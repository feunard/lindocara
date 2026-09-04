/**
 * The game's renderer — the only one, since S3 retired the PixiJS path (2026-08-04).
 *
 * It draws the world's GROUND — terrain, sea, foam, sky and light, from the welcome's heightfield —
 * its actors, scenery, runtime event appearances, secondary entities and combat/interaction
 * presentation. `visual-layer.ts` owns transient geometry and screen projection while this adapter
 * keeps game-domain choices out of `@lindocara/hd2d`.
 *
 * Actors cycle their idle sheets; reported `vy` drives stretch/squash and a gliding player carries
 * a dedicated canopy billboard.
 */

import type { AuthoredQuestMarker } from "@lindocara/engine/adventure-state.js";
import {
  buildingFaction,
  type BuildingArchetype,
  type BuildingFaction,
  visualBuildingArchetype,
} from "@lindocara/engine/buildings.js";
import type { PrimaryColor } from "@lindocara/engine/character.js";
import type { MonsterSpecies, PlayerClass } from "@lindocara/engine/game.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { HeroEvent } from "@lindocara/engine/hd2d/hero-state.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import type { MapElement } from "@lindocara/engine/map-data.js";
import type { MapWeather } from "@lindocara/engine/map-weather.js";
import type { MerchantDefinition } from "@lindocara/engine/merchant.js";
import type {
  CombatActionSnapshot,
  CombatAnimation,
  GuardSnapshot,
  MonsterSpecialImpact,
  PeasantBombImpactVisual,
  PeasantCampVisual,
  PeasantRationVisual,
  PlayerSnapshot,
  PriestLumenPortalVisual,
  PriestLumenTrailVisual,
  PriestPolarityOrbVisual,
  RogueShadowDanceSequence,
  WorldBuildingSnapshot,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import type { SeaGuardianState } from "@lindocara/engine/sea-guardian.js";
import {
  isSheepAssetId,
  type SHEEP_ASSET_IDS,
  SHEEP_RENDER_HEIGHT,
} from "@lindocara/engine/sheep.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  EDITOR_ASSETS,
  editorAsset,
  guardPrimaryColorForAsset,
  LINDOCARA_CAMPFIRE_ASSET_ID,
  LINDOCARA_CHEST_CLOSED_ASSET_ID,
  LINDOCARA_CHEST_OPEN_ASSET_ID,
  LINDOCARA_INTERIOR_ASSET_IDS,
  LINDOCARA_PICKUP_ASSET_IDS,
  LINDOCARA_PICKUP_FLOAT_HEIGHT,
  LINDOCARA_RUNNER_ASSET_IDS,
  NPC_MODEL_ASSETS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import {
  undergroundDepthAtElevation,
  undergroundFloorHeight,
  undergroundVisibleDepthsAtElevation,
} from "@lindocara/engine/underground.js";
import type { Facing } from "@lindocara/hd2d/billboard.js";
import { fetchAll } from "@lindocara/hd2d/loader.js";
import type { Water } from "@lindocara/hd2d/terrain/water.js";
import type {
  TextureCache,
  TextureRegistry,
  TextureSource,
  TextureSpec,
} from "@lindocara/hd2d/textures.js";
import { createTextureCache, createTextureRegistry } from "@lindocara/hd2d/textures.js";
import * as THREE from "three";

import { ACTOR_FRAME_MS, type ActorMotion, ActorMotionTracker } from "../actor-motion.js";
import { CameraShake, heroLandingImpulse, SHEEP_EXPLOSION_SHAKE } from "../camera-shake.js";
import { CHARACTER_ATLAS_URL } from "../character-art.js";
import {
  allCombatSheets,
  combatActionFrameIndex,
  combatArt,
  type MonsterImpactSound,
  monsterCombatArt,
  monsterSpecialImpactArt,
  multiImpactActionFrameIndex,
  teleportEffectArt,
} from "../combat-art.js";
import { mobilityRenderOffset, mobilityVisual } from "../combat-motion.js";
import { CombatVisualAuthority } from "../combat-visual-state.js";
import { shouldShowHealthBar } from "../display-settings.js";
import {
  allEnemySheets,
  isRootMinotaurSkillId,
  ROOT_MINOTAUR_DEATH_SHEET,
  rootMinotaurSkillSheet,
  TINY_SWORDS_ENEMIES,
} from "../enemy-art.js";
import { sameRenderedMap } from "../map-render-cache.js";
import type { RenderContext, RendererLike } from "../renderer-api.js";
import type { SceneSample } from "../scene-sample.js";
import { ServerClock } from "../server-clock.js";
import {
  allUnitSheets,
  assassinSkillActiveFrame,
  assassinSkillSheet,
  ASSASSIN_DEATH_SHEET,
  isAssassinSkillId,
  isPeasantSkillId,
  isPriestBonusSkillId,
  PEASANT_BONUS_DEATH_SHEET,
  peasantBonusCarrySheet,
  peasantBonusSkillActiveFrame,
  peasantBonusSkillSheet,
  peasantCarrySheet,
  peasantCasterSheet,
  PRIEST_BONUS_DEATH_SHEET,
  priestBonusSkillActiveFrame,
  priestBonusSkillSheet,
  isRangerBonusSkillId,
  RANGER_BONUS_DEATH_SHEET,
  rangerBonusSkillActiveFrame,
  rangerBonusSkillSheet,
  RUNIC_GUARDIAN_DEATH_SHEET,
  type UnitSheet,
  unitSheet,
} from "../tiny-swords-art.js";
import { tinySwordsSourceUrl } from "../tiny-swords-assets.js";
import { WorldEventMotionTracker } from "../world-event-motion.js";
import type { ActorView, BillboardRegistry, BillboardScene } from "./billboards.js";
import { createBillboardRegistry, LAB_UNIT_HEIGHT } from "./billboards.js";
import type { DayCycleOverride } from "./day-cycle.js";
import type { Hd2dScene } from "./scene.js";
import {
  createHd2dScene,
  exactStoreyVisible,
  HD2D_CAMERA,
  HD2D_TEXTURE_URLS,
  surfaceAccessPreviewAt,
  waterPlaneKey,
} from "./scene.js";
import type { StaticContent, StaticContentEvent, StaticSpriteArt } from "./static-content.js";
import { authoredMaterialAt, placeStaticContent } from "./static-content.js";
import type { StructureVolumeKind } from "./structure-volumes.js";
import {
  actorUndergroundVisibilityAt,
  groundedUndergroundVisibilityDepth,
  type StableUndergroundVisibility,
  undergroundVisibilityTransitionAt,
} from "./underground-visibility.js";
import {
  HD2D_SHEEP_EXPLOSION_TEXTURE_URL,
  HD2D_SPLASH_TEXTURE_URL,
  type Hd2dEditorOverlay,
  Hd2dVisualLayer,
} from "./visual-layer.js";

/** The map-editor spawn marker's ghost knight. The exact id the palette itself draws blue warriors
 *  with (`GUARD_ASSET_BY_COLOR.azure`, `@lindocara/engine/tiny-swords-catalog.js`) — a real
 *  catalogue entry, not a hardcoded URL, so a future recolour of the warrior sheet updates the
 *  marker too. */
const EDITOR_SPAWN_KNIGHT_ASSET_ID = "character.units-blue-units-warrior.warrior-idle";
const LINDOCARA_PICKUP_ASSET_ID_SET: ReadonlySet<string> = new Set(
  Object.values(LINDOCARA_PICKUP_ASSET_IDS),
);
const LINDOCARA_BENEFICIAL_PICKUP_ASSET_ID_SET: ReadonlySet<string> = new Set([
  LINDOCARA_PICKUP_ASSET_IDS.speed_boost,
  LINDOCARA_PICKUP_ASSET_IDS.light_gravity,
  LINDOCARA_PICKUP_ASSET_IDS.double_jump,
]);

// --- actor art direction --------------------------------------------------------------------------

/** The generated guardian fills more of its 192 px frame than the stock roster. A small
 * presentation-only reduction aligns its visible stature without changing collision or reach. */
const RUNIC_GUARDIAN_RENDER_SCALE = 0.92;
/** The Assassin bake is normalized smaller than the guardian, then reduced once more here so its
 * visible stature stays close to the compact stock Thief instead of reading as a mini-boss. */
const ASSASSIN_RENDER_SCALE = 0.9;
/** The animated Peasant uses the same normalized 96 px body target as the Assassin. */
const PEASANT_BONUS_RENDER_SCALE = 0.9;
/** The hooded Ranger shares the compact player silhouette used by the Assassin and Peasant. */
const RANGER_BONUS_RENDER_SCALE = 0.9;
/** The elderly Priest shares the same normalized player height as the other generated bodies. */
const PRIEST_BONUS_RENDER_SCALE = 0.9;
const ROOT_MINOTAUR_FRAME_MS = { idle: 1_000 / 3, run: 1_000 / 16 } as const;
const ROOT_MINOTAUR_DEATH_DURATION_MS = 1_000;

/**
 * Which sheet each kind of actor draws with — the ADAPTER's knowledge, exactly like the terrain
 * atlases in `scene.ts`. `billboards.ts` never sees a class, a species or a faction colour.
 *
 * Idle/run/attack are selected from presentation facts already in the frame: position deltas and
 * the server-owned action timeline.
 */
export function playerActorSheet(player: PlayerSnapshot, motion: ActorMotion): UnitSheet {
  if (player.appearance.body === "assassin") {
    if (motion === "attack" && player.action?.skillId && isAssassinSkillId(player.action.skillId)) {
      return assassinSkillSheet(player.action.skillId);
    }
    return unitSheet(player.class, player.appearance, motion);
  }
  if (player.appearance.body === "peasant") {
    if (motion === "attack" && player.action?.skillId && isPeasantSkillId(player.action.skillId)) {
      return peasantBonusSkillSheet(player.action.skillId, player.action.peasantTool);
    }
    if (motion !== "attack" && player.peasantCarry) {
      return peasantBonusCarrySheet(player.peasantCarry.kind, motion);
    }
    return unitSheet(player.class, player.appearance, motion);
  }
  if (
    player.appearance.body === "ranger" &&
    motion === "attack" &&
    player.action?.skillId &&
    isRangerBonusSkillId(player.action.skillId)
  ) {
    return rangerBonusSkillSheet(player.action.skillId);
  }
  if (
    player.appearance.body === "priest" &&
    motion === "attack" &&
    player.action?.skillId &&
    isPriestBonusSkillId(player.action.skillId)
  ) {
    return priestBonusSkillSheet(player.action.skillId);
  }
  // This temporary bonus is intentionally one coherent directional bake. Replacing its attack
  // pose with the ordinary Warrior caster sheet would make the model change identity mid-swing;
  // combat effects and authoritative contact timing still render through the normal layers.
  if (player.appearance.body === "runic_guardian") {
    // Its shield-bash art is the forward-leaning run cycle: the generic sword attack planted both
    // feet during the authoritative displacement, so the body looked teleported even once the
    // position itself was eased. The action timeline still drives this strip as a one-shot charge.
    const runicMotion = player.action?.skillId === "shield_bash" ? "run" : motion;
    return unitSheet(player.class, player.appearance, runicMotion);
  }
  if (motion === "attack" && player.class === "warrior" && player.guarding === true) {
    const guard = combatArt("warrior", "iron_guard", player.appearance.primaryColor).caster;
    return {
      source: guard.source,
      frames: guard.frames,
      frameWidth: guard.frameWidth,
      frameHeight: guard.frameHeight,
      footOffset: 56,
    };
  }
  if (player.class === "peasant") {
    if (motion === "attack" && player.action?.skillId && isPeasantSkillId(player.action.skillId)) {
      return peasantCasterSheet(
        player.appearance.primaryColor,
        player.action.skillId,
        player.action.peasantTool,
      );
    }
    if (motion !== "attack" && player.peasantCarry) {
      return peasantCarrySheet(player.appearance.primaryColor, player.peasantCarry.kind, motion);
    }
  }
  if (motion === "attack" && player.action?.skillId) {
    const base = unitSheet(player.class, player.appearance, motion);
    const caster = combatArt(
      player.class,
      player.action.skillId,
      player.appearance.primaryColor,
    ).caster;
    return {
      ...base,
      source: caster.source,
      frames: caster.frames,
      frameWidth: caster.frameWidth,
      frameHeight: caster.frameHeight,
    };
  }
  return unitSheet(player.class, player.appearance, motion);
}

/** The species remains the authoritative combat model; `graphicAssetId` changes presentation only.
 *  Actor-capable catalogue appearances are finite and preloaded below, so the editor preview and
 *  runtime draw the exact same authored monster without teaching combat a fake species. */
export interface BillboardActorSheet {
  source: string;
  frames: number;
  frameWidth?: number;
  frameHeight?: number;
  footOffset?: number;
  renderHeight?: number;
  axis?: "x" | "y";
  directionRows?: number;
}

const NPC_MODEL_ASSET_IDS = new Set(NPC_MODEL_ASSETS.map((asset) => asset.id));

const SHEEP_ACTOR_SHEETS: Readonly<
  Record<(typeof SHEEP_ASSET_IDS)[number], Readonly<Record<"idle" | "run", BillboardActorSheet>>>
> = {
  "resource.terrain-resources-meat-sheep.sheep-idle": {
    idle: {
      source: tinySwordsSourceUrl(
        "Tiny Swords (Free Pack)/Terrain/Resources/Meat/Sheep/Sheep_Idle.png",
      ),
      frames: 6,
      frameWidth: 128,
      frameHeight: 128,
      footOffset: 44,
      axis: "x",
    },
    run: {
      source: tinySwordsSourceUrl(
        "Tiny Swords (Free Pack)/Terrain/Resources/Meat/Sheep/Sheep_Move.png",
      ),
      frames: 4,
      frameWidth: 128,
      frameHeight: 128,
      footOffset: 44,
      axis: "x",
    },
  },
  "resource.resources-sheep.happysheep-idle": {
    idle: {
      source: tinySwordsSourceUrl("Tiny Swords (Update 010)/Resources/Sheep/HappySheep_Idle.png"),
      frames: 8,
      frameWidth: 128,
      frameHeight: 128,
      footOffset: 42,
      axis: "x",
    },
    run: {
      source: tinySwordsSourceUrl(
        "Tiny Swords (Update 010)/Resources/Sheep/HappySheep_Bouncing.png",
      ),
      frames: 6,
      frameWidth: 128,
      frameHeight: 128,
      footOffset: 42,
      axis: "x",
    },
  },
};

export const SHEEP_ACTOR_FRAME_MS = { idle: 1_000 / 6, run: 1_000 / 9 } as const;

export function authoredActorSheet(
  graphicAssetId: string | null | undefined,
  motion: ActorMotion,
): BillboardActorSheet | null {
  if (isSheepAssetId(graphicAssetId)) {
    return SHEEP_ACTOR_SHEETS[graphicAssetId][motion === "run" ? "run" : "idle"];
  }
  if (!graphicAssetId || !NPC_MODEL_ASSET_IDS.has(graphicAssetId)) return null;
  const asset = editorAsset(graphicAssetId);
  if (!asset) return null;
  const selected =
    motion === "run" && asset.motions?.run
      ? asset.motions.run
      : motion === "attack" && asset.motions?.attack
        ? asset.motions.attack
        : asset;
  const frame = selected.frame;
  return {
    source: tinySwordsSourceUrl(selected.sourcePath),
    frames: frame?.count ?? 1,
    frameWidth: frame?.width ?? asset.width,
    frameHeight: frame?.height ?? asset.height,
    footOffset: selected.footOffset,
    axis: frame?.axis ?? "x",
  };
}

export function monsterActorSheet(
  species: MonsterSpecies,
  motion: ActorMotion,
  graphicAssetId?: string | null,
  skillId?: string,
): BillboardActorSheet {
  const authored = authoredActorSheet(graphicAssetId, motion);
  if (authored) return authored;
  if (
    species === "minotaur_brute" &&
    motion === "attack" &&
    skillId !== undefined &&
    isRootMinotaurSkillId(skillId)
  ) {
    return rootMinotaurSkillSheet(skillId);
  }
  return TINY_SWORDS_ENEMIES[species][motion];
}

function actorSheetView(sheet: BillboardActorSheet) {
  return {
    textureKey: sheet.source,
    frames: sheet.frames,
    ...(sheet.frameWidth === undefined ? {} : { frameWidth: sheet.frameWidth }),
    ...(sheet.frameHeight === undefined ? {} : { frameHeight: sheet.frameHeight }),
    frameAxis: sheet.axis ?? ("x" as const),
    ...(sheet.directionRows === undefined ? {} : { directionRows: sheet.directionRows }),
    ...(sheet.renderHeight === undefined ? {} : { renderHeight: sheet.renderHeight }),
    ...(sheet.footOffset === undefined || sheet.frameHeight === undefined
      ? {}
      : { foot: sheet.footOffset / sheet.frameHeight }),
  };
}

/**
 * The wire's last-accepted movement vector, as one of the four names a billboard understands.
 *
 * The dominant axis wins. A ZERO vector answers `"north"` rather than falling through to `"east"`:
 * north and south are `facingToFlip`'s no-ops, so "no direction" leaves the sprite turned the way
 * it already was — where `"east"` would snap a westward hero around the instant the server ever
 * sent a zeroed facing.
 */
/** `z` is the screen-down ground axis, so a negative `z` faces north exactly as a negative pixel
 *  `y` used to. */
function facingOf(vector: GroundVector): Facing {
  if (vector.x === 0 && vector.z === 0) return "north";
  if (Math.abs(vector.x) >= Math.abs(vector.z)) return vector.x < 0 ? "west" : "east";
  return vector.z < 0 ? "north" : "south";
}

/**
 * One player snapshot, as the actor the registry draws.
 *
 * Exported, and a function rather than an object literal inlined in `#collectActors`, for one
 * reason: this is the seam the wire's locomotion state crosses into the renderer's. A flag dropped
 * here is a flag `billboards.ts` can do nothing with, and every placement test in the package would
 * still pass — so the seam is pinned by `hd2d-remote-state.test.ts` instead of trusted.
 *
 * All three flags and the elevation ride across untouched. `billboards.ts` decides what to do with
 * them; this only refuses to lose them.
 */
/** Locomotion flags for room-stepped actors which are always grounded (guards and corpses). */
const GROUNDED = { airborne: false, swimming: false, gliding: false } as const;

/** A tracked hero stays in its resolved room; only a real stair/shaft transition may change it. */
export function actorUndergroundVisibilityDepth(
  elevation: number,
  trackedHero: boolean,
  transitioning: boolean,
  stableDepth: number | null,
): number | null {
  // Elevation alone cannot distinguish a raised surface tile from an upper storey. The local
  // hero's stable depth was resolved against the authored floors immediately above, so reuse it
  // both while grounded and during an ordinary jump. A genuine access transition deliberately
  // falls through to elevation so the actor moves progressively between the two visible floors.
  return trackedHero && !transitioning ? stableDepth : undergroundDepthAtElevation(elevation);
}

export const HD2D_GLIDER_TEXTURE_URL = "/assets/lindocara/hd2d/glider.png";
export const SEA_GUARDIAN_SWIM_TEXTURE_URL = "/assets/lindocara/hd2d/sea-guardian-swim.png";
export const SEA_GUARDIAN_SWIM_UP_TEXTURE_URL = "/assets/lindocara/hd2d/sea-guardian-swim-up.png";
export const SEA_GUARDIAN_SWIM_DOWN_TEXTURE_URL =
  "/assets/lindocara/hd2d/sea-guardian-swim-down.png";
export const SEA_GUARDIAN_ATTACK_TEXTURE_URL = "/assets/lindocara/hd2d/sea-guardian-attack.png";
export const SEA_GUARDIAN_DIVE_CYCLE_MS = 14_000;
const SEA_GUARDIAN_DIVE_START_MS = 7_000;
const SEA_GUARDIAN_DIVE_TRANSITION_MS = 1_200;
const SEA_GUARDIAN_DIVE_HOLD_MS = 3_500;
const SEA_GUARDIAN_SURFACE_DEPTH = 0.48;
const SEA_GUARDIAN_SUBMERGED_DEPTH = 2.35;
const SEA_GUARDIAN_SUBMERGED_OPACITY = 0.06;

export interface SeaGuardianPresentation {
  waterDepth: number;
  opacity: number;
}

function seaGuardianPhaseOffset(id: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % SEA_GUARDIAN_DIVE_CYCLE_MS;
}

function smoothDive(value: number): number {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

/** Periodic patrol-only dive. Chasing and attacking stay readable gameplay threats. */
export function seaGuardianPresentation(
  id: string,
  state: SeaGuardianState,
  now: number,
): SeaGuardianPresentation {
  if (state === "attack") return { waterDepth: 0.18, opacity: 1 };
  if (state === "chase") return { waterDepth: SEA_GUARDIAN_SURFACE_DEPTH, opacity: 1 };
  const phase =
    (((now + seaGuardianPhaseOffset(id)) % SEA_GUARDIAN_DIVE_CYCLE_MS) +
      SEA_GUARDIAN_DIVE_CYCLE_MS) %
    SEA_GUARDIAN_DIVE_CYCLE_MS;
  const descentEnd = SEA_GUARDIAN_DIVE_START_MS + SEA_GUARDIAN_DIVE_TRANSITION_MS;
  const holdEnd = descentEnd + SEA_GUARDIAN_DIVE_HOLD_MS;
  const ascentEnd = holdEnd + SEA_GUARDIAN_DIVE_TRANSITION_MS;
  const amount =
    phase < SEA_GUARDIAN_DIVE_START_MS || phase >= ascentEnd
      ? 0
      : phase < descentEnd
        ? smoothDive((phase - SEA_GUARDIAN_DIVE_START_MS) / SEA_GUARDIAN_DIVE_TRANSITION_MS)
        : phase < holdEnd
          ? 1
          : 1 - smoothDive((phase - holdEnd) / SEA_GUARDIAN_DIVE_TRANSITION_MS);
  return {
    waterDepth: THREE.MathUtils.lerp(
      SEA_GUARDIAN_SURFACE_DEPTH,
      SEA_GUARDIAN_SUBMERGED_DEPTH,
      amount,
    ),
    opacity: THREE.MathUtils.lerp(1, SEA_GUARDIAN_SUBMERGED_OPACITY, amount),
  };
}

/** Directional swim sheet; side-facing movement keeps the original mirrored profile. */
export function seaGuardianSwimTextureUrl(facing: GroundVector): string {
  const direction = facingOf(facing);
  if (direction === "north") return SEA_GUARDIAN_SWIM_UP_TEXTURE_URL;
  if (direction === "south") return SEA_GUARDIAN_SWIM_DOWN_TEXTURE_URL;
  return SEA_GUARDIAN_SWIM_TEXTURE_URL;
}

/** True only while the held Lumen Step has replaced the Priest's body with its cloud. */
export function isLumenStepClouded(
  action: CombatActionSnapshot | null,
  actionElapsedMs: number,
): boolean {
  if (action?.skillId !== "blink") return false;
  const impactElapsed = action.impactAt - action.startedAt;
  const recoveryElapsed = action.recoveryEndsAt - action.startedAt;
  if (actionElapsedMs < impactElapsed || actionElapsedMs >= recoveryElapsed) return false;
  return (
    action.channelEndsAt === undefined || actionElapsedMs <= action.channelEndsAt - action.startedAt
  );
}

export function playerActorView(
  player: PlayerSnapshot,
  animationTimeMs = 0,
  motion: ActorMotion = "idle",
  animationDurationMs?: number,
  isSelf = false,
): ActorView {
  const sheet = playerActorSheet(player, motion);
  const runic = player.appearance.body === "runic_guardian";
  const assassin = player.appearance.body === "assassin";
  const peasantBonus = player.appearance.body === "peasant";
  const rangerBonus = player.appearance.body === "ranger";
  const priestBonus = player.appearance.body === "priest";
  const clouded = player.class === "priest" && isLumenStepClouded(player.action, animationTimeMs);
  const lumenCloud = clouded
    ? combatArt("priest", "blink", player.appearance.primaryColor).impact
    : undefined;
  return {
    id: player.id,
    kind: "player",
    x: player.x,
    y: player.y,
    z: player.z,
    airborne: player.airborne,
    swimming: player.swimming,
    gliding: player.gliding,
    vy: player.vy ?? 0,
    canopyTextureKey: HD2D_GLIDER_TEXTURE_URL,
    facing: facingOf(player.facing),
    ...(sheet.directionRows === undefined ? {} : { directionalFacing: player.facing }),
    ...(lumenCloud
      ? {
          textureKey: lumenCloud.source,
          frames: lumenCloud.frames,
          frameWidth: lumenCloud.frameWidth,
          frameHeight: lumenCloud.frameHeight,
          frameAxis: "x" as const,
          foot: 0,
          renderHeight: Math.max(
            0.42,
            (lumenCloud.frameHeight / 192) * 2.6 * (lumenCloud.scale ?? 1),
          ),
          ...(lumenCloud.tint === undefined ? {} : { tint: lumenCloud.tint }),
        }
      : actorSheetView(sheet)),
    ...(!clouded && runic
      ? { renderHeight: LAB_UNIT_HEIGHT * RUNIC_GUARDIAN_RENDER_SCALE }
      : !clouded && assassin
        ? { renderHeight: LAB_UNIT_HEIGHT * ASSASSIN_RENDER_SCALE }
        : !clouded && peasantBonus
          ? { renderHeight: LAB_UNIT_HEIGHT * PEASANT_BONUS_RENDER_SCALE }
          : !clouded && rangerBonus
            ? { renderHeight: LAB_UNIT_HEIGHT * RANGER_BONUS_RENDER_SCALE }
            : !clouded && priestBonus
              ? { renderHeight: LAB_UNIT_HEIGHT * PRIEST_BONUS_RENDER_SCALE }
              : {}),
    animationTimeMs,
    ...(animationDurationMs === undefined ? {} : { animationDurationMs }),
    // Four distinct Runic Guardian poses form the same half-second cycle as a stock six-frame
    // warrior at 12 fps. Playing those four at 12 fps made each contact too brief to read.
    frameDurationMs:
      runic && motion === "run"
        ? 1_000 / 8
        : assassin && motion === "run"
          ? 1_000 / 16
          : assassin && motion === "idle"
            ? 1_000 / 3
            : peasantBonus && motion === "run"
              ? 1_000 / (player.peasantCarry ? 14 : 60)
              : peasantBonus && motion === "idle"
                ? 1_000 / 3
                : rangerBonus && motion === "run"
                  ? 1_000 / 16
                  : rangerBonus && motion === "idle"
                    ? 1_000 / 3
                    : priestBonus && motion === "run"
                      ? 1_000 / 16
                      : priestBonus && motion === "idle"
                        ? 1_000 / 2.5
                        : ACTOR_FRAME_MS[motion],
    animationLoop: clouded || player.guarding === true || motion !== "attack",
    opacity:
      player.life === "ghost"
        ? 0.48
        : player.silhouette
          ? 0.9
          : player.invisible
            ? isSelf
              ? 0.28
              : 0.06
            : 1,
    ...(player.life === "ghost" ? { pose: "ghost" as const } : {}),
  };
}

/** A guard is a Tiny Swords unit like any other — the same warrior sheet the deleted PixiJS path
 *  gave it, in the faction colour its authored asset id implies. */
export function guardSheet(
  guard: Pick<GuardSnapshot, "graphicAssetId">,
  motion: ActorMotion,
): BillboardActorSheet {
  return (
    authoredActorSheet(guard.graphicAssetId, motion) ??
    unitSheet(
      "warrior",
      { body: "wayfarer", primaryColor: guardPrimaryColorForAsset(guard.graphicAssetId) },
      motion,
    )
  );
}

/**
 * Every sheet the three functions above can name, deduplicated — the registry's `get` throws on a
 * texture nobody preloaded, and a hero walking into a species that was never downloaded must not be
 * the thing that finds out.
 *
 * `atlas` stays false, as it does for every sprite sheet in the lab's own catalogue: a sprite is
 * sampled frame by frame but it is also seen at every distance, so it keeps its mipmaps (the
 * tilesets and the foam are the atlases, and `scene.ts` marks them).
 */
export const HD2D_ACTOR_TEXTURE_URLS: readonly TextureSpec[] = [
  ...new Set([
    ...allUnitSheets().map((sheet) => sheet.source),
    ...allCombatSheets().map((sheet) => sheet.source),
    ...NPC_MODEL_ASSETS.flatMap((asset) => [
      tinySwordsSourceUrl(asset.sourcePath),
      ...(asset.motions?.run ? [tinySwordsSourceUrl(asset.motions.run.sourcePath)] : []),
      ...(asset.motions?.attack ? [tinySwordsSourceUrl(asset.motions.attack.sourcePath)] : []),
    ]),
    ...Object.values(SHEEP_ACTOR_SHEETS).flatMap((sheets) => [
      sheets.idle.source,
      sheets.run.source,
    ]),
    ...allEnemySheets().map((sheet) => sheet.source),
    HD2D_GLIDER_TEXTURE_URL,
    SEA_GUARDIAN_SWIM_TEXTURE_URL,
    SEA_GUARDIAN_SWIM_UP_TEXTURE_URL,
    SEA_GUARDIAN_SWIM_DOWN_TEXTURE_URL,
    SEA_GUARDIAN_ATTACK_TEXTURE_URL,
    HD2D_SPLASH_TEXTURE_URL,
    HD2D_SHEEP_EXPLOSION_TEXTURE_URL,
    CHARACTER_ATLAS_URL,
  ]),
].map((url) => ({ url, ...(url === HD2D_SPLASH_TEXTURE_URL ? { atlas: true } : {}) }));

// --- scenery art direction ------------------------------------------------------------------------

/**
 * One catalogue asset, resolved: the file it draws from and the geometry a billboard is built with.
 * `StaticSpriteArt` minus its texture, because the sheet has to be NAMED before it can be
 * downloaded and TEXTURED only afterwards — see `staticAssetSpec`.
 */
export interface StaticAssetSpec extends Omit<
  StaticSpriteArt,
  "texture" | "companions" | "coldVariant" | "buildingVolume"
> {
  url: string;
  companions?: readonly StaticAssetSpec[];
  coldVariant?: StaticAssetSpec;
  buildingVolume?: {
    archetype: BuildingArchetype;
    faction: BuildingFaction;
    state: "standing" | "construction" | "destroyed";
    wallUrl: string;
    roofUrl: string;
    stoneUrl: string;
    blueStoneUrl: string;
    woodUrl: string;
    factionDetailUrl?: string;
    roofColor: number;
  };
}

const LAB_CAMPFIRE_BASE_URL = "/assets/lindocara/hd2d/campfire-base.png";
const LAB_CAMPFIRE_FLAME_URL = "/assets/lindocara/hd2d/campfire-flame.png";
const LAB_CHEST_CLOSED_URL = "/assets/lindocara/hd2d/chest-closed.png";
const LAB_CHEST_OPEN_URL = "/assets/lindocara/hd2d/chest-open.png";
const LAB_SNOW_TREE_URL = "/assets/lindocara/hd2d/snow-tree.png";
const PICKUP_BUFF_SPARKLES_URL = "/assets/lindocara/hd2d/pickups/buff-sparkles.png";
const PICKUP_DEBUFF_SPARKLES_URL = "/assets/lindocara/hd2d/pickups/debuff-sparkles.png";
const GENERATED_BUILDING_ROOT = "/assets/lindocara/hd2d/buildings";
const GENERATED_BRIDGE_DECK_URL = "/assets/lindocara/hd2d/interiors/floor.png";
const GENERATED_BUILDING_WALL_URL = `${GENERATED_BUILDING_ROOT}/wall-timber.png`;
const GENERATED_BUILDING_ROOF_URL = `${GENERATED_BUILDING_ROOT}/roof-shingles.png`;
const GENERATED_BUILDING_STONE_URL = `${GENERATED_BUILDING_ROOT}/cream-stone.png`;
const GENERATED_BUILDING_BLUE_STONE_URL = `${GENERATED_BUILDING_ROOT}/blue-stone.png`;
const GOBLIN_HOUSE_URL = tinySwordsSourceUrl(
  "Tiny Swords (Update 010)/Factions/Goblins/Buildings/Wood_House/Goblin_House.png",
);
const GOBLIN_TOWER_RED_URL = tinySwordsSourceUrl(
  "Tiny Swords (Update 010)/Factions/Goblins/Buildings/Wood_Tower/Wood_Tower_Red.png",
);
const ORC_ROOT_HALL_URL = tinySwordsSourceUrl(
  "Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Root Troll/Dead Tree.png",
);
const ORC_TROLL_URL = tinySwordsSourceUrl(
  "Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Troll/Troll_Idle.png",
);
const BEASTFOLK_GNOLL_URL = tinySwordsSourceUrl(
  "Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Gnoll/Gnoll_Idle.png",
);
const BEASTFOLK_BONE_URL = tinySwordsSourceUrl(
  "Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Gnoll/Gnoll_Bone.png",
);
const WILD_CAVE_URL = tinySwordsSourceUrl(
  "Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Caveborn/Cave/Cave_Idle.png",
);
const WILD_LIZARD_URL = tinySwordsSourceUrl(
  "Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/Caveborn/Lizard/Lizard_Idle.png",
);
const NATIVE_TREE_ASSET_IDS = new Set([
  "resource.terrain-resources-wood-trees.tree1",
  "resource.terrain-resources-wood-trees.tree2",
  "resource.terrain-resources-wood-trees.tree3",
  "resource.terrain-resources-wood-trees.tree4",
]);
const UPDATE_TREE_ASSET_IDS: ReadonlySet<string> = new Set(
  [1, 2, 3, 4, 5, 6].map((index) => `resource.resources-trees.tree-${index}`),
);
const LARGE_TREE_ANIMATION_MS = 2_800;
const TREE1_ANIMATION_MS = 2_200;

function snowTreeSpec(): StaticAssetSpec {
  return {
    url: LAB_SNOW_TREE_URL,
    height: 2.9,
    aspect: 94 / 142,
    foot: 0.03,
  };
}

function generatedBuildingSpec(assetId: string): StaticAssetSpec | null {
  const definition = editorAsset(assetId);
  if (definition?.editor.category !== "buildings") return null;
  const archetype = visualBuildingArchetype(assetId);
  if (!archetype) return null;
  const faction = buildingFaction(assetId);
  const state = definition.tags.includes("destroyed")
    ? "destroyed"
    : definition.tags.some((tag) => tag.includes("construction"))
      ? "construction"
      : "standing";
  const front =
    archetype === "windmill"
      ? "windmill-front.png"
      : archetype === "tower"
        ? "tower-front.png"
        : archetype === "archery" || archetype === "monastery"
          ? "archery-front.png"
          : archetype === "barracks" || archetype === "castle"
            ? "barracks-front.png"
            : "house-front.png";
  const frame =
    archetype === "windmill"
      ? { width: 210, height: 224 }
      : archetype === "tower"
        ? { width: 159, height: 220 }
        : archetype === "archery" || archetype === "monastery"
          ? { width: 225, height: 202 }
          : archetype === "barracks" || archetype === "castle"
            ? { width: 267, height: 206 }
            : { width: 199, height: 198 };
  const lower = assetId.toLowerCase();
  const roofColor =
    faction === "goblin"
      ? 0x986b42
      : faction === "orc-troll"
        ? 0x91463b
        : faction === "beastfolk"
          ? 0x4ca093
          : faction === "wild-tribe"
            ? 0xb07845
            : lower.includes("red")
              ? 0xc85e54
              : lower.includes("purple")
                ? 0x8e65aa
                : lower.includes("yellow")
                  ? 0xd3a843
                  : lower.includes("black")
                    ? 0x48515b
                    : 0x4da9c7;
  return {
    url:
      faction === "goblin"
        ? GOBLIN_HOUSE_URL
        : faction === "orc-troll"
          ? ORC_ROOT_HALL_URL
          : faction === "beastfolk"
            ? BEASTFOLK_GNOLL_URL
            : faction === "wild-tribe"
              ? WILD_CAVE_URL
              : `${GENERATED_BUILDING_ROOT}/${front}`,
    height: frame.height / TILE_SIZE,
    aspect: frame.width / frame.height,
    foot: 0,
    buildingVolume: {
      archetype,
      faction,
      state,
      wallUrl: GENERATED_BUILDING_WALL_URL,
      roofUrl: GENERATED_BUILDING_ROOF_URL,
      stoneUrl: GENERATED_BUILDING_STONE_URL,
      blueStoneUrl: GENERATED_BUILDING_BLUE_STONE_URL,
      woodUrl: GENERATED_BRIDGE_DECK_URL,
      ...(faction === "goblin" ? { factionDetailUrl: GOBLIN_TOWER_RED_URL } : {}),
      ...(faction === "orc-troll" ? { factionDetailUrl: ORC_TROLL_URL } : {}),
      ...(faction === "beastfolk" ? { factionDetailUrl: BEASTFOLK_BONE_URL } : {}),
      ...(faction === "wild-tribe" ? { factionDetailUrl: WILD_LIZARD_URL } : {}),
      roofColor,
    },
  };
}

/**
 * A catalogue asset id, read as everything the HD-2D path needs to draw it — or `null` when this
 * build cannot draw it at all. The ADAPTER's knowledge, exactly like `playerTextureKey` above and
 * the terrain atlases in `scene.ts`.
 *
 * ONE function, deliberately, and exported so it can be pinned by a test: the url and the geometry
 * were briefly two functions with the REFUSALS in only one of them, which made "never ask for the
 * geometry of an asset the other one rejected" an invariant living in neither — a second call site
 * (an editor preview, which the spec anticipates) would have quietly framed a whole shared sheet as
 * one sprite. The refusals and the arithmetic now sit together, and every caller gets both.
 *
 * Two honest refusals. `placeStaticContent` turns each into one skipped sprite and a console
 * warning, never a thrown error:
 *
 * - an id no catalogue entry answers to — a map authored against a newer pack;
 * - a file the Vite glob never bundled (`tinySwordsSourceUrl` throws on those, by design).
 *
 * `definition.width`/`height` are the FRAME's size, not the sheet's, so a frame count along its own
 * axis is what gives the grid. The scale rule is the pack's own and the same one `billboards.ts`
 * gives actors: a frame is worth its native pixels at 64 to the tile, so an authored tree and the
 * hero beside it stay in proportion. `footOffset` is `frameHeight - alphaBboxBottom` — the visible
 * ground line measured up from the bottom of the frame — which is precisely what `foot` wants, and
 * the same number the deleted PixiJS path used to stand the very same sprite on the very same cell.
 */
export function staticAssetSpec(assetId: string): StaticAssetSpec | null {
  const definition = editorAsset(assetId);
  const architecture = definition?.editor.architecturalVolume;
  const structureVolume = architecture
    ? (`${architecture.style}-${architecture.kind}` as StructureVolumeKind)
    : null;
  if (structureVolume) {
    if (!definition) return null;
    return {
      url: definition.sourcePath,
      height: 1,
      aspect: 1,
      foot: 0,
      structureVolume,
    };
  }
  const generatedBuilding = generatedBuildingSpec(assetId);
  if (generatedBuilding) return generatedBuilding;
  if (assetId === "terrain.bridge.wood.horizontal" || assetId === "terrain.bridge.wood.vertical") {
    return {
      url: GENERATED_BRIDGE_DECK_URL,
      height: 1,
      aspect: 1,
      bridgeOrientation: assetId.endsWith("horizontal") ? "horizontal" : "vertical",
    };
  }
  if (assetId === LINDOCARA_CAMPFIRE_ASSET_ID) {
    return {
      url: LAB_CAMPFIRE_BASE_URL,
      height: 66 / TILE_SIZE,
      aspect: 57 / 66,
      foot: 0,
      renderMode: "flat",
      flatSize: 1.25,
      fireLight: { color: 0xff8c2e, lift: 0.62, distance: 34, decay: 2, glow: true },
      companions: [
        {
          url: LAB_CAMPFIRE_FLAME_URL,
          cols: 7,
          rows: 1,
          height: 1.5,
          aspect: 1,
          foot: 0.12,
          animationDurationMs: (7 / 12) * 1_000,
          lit: false,
        },
      ],
    };
  }
  if (assetId === LINDOCARA_CHEST_CLOSED_ASSET_ID || assetId === LINDOCARA_CHEST_OPEN_ASSET_ID) {
    return {
      url: assetId === LINDOCARA_CHEST_OPEN_ASSET_ID ? LAB_CHEST_OPEN_URL : LAB_CHEST_CLOSED_URL,
      height: 1.15,
      aspect: 1,
      foot: 0.02,
    };
  }
  if (!definition) return null;
  if (assetId === LINDOCARA_INTERIOR_ASSET_IDS.rug) {
    return {
      url: definition.sourcePath,
      height: definition.height / TILE_SIZE,
      aspect: definition.width / definition.height,
      renderMode: "flat",
      flatSize: 1.55,
    };
  }
  const runnerProp =
    assetId === LINDOCARA_RUNNER_ASSET_IDS.spikeTrap
      ? "spike-trap"
      : assetId === LINDOCARA_RUNNER_ASSET_IDS.pushTrap
        ? "push-trap"
        : assetId === LINDOCARA_RUNNER_ASSET_IDS.launchTrap
          ? "launch-trap"
          : assetId === LINDOCARA_RUNNER_ASSET_IDS.barricade
            ? "barricade"
            : assetId === LINDOCARA_RUNNER_ASSET_IDS.goblinBarricade
              ? "goblin-barricade"
              : assetId === LINDOCARA_RUNNER_ASSET_IDS.orcBarricade
                ? "orc-barricade"
                : null;
  if (runnerProp) {
    return {
      url: definition.sourcePath,
      height: definition.height / TILE_SIZE,
      aspect: definition.width / definition.height,
      foot: 0,
      runnerProp,
    };
  }
  if (UPDATE_TREE_ASSET_IDS.has(assetId)) {
    let url: string;
    try {
      url = tinySwordsSourceUrl(definition.sourcePath);
    } catch {
      return null;
    }
    return {
      url,
      // This is a 4x3 ATLAS of six different tree silhouettes plus a stump, not an animation.
      // Swapping those silhouettes caused violent jumps and a large per-frame workload. Saved
      // aliases now resolve to the first tree, animated only by an almost imperceptible slow sway.
      cols: 1,
      rows: 1,
      height: 3,
      aspect: 1,
      foot: definition.footOffset / 192,
      renderLayer: "canopy",
      sway: { amplitudeRadians: THREE.MathUtils.degToRad(0.28), durationMs: 9_000 },
      uvRect: {
        offsetX: 0,
        offsetY: 2 / 3,
        repeatX: 1 / 4,
        repeatY: 1 / 3,
      },
    };
  }
  const frame = definition.frame;
  const crop = definition.editor.sourceRect;
  const sourceExtent = crop
    ? EDITOR_ASSETS.filter((asset) => asset.sourcePath === definition.sourcePath).reduce(
        (extent, asset) => {
          const rect = "sourceRect" in asset.editor ? asset.editor.sourceRect : undefined;
          return {
            width: Math.max(extent.width, rect ? rect.x + rect.width : asset.width),
            height: Math.max(extent.height, rect ? rect.y + rect.height : asset.height),
          };
        },
        { width: definition.width, height: definition.height },
      )
    : { width: definition.width, height: definition.height };
  const framePx = {
    width: crop?.width ?? frame?.width ?? definition.width,
    height: crop?.height ?? frame?.height ?? definition.height,
  };
  if (framePx.width <= 0 || framePx.height <= 0) return null;
  const count = Math.max(1, frame?.count ?? 1);
  const nativeTreeStrip = /\/Trees\/Tree[1-4]\.png$/.test(
    definition.sourcePath.replaceAll("\\", "/"),
  );
  const alongX = (frame?.axis ?? "x") === "x";
  let url: string;
  try {
    url = definition.sourcePath.startsWith("/")
      ? definition.sourcePath
      : tinySwordsSourceUrl(definition.sourcePath);
  } catch {
    // The Vite glob is the only boundary to the raw pack and it throws on a path it never bundled.
    // A catalogue entry pointing at a file this build does not ship is one lost prop, not a crash.
    return null;
  }
  const spec: StaticAssetSpec = {
    url,
    cols: crop ? 1 : alongX ? count : 1,
    rows: crop ? 1 : alongX ? 1 : count,
    // Pickup source canvases are authored at 192 px for clean detail, not as three-tile-tall
    // scenery. Keep their in-world silhouette close to a hero's boot instead of applying the
    // catalogue's ordinary 64 px-per-tile prop scale.
    height: LINDOCARA_PICKUP_ASSET_ID_SET.has(assetId) ? 1.05 : framePx.height / TILE_SIZE,
    aspect: framePx.width / framePx.height,
    foot: definition.footOffset / framePx.height + (1 - definition.anchor.y),
    renderLayer:
      definition.editor.renderLayer === "ground" ? "object" : definition.editor.renderLayer,
    ...(definition.editor.wallMounted ? { renderMode: "wall-card" as const } : {}),
    ...(definition.nature === "animated" && !crop && count > 1
      ? {
          animationDurationMs: nativeTreeStrip
            ? assetId === "resource.terrain-resources-wood-trees.tree1"
              ? TREE1_ANIMATION_MS
              : LARGE_TREE_ANIMATION_MS
            : (frame?.durationMs ?? count * 145),
        }
      : {}),
    ...(crop
      ? {
          uvRect: {
            offsetX: crop.x / sourceExtent.width,
            offsetY: 1 - (crop.y + crop.height) / sourceExtent.height,
            repeatX: crop.width / sourceExtent.width,
            repeatY: crop.height / sourceExtent.height,
          },
        }
      : {}),
  };
  const warmLight = definition.tags.some(
    (tag) => tag === "torch" || tag === "fire" || tag === "campfire",
  );
  const litSpec = warmLight
    ? {
        ...spec,
        fireLight: { color: 0xff9a45, lift: 0.55, distance: 18, decay: 2, glow: false },
      }
    : spec;
  const beneficialPickup = LINDOCARA_BENEFICIAL_PICKUP_ASSET_ID_SET.has(assetId);
  const pickupSpec = LINDOCARA_PICKUP_ASSET_ID_SET.has(assetId)
    ? {
        ...litSpec,
        companions: [
          {
            url: beneficialPickup ? PICKUP_BUFF_SPARKLES_URL : PICKUP_DEBUFF_SPARKLES_URL,
            height: 1.45,
            aspect: 1,
            foot: 0.14,
            lit: false,
            twinkle: { durationMs: 1_250, minOpacity: 0.42, scaleAmplitude: 0.1 },
          },
        ],
      }
    : litSpec;
  return NATIVE_TREE_ASSET_IDS.has(assetId)
    ? { ...pickupSpec, coldVariant: snowTreeSpec() }
    : pickupSpec;
}

function staticSpecUrls(spec: StaticAssetSpec): string[] {
  return [
    spec.url,
    ...(spec.buildingVolume
      ? [
          spec.buildingVolume.wallUrl,
          spec.buildingVolume.roofUrl,
          spec.buildingVolume.stoneUrl,
          spec.buildingVolume.blueStoneUrl,
          spec.buildingVolume.woodUrl,
          ...(spec.buildingVolume.factionDetailUrl ? [spec.buildingVolume.factionDetailUrl] : []),
        ]
      : []),
    ...(spec.companions ?? []).flatMap(staticSpecUrls),
    ...(spec.coldVariant ? staticSpecUrls(spec.coldVariant) : []),
  ];
}

function materializeStaticSpec(spec: StaticAssetSpec, textures: TextureSource): StaticSpriteArt {
  const { url, companions, coldVariant, buildingVolume, ...geometry } = spec;
  return {
    texture: textures.get(url),
    ...geometry,
    ...(buildingVolume
      ? {
          buildingVolume: {
            archetype: buildingVolume.archetype,
            faction: buildingVolume.faction,
            state: buildingVolume.state,
            wall: textures.get(buildingVolume.wallUrl),
            roof: textures.get(buildingVolume.roofUrl),
            stone: textures.get(buildingVolume.stoneUrl),
            blueStone: textures.get(buildingVolume.blueStoneUrl),
            wood: textures.get(buildingVolume.woodUrl),
            ...(buildingVolume.factionDetailUrl
              ? { factionDetail: textures.get(buildingVolume.factionDetailUrl) }
              : {}),
            roofColor: buildingVolume.roofColor,
          },
        }
      : {}),
    ...(companions
      ? { companions: companions.map((companion) => materializeStaticSpec(companion, textures)) }
      : {}),
    ...(coldVariant ? { coldVariant: materializeStaticSpec(coldVariant, textures) } : {}),
  };
}

/** Every catalogue id a map's scenery names, deduplicated and in placement order. */
function staticAssetIds(map: MapData): string[] {
  const ids = new Set<string>();
  for (const element of map.elements) ids.add(element.assetId);
  return [...ids];
}

function worldEventAsset(event: WorldEventSnapshot): string | null {
  const harvest = event.harvest;
  if (!harvest || harvest.state === "intact") return event.graphicAssetId;
  if (harvest.exhaustionBehavior === "replace") return harvest.exhaustedAssetId;
  return null;
}

export function worldEventStaticPresentation(event: WorldEventSnapshot): {
  elevationOffset: number | undefined;
  floating: boolean;
} {
  const assetId = worldEventAsset(event);
  const pickup = assetId !== null && LINDOCARA_PICKUP_ASSET_ID_SET.has(assetId);
  return {
    elevationOffset: event.elevationOffset ?? (pickup ? LINDOCARA_PICKUP_FLOAT_HEIGHT : undefined),
    floating: event.floating === true || pickup,
  };
}

/** Keep one texture request alive while repeated render frames ask for the same event assets. */
export function shouldStartWorldEventTextureLoad(
  assetKey: string,
  loadingAssetKey: string,
  hasDesiredTextures: boolean,
): boolean {
  return !hasDesiredTextures && assetKey !== loadingAssetKey;
}

/** Every presentation field that can change a live static-event placement without changing art. */
export function worldEventContentVisualKey(
  events: readonly WorldEventSnapshot[],
  buildings: readonly WorldBuildingSnapshot[],
): string {
  return [
    ...events.map((event) => {
      const assetId = worldEventAsset(event);
      const presentation = worldEventStaticPresentation(event);
      return authoredActorSheet(assetId, "idle")
        ? `event:${event.id}:actor:${assetId ?? ""}`
        : `event:${event.id}:${event.col}:${event.row}:${event.y ?? ""}:${event.undergroundDepth ?? ""}:${assetId ?? ""}:${event.presentation ?? "marker"}:${event.scale ?? 1}:${presentation.elevationOffset ?? 0}:${presentation.floating ? 1 : 0}`;
    }),
    ...buildings.map(
      (building) =>
        `building:${building.id}:${building.x}:${building.y ?? ""}:${building.z}:${building.undergroundDepth ?? ""}:${building.orientation ?? 0}:${building.rotation ?? ""}:${building.dimensions?.width ?? ""}:${building.dimensions?.depth ?? ""}:${building.graphicAssetId}:${building.hp}:${building.maxHp}`,
    ),
  ].join("|");
}

interface ActorPosition {
  x: number;
  y: number;
  z: number;
  playerClass?: PlayerClass;
  primaryColor?: PrimaryColor;
  species?: MonsterSpecies;
}

interface PlayerPresentationState {
  x: number;
  y: number;
  z: number;
  invisible: boolean;
  actionId: string | null;
  mobilityPlayedActionId: string | null;
  mobilityTransition?: {
    offsetX: number;
    offsetZ: number;
    startedAt: number;
    durationMs: number;
  };
}

export class Hd2dRenderer implements RendererLike {
  #canvas: HTMLCanvasElement;
  #textures: TextureRegistry;
  /** Built on the first `configureMapTerrain` carrying a heightfield, not at construction: the map
   *  only exists once the welcome has landed. */
  #scene: Hd2dScene | null = null;
  #dayCycleOverride: DayCycleOverride = null;
  /** Lives and dies with the scene: its billboards are parented to that scene's graph. */
  #actors: BillboardRegistry | null = null;
  /** The map's scenery, placed once per map. Lives and dies with the scene, like the actors. */
  #content: StaticContent | null = null;
  /**
   * Every catalogue sheet this renderer has ever decoded — scenery, world events, the editor's
   * preview and its spawn knight — kept across scene rebuilds and freed only in `destroy`.
   *
   * A cache rather than a per-load registry, and it is the whole reason painting stopped blinking:
   * `#disposeScene` used to dispose the scenery's textures, so every terrain edit re-downloaded and
   * re-decoded sheets that had not changed — measured at ~90 ms of `fetch` against a WARM HTTP
   * cache plus ~10 ms of decode per rebuild, with no scenery on screen in between. Which sheets a
   * map needs is still only known once that map has landed, which is why this is separate from
   * `#textures` (fixed at construction, so the first frame can be correct).
   */
  #assetTextures: TextureCache = createTextureCache();
  /** The sea, owned here rather than by the scene because it outlives every scene built at the same
   *  extent and sea level — see `configureMapTerrain`. `#waterKey` is those two numbers. */
  #water: Water | null = null;
  #waterKey = "";
  #eventContent: StaticContent | null = null;
  #eventTextures: TextureSource | null = null;
  #eventToken = 0;
  #eventAssetKey = "";
  #eventLoadingAssetKey = "";
  #eventRequestedVisualKey = "";
  #eventVisualKey = "";
  #editorPreviewAssetId: string | null = null;
  #editorPreviewArt: StaticSpriteArt | null = null;
  #editorPreviewToken = 0;
  /** The spawn marker's ghost knight — loaded at most once per renderer instance (the asset id is
   *  fixed, unlike `#editorPreviewArt`'s currently-selected palette pick) and kept alive across
   *  terrain rebuilds so switching maps in the editor never re-downloads it. */
  #spawnKnightArt: StaticSpriteArt | null = null;
  #spawnKnightRequested = false;
  #worldEvents: readonly WorldEventSnapshot[] = [];
  #worldBuildings: readonly WorldBuildingSnapshot[] = [];
  #map: MapData | null = null;
  #visuals: Hd2dVisualLayer | null = null;
  /** `null` until an author pushes one: a scene built from a map already knows its own weather. */
  #weather: MapWeather | null = null;
  #merchant: MerchantDefinition | null = null;
  #questMarkers: readonly AuthoredQuestMarker[] = [];
  #actorPositions = new Map<string, ActorPosition>();
  #actorMotion = new ActorMotionTracker();
  /** Local presentation clock for the one-shot runic death animation. */
  #corpseAnimations = new Map<string, number>();
  /** Local presentation clock for dead Root Minotaurs retained in monster snapshots. */
  #monsterDeathAnimations = new Map<string, number>();
  #eventMotion = new WorldEventMotionTracker();
  #playerPresentation = new Map<string, PlayerPresentationState>();
  /** Last grounded storey per remote hero. Their live `y` animates a jump but does not change room. */
  #playerVisibility = new Map<string, StableUndergroundVisibility>();
  #combatAnimations = new Map<string, CombatAnimation>();
  #combatVisualAuthority = new CombatVisualAuthority();
  #cameraShake = new CameraShake();
  #pointerRaycaster = new THREE.Raycaster();
  #serverClock: ServerClock;
  /** Bumped by every map change and every teardown, so a download still in flight for the previous
   *  map cannot land its scenery in the new one's scene. */
  #contentToken = 0;
  /** Rebuilt every frame into the same array — `render` runs 60 times a second, and a fresh array
   *  per frame is garbage for nothing. */
  #actorViews: ActorView[] = [];
  #selfId: string | null = null;
  #manualFocus: GroundVector | null = null;
  #tiltShiftEnabled = true;
  #fogEnabled = true;
  #cameraZoom = 100;
  #cameraYaw = 0;
  #cameraPitch = HD2D_CAMERA.pitch;
  #undergroundDepth: number | null = null;
  #gameplayVisibilityDepth: number | null = null;
  #gameplayVisibilityElevation = 0;
  #gameplayVisibilityInitialized = false;
  #frameCallbacks: Array<(nowMs: number, deltaSeconds: number) => void> = [];
  #rafHandle: number | null = null;
  #lastFrameMs: number | null = null;
  #destroyed = false;
  #currentMapId: string | null = null;
  #currentMapRevision = -1;
  #onResize = (): void => this.#scene?.resize();

  private constructor(
    canvas: HTMLCanvasElement,
    textures: TextureRegistry,
    serverClock: ServerClock,
  ) {
    this.#canvas = canvas;
    this.#textures = textures;
    this.#serverClock = serverClock;
    addEventListener("resize", this.#onResize);
    this.#startLoop();
  }

  /**
   * Downloads and decodes every texture BEFORE returning, exactly as the lab does: a scene built on
   * textures still decoding clones empty ones, and three complains once per frame about it.
   *
   * The session clock projects authoritative effect deadlines onto the local frame timeline.
   */
  static async create(
    canvas: HTMLCanvasElement,
    serverClock: ServerClock = new ServerClock(),
  ): Promise<Hd2dRenderer> {
    const specs = [...HD2D_TEXTURE_URLS, ...HD2D_ACTOR_TEXTURE_URLS];
    const blobs = await fetchAll(
      specs.map((spec) => spec.url),
      () => {},
    );
    const textures = createTextureRegistry(specs);
    await textures.decode(blobs, () => {});
    return new Hd2dRenderer(canvas, textures, serverClock);
  }

  /**
   * The frame loop. The deleted PixiJS renderer borrowed a shared `Application`'s ticker; there is
   * no such ticker here, so this owns a `requestAnimationFrame` loop and hands the session the same
   * `(nowMs, deltaSeconds)` it has always received. The session's callback is what calls `render`,
   * so the scene advances from inside the callback, never beside it.
   */
  #startLoop(): void {
    const step = (now: number): void => {
      this.#rafHandle = requestAnimationFrame(step);
      const dt = this.#lastFrameMs === null ? 0 : (now - this.#lastFrameMs) / 1000;
      this.#lastFrameMs = now;
      for (const callback of this.#frameCallbacks) callback(now, dt);
    };
    this.#rafHandle = requestAnimationFrame(step);
  }

  onFrame(callback: (nowMs: number, deltaSeconds: number) => void): void {
    this.#frameCallbacks.push(callback);
  }

  /**
   * Builds the scene from the welcome's heightfield.
   *
   * `tiles`/`elements`/`appearance` are the tile path's, and go unread here — the appearance this
   * renderer draws comes from the heightfield, and a heightfield-backed room ships blank tile
   * layers precisely so its welcome still validates. A `null` heightfield leaves the scene unbuilt
   * and the screen empty, which is the honest state of a room this path cannot draw.
   */
  configureMapTerrain(
    zoneId: string,
    _elements: readonly MapElement[],
    revision: number,
    heightfield: MapData,
    _appearance?: { tilesetId: string; layers: readonly string[] },
  ): void {
    if (
      this.#currentMapId !== null &&
      sameRenderedMap(
        { mapId: zoneId, revision },
        { mapId: this.#currentMapId, revision: this.#currentMapRevision },
      )
    )
      return;
    // The sea is handed forward, not rebuilt: its plane is 385x385 vertices, costs 17-23 ms, and
    // depends on nothing but these two numbers — the coastline only drives a ~1 ms attribute the
    // scene refreshes for us. A map of a different extent or a different sea level gets a new one.
    const waterKey = waterPlaneKey(heightfield);
    // An EDIT of the map already on screen — which is every brush stroke in the editor — keeps its
    // scene and swaps only the ground. A different map, or one whose sea plane no longer matches
    // (the sea is inside that scene), still gets a whole new one: the day-cycle seed is fixed per
    // scene, and a transition should reset the camera rather than inherit the previous framing.
    const editInPlace =
      this.#scene !== null && this.#currentMapId === zoneId && this.#waterKey === waterKey;
    this.#currentMapId = zoneId;
    this.#currentMapRevision = revision;

    let scene: Hd2dScene;
    if (editInPlace && this.#scene) {
      this.#disposeSceneContents();
      scene = this.#scene;
      scene.updateTerrain(heightfield);
      scene.setUndergroundDepth(this.#undergroundDepth, this.#currentMapId === "editor");
    } else {
      this.#disposeScene();
      if (this.#water && this.#waterKey !== waterKey) {
        this.#water.dispose();
        this.#water = null;
      }
      scene = createHd2dScene(
        this.#canvas,
        heightfield,
        this.#textures,
        zoneId,
        this.#water ? { water: this.#water } : {},
      );
      this.#water = scene.water;
      this.#waterKey = waterKey;
      scene.setDayCycleOverride(this.#dayCycleOverride);
      if (this.#weather !== null) scene.setWeather(this.#weather);
      scene.setZoom(this.#cameraZoom);
      scene.setYaw(this.#cameraYaw);
      scene.setPitch(this.#cameraPitch);
      scene.setTiltShiftEnabled(this.#tiltShiftEnabled);
      scene.setFogEnabled(this.#fogEnabled);
      scene.setUndergroundDepth(this.#undergroundDepth, this.#currentMapId === "editor");
      if (this.#manualFocus)
        scene.focusOn(
          this.#manualFocus.x,
          this.#manualFocus.z,
          this.#undergroundDepth === null
            ? undefined
            : undergroundFloorHeight(this.#undergroundDepth),
        );
    }
    this.#scene = scene;
    this.#map = heightfield;
    this.#visuals = new Hd2dVisualLayer(
      scene,
      this.#canvas,
      heightfield.size,
      heightfield.waterLevel,
      this.#textures,
      (x, z) => authoredMaterialAt(heightfield, x, z),
    );
    this.#visuals.setEditorGroundElevation(
      this.#undergroundDepth === null ? null : undergroundFloorHeight(this.#undergroundDepth),
    );
    this.#visuals.setEditorPreviewArt(this.#editorPreviewArt);
    this.#visuals.setSpawnKnightArt(this.#spawnKnightArt);
    this.#visuals.setMerchant(this.#merchant);
    this.#visuals.setQuestMarkers(this.#questMarkers);
    this.#actors = createBillboardRegistry(
      scene.ctx,
      this.#sceneFor(scene, heightfield, scene.scene),
      this.#textures,
    );
    // Fire and forget, but never silently: a failed scenery download costs the map its props and
    // must say so, while the ground and the actors carry on.
    void this.#loadStaticContent(scene, heightfield).catch((error: unknown) => {
      console.warn("[hd2d] map scenery could not be loaded", error);
    });
    this.#syncWorldEventContent(this.#worldEvents, this.#worldBuildings, true);
  }

  /**
   * Applies an editor-only content edit without rebuilding unchanged terrain, water, actors or
   * post-processing. Building and bridge colliders still come from the newly compiled heightfield,
   * so picking and movement validation see their new footprint immediately.
   */
  updateEditorContent(revision: number, heightfield: MapData): void {
    const scene = this.#scene;
    if (
      !scene ||
      this.#currentMapId !== "editor" ||
      this.#waterKey !== waterPlaneKey(heightfield)
    ) {
      this.configureMapTerrain("editor", [], revision, heightfield);
      return;
    }
    this.#currentMapRevision = revision;
    this.#map = heightfield;
    scene.updateCollisionMap(heightfield);
    void this.#syncStaticContent(scene, heightfield).catch((error: unknown) => {
      console.warn("[hd2d] map scenery could not be updated", error);
    });
  }

  setDayCycleOverride(override: DayCycleOverride): void {
    this.#dayCycleOverride = override;
    this.#scene?.setDayCycleOverride(override);
  }

  /**
   * The authored weather, live.
   *
   * Remembered as well as pushed, for the same reason `#dayCycleOverride` is: a terrain edit
   * rebuilds the scene from the map, and a scene rebuilt from a map whose weather the author has
   * changed but not yet saved would come back under a clear sky.
   */
  setWeather(weather: MapWeather): void {
    this.#weather = weather;
    this.#scene?.setWeather(weather);
  }

  /** What `billboards.ts` and `static-content.ts` both need of the scene they draw into. Dynamic
   * actors live at scene level so hiding surface scenery never hides the followed hero. */
  #sceneFor(
    scene: Hd2dScene,
    heightfield: MapData,
    root: THREE.Object3D = scene.surfaceRoot,
  ): BillboardScene {
    return {
      root,
      // Keep this live across editor content edits: building/bridge collision is replaced without
      // recreating the scene, and newly placed visuals must sample the refreshed surface.
      get query() {
        return scene.query;
      },
      size: heightfield.size,
      waterLevel: heightfield.waterLevel,
    };
  }

  /**
   * Downloads the map's own scenery sheets, then places them.
   *
   * Asynchronous where `configureMapTerrain` is not, and it has to be: the catalogue holds 480
   * assets and a map names a handful of them, so preloading the lot beside the terrain would trade
   * a two-second first frame for scenery that could simply arrive a moment later. The ground, the
   * sea and the actors are already on screen while this runs.
   *
   * `token` is the guard that makes that safe. Two maps in quick succession — a map transition, a
   * reconnect onto a different map — must not let the first one's download graft its trees onto the
   * second one's scene, so a load that is no longer the current one gives its textures straight
   * back.
   */
  async #loadStaticContent(scene: Hd2dScene, heightfield: MapData): Promise<void> {
    const token = ++this.#contentToken;
    const assetIds = staticAssetIds(heightfield);
    if (assetIds.length === 0) return;

    // Resolved ONCE, BEFORE the download, and reused as the placement's own resolver below: an id
    // this build cannot draw must not become a 404 that fails the whole batch, and — because the
    // spec carries the geometry as well as the url — there is no second lookup that could disagree
    // with this one about what is drawable. An unresolved id stays out of the map, `resolve`
    // answers `null` for it, and `placeStaticContent` skips it with a warning.
    const specByAsset = new Map<string, StaticAssetSpec>();
    for (const assetId of assetIds) {
      const spec = staticAssetSpec(assetId);
      if (spec) specByAsset.set(assetId, spec);
    }
    // `atlas` stays false, as it does for every sprite sheet: a prop is seen at every distance, so
    // it keeps its mipmaps. Same reasoning as `HD2D_ACTOR_TEXTURE_URLS`.
    const specs: TextureSpec[] = [
      ...new Set([...specByAsset.values()].flatMap(staticSpecUrls)),
    ].map((url) => ({ url }));

    const textures = specs.length > 0 ? await this.#assetTextures.load(specs) : null;

    // No `dispose` on the abandoned branch any more: the sheets belong to the cache, and a map that
    // lost its race is very often the same map one edit later.
    if (this.#destroyed || token !== this.#contentToken || this.#scene !== scene) return;
    this.#content = placeStaticContent(
      scene.ctx,
      this.#sceneFor(scene, heightfield),
      { ...heightfield, events: [] },
      (assetId) => {
        const spec = specByAsset.get(assetId);
        if (!spec || !textures) return null;
        return materializeStaticSpec(spec, textures);
      },
    );
    // Le chargement des textures est asynchrone : ces enfants n'existaient pas encore lorsque la
    // vue −N a masqué la surface. Réappliquer la profondeur après leur insertion évite que maisons,
    // tours et décors reviennent par-dessus le sous-sol quelques images plus tard.
    scene.setUndergroundDepth(this.#undergroundDepth, this.#currentMapId === "editor");
  }

  /** Loads only missing scenery sheets, then diffs placements against the content already alive. */
  async #syncStaticContent(scene: Hd2dScene, heightfield: MapData): Promise<void> {
    if (!this.#content) {
      await this.#loadStaticContent(scene, heightfield);
      return;
    }
    const token = ++this.#contentToken;
    const specByAsset = new Map<string, StaticAssetSpec>();
    for (const assetId of staticAssetIds(heightfield)) {
      const spec = staticAssetSpec(assetId);
      if (spec) specByAsset.set(assetId, spec);
    }
    const specs: TextureSpec[] = [
      ...new Set([...specByAsset.values()].flatMap(staticSpecUrls)),
    ].map((url) => ({ url }));
    const textures = specs.length > 0 ? await this.#assetTextures.load(specs) : null;
    if (this.#destroyed || token !== this.#contentToken || this.#scene !== scene) return;
    this.#content.syncElements(heightfield.elements, (assetId) => {
      const spec = specByAsset.get(assetId);
      if (!spec || !textures) return null;
      return materializeStaticSpec(spec, textures);
    });
    scene.setUndergroundDepth(this.#undergroundDepth, this.#currentMapId === "editor");
  }

  async #loadEditorPreviewAsset(assetId: string, token: number): Promise<void> {
    const spec = staticAssetSpec(assetId);
    if (!spec) return;
    const urls = [...new Set(staticSpecUrls(spec))];
    const textures = await this.#assetTextures.load(urls.map((url) => ({ url })));
    if (this.#destroyed || token !== this.#editorPreviewToken) return;
    this.#editorPreviewArt = materializeStaticSpec(spec, textures);
    this.#visuals?.setEditorPreviewArt(this.#editorPreviewArt);
  }

  /**
   * Loads the spawn marker's ghost knight, through the exact same catalogue pipeline as
   * `#loadEditorPreviewAsset` above — `staticAssetSpec` -> `staticSpecUrls` -> `#assetTextures` ->
   * `materializeStaticSpec` — rather than a second implementation of it. Unlike the palette
   * preview, the asset id here is fixed, so this fires at most once per renderer instance
   * (`#spawnKnightRequested`) and the result is kept for the renderer's whole lifetime, reapplied
   * to every fresh `Hd2dVisualLayer` a terrain rebuild creates (see `configureMapTerrain`) instead
   * of being re-downloaded.
   */
  async #loadSpawnKnightAsset(): Promise<void> {
    const spec = staticAssetSpec(EDITOR_SPAWN_KNIGHT_ASSET_ID);
    if (!spec) return;
    const urls = [...new Set(staticSpecUrls(spec))];
    const textures = await this.#assetTextures.load(urls.map((url) => ({ url })));
    if (this.#destroyed) return;
    this.#spawnKnightArt = materializeStaticSpec(spec, textures);
    this.#visuals?.setSpawnKnightArt(this.#spawnKnightArt);
  }

  #syncWorldEventContent(
    events: readonly WorldEventSnapshot[],
    buildings: readonly WorldBuildingSnapshot[],
    force = false,
  ): void {
    this.#worldEvents = events;
    this.#worldBuildings = buildings;
    const visualKey = worldEventContentVisualKey(events, buildings);
    const assetIds = [
      ...new Set(
        [
          ...events.flatMap((event) => [
            event.graphicAssetId,
            event.harvest?.exhaustedAssetId ?? null,
          ]),
          ...buildings.flatMap((building) => [building.graphicAssetId, building.destroyedAssetId]),
        ].filter(
          (assetId): assetId is string =>
            assetId !== null && authoredActorSheet(assetId, "idle") === null,
        ),
      ),
    ].sort();
    const assetKey = assetIds.join("|");
    this.#eventRequestedVisualKey = visualKey;
    if (!force && visualKey === this.#eventVisualKey && assetKey === this.#eventAssetKey) return;
    if (!this.#scene || !this.#map) return;
    if (assetIds.length === 0) {
      this.#eventToken += 1;
      this.#eventContent?.dispose();
      this.#eventContent = null;
      // No `dispose()` here any more: `#eventTextures` is only a VIEW into `#assetTextures` now
      // (see its field docblock), and the sheets it names outlive this reset in the shared cache.
      this.#eventTextures = null;
      this.#eventAssetKey = "";
      this.#eventLoadingAssetKey = "";
      this.#eventVisualKey = visualKey;
      return;
    }
    if (assetKey === this.#eventAssetKey && this.#eventTextures) {
      this.#placeWorldEventContent(visualKey);
      return;
    }
    if (
      !shouldStartWorldEventTextureLoad(
        assetKey,
        this.#eventLoadingAssetKey,
        assetKey === this.#eventAssetKey && this.#eventTextures !== null,
      )
    )
      return;
    this.#eventAssetKey = assetKey;
    this.#eventLoadingAssetKey = assetKey;
    this.#eventVisualKey = "";
    const token = ++this.#eventToken;
    this.#eventContent?.dispose();
    this.#eventContent = null;
    this.#eventTextures = null;
    void this.#loadWorldEventTextures(assetIds, token).catch((error: unknown) => {
      if (token === this.#eventToken) this.#eventLoadingAssetKey = "";
      console.warn("[hd2d] world-event art could not be loaded", error);
    });
  }

  async #loadWorldEventTextures(assetIds: readonly string[], token: number): Promise<void> {
    const specsByAsset = new Map<string, StaticAssetSpec>();
    for (const assetId of assetIds) {
      const spec = staticAssetSpec(assetId);
      if (spec) specsByAsset.set(assetId, spec);
    }
    const specs: TextureSpec[] = [
      ...new Set([...specsByAsset.values()].flatMap(staticSpecUrls)),
    ].map((url) => ({ url }));
    if (specs.length === 0) {
      if (token === this.#eventToken) {
        this.#eventLoadingAssetKey = "";
        this.#eventVisualKey = this.#eventRequestedVisualKey;
      }
      return;
    }
    const textures = await this.#assetTextures.load(specs);
    if (this.#destroyed || token !== this.#eventToken || !this.#scene || !this.#map) return;
    this.#eventTextures = textures;
    this.#eventLoadingAssetKey = "";
    this.#placeWorldEventContent(this.#eventRequestedVisualKey);
  }

  #placeWorldEventContent(visualKey: string): void {
    const scene = this.#scene;
    const map = this.#map;
    const textures = this.#eventTextures;
    if (!scene || !map || !textures) return;
    const events: StaticContentEvent[] = this.#worldEvents.flatMap((event) => {
      const assetId = worldEventAsset(event);
      const presentation = worldEventStaticPresentation(event);
      return assetId === null || authoredActorSheet(assetId, "idle")
        ? []
        : [
            {
              id: event.id,
              x: event.col + 0.5 - map.size / 2,
              // Native scenery is bottom-anchored on the cell's lower edge, exactly like authored
              // map elements. Marker events stay centred in their logical cell.
              z: event.row + (event.presentation === "native" ? 1 : 0.5) - map.size / 2,
              ...(event.y === undefined ? {} : { y: event.y }),
              ...(event.undergroundDepth === undefined
                ? {}
                : { undergroundDepth: event.undergroundDepth }),
              graphicAssetId: assetId,
              ...(event.scale === undefined ? {} : { scale: event.scale }),
              ...(presentation.elevationOffset === undefined
                ? {}
                : { elevationOffset: presentation.elevationOffset }),
              ...(presentation.floating ? { floating: true } : {}),
            },
          ];
    });
    events.push(
      ...this.#worldBuildings.map((building) => ({
        id: `building-${building.id}`,
        x: building.x,
        ...(building.y === undefined ? {} : { y: building.y }),
        z: building.z,
        ...(building.undergroundDepth === undefined
          ? {}
          : { undergroundDepth: building.undergroundDepth }),
        graphicAssetId: building.graphicAssetId,
        ...(building.orientation ? { orientation: building.orientation } : {}),
        ...(building.rotation === undefined ? {} : { rotation: building.rotation }),
        ...(building.dimensions ? { building: building.dimensions } : {}),
        health: {
          value: building.hp,
          max: building.maxHp,
          visible: building.destructible && !building.destroyed && building.hp < building.maxHp,
        },
      })),
    );
    if (this.#eventContent) {
      // Harvesting changes one event. Preserve every other tree/rock mesh and update only that id;
      // rebuilding hundreds of billboards here caused a frame hitch and a white GPU-upload flash.
      this.#eventContent.syncEvents(events);
    } else {
      this.#eventContent = placeStaticContent(
        scene.ctx,
        this.#sceneFor(scene, map),
        { ...map, elements: [], events },
        (assetId) => {
          const spec = staticAssetSpec(assetId);
          if (!spec) return null;
          return materializeStaticSpec(spec, textures);
        },
      );
    }
    this.#eventVisualKey = visualKey;
    scene.setUndergroundDepth(this.#undergroundDepth, this.#currentMapId === "editor");
  }

  render(sample: SceneSample, context: RenderContext): void {
    if (this.#destroyed) return;
    const scene = this.#scene;
    if (!scene) return;

    this.#actors?.sync(this.#collectActors(sample, context));
    const self =
      context.self ?? sample.players.find((player) => player.id === this.#selfId) ?? null;
    this.#visuals?.setEventVisibilityDepth(
      this.#map?.underground
        ? self
          ? this.#gameplayVisibilityDepth
          : this.#undergroundDepth
        : undefined,
    );
    this.#syncWorldEventContent(sample.events, sample.buildings ?? []);
    const fireIntensity = scene.fireIntensity();
    this.#content?.setFireMood(fireIntensity);
    this.#eventContent?.setFireMood(fireIntensity);
    this.#content?.update(context.now);
    this.#eventContent?.update(context.now);
    this.#visuals?.syncLocalHero(context.self ?? null, context.movement ?? null, context.now);
    this.#visuals?.syncPowerBuffs(
      sample.players.flatMap((player) =>
        player.powerBuffUntil === undefined
          ? []
          : [
              {
                id: player.id,
                x: player.x,
                y: player.y,
                z: player.z,
                endsAt: this.#localDeadline(player.powerBuffUntil, 6_000),
              },
            ],
      ),
      context.now,
    );
    this.#visuals?.syncHealingAuras(
      sample.players.flatMap((player) =>
        player.healingAuraUntil === undefined
          ? []
          : [
              {
                id: player.id,
                x: player.x,
                y: player.y,
                z: player.z,
                endsAt: this.#localDeadline(player.healingAuraUntil, 150),
              },
            ],
      ),
      context.now,
    );
    this.#visuals?.sync(sample, context.now);

    // The camera follows the local player, and only it: every other actor is drawn where the
    // interpolated view puts it. `x` and `z` are the ground point; `self.y` is supplied separately
    // as the surface ceiling so a bridge/roof under the hero drives camera height without confusing
    // elevation with a ground axis. Its airborne flag prevents lower terrain from stealing focus
    // while the hero crosses a crevasse.
    // A player the view has not sent yet leaves the camera wherever it last was, which is the map's
    // spawn on the very first frames.
    const cameraSelf = sample.players.find((player) => player.id === this.#selfId);
    if (cameraSelf)
      scene.focusOn(
        cameraSelf.x,
        cameraSelf.z,
        cameraSelf.y,
        cameraSelf.airborne,
        cameraSelf.vy ?? 0,
      );
    else if (this.#manualFocus) scene.focusOn(this.#manualFocus.x, this.#manualFocus.z);
    const shake = this.#cameraShake.offset(context.now);
    scene.setCameraShake(shake.x, shake.y);

    // `context.now` rather than a clock read of our own: it is the very `now` this frame's callback
    // was handed, so the scene's animations advance on the same timeline as everything else in it.
    scene.render(context.now);
  }

  /**
   * The frame's actors, in the one shape the registry understands. Positions ride across in the
   * snapshot's own TILE units, `x`/`z` on the ground and `y` the elevation — the same frame the
   * scene draws in, so there is no conversion anywhere in this package.
   *
   * A PLAYER also carries its three locomotion flags (`playerActorView`), because since S3 moved
   * movement to the client a hero's elevation is a fact its own client computed and the room
   * relayed. A relentless runner can also carry a room-authored airborne flag while crossing
   * relief. Guards and ordinary monsters remain grounded from the heightfield.
   *
   * Dead monsters and corpse snapshots become flattened billboards; ghosts keep their walking pose
   * with reduced opacity. A player whose life is `corpse` is omitted only because the dedicated
   * `sample.corpses` entry is the single body source.
   */
  #collectActors(sample: SceneSample, context: RenderContext): readonly ActorView[] {
    const animationTimeMs = context.now;
    const self =
      context.self ?? sample.players.find((player) => player.id === this.#selfId) ?? null;
    const views = this.#actorViews;
    const present = new Set<string>();
    const playerIds = new Set<string>();
    views.length = 0;
    this.#actorPositions.clear();
    for (const player of sample.players) {
      if (player.life === "corpse") continue;
      playerIds.add(player.id);
      present.add(player.id);
      this.#combatVisualAuthority.recordSnapshot(player.id, player.action?.id ?? null);
      const mobilityOffset = this.#restorePlayerPresentation(player, animationTimeMs);
      const motion = this.#actorMotion.sample(
        player.id,
        player.x,
        player.z,
        player.action !== null || player.guarding === true,
        animationTimeMs,
      );
      const timing = player.action
        ? this.#actorAnimationTiming(player.action, animationTimeMs)
        : null;
      const view = playerActorView(
        player,
        timing?.elapsed ?? animationTimeMs,
        motion.motion,
        timing?.duration,
        player.id === this.#selfId,
      );
      view.x += mobilityOffset.x;
      view.z += mobilityOffset.z;
      if (this.#map?.underground && player.id !== self?.id) {
        const visibility = actorUndergroundVisibilityAt(
          this.#map,
          player.x,
          player.z,
          player.y,
          player.airborne,
          player.vy ?? 0,
          this.#playerVisibility.get(player.id),
        );
        this.#playerVisibility.set(player.id, visibility.stable);
        view.visibilityDepth = visibility.visibleDepth;
      }
      if (player.action && !isLumenStepClouded(player.action, timing?.elapsed ?? animationTimeMs)) {
        const art = combatArt(
          player.class,
          player.action.skillId ?? "attack",
          player.appearance.primaryColor,
        );
        const directionalBonus =
          player.appearance.body === "runic_guardian" ||
          player.appearance.body === "assassin" ||
          player.appearance.body === "peasant" ||
          player.appearance.body === "ranger" ||
          player.appearance.body === "priest";
        const frames = directionalBonus ? (view.frames ?? 10) : art.caster.frames;
        const activeFrame =
          player.appearance.body === "assassin" &&
          player.action.skillId &&
          isAssassinSkillId(player.action.skillId)
            ? assassinSkillActiveFrame(player.action.skillId)
            : player.appearance.body === "peasant" &&
                player.action.skillId &&
                isPeasantSkillId(player.action.skillId)
              ? peasantBonusSkillActiveFrame(player.action.skillId)
              : player.appearance.body === "ranger" &&
                  player.action.skillId &&
                  isRangerBonusSkillId(player.action.skillId)
                ? rangerBonusSkillActiveFrame(player.action.skillId)
                : player.appearance.body === "priest" &&
                    player.action.skillId &&
                    isPriestBonusSkillId(player.action.skillId)
                  ? priestBonusSkillActiveFrame(player.action.skillId)
                  : directionalBonus
                    ? Math.round(
                        (art.caster.activeFrame / Math.max(1, art.caster.frames - 1)) *
                          (frames - 1),
                      )
                    : art.caster.activeFrame;
        view.frame = this.#actionFrame(
          player.action,
          frames,
          activeFrame,
          animationTimeMs,
          this.#combatAnimations.get(player.id)?.actionId === player.action.id
            ? this.#combatAnimations.get(player.id)?.impactTimes
            : undefined,
        );
      }
      views.push(view);
      const afterimageExpiresAt = player.afterimage
        ? this.#serverClock.toLocal(player.afterimage.expiresAt)
        : null;
      if (
        player.afterimage &&
        (afterimageExpiresAt === null || afterimageExpiresAt > animationTimeMs)
      ) {
        const sheet = unitSheet(player.class, player.appearance, "idle");
        views.push({
          id: `afterimage:${player.id}`,
          kind: "player",
          x: player.afterimage.x,
          y: player.afterimage.y,
          z: player.afterimage.z,
          airborne: true,
          swimming: false,
          gliding: false,
          vy: 0,
          facing: facingOf(player.facing),
          ...actorSheetView(sheet),
          ...(sheet.directionRows === undefined ? {} : { directionalFacing: player.facing }),
          ...(player.appearance.body === "runic_guardian"
            ? { renderHeight: LAB_UNIT_HEIGHT * RUNIC_GUARDIAN_RENDER_SCALE }
            : player.appearance.body === "assassin"
              ? { renderHeight: LAB_UNIT_HEIGHT * ASSASSIN_RENDER_SCALE }
              : {}),
          animationTimeMs,
          animationLoop: true,
          tint: 0x6ad9ff,
          opacity: 0.32,
        });
      }
      this.#actorPositions.set(player.id, {
        x: player.x,
        y: player.y,
        z: player.z,
        playerClass: player.class,
        primaryColor: player.appearance.primaryColor,
      });
    }
    for (const guardian of sample.seaGuardians) {
      present.add(guardian.id);
      const attacking = guardian.state === "attack";
      const presentation = seaGuardianPresentation(guardian.id, guardian.state, animationTimeMs);
      const facing = facingOf(guardian.facing);
      const attackStartedAt = this.#serverClock.toLocal(guardian.animationStartedAt);
      const attackDuration =
        guardian.animationEndsAt === null
          ? undefined
          : guardian.animationEndsAt - guardian.animationStartedAt;
      views.push({
        id: guardian.id,
        kind: "sea_guardian",
        x: guardian.x,
        y: guardian.y,
        z: guardian.z,
        airborne: false,
        swimming: true,
        gliding: false,
        waterDepth: presentation.waterDepth,
        opacity: presentation.opacity,
        vy: 0,
        facing,
        textureKey: attacking
          ? SEA_GUARDIAN_ATTACK_TEXTURE_URL
          : seaGuardianSwimTextureUrl(guardian.facing),
        frames: 4,
        frameWidth: 256,
        frameHeight: 256,
        foot: 0.5,
        renderHeight: attacking ? 4.2 : 3.4,
        animationTimeMs: attacking
          ? Math.max(0, animationTimeMs - (attackStartedAt ?? animationTimeMs))
          : animationTimeMs,
        ...(attackDuration === undefined ? {} : { animationDurationMs: attackDuration }),
        animationLoop: !attacking,
      });
    }
    const rootMinotaurDeathIds = new Set<string>();
    for (const monster of sample.monsters) {
      present.add(monster.id);
      this.#combatVisualAuthority.recordSnapshot(monster.id, monster.action?.id ?? null);
      const motion = this.#actorMotion.sample(
        monster.id,
        monster.x,
        monster.z,
        monster.action !== null,
        animationTimeMs,
      );
      const timing = monster.action
        ? this.#actorAnimationTiming(monster.action, animationTimeMs)
        : null;
      const rootMinotaurArt =
        monster.species === "minotaur_brute" &&
        authoredActorSheet(monster.graphicAssetId, "idle") === null;
      const rootMinotaurDeath = monster.dead && rootMinotaurArt;
      const deathStartedAt = rootMinotaurDeath
        ? (this.#monsterDeathAnimations.get(monster.id) ?? animationTimeMs)
        : null;
      if (rootMinotaurDeath) {
        rootMinotaurDeathIds.add(monster.id);
        this.#monsterDeathAnimations.set(monster.id, deathStartedAt ?? animationTimeMs);
      }
      const displayedMotion = monster.dead ? "idle" : motion.motion;
      const sheet = rootMinotaurDeath
        ? ROOT_MINOTAUR_DEATH_SHEET
        : monsterActorSheet(
            monster.species,
            displayedMotion,
            monster.graphicAssetId,
            monster.action?.skillId,
          );
      const monsterView: ActorView = {
        id: monster.id,
        kind: monster.dead ? "corpse" : "monster",
        x: monster.x,
        y: monster.y,
        z: monster.z,
        airborne: monster.airborne === true,
        swimming: false,
        gliding: false,
        vy: 0,
        facing: facingOf(monster.facing),
        ...actorSheetView(sheet),
        ...(sheet.directionRows === undefined ? {} : { directionalFacing: monster.facing }),
        animationTimeMs:
          rootMinotaurDeath && deathStartedAt !== null
            ? animationTimeMs - deathStartedAt
            : (timing?.elapsed ?? animationTimeMs),
        ...(rootMinotaurDeath
          ? { animationDurationMs: ROOT_MINOTAUR_DEATH_DURATION_MS }
          : timing
            ? { animationDurationMs: timing.duration }
            : {}),
        frameDurationMs:
          rootMinotaurArt && displayedMotion !== "attack"
            ? ROOT_MINOTAUR_FRAME_MS[displayedMotion]
            : ACTOR_FRAME_MS[displayedMotion],
        animationLoop: rootMinotaurDeath ? false : motion.motion !== "attack",
        healthBar: {
          value: monster.hp,
          max: monster.maxHp,
          visible:
            !monster.dead &&
            shouldShowHealthBar(
              context.healthBars,
              "enemy",
              self
                ? Math.hypot(self.x - monster.x, self.z - monster.z) * TILE_SIZE
                : Number.POSITIVE_INFINITY,
            ),
        },
        ...(monster.dead && !rootMinotaurDeath ? { pose: "fallen" as const } : {}),
      };
      if (monster.action && !monster.dead) {
        const art = monsterCombatArt(monster.species);
        monsterView.frame = this.#actionFrame(
          monster.action,
          art.caster.frames,
          art.activeFrame,
          animationTimeMs,
          this.#combatAnimations.get(monster.id)?.actionId === monster.action.id
            ? this.#combatAnimations.get(monster.id)?.impactTimes
            : undefined,
        );
      }
      views.push(monsterView);
      this.#actorPositions.set(monster.id, {
        x: monster.x,
        y: monster.y,
        z: monster.z,
        species: monster.species,
      });
    }
    for (const monsterId of this.#monsterDeathAnimations.keys()) {
      if (!rootMinotaurDeathIds.has(monsterId)) this.#monsterDeathAnimations.delete(monsterId);
    }
    for (const guard of sample.guards) {
      present.add(guard.id);
      const motion = this.#actorMotion.sample(
        guard.id,
        guard.x,
        guard.z,
        guard.fighting,
        animationTimeMs,
      );
      const sheet = guardSheet(guard, motion.motion);
      views.push({
        id: guard.id,
        kind: "guard",
        x: guard.x,
        y: guard.y,
        z: guard.z,
        ...GROUNDED,
        vy: 0,
        // A guard carries no facing on the wire. `"north"` is `facingToFlip`'s no-op, so it keeps
        // whichever profile the guard already had rather than snapping it east every frame.
        facing: motion.direction ? facingOf(motion.direction) : "north",
        ...actorSheetView(sheet),
        animationTimeMs,
        frameDurationMs: ACTOR_FRAME_MS[motion.motion],
        animationLoop: true,
      });
    }
    for (const guard of sample.guards)
      this.#actorPositions.set(guard.id, { x: guard.x, y: guard.y, z: guard.z });
    const corpseIds = new Set<string>();
    for (const corpse of sample.corpses) {
      corpseIds.add(corpse.id);
      const runic = corpse.appearance.body === "runic_guardian";
      const assassin = corpse.appearance.body === "assassin";
      const peasantBonus = corpse.appearance.body === "peasant";
      const rangerBonus = corpse.appearance.body === "ranger";
      const priestBonus = corpse.appearance.body === "priest";
      const sheet = runic
        ? RUNIC_GUARDIAN_DEATH_SHEET
        : assassin
          ? ASSASSIN_DEATH_SHEET
          : peasantBonus
            ? PEASANT_BONUS_DEATH_SHEET
            : rangerBonus
              ? RANGER_BONUS_DEATH_SHEET
              : priestBonus
                ? PRIEST_BONUS_DEATH_SHEET
                : unitSheet(corpse.class, corpse.appearance, "idle");
      const deathStartedAt = this.#corpseAnimations.get(corpse.id) ?? animationTimeMs;
      this.#corpseAnimations.set(corpse.id, deathStartedAt);
      const corpseFacing = corpse.facing ?? { x: 0, z: 1 };
      views.push({
        id: `corpse:${corpse.id}`,
        kind: "corpse",
        x: corpse.x,
        y: corpse.y,
        z: corpse.z,
        ...GROUNDED,
        vy: 0,
        facing: facingOf(corpseFacing),
        ...(sheet.directionRows === undefined ? {} : { directionalFacing: corpseFacing }),
        ...actorSheetView(sheet),
        ...(runic
          ? { renderHeight: LAB_UNIT_HEIGHT * RUNIC_GUARDIAN_RENDER_SCALE }
          : assassin
            ? { renderHeight: LAB_UNIT_HEIGHT * ASSASSIN_RENDER_SCALE }
            : peasantBonus
              ? { renderHeight: LAB_UNIT_HEIGHT * PEASANT_BONUS_RENDER_SCALE }
              : rangerBonus
                ? { renderHeight: LAB_UNIT_HEIGHT * RANGER_BONUS_RENDER_SCALE }
                : priestBonus
                  ? { renderHeight: LAB_UNIT_HEIGHT * PRIEST_BONUS_RENDER_SCALE }
                  : {}),
        ...(runic || assassin || peasantBonus || rangerBonus || priestBonus
          ? {
              animationTimeMs: animationTimeMs - deathStartedAt,
              animationDurationMs: assassin
                ? 900
                : peasantBonus || rangerBonus || priestBonus
                  ? 1_000
                  : 760,
              animationLoop: false,
            }
          : { pose: "fallen" as const }),
      });
    }
    for (const corpseId of this.#corpseAnimations.keys()) {
      if (!corpseIds.has(corpseId)) this.#corpseAnimations.delete(corpseId);
    }
    const eventIds = new Set<string>();
    const mapSize = this.#map?.size ?? 0;
    for (const event of sample.events) {
      const assetId = worldEventAsset(event);
      const idleSheet = authoredActorSheet(assetId, "idle");
      if (!idleSheet) continue;
      eventIds.add(event.id);
      const movement = this.#eventMotion.sample(event, animationTimeMs);
      const motion = event.moveAnimation && movement.moving ? "run" : "idle";
      const sheet = authoredActorSheet(assetId, motion) ?? idleSheet;
      views.push({
        id: `event:${event.id}`,
        kind: "event",
        x: movement.col + 0.5 - mapSize / 2,
        y: event.y ?? 0,
        z: movement.row + 0.5 - mapSize / 2,
        ...(event.undergroundDepth === undefined
          ? {}
          : { undergroundDepth: event.undergroundDepth }),
        ...GROUNDED,
        vy: 0,
        facing:
          !event.directionFixed && movement.direction ? facingOf(movement.direction) : "north",
        ...actorSheetView(sheet),
        ...(isSheepAssetId(assetId) ? { renderHeight: SHEEP_RENDER_HEIGHT } : {}),
        animationTimeMs,
        frameDurationMs: isSheepAssetId(assetId)
          ? SHEEP_ACTOR_FRAME_MS[motion]
          : ACTOR_FRAME_MS[motion],
        animationLoop: true,
      });
    }
    this.#eventMotion.retain(eventIds);
    this.#actorMotion.retain(present);
    for (const playerId of this.#playerPresentation.keys()) {
      if (!playerIds.has(playerId)) this.#playerPresentation.delete(playerId);
    }
    for (const playerId of this.#playerVisibility.keys()) {
      if (!playerIds.has(playerId)) this.#playerVisibility.delete(playerId);
    }
    for (const actorId of this.#combatAnimations.keys()) {
      if (!present.has(actorId)) this.#combatAnimations.delete(actorId);
    }
    if (self && this.#map?.underground) {
      if (!this.#gameplayVisibilityInitialized) {
        this.#gameplayVisibilityDepth = groundedUndergroundVisibilityDepth(
          this.#map,
          self.x,
          self.z,
          self.y,
        );
        this.#gameplayVisibilityElevation = self.y;
        this.#gameplayVisibilityInitialized = true;
      }
      const transitioning = undergroundVisibilityTransitionAt(
        this.#map,
        self.x,
        self.z,
        self.y,
        self.airborne,
        self.vy ?? 0,
        this.#gameplayVisibilityDepth,
        this.#gameplayVisibilityElevation,
      );
      if (transitioning) {
        this.#gameplayVisibilityDepth = undergroundDepthAtElevation(self.y);
        if (!self.airborne) this.#gameplayVisibilityElevation = self.y;
      } else if (!self.airborne) {
        this.#gameplayVisibilityDepth = groundedUndergroundVisibilityDepth(
          this.#map,
          self.x,
          self.z,
          self.y,
        );
        this.#gameplayVisibilityElevation = self.y;
      }
      const visibleDepths: Array<number | null> = transitioning
        ? [...undergroundVisibleDepthsAtElevation(self.y)]
        : [this.#gameplayVisibilityDepth];
      if (visibleDepths.includes(null) && surfaceAccessPreviewAt(this.#map, self.x, self.z)) {
        const shaftDepth = Math.max(
          0,
          ...(this.#map.underground.shafts ?? []).map((shaft) => shaft.depth),
        );
        for (let depth = 1; depth <= shaftDepth; depth += 1) visibleDepths.push(depth);
      }
      let write = 0;
      for (const view of views) {
        const viewDepth =
          view.visibilityDepth !== undefined
            ? view.visibilityDepth
            : actorUndergroundVisibilityDepth(
                view.y,
                view.id === self.id,
                transitioning,
                this.#gameplayVisibilityDepth,
              );
        if (view.healthBar) {
          view.healthBar.visible &&= exactStoreyVisible(viewDepth, this.#gameplayVisibilityDepth);
        }
        if (!visibleDepths.includes(viewDepth)) continue;
        views[write] = view;
        write += 1;
      }
      views.length = write;
    }
    return views;
  }

  #actionFrame(
    action: CombatActionSnapshot,
    frames: number,
    activeFrame: number,
    now: number,
    serverImpactTimes?: readonly number[],
  ): number {
    const timeline = this.#serverClock.combatTimeline(action, now);
    const impactTimes = serverImpactTimes?.map(
      (impactAt) =>
        this.#serverClock.toLocal(impactAt) ??
        timeline.impactAt + Math.max(0, impactAt - action.impactAt),
    );
    return impactTimes && impactTimes.length > 1
      ? multiImpactActionFrameIndex(frames, activeFrame, timeline, impactTimes, now)
      : combatActionFrameIndex(frames, activeFrame, timeline, now);
  }

  #restorePlayerPresentation(player: PlayerSnapshot, now: number): GroundVector {
    const previous = this.#playerPresentation.get(player.id);
    const actionId = player.action?.id ?? null;
    let mobilityPlayedActionId =
      previous?.actionId === actionId ? previous.mobilityPlayedActionId : null;
    let mobilityTransition =
      previous?.actionId === actionId ? previous.mobilityTransition : undefined;
    if (previous) {
      if (previous.invisible && !player.invisible) {
        const vanish = combatArt("rogue", "vanish", player.appearance.primaryColor);
        if (vanish.zone)
          this.#visuals?.playSheet(
            vanish.zone,
            player.x,
            player.z,
            vanish.zone.durationMs,
            now,
            1,
            player.y,
          );
      }
      const mobility = mobilityVisual(player.action?.skillId);
      const distance = Math.hypot(player.x - previous.x, player.z - previous.z);
      const lumenHeld =
        player.action?.skillId === "blink" && player.action.channelEndsAt !== undefined;
      if (
        mobility &&
        actionId &&
        !lumenHeld &&
        mobilityPlayedActionId !== actionId &&
        distance > 12 / TILE_SIZE
      ) {
        const startedAt = now;
        const impact = combatArt(
          player.class,
          player.action?.skillId ?? "attack",
          player.appearance.primaryColor,
        ).impact;
        if (impact) {
          this.#visuals?.playSheet(
            impact,
            previous.x,
            previous.z,
            impact.durationMs,
            startedAt,
            0.72,
            previous.y,
          );
          this.#visuals?.playSheet(
            impact,
            player.x,
            player.z,
            impact.durationMs,
            startedAt,
            1.02,
            player.y,
          );
        }
        mobilityPlayedActionId = actionId;
        mobilityTransition = {
          offsetX: previous.x - player.x,
          offsetZ: previous.z - player.z,
          startedAt,
          durationMs: mobility.durationMs,
        };
      }
    }
    const mobilityOffset = mobilityTransition
      ? mobilityRenderOffset(
          mobilityTransition.offsetX,
          mobilityTransition.offsetZ,
          mobilityTransition.startedAt,
          mobilityTransition.durationMs,
          now,
        )
      : { x: 0, y: 0 };
    if (mobilityTransition && mobilityOffset.x === 0 && mobilityOffset.y === 0) {
      mobilityTransition = undefined;
    }
    this.#playerPresentation.set(player.id, {
      x: player.x,
      y: player.y,
      z: player.z,
      invisible: player.invisible === true,
      actionId,
      mobilityPlayedActionId,
      ...(mobilityTransition ? { mobilityTransition } : {}),
    });
    return { x: mobilityOffset.x, z: mobilityOffset.y };
  }

  #actorAnimationTiming(
    action: CombatActionSnapshot,
    now: number,
  ): { elapsed: number; duration: number } {
    const timeline = this.#serverClock.combatTimeline(action, now);
    return {
      elapsed: Math.max(0, now - timeline.startedAt),
      duration: Math.max(1, timeline.recoveryEndsAt - timeline.startedAt),
    };
  }

  /**
   * Everything placed AGAINST a heightfield: scenery, world-event art, the billboard registry, the
   * visual layer and the per-actor animation state they carry.
   *
   * Split out of `#disposeScene` because a terrain edit has to drop exactly this much and no more
   * — the scene, its camera, lights, sky, sea and post-fx describe no terrain and survive
   * `Hd2dScene.updateTerrain`. Every billboard disposed here unregisters itself from the context's
   * yaw registry (`ctx.unregisterBillboard`), which is what makes keeping that context across an
   * edit safe rather than a slow leak of meshes nothing can reach.
   */
  #disposeSceneContents(): void {
    // Billboards first: they are parented to the scene's graph, and disposing that graph out from
    // under them would leave the context's yaw registry holding meshes nothing can reach. The
    // token bump is part of the same teardown — a scenery download still in flight belongs to a
    // scene that no longer exists.
    this.#contentToken += 1;
    this.#eventToken += 1;
    this.#content?.dispose();
    this.#content = null;
    this.#eventContent?.dispose();
    this.#eventContent = null;
    // Neither texture view is disposed here: both are just cached lookups into `#assetTextures`
    // now (see its field docblock), which survives scene rebuilds on purpose — disposing it per
    // rebuild is exactly the re-download/re-decode stall that cache was built to remove.
    this.#eventTextures = null;
    this.#eventAssetKey = "";
    this.#eventLoadingAssetKey = "";
    this.#eventRequestedVisualKey = "";
    this.#eventVisualKey = "";
    this.#visuals?.dispose();
    this.#visuals = null;
    this.#actors?.dispose();
    this.#actors = null;
    this.#actorMotion.reset();
    this.#corpseAnimations.clear();
    this.#monsterDeathAnimations.clear();
    this.#eventMotion.reset();
    this.#playerPresentation.clear();
    this.#playerVisibility.clear();
    this.#combatAnimations.clear();
    this.#combatVisualAuthority.clearSnapshots();
    this.#cameraShake.clear();
  }

  #disposeScene(): void {
    this.#disposeSceneContents();
    this.#scene?.dispose();
    this.#scene = null;
    this.#map = null;
    this.#gameplayVisibilityDepth = null;
    this.#gameplayVisibilityElevation = 0;
    this.#gameplayVisibilityInitialized = false;
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    removeEventListener("resize", this.#onResize);
    if (this.#rafHandle !== null) cancelAnimationFrame(this.#rafHandle);
    this.#rafHandle = null;
    this.#frameCallbacks = [];
    this.#disposeScene();
    this.#editorPreviewToken += 1;
    this.#editorPreviewArt = null;
    this.#spawnKnightArt = null;
    // The one place the catalogue sheets and the sea are actually freed: both outlive every scene
    // this renderer built, and only the renderer's own death ends them.
    this.#assetTextures.dispose();
    this.#water?.dispose();
    this.#water = null;
    this.#textures.dispose();
  }

  /** Which of the frame's players the camera follows. Not a no-op any more: this is the one actor
   *  the view is built around. */
  setSelfId(id: string): void {
    this.#selfId = id;
  }

  #position(id: string): ActorPosition | null {
    return this.#actorPositions.get(id) ?? null;
  }

  #effectPosition(
    x: number,
    z: number,
    targetId?: string,
    fallbackElevation?: number,
  ): GroundVector & { y?: number } {
    const renderedTarget = targetId ? this.#position(targetId) : null;
    return renderedTarget
      ? { x: renderedTarget.x, y: renderedTarget.y, z: renderedTarget.z }
      : { x, z, ...(fallbackElevation === undefined ? {} : { y: fallbackElevation }) };
  }

  #localDeadline(serverTimestamp: number, fallbackMs: number): number {
    return this.#serverClock.toLocal(serverTimestamp) ?? performance.now() + fallbackMs;
  }

  configureMerchant(merchant: MerchantDefinition | null): void {
    this.#merchant = merchant;
    this.#visuals?.setMerchant(merchant);
  }

  diagnostics(): Record<string, number> {
    return {
      mapLoaded: this.#scene ? 1 : 0,
      gameHour: this.#scene?.gameHour() ?? 0,
      trackedActors: this.#actorPositions.size,
      ...this.#visuals?.diagnostics(),
    };
  }

  hidePeasantBombAim(): void {
    this.#visuals?.hideAim();
  }

  hideQuestSite(id: string, durationMs: number): void {
    this.#visuals?.hideQuestSite(id, durationMs);
  }

  playCombatAnimation(animation: CombatAnimation): void {
    if (!this.#combatVisualAuthority.acceptsAnimation(animation.actorId, animation.actionId))
      return;
    this.#combatAnimations.set(animation.actorId, animation);
    const position = this.#position(animation.actorId);
    if (!position) return;
    const now = performance.now();
    const timeline = this.#serverClock.combatTimeline(animation, now);
    if (
      animation.actorKind === "player" &&
      animation.skillId &&
      this.#visuals &&
      position.playerClass &&
      position.primaryColor
    ) {
      const art = combatArt(position.playerClass, animation.skillId, position.primaryColor);
      const mobilityImpact =
        animation.skillId === "shield_bash" ||
        animation.skillId === "dash" ||
        animation.skillId === "blink" ||
        animation.skillId === "shadow_step"
          ? art.impact
          : undefined;
      for (const sheet of [art.zone ?? mobilityImpact, art.accent]) {
        if (sheet)
          this.#visuals.playSheet(
            sheet,
            position.x,
            position.z,
            sheet.durationMs,
            timeline.impactAt,
            1,
            position.y,
          );
      }
      if (animation.talented) {
        const flourish = art.accent ?? art.zone ?? art.impact;
        if (flourish) {
          const restrainedPeasant = position.playerClass === "peasant";
          this.#visuals.playSheet(
            {
              ...flourish,
              scale: (flourish.scale ?? 1) * (restrainedPeasant ? 1.08 : 1.28),
            },
            position.x,
            position.z,
            flourish.durationMs,
            timeline.impactAt,
            1,
            position.y,
          );
          this.#visuals.playSheet(
            {
              ...flourish,
              scale: (flourish.scale ?? 1) * (restrainedPeasant ? 0.78 : 0.72),
            },
            position.x,
            position.z,
            flourish.durationMs * 0.82,
            timeline.impactAt,
            1,
            position.y,
          );
          if (animation.evolved) {
            this.#visuals.playSheet(
              {
                ...flourish,
                scale: (flourish.scale ?? 1) * (restrainedPeasant ? 1.32 : 1.68),
              },
              position.x,
              position.z,
              flourish.durationMs * 1.18,
              timeline.impactAt,
              1,
              position.y,
            );
          }
        }
      }
    }
  }

  playCombatImpact(
    playerId: string,
    skillId: string,
    x: number,
    z: number,
    targetId?: string,
  ): PlayerClass | undefined {
    const position = this.#position(playerId);
    const playerClass = position?.playerClass;
    if (playerClass && position?.primaryColor) {
      const art = combatArt(playerClass, skillId, position.primaryColor);
      const impact = this.#effectPosition(x, z, targetId, position.y);
      if (art.impact)
        this.#visuals?.playSheet(
          art.impact,
          impact.x,
          impact.z,
          art.impact.durationMs,
          performance.now(),
          1,
          impact.y,
        );
    }
    return playerClass;
  }

  playHealingImpact(
    color: PrimaryColor,
    skillId: "mend" | "prayer" | "divine_nova" = "mend",
    x?: number,
    z?: number,
    targetId?: string,
  ): void {
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    const atX = x ?? self?.x;
    const atZ = z ?? self?.z;
    if (atX === undefined || atZ === undefined) return;
    const position = this.#effectPosition(atX, atZ, targetId, self?.y);
    const definition = combatArt("priest", skillId, color);
    const impact = definition.impact ?? definition.zone;
    if (impact)
      this.#visuals?.playSheet(
        impact,
        position.x,
        position.z,
        impact.durationMs,
        performance.now(),
        1,
        position.y,
      );
  }

  playInteraction(): void {
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    if (self) this.#visuals?.pulse(self.x, self.z, 0xffe29a, 0.48, 300, performance.now(), self.y);
  }

  /**
   * The local hero's own movement events — never a remote one's: the session hands this whatever
   * `client.update` returned, and that is the one hero this client steps.
   *
   * Which is what makes the landing shake sound: the camera is over this hero, so its feet hitting
   * the ground are the one impact that needs no distance test.
   */
  playHeroMovement(events: readonly HeroEvent[], hero: PlayerSnapshot | null): void {
    this.#visuals?.playHeroMovement(events, hero);
    const now = performance.now();
    for (const event of events) {
      if (event.t !== "reception") continue;
      const impulse = heroLandingImpulse(event.force, now);
      if (impulse) this.#cameraShake.trigger(impulse);
    }
  }

  playLumenPortal(portal: PriestLumenPortalVisual): void {
    const now = performance.now();
    const endsAt = this.#localDeadline(portal.endsAt, 700);
    const duration = Math.max(120, endsAt - now);
    const actor = this.#position(portal.actorId);
    const color = actor?.primaryColor ?? "azure";
    const cloud = combatArt("priest", "blink", color).impact;
    if (!cloud) return;
    this.#visuals?.playSheet(cloud, portal.from.x, portal.from.z, duration, now, 1.05, actor?.y);
    this.#visuals?.playSheet(cloud, portal.to.x, portal.to.z, duration, now, 1.18, actor?.y);
  }

  playLumenTrail(trail: PriestLumenTrailVisual): void {
    const now = performance.now();
    const duration = Math.max(120, this.#localDeadline(trail.endsAt, 650) - now);
    const actor = this.#position(trail.actorId);
    const color = actor?.primaryColor ?? "azure";
    const cloud = combatArt("priest", "blink", color).impact;
    if (!cloud) return;
    for (let index = 1; index < trail.points.length; index += 1) {
      const from = trail.points[index - 1];
      const to = trail.points[index];
      if (!from || !to) continue;
      const distance = Math.hypot(to.x - from.x, to.z - from.z);
      const steps = Math.max(1, Math.ceil(distance / 0.65));
      for (let step = 0; step <= steps; step += 1) {
        const progress = step / steps;
        this.#visuals?.playSheet(
          cloud,
          from.x + (to.x - from.x) * progress,
          from.z + (to.z - from.z) * progress,
          duration,
          now,
          0.72 + ((index + step) % 3) * 0.08,
          actor?.y,
        );
      }
    }
  }

  playMonsterImpact(species: MonsterSpecies, x?: number, z?: number): void {
    const fallback = [...this.#actorPositions.values()].find((actor) => actor.species === species);
    const atX = x ?? fallback?.x;
    const atZ = z ?? fallback?.z;
    if (atX === undefined || atZ === undefined) return;
    const art = monsterCombatArt(species).impact;
    this.#visuals?.playSheet(art, atX, atZ, art.durationMs, performance.now(), 1, fallback?.y);
  }

  playMonsterSpecialImpact(impact: MonsterSpecialImpact): MonsterImpactSound | undefined {
    if (!this.#combatVisualAuthority.acceptsImpact(impact.actionId)) return undefined;
    const art = monsterSpecialImpactArt(impact.technique);
    const actor = this.#position(impact.actorId);
    const x = impact.x + (impact.direction.x * art.forwardOffset) / TILE_SIZE;
    const z = impact.z + (impact.direction.z * art.forwardOffset) / TILE_SIZE;
    this.#visuals?.playSheet(
      art.effect,
      x,
      z,
      art.effect.durationMs,
      performance.now(),
      1,
      actor?.y,
    );
    if (art.accent)
      this.#visuals?.playSheet(
        art.accent,
        x,
        z,
        art.accent.durationMs,
        performance.now(),
        1,
        actor?.y,
      );
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    if (!self) return undefined;
    const nearby = this.#cameraShake.trigger({
      id: impact.actionId,
      now: performance.now(),
      intensity: art.shake.intensity,
      durationMs: art.shake.durationMs,
      distance: Math.hypot(self.x - x, self.z - z),
      maxDistance: art.shake.maxDistance / TILE_SIZE,
    });
    return nearby ? art.sound : undefined;
  }

  playPeasantBombImpact(impact: PeasantBombImpactVisual): void {
    if (!this.#combatVisualAuthority.acceptsImpact(impact.actionId)) return;
    const art = combatArt("peasant", "homemade_bomb", "ember").impact;
    const actorY = this.#position(impact.actorId)?.y;
    if (art) {
      this.#visuals?.playSheet(
        { ...art, scale: (art.scale ?? 1) * 1.05 },
        impact.x,
        impact.z,
        art.durationMs * 1.05,
        performance.now(),
        1,
        actorY,
      );
    }
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    if (self) {
      this.#cameraShake.trigger({
        id: `peasant-bomb-${impact.actionId}`,
        now: performance.now(),
        intensity: 5.5,
        durationMs: 260,
        distance: Math.hypot(self.x - impact.x, self.z - impact.z),
        maxDistance: Math.max(260 / TILE_SIZE, impact.radius * 4),
      });
    }
  }

  playSheepExplosion(x: number, z: number, y?: number): void {
    this.#visuals?.playSheepExplosion(x, z, y);
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    if (!self) return;
    this.#cameraShake.trigger({
      id: `sheep-explosion-${x}-${z}`,
      now: performance.now(),
      intensity: SHEEP_EXPLOSION_SHAKE.intensity,
      durationMs: SHEEP_EXPLOSION_SHAKE.durationMs,
      distance: Math.hypot(self.x - x, self.z - z),
      maxDistance: SHEEP_EXPLOSION_SHAKE.maxDistanceTiles,
    });
  }

  playPolarityOrb(orb: PriestPolarityOrbVisual): void {
    const now = performance.now();
    const duration = Math.max(120, this.#localDeadline(orb.endsAt, 900) - now);
    const actor = this.#position(orb.actorId);
    const color = actor?.primaryColor ?? "azure";
    const sprite = combatArt("priest", "radiant_bolt", color).projectile;
    if (sprite) this.#visuals?.playSheet(sprite, orb.x, orb.z, duration, now, 0.78, actor?.y);
  }

  playRoguePoisonImpact(x: number, z: number, rupture: boolean, targetId?: string): PlayerClass {
    const art = combatArt("rogue", "poisoned_shiv", "violet").impact;
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    const impact = this.#effectPosition(x, z, targetId, self?.y);
    if (art) {
      this.#visuals?.playSheet(
        {
          ...art,
          scale: (art.scale ?? 1) * (rupture ? 1.85 : 0.58),
        },
        impact.x,
        impact.z,
        art.durationMs * (rupture ? 1.15 : 0.72),
        performance.now(),
        1,
        impact.y,
      );
    }
    return "rogue";
  }

  playShadowDance(sequence: RogueShadowDanceSequence): void {
    if (!this.#combatVisualAuthority.acceptsAction(sequence.actionId)) return;
    const base = this.#serverClock.toLocal(sequence.startedAt) ?? performance.now();
    const art = combatArt("rogue", "shadow_dance", "violet");
    for (const strike of sequence.strikes) {
      const startedAt = this.#serverClock.toLocal(strike.impactAt) ?? base;
      const targetY = this.#position(strike.targetId)?.y ?? this.#position(sequence.actorId)?.y;
      if (art.zone) {
        this.#visuals?.playSheet(
          { ...art.zone, scale: (art.zone.scale ?? 1) * 0.62 },
          strike.targetPosition.x,
          strike.targetPosition.z,
          360,
          startedAt,
          0.78,
          targetY,
        );
      }
    }
    const last = sequence.strikes.at(-1);
    if (last && art.accent) {
      const startedAt = this.#serverClock.toLocal(last.impactAt) ?? base;
      const targetY = this.#position(last.targetId)?.y ?? this.#position(sequence.actorId)?.y;
      this.#visuals?.playSheet(
        art.accent,
        last.targetPosition.x,
        last.targetPosition.z,
        art.accent.durationMs,
        startedAt,
        1,
        targetY,
      );
    }
  }

  playTeleportEffect(x?: number, z?: number): void {
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    const atX = x ?? self?.x;
    const atZ = z ?? self?.z;
    if (atX === undefined || atZ === undefined) return;
    const art = teleportEffectArt();
    this.#visuals?.playSheet(art, atX, atZ, art.durationMs, performance.now(), 1, self?.y);
  }

  /**
   * Preloads authored event art before its first playable frame.
   *
   * **The invariant this owes, rescued from the deleted `world-event-art.ts`:** collect ONLY the
   * explicit visual ids the authoritative snapshot carries — `event.graphicAssetId` and
   * `event.harvest.exhaustedAssetId`, each validated by `isEditorAssetId`. In particular **never
   * inspect an asset's name or path to guess that a resource might need a stump, an empty rock or
   * any other harvested replacement.** Guessing from a filename makes the preload set drift the day
   * an asset is renamed, and a harvest that lands on an unpreloaded texture initiates its download
   * from the last authoritative hit — which is exactly the frame it must not.
   *
   * The point of preloading here at all is that timing: queue every replacement before the first
   * playable frame, so the swap is a texture already in memory.
   */
  preloadWorldEventAssets(
    events: readonly WorldEventSnapshot[],
    buildings: readonly WorldBuildingSnapshot[] = [],
  ): void {
    this.#syncWorldEventContent(events, buildings, true);
  }

  removePeasantCamp(id: string): void {
    this.#visuals?.removeCamp(id);
  }

  removePeasantRation(id: string): void {
    this.#visuals?.removeRation(id);
  }

  /** Exact sprite picking, matching the lab: only an intact sheep billboard can answer. */
  pickSheep(clientX: number, clientY: number): string | null {
    if (!this.#scene || !this.#actors) return null;
    const rect = this.#canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const actorIds = this.#worldEvents.flatMap((event) => {
      const assetId = worldEventAsset(event);
      return event.harvest?.state === "intact" && isSheepAssetId(assetId)
        ? [`event:${event.id}`]
        : [];
    });
    const objects = this.#actors.objectsFor(actorIds);
    if (objects.length === 0) return null;
    this.#pointerRaycaster.setFromCamera(
      new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.#scene.camera,
    );
    const hit = this.#pointerRaycaster.intersectObjects([...objects], false)[0];
    const actorId = hit?.object.userData.actorId;
    return typeof actorId === "string" && actorId.startsWith("event:")
      ? actorId.slice("event:".length)
      : null;
  }

  /** Casts the pointer through the HD-2D camera onto the bounded world ground. */
  screenToWorld(clientX: number, clientY: number): GroundVector | null {
    return this.#visuals?.screenToWorld(clientX, clientY) ?? null;
  }

  /** Moves the editor/preview camera without impersonating a local player. */
  setCameraFocus(x: number, z: number): void {
    this.#manualFocus = { x, z };
    this.#scene?.focusOn(
      x,
      z,
      this.#undergroundDepth === null ? undefined : undergroundFloorHeight(this.#undergroundDepth),
    );
  }

  /** Selects the ground floor or a signed vertical storey in creator tools. */
  setUndergroundDepth(depth: number | null): void {
    this.#undergroundDepth = depth;
    this.#scene?.setUndergroundDepth(depth, this.#currentMapId === "editor");
    this.#visuals?.setEditorGroundElevation(
      depth === null ? null : undergroundFloorHeight(this.#undergroundDepth ?? depth),
    );
    this.#visuals?.setEventVisibilityDepth(this.#map?.underground ? depth : undefined);
    if (this.#manualFocus) this.setCameraFocus(this.#manualFocus.x, this.#manualFocus.z);
  }

  /** Changes the editor/preview camera while preserving gameplay's 100% default. */
  setCameraZoom(percent: number): void {
    this.#cameraZoom = percent;
    this.#scene?.setZoom(percent);
  }

  setCameraPitch(radians: number): void {
    if (!Number.isFinite(radians)) return;
    this.#cameraPitch = radians;
    this.#scene?.setPitch(radians);
  }

  rotateCamera(deltaRadians: number): void {
    if (!Number.isFinite(deltaRadians) || deltaRadians === 0) return;
    this.#cameraYaw = Math.atan2(
      Math.sin(this.#cameraYaw + deltaRadians),
      Math.cos(this.#cameraYaw + deltaRadians),
    );
    this.#scene?.setYaw(this.#cameraYaw);
  }

  /** Keeps gameplay's tilt-shift by default while allowing the authoring stage to stay crisp. */
  setFogEnabled(enabled: boolean): void {
    this.#fogEnabled = enabled;
    this.#scene?.setFogEnabled(enabled);
  }

  setTiltShiftEnabled(enabled: boolean): void {
    this.#tiltShiftEnabled = enabled;
    this.#scene?.setTiltShiftEnabled(enabled);
  }

  /** Draws creator-only grid/collision/selection guides in the real HD-2D scene.
   *
   *  Also the trigger for the spawn marker's knight: the first editor overlay of ANY kind starts
   *  the one-shot load (`#spawnKnightRequested` guards repeats — this runs on every hover). Never
   *  fires for an ordinary player, since only the editor ever calls this method at all.
   *
   *  It used to wait for an overlay carrying a `spawn`, which was enough while a pulsing ring stood
   *  in for the knight until its texture landed. The ring is gone (feedback #23) and the knight is
   *  now the whole marker, so the load has to be ahead of the first spawn rather than triggered by
   *  it: an author placing the start would otherwise watch an empty cell for a round trip. */
  setEditorOverlay(overlay: Hd2dEditorOverlay | null): void {
    this.#visuals?.setEditorOverlay(overlay);
    if (overlay && !this.#spawnKnightRequested) {
      this.#spawnKnightRequested = true;
      void this.#loadSpawnKnightAsset().catch((error: unknown) => {
        console.warn("[hd2d] spawn marker knight could not be loaded", error);
      });
    }
  }

  /** Loads only the currently selected creator asset and keeps it alive across terrain redraws. */
  setEditorPreviewAsset(assetId: string | null): void {
    if (assetId === this.#editorPreviewAssetId) {
      this.#visuals?.setEditorPreviewArt(this.#editorPreviewArt);
      return;
    }
    this.#editorPreviewAssetId = assetId;
    const token = ++this.#editorPreviewToken;
    this.#visuals?.setEditorPreviewArt(null);
    this.#editorPreviewArt = null;
    if (!assetId) return;
    void this.#loadEditorPreviewAsset(assetId, token).catch((error: unknown) => {
      if (token === this.#editorPreviewToken) {
        console.warn(`[hd2d] editor preview asset "${assetId}" could not be loaded`, error);
      }
    });
  }

  setAuthoredQuestMarkers(markers: readonly AuthoredQuestMarker[]): void {
    this.#questMarkers = markers;
    this.#visuals?.setQuestMarkers(markers);
  }

  showPeasantBombAim(origin: GroundVector, direction: GroundVector, range: number): void {
    this.#visuals?.setAim(origin, direction, range);
  }

  showPeasantCamp(camp: PeasantCampVisual): void {
    const actor = this.#position(camp.actorId);
    const created = this.#visuals?.showCamp(
      camp,
      this.#localDeadline(camp.expiresAt, 30_000),
      actor?.y,
    );
    if (!created) return;
    const color = actor?.primaryColor ?? "moss";
    const zone = combatArt("peasant", "makeshift_camp", color).zone;
    if (zone)
      this.#visuals?.playSheet(
        zone,
        camp.x,
        camp.z,
        zone.durationMs,
        performance.now(),
        1,
        actor?.y,
      );
  }

  showPeasantRation(ration: PeasantRationVisual): void {
    this.#visuals?.showRation(
      ration,
      this.#localDeadline(ration.launchedAt, 0),
      this.#localDeadline(ration.landsAt, 1_600),
      this.#localDeadline(ration.fadeAt, 31_600),
      this.#localDeadline(ration.expiresAt, 32_600),
    );
  }

  showWorldEvent(
    text: string,
    tone: "info" | "good" | "bad",
    x?: number,
    z?: number,
    targetId?: string,
  ): void {
    const self = this.#selfId ? this.#position(this.#selfId) : null;
    const position = this.#effectPosition(x ?? self?.x ?? 0, z ?? self?.z ?? 0, targetId, self?.y);
    this.#visuals?.showWorldEvent(text, tone, position.x, position.z, position.y);
  }
}
