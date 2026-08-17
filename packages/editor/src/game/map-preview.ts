/** A throwaway walk through an unsaved authored map, using the shipped movement and render paths. */

import { createHeroController } from "@lindocara/client/game/hero-controller.js";
import { acquireStageCanvas, releaseStageCanvas } from "@lindocara/client/game/stage-canvas.js";
import { t } from "@lindocara/client/i18n.js";
import {
  BODY_VARIANTS,
  type CharacterAppearance,
  PRIMARY_COLORS,
  starterEquipmentFor,
} from "@lindocara/engine/character.js";
import {
  defaultMonsterTuning,
  GUARD_MAX_HP,
  MONSTER_SPECIES_KIND,
} from "@lindocara/engine/game.js";
import { harvestGroundColliderAt } from "@lindocara/engine/harvest.js";
import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { type ColliderRect, createColliderIndex } from "@lindocara/engine/hd2d/collider-index.js";
import type { HeroState } from "@lindocara/engine/hd2d/hero-state.js";
import type { MapData } from "@lindocara/engine/map-data.js";
import { guardEvents, type MapEvent, monsterEvents } from "@lindocara/engine/map-events.js";
import type { MapHeroSettings } from "@lindocara/engine/map-hero-settings.js";
import { mapHeroClassSettings } from "@lindocara/engine/map-hero-settings.js";
import {
  DEFAULT_MAP_FIXED_LIGHTING,
  type MapFixedLighting,
} from "@lindocara/engine/map-lighting.js";
import { nativeHarvestEvents } from "@lindocara/engine/native-harvest.js";
import type {
  GuardSnapshot,
  MonsterSnapshot,
  PlayerSnapshot,
  QuestState,
} from "@lindocara/engine/protocol.js";
import type { Input } from "@lindocara/engine/simulation.js";
import { BODY_RADIUS, zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import type { AmbienceConfig } from "@lindocara/renderer/ambience.js";
import { fixedLightingOverride } from "@lindocara/renderer/hd2d/day-cycle.js";
import { Hd2dRenderer } from "@lindocara/renderer/hd2d/game-renderer.js";
import { trackInput } from "@lindocara/renderer/input.js";
import type { RenderContext } from "@lindocara/renderer/renderer-api.js";
import {
  authoredEventPreviewSnapshots,
  authoredSeaGuardianPreviewSnapshots,
} from "./event-preview.js";

const SELF_ID = "map-preview-self";
const PREVIEW_QUEST: QuestState = {
  chapter: "three_offerings",
  status: "available",
  progress: 0,
  target: 3,
};
const ZOOM_STEP = 1.25;
const MAX_PREVIEW_FRAME_SECONDS = 0.05;

function randomAppearance(): CharacterAppearance {
  const body = BODY_VARIANTS[Math.floor(Math.random() * BODY_VARIANTS.length)] ?? "wayfarer";
  const primaryColor = PRIMARY_COLORS[Math.floor(Math.random() * PRIMARY_COLORS.length)] ?? "azure";
  return { body, primaryColor };
}

function wheelZoomRatio(deltaY: number): number {
  return Math.exp(-Math.max(-240, Math.min(240, deltaY)) * 0.0016);
}

function bodyAt(x: number, z: number): ColliderRect {
  return { x: x - BODY_RADIUS, z: z - BODY_RADIUS, w: BODY_RADIUS * 2, h: BODY_RADIUS * 2 };
}

function overlaps(a: ColliderRect, b: ColliderRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.z < b.z + b.h && a.z + a.h > b.z;
}

let previewGeneration = 0;

export interface MapPreviewOptions {
  heroSettings?: MapHeroSettings;
  dayNightCycle?: boolean;
  fixedLighting?: MapFixedLighting;
  playerChrome?: boolean;
  /** Retained for callers; HD-2D ambience is part of the scene rather than a preview-only switch. */
  ambience?: AmbienceConfig;
  /** Camera multiplier. 1 is the game framing, below 1 pulls back. */
  zoom?: number;
  zoomControls?: boolean;
  /** DEV witness input, still fed through the real hero controller rather than moving it directly. */
  scriptedInput?: (elapsedMs: number) => Input;
  /** DEV witness observation of the same state handed to the renderer. */
  onHeroState?: (state: Readonly<HeroState>) => void;
}

export async function startMapPreview(
  data: MapData,
  events: readonly MapEvent[] = [],
  options: MapPreviewOptions = {},
): Promise<{ stop(): void }> {
  const generation = ++previewGeneration;
  // A hold on the shared canvas, dropped in `stop()` and on the stale-generation abort below.
  const canvas = acquireStageCanvas();

  const runtimeEvents = [...events, ...nativeHarvestEvents(data.elements, events.length + 1)];
  const heightfield = compileAuthoredMap(data, runtimeEvents);
  const staticTerrain = zoneTerrainFromHeightfield(heightfield);
  const spawn = heightfield.spawns.find((candidate) => candidate.name === "default") ??
    heightfield.spawns[0] ?? { x: 0, z: 0 };
  const spawnY = staticTerrain.query.heightAt(spawn.x, spawn.z) ?? heightfield.waterLevel;
  const colliders = createColliderIndex();
  for (const collider of staticTerrain.colliders.all) colliders.add(collider);
  const pendingHarvestColliders = new Map<string, ColliderRect>();
  for (const event of runtimeEvents) {
    if (event.kind !== "harvestable" || !event.harvestProfile) continue;
    const collider = harvestGroundColliderAt(
      event.harvestProfile,
      event.col,
      event.row,
      "intact",
      heightfield.size,
    );
    if (!collider) continue;
    if (overlaps(collider, bodyAt(spawn.x, spawn.z)))
      pendingHarvestColliders.set(event.id, collider);
    else colliders.add(collider);
  }
  const terrain = { ...staticTerrain, colliders };
  const renderer = await Hd2dRenderer.create(canvas);
  if (generation !== previewGeneration) {
    renderer.destroy();
    releaseStageCanvas();
    return { stop() {} };
  }

  renderer.setDayCycleOverride(
    options.dayNightCycle === false
      ? fixedLightingOverride(options.fixedLighting ?? DEFAULT_MAP_FIXED_LIGHTING)
      : null,
  );
  renderer.configureMapTerrain(`preview:${generation}`, [], generation, heightfield);
  renderer.setSelfId(SELF_ID);

  let zoom = Math.max(0.02, Math.min(2.5, options.zoom ?? 1));
  const applyZoom = (): void => renderer.setCameraZoom(zoom * 100);
  applyZoom();

  const onZoomKey = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
    if (event.key === "-" || event.key === "_") zoom /= ZOOM_STEP;
    else if (event.key === "+" || event.key === "=") zoom *= ZOOM_STEP;
    else if (event.key === "0") zoom = options.zoom ?? 1;
    else return;
    zoom = Math.max(0.02, Math.min(2.5, zoom));
    applyZoom();
    event.preventDefault();
  };
  const onWheel = (event: WheelEvent): void => {
    if (event.ctrlKey) return;
    zoom = Math.max(0.02, Math.min(2.5, zoom * wheelZoomRatio(event.deltaY)));
    applyZoom();
    event.preventDefault();
  };
  if (options.zoomControls) {
    window.addEventListener("keydown", onZoomKey);
    window.addEventListener("wheel", onWheel, { passive: false });
  }

  const hero = createHeroController({
    terrain,
    spawn: { x: spawn.x, y: spawnY, z: spawn.z },
    speed: mapHeroClassSettings(options.heroSettings, "warrior").stats.movementSpeed,
  });
  const appearance = randomAppearance();
  const baseSelf: Omit<
    PlayerSnapshot,
    "x" | "y" | "z" | "vy" | "airborne" | "swimming" | "gliding" | "facing"
  > = {
    id: SELF_ID,
    nick: t("editor.preview"),
    hp: 100,
    maxHp: 100,
    level: 1,
    appearance,
    class: "warrior",
    equipment: starterEquipmentFor("warrior"),
    life: "alive",
    action: null,
  };

  const previewMonsters: MonsterSnapshot[] = monsterEvents(events).flatMap((event) => {
    const species = event.species;
    if (species === null) return [];
    const tuning = {
      ...defaultMonsterTuning(species),
      ...(event.monsterRank ? { rank: event.monsterRank } : {}),
      ...(event.monsterMaxHp === null || event.monsterMaxHp === undefined
        ? {}
        : { maxHp: event.monsterMaxHp }),
      ...(event.monsterSpecialTechnique ? { specialTechnique: event.monsterSpecialTechnique } : {}),
    };
    const x = event.col + 0.5 - heightfield.size / 2;
    const z = event.row + 0.5 - heightfield.size / 2;
    return [
      {
        id: `preview-monster-${event.id}`,
        name: event.name,
        kind: MONSTER_SPECIES_KIND[species],
        species,
        rank: tuning.rank,
        specialTechnique: tuning.specialTechnique,
        x,
        y: terrain.query.heightAt(x, z) ?? heightfield.waterLevel,
        z,
        hp: tuning.maxHp,
        maxHp: tuning.maxHp,
        dead: false,
        graphicAssetId: event.pages[0]?.graphicAssetId ?? null,
        facing: { x: 0, z: 1 },
        action: null,
      },
    ];
  });
  const previewGuards: GuardSnapshot[] = guardEvents(events).flatMap((event) => {
    const page = event.pages[0];
    if (!page) return [];
    const x = event.col + 0.5 - heightfield.size / 2;
    const z = event.row + 0.5 - heightfield.size / 2;
    return [
      {
        id: `preview-guard-${event.id}`,
        x,
        y: terrain.query.heightAt(x, z) ?? heightfield.waterLevel,
        z,
        hp: GUARD_MAX_HP,
        maxHp: GUARD_MAX_HP,
        homeX: x,
        homeZ: z,
        fighting: false,
        graphicAssetId: page.graphicAssetId,
        graphicTint: page.graphicTint ?? 0xffffff,
      },
    ];
  });
  const worldEvents = authoredEventPreviewSnapshots(runtimeEvents, "playable-preview");
  const previewSeaGuardians = authoredSeaGuardianPreviewSnapshots(
    events,
    heightfield.size,
    heightfield.waterLevel,
  );
  renderer.preloadWorldEventAssets(worldEvents);

  const tracker = trackInput();
  const playerChrome = options.playerChrome ?? true;
  let previewElapsedMs = 0;
  renderer.onFrame((now, frameDt) => {
    const dt = Math.min(MAX_PREVIEW_FRAME_SECONDS, Math.max(0, frameDt));
    previewElapsedMs += dt * 1_000;
    const input = options.scriptedInput?.(previewElapsedMs) ?? tracker.current();
    hero.step(
      {
        x: Number(input.right) - Number(input.left),
        z: Number(input.down) - Number(input.up),
        jump: input.jump ?? false,
      },
      dt,
    );
    const state = hero.state;
    for (const [eventId, collider] of pendingHarvestColliders) {
      if (overlaps(collider, bodyAt(state.x, state.z))) continue;
      colliders.add(collider);
      pendingHarvestColliders.delete(eventId);
    }
    const self: PlayerSnapshot = {
      ...baseSelf,
      x: state.x,
      y: state.y,
      z: state.z,
      vy: state.vy,
      airborne: state.airborne,
      swimming: state.swimming,
      gliding: state.gliding,
      facing: hero.facing,
    };
    const context: RenderContext = {
      self,
      quest: PREVIEW_QUEST,
      now,
      healthBars: playerChrome ? "both" : "none",
      grid: false,
    };
    renderer.render(
      {
        players: [self],
        seaGuardians: previewSeaGuardians,
        monsters: previewMonsters,
        guards: previewGuards,
        loot: [],
        corpses: [],
        projectiles: [],
        events: worldEvents,
      },
      context,
    );
    options.onHeroState?.(state);
  });

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (options.zoomControls) {
        window.removeEventListener("keydown", onZoomKey);
        window.removeEventListener("wheel", onWheel);
      }
      tracker.stop();
      renderer.destroy();
      releaseStageCanvas();
    },
  };
}
