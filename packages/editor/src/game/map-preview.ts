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

import { t } from "@lindocara/client/i18n.js";
import {
  BODY_VARIANTS,
  type CharacterAppearance,
  PRIMARY_COLORS,
  starterEquipmentFor,
} from "@lindocara/engine/character.js";
import { facingFromInput } from "@lindocara/engine/directional-combat.js";
import { resolveTerrain } from "@lindocara/engine/game.js";
import { type MapData, mapSpawnPoint, terrainFromMap } from "@lindocara/engine/map-data.js";
import { MAX_ACCUMULATED_SECONDS } from "@lindocara/engine/prediction.js";
import type { PlayerSnapshot, QuestState } from "@lindocara/engine/protocol.js";
import { PLAYER_SPEED, step, TICK_DT, type Vec2 } from "@lindocara/engine/simulation.js";
import { encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { trackInput } from "@lindocara/renderer/input.js";
import { type RenderContext, Renderer } from "@lindocara/renderer/renderer.js";
import { acquireStageApp } from "@lindocara/renderer/stage-application.js";

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
    facing: { x: 1, y: 0 },
    action: null,
  };

  const tracker = trackInput();
  let position: Vec2 = { x: spawn.x, y: spawn.y };
  let facing: Vec2 = { ...self.facing };
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
      // Same conversion `movement-system.ts` applies to a dequeued command every tick: the last
      // non-zero movement becomes facing, standing still preserves it. Without this the preview
      // hero never turns, since nothing else in this local loop ever touches `facing`.
      facing = facingFromInput(input, facing);
    }
    // The DRAWN position carries the leftover sub-tick time as a partial step, byte-for-byte
    // `net.ts`'s `#samplePredictedPosition`: `position` above advances only in whole `TICK_DT` ticks
    // (the 20Hz authoritative cadence), so drawing it raw makes the local hero jerk forward at 20Hz on
    // a 60/120Hz screen (D22). Adding the leftover `accumulator` as one fractional `step()` — the same
    // shared movement truth, not a second copy — draws the own square smoothly every frame, exactly as
    // the live client predicts its own square between ticks.
    const drawn = resolveTerrain(
      position,
      step(position, input, accumulator, PLAYER_SPEED, geometry),
      geometry,
    );
    const moved: PlayerSnapshot = { ...self, x: drawn.x, y: drawn.y, facing };
    const context: RenderContext = {
      self: moved,
      quest: PREVIEW_QUEST,
      now,
      healthBars: "both",
      grid: false,
    };
    renderer.render(
      {
        players: [moved],
        monsters: [],
        guards: [],
        loot: [],
        corpses: [],
        projectiles: [],
        events: [],
      },
      context,
    );
  });

  // The editor's dispose (run just before this) paused the shared ticker; guarantee a running one so
  // the frame loop above fires. Idempotent — `acquireStageApp` hands back the same, started app.
  const app = await acquireStageApp(canvas);
  app.ticker.start();
  // Measured: on a high-refresh (ProMotion 120Hz) display the uncapped preview ticker ran at
  // 120-145 fps, roughly doubling GPU fill-rate for zero visible gain over 60 — the dominant cost
  // is the fullscreen animated water fill. Scoped to the preview only: this is the shared `#stage`
  // app the game session's renderer also runs on, so `stop()` below puts the cap back to Pixi's
  // default (uncapped) rather than leaving the game itself capped after the preview closes.
  app.ticker.maxFPS = 60;

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      tracker.stop();
      app.ticker.maxFPS = 0;
      // Detaches only this preview's world and frame callbacks from the shared app (never destroys
      // it — Pixi 8 cannot re-init the canvas), leaving a clean stage for the editor to reopen on.
      renderer.destroy();
    },
  };
}
