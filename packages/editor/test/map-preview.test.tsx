/**
 * `map-preview.ts` drives a real Pixi `Renderer` on a real canvas, which is untestable in jsdom —
 * the same reasoning `editor-shell.test.tsx` documents for the painting stage. So `Renderer`,
 * `acquireStageApp` and `trackInput` are faked here exactly as that file fakes
 * `openMapEditorStage`, and this test drives the *real* `startMapPreview` tick loop through the
 * fake's captured `onFrame` callback. That keeps the assertion on the actual production wiring —
 * a revert of the `facing` fix in `map-preview.ts` fails this test, not just the pure helper it
 * calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  frame: null as ((now: number, dt: number) => void) | null,
  renders: [] as {
    players: readonly { x: number; y: number; facing: { x: number; y: number } }[];
  }[],
  input: { up: false, down: false, left: false, right: false },
  maxFPS: 0,
}));

vi.mock("@lindocara/renderer/renderer.js", () => ({
  Renderer: {
    create: vi.fn(async () => ({
      configureMapTerrain: vi.fn(),
      setSelfId: vi.fn(),
      onFrame: (callback: (now: number, dt: number) => void) => {
        state.frame = callback;
      },
      render: (sample: {
        players: readonly { x: number; y: number; facing: { x: number; y: number } }[];
      }) => {
        state.renders.push(sample);
      },
      destroy: vi.fn(),
    })),
  },
}));

vi.mock("@lindocara/renderer/stage-application.js", () => ({
  acquireStageApp: vi.fn(async () => ({
    ticker: {
      start: vi.fn(),
      get maxFPS() {
        return state.maxFPS;
      },
      set maxFPS(value: number) {
        state.maxFPS = value;
      },
    },
  })),
}));

vi.mock("@lindocara/renderer/input.js", () => ({
  trackInput: () => ({
    current: () => state.input,
    setVirtual: vi.fn(),
    reset: vi.fn(),
    stop: vi.fn(),
  }),
}));

import { startMapPreview } from "@lindocara/editor/game/map-preview.js";
import { TICK_DT } from "@lindocara/engine/simulation.js";
import { mapDataFromBlocks } from "@lindocara/testing/map-fixtures.js";

// A large open room: the fixture only needs to exist, no wall is anywhere near the spawn.
const OPEN_ROOM = mapDataFromBlocks({
  blocks: Array.from({ length: 10 }, () => ".".repeat(10)),
  elements: [],
  spawn: { col: 5, row: 5 },
});

describe("map preview", () => {
  beforeEach(() => {
    state.frame = null;
    state.renders = [];
    state.input = { up: false, down: false, left: false, right: false };
    state.maxFPS = 0;
    document.body.innerHTML = '<canvas id="stage"></canvas>';
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("turns the preview hero to face left, and holds that facing at rest", async () => {
    const preview = await startMapPreview(OPEN_ROOM);
    if (!state.frame) throw new Error("Renderer.onFrame never captured a callback");

    // One full tick's worth of "left" held down.
    state.input = { up: false, down: false, left: true, right: false };
    state.frame(performance.now(), TICK_DT);

    const afterLeft = state.renders.at(-1)?.players[0];
    expect(afterLeft?.facing).toEqual({ x: -1, y: 0 });

    // Releasing the key must not snap facing back to the hardcoded right-facing default.
    state.input = { up: false, down: false, left: false, right: false };
    state.frame(performance.now(), TICK_DT);

    const atRest = state.renders.at(-1)?.players[0];
    expect(atRest?.facing).toEqual({ x: -1, y: 0 });

    preview.stop();
  });

  it("D22: draws the own hero with a sub-tick partial step, so it moves smoothly below 20Hz", async () => {
    const preview = await startMapPreview(OPEN_ROOM);
    if (!state.frame) throw new Error("Renderer.onFrame never captured a callback");

    // A frame shorter than one tick: the whole-tick loop never fires, so a preview that drew the raw
    // tick position would render the hero standing still. The partial step must still advance it.
    const now = performance.now();
    state.frame(now, TICK_DT * 0.4);
    const atRest = state.renders.at(-1)?.players[0];

    state.input = { up: false, down: false, left: false, right: true };
    state.frame(now, TICK_DT * 0.4); // accumulator 0.8·TICK_DT — still no full tick.
    const partial = state.renders.at(-1)?.players[0];

    // No whole tick fired in either frame, yet the drawn x advanced: proof the local square is drawn
    // with the sub-tick partial step (net.ts's rule), not frozen at the last 20Hz tick.
    expect(partial?.x).toBeGreaterThan(atRest?.x ?? 0);

    preview.stop();
  });

  it("caps the preview ticker at 60fps and restores it on stop", async () => {
    const preview = await startMapPreview(OPEN_ROOM);
    expect(state.maxFPS).toBe(60);
    preview.stop();
    expect(state.maxFPS).toBe(0);
  });
});
