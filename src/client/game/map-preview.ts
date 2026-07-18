/**
 * A sandbox walk through an unsaved map, with a throwaway level-1 warrior.
 *
 * The whole point of this module is one line, and it is deliberately the same line the live client
 * runs to predict its own square (`net.ts`'s `predictPartial`) and the same rules the server runs to
 * decide truth:
 *
 *   position = resolveTerrain(position, step(position, input, TICK_DT, PLAYER_SPEED, geometry), geometry);
 *
 * Because the preview calls the exact shared `step()` + `resolveTerrain()` on the exact `terrainFromMap`
 * bake the server would build, parity is not a promise kept by hand — it is the same functions on the
 * same geometry. What a builder walks here is what a player will walk, collisions included.
 *
 * There is no React in here (game code never imports React). `MapEditor` disposes the painting stage,
 * calls `startMapPreview`, and on Esc calls the returned `stop()`, which tears the preview renderer
 * off the shared `#stage` app so the editor can be reopened on the same canvas with the edits intact.
 */
import {
  BODY_VARIANTS,
  type CharacterAppearance,
  PRIMARY_COLORS,
  starterEquipmentFor,
} from "../../shared/character.js";
import { resolveTerrain } from "../../shared/game.js";
import { type MapData, mapSpawnPoint, terrainFromMap } from "../../shared/map-data.js";
import { MAX_ACCUMULATED_SECONDS } from "../../shared/prediction.js";
import type { PlayerSnapshot, QuestState } from "../../shared/protocol.js";
import { PLAYER_SPEED, step, TICK_DT, type Vec2 } from "../../shared/simulation.js";
import { encodeTileLayer } from "../../shared/tile-layer-codec.js";
import { t } from "../i18n.js";
import { trackInput } from "./input.js";
import { type RenderContext, Renderer } from "./renderer.js";
import { acquireStageApp } from "./stage-application.js";

/** The synthetic hero's id, echoed to `setSelfId` so the renderer follows it with the camera and
 *  draws its self ring — the same wiring a real session uses for the local player. */
const SELF_ID = "map-preview-self";

/** A benign, walkable quest state: the preview zone has no quest sites (empty visuals), so this only
 *  has to be a valid shape the overlay pass can read. Mirrors the constant `session.ts` starts with. */
const PREVIEW_QUEST: QuestState = {
  chapter: "three_offerings",
  status: "available",
  progress: 0,
  target: 3,
};

/** A random level-1 warrior's look, drawn from the same catalogues character creation uses. */
function randomAppearance(): CharacterAppearance {
  const body = BODY_VARIANTS[Math.floor(Math.random() * BODY_VARIANTS.length)] ?? "wayfarer";
  const primaryColor = PRIMARY_COLORS[Math.floor(Math.random() * PRIMARY_COLORS.length)] ?? "azure";
  return { body, primaryColor };
}

// Bumped by every start. A start superseded before its textures finished loading (React StrictMode's
// throwaway first mount) tears down what it built and hands back an inert stop, so only the latest
// preview ever keeps a renderer on the shared `#stage` app.
let previewGeneration = 0;

/**
 * Opens a throwaway warrior walk on the map `data`, on the shared `#stage` canvas the editor just
 * released. Returns a `stop()` that detaches the preview renderer so the editor can reopen on the
 * same canvas.
 *
 * The caller (the editor) must have disposed its painting stage first: one Pixi world on `#stage` at
 * a time. The editor's dispose pauses the shared ticker; `acquireStageApp` below hands back a running
 * one so this frame loop actually fires.
 */
export async function startMapPreview(data: MapData): Promise<{ stop(): void }> {
  const generation = ++previewGeneration;
  const canvas = document.querySelector<HTMLCanvasElement>("#stage");
  if (!canvas) throw new Error("index.html is missing #stage");

  // The exact geometry the server would build a room from — collision and bounds both come from here.
  const geometry = terrainFromMap(data);
  const spawn = mapSpawnPoint(data);

  const renderer = await Renderer.create(canvas);
  // A newer start already superseded this one while textures loaded: undo the world this build added
  // to the shared stage and return a no-op stop. This is StrictMode's throwaway half.
  if (generation !== previewGeneration) {
    renderer.destroy();
    return { stop() {} };
  }

  // A unique zone id every start, so `configureMapTerrain`'s same-zone short-circuit never skips a
  // rebuild when a previous preview left `#currentZoneId` set to an earlier `preview:*`.
  // Re-encoded rather than handed over parsed: the renderer owns the one degrade policy for a
  // malformed layer, and a preview must exercise the same path a welcome does. Once per preview
  // build, never per frame.
  renderer.configureMapTerrain(`preview:${generation}`, geometry.tiles, data.elements, generation, {
    tilesetId: data.tilesetId,
    layers: data.layers.map(encodeTileLayer),
  });
  renderer.setSelfId(SELF_ID);

  const self: PlayerSnapshot = {
    id: SELF_ID,
    nick: t("editor.preview"),
    x: spawn.x,
    y: spawn.y,
    ack: 0,
    hp: 100,
    maxHp: 100,
    level: 1,
    appearance: randomAppearance(),
    class: "warrior",
    equipment: starterEquipmentFor("warrior"),
    life: "alive",
  };

  const tracker = trackInput();
  let position: Vec2 = { x: spawn.x, y: spawn.y };
  let accumulator = 0;

  renderer.onFrame((now, dt) => {
    const input = tracker.current();
    // The same fixed-step accumulator `net.ts` runs: one command's worth of movement per TICK_DT,
    // capped so a slow frame cannot spiral. The tick rate is the speed limit, exactly as in game.
    accumulator = Math.min(accumulator + dt, MAX_ACCUMULATED_SECONDS);
    while (accumulator >= TICK_DT) {
      accumulator -= TICK_DT;
      // The one load-bearing line — byte-for-byte `net.ts`'s `predictPartial`, the shared movement
      // truth the server and client prediction both run.
      position = resolveTerrain(
        position,
        step(position, input, TICK_DT, PLAYER_SPEED, geometry),
        geometry,
      );
    }
    const moved: PlayerSnapshot = { ...self, x: position.x, y: position.y };
    const context: RenderContext = {
      self: moved,
      quest: PREVIEW_QUEST,
      attackCooldownUntil: 0,
      attackRange: 0,
      now,
      healthBars: "both",
      grid: false,
    };
    renderer.render({ players: [moved], monsters: [], guards: [], loot: [], corpses: [] }, context);
  });

  // The editor's dispose (run just before this) paused the shared ticker; guarantee a running one so
  // the frame loop above fires. Idempotent — `acquireStageApp` hands back the same, started app.
  (await acquireStageApp(canvas)).ticker.start();

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      tracker.stop();
      // Detaches only this preview's world and frame callbacks from the shared app (never destroys
      // it — Pixi 8 cannot re-init the canvas), leaving a clean stage for the editor to reopen on.
      renderer.destroy();
    },
  };
}
