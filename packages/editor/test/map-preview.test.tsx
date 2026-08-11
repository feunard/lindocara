import { startMapPreview } from "@lindocara/editor/game/map-preview.js";
import { harvestGroundColliderAt } from "@lindocara/engine/harvest.js";
import { harvestProfileFromPreset } from "@lindocara/engine/harvest-presets.js";
import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { defaultEventPage, type MapEvent } from "@lindocara/engine/map-events.js";
import { BODY_RADIUS } from "@lindocara/engine/terrain-access.js";
import { mapDataFromBlocks } from "@lindocara/testing/map-fixtures.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const renderer = {
    configureMapTerrain: vi.fn(),
    destroy: vi.fn(),
    onFrame: vi.fn((callback: (now: number, dt: number) => void) => {
      state.frame = callback;
    }),
    preloadWorldEventAssets: vi.fn(),
    render: vi.fn((sample: PreviewSample) => state.renders.push(sample)),
    setCameraZoom: vi.fn(),
    setDayCycleOverride: vi.fn(),
    setSelfId: vi.fn(),
  };
  return {
    frame: null as ((now: number, dt: number) => void) | null,
    renders: [] as PreviewSample[],
    input: { up: false, down: false, left: false, right: false, jump: false },
    renderer,
    create: vi.fn(async () => renderer),
    stopInput: vi.fn(),
  };
});

interface PreviewPlayer {
  x: number;
  y: number;
  z: number;
  facing: { x: number; z: number };
}

interface PreviewSample {
  players: readonly PreviewPlayer[];
  guards: readonly {
    id: string;
    x: number;
    y: number;
    z: number;
    hp: number;
    maxHp: number;
    graphicAssetId?: string | null;
    graphicTint?: number;
  }[];
}

vi.mock("@lindocara/renderer/hd2d/game-renderer.js", () => ({
  Hd2dRenderer: { create: state.create },
}));

vi.mock("@lindocara/renderer/input.js", () => ({
  trackInput: () => ({
    current: () => state.input,
    setVirtual: vi.fn(),
    reset: vi.fn(),
    stop: state.stopInput,
  }),
}));

const OPEN_ROOM = mapDataFromBlocks({
  blocks: Array.from({ length: 10 }, () => ".".repeat(10)),
  elements: [],
  spawn: { col: 5, row: 5 },
});

const TREE_EVENT: MapEvent = {
  id: "preview-harvest-tree",
  col: 7,
  row: 5,
  name: "Tree",
  ordinal: 1,
  kind: "harvestable",
  species: null,
  patrolRadius: null,
  harvestProfile: harvestProfileFromPreset("tree"),
  pages: [defaultEventPage()],
};

const GUARD_EVENT: MapEvent = {
  id: "preview-guard",
  col: 6,
  row: 4,
  name: "Sentinel",
  ordinal: 2,
  kind: "guard",
  species: null,
  patrolRadius: 64,
  pages: [
    {
      ...defaultEventPage(),
      graphicAssetId: "character.units-blue-units-warrior.warrior-idle",
      graphicTint: 0x91c8ff,
    },
  ],
};

describe("HD-2D map preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.frame = null;
    state.renders = [];
    state.input = { up: false, down: false, left: false, right: false, jump: false };
    document.body.innerHTML = '<canvas id="stage"></canvas>';
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("turns left immediately and preserves facing at rest", async () => {
    const preview = await startMapPreview(OPEN_ROOM);
    if (!state.frame) throw new Error("frame callback missing");
    state.input.left = true;
    state.frame(performance.now(), 1 / 60);
    expect(state.renders.at(-1)?.players[0]?.facing).toEqual({ x: -1, z: 0 });

    state.input.left = false;
    state.frame(performance.now(), 1 / 60);
    expect(state.renders.at(-1)?.players[0]?.facing).toEqual({ x: -1, z: 0 });
    preview.stop();
  });

  it("draws client-owned movement on every animation frame", async () => {
    const preview = await startMapPreview(OPEN_ROOM);
    if (!state.frame) throw new Error("frame callback missing");
    state.frame(performance.now(), 1 / 240);
    const before = state.renders.at(-1)?.players[0]?.x ?? 0;
    state.input.right = true;
    state.frame(performance.now(), 1 / 240);
    expect(state.renders.at(-1)?.players[0]?.x).toBeGreaterThan(before);
    preview.stop();
  });

  it("owns and tears down its HD-2D renderer and input tracker", async () => {
    const preview = await startMapPreview(OPEN_ROOM);
    expect(state.renderer.setDayCycleOverride).toHaveBeenCalledWith(null);
    expect(state.renderer.configureMapTerrain).toHaveBeenCalledWith(
      expect.stringMatching(/^preview:/),
      [],
      expect.any(Number),
      expect.objectContaining({ version: 1, size: 10 }),
    );
    preview.stop();
    expect(state.renderer.destroy).toHaveBeenCalledOnce();
    expect(state.stopInput).toHaveBeenCalledOnce();
  });

  it("uses the selected fixed ambience for a cycle-disabled map preview", async () => {
    const preview = await startMapPreview(OPEN_ROOM, [], {
      dayNightCycle: false,
      fixedLighting: "night-full",
    });
    expect(state.renderer.setDayCycleOverride).toHaveBeenCalledWith("night");
    preview.stop();
  });

  it("renders authored guards as real HD-2D actors in the playable preview", async () => {
    const preview = await startMapPreview(OPEN_ROOM, [GUARD_EVENT]);
    if (!state.frame) throw new Error("frame callback missing");
    state.frame(performance.now(), 1 / 60);

    expect(state.renders.at(-1)?.guards).toEqual([
      expect.objectContaining({
        id: `preview-guard-${GUARD_EVENT.id}`,
        hp: 220,
        maxHp: 220,
        graphicAssetId: GUARD_EVENT.pages[0]?.graphicAssetId,
        graphicTint: 0x91c8ff,
      }),
    ]);
    preview.stop();
  });

  it("blocks the local hero on an intact authored harvest footprint", async () => {
    const heightfield = compileAuthoredMap(OPEN_ROOM, [TREE_EVENT]);
    const collider = harvestGroundColliderAt(
      TREE_EVENT.harvestProfile as NonNullable<MapEvent["harvestProfile"]>,
      TREE_EVENT.col,
      TREE_EVENT.row,
      "intact",
      heightfield.size,
    );
    if (!collider) throw new Error("fixture collider missing");
    const preview = await startMapPreview(OPEN_ROOM, [TREE_EVENT]);
    if (!state.frame) throw new Error("frame callback missing");
    state.input.right = true;
    for (let frame = 0; frame < 180; frame += 1) state.frame(performance.now(), 1 / 60);
    const player = state.renders.at(-1)?.players[0];
    expect((player?.x ?? Number.POSITIVE_INFINITY) + BODY_RADIUS).toBeLessThanOrEqual(collider.x);
    preview.stop();
  });

  it("lets a hero leave an overlapping resource before activating its collider", async () => {
    const spawnResource = { ...TREE_EVENT, col: OPEN_ROOM.spawn.col, row: OPEN_ROOM.spawn.row };
    const heightfield = compileAuthoredMap(OPEN_ROOM, [spawnResource]);
    const collider = harvestGroundColliderAt(
      spawnResource.harvestProfile as NonNullable<MapEvent["harvestProfile"]>,
      spawnResource.col,
      spawnResource.row,
      "intact",
      heightfield.size,
    );
    if (!collider) throw new Error("fixture collider missing");
    const preview = await startMapPreview(OPEN_ROOM, [spawnResource]);
    if (!state.frame) throw new Error("frame callback missing");

    state.input.right = true;
    for (let frame = 0; frame < 120; frame += 1) state.frame(performance.now(), 1 / 60);
    expect(state.renders.at(-1)?.players[0]?.x).toBeGreaterThan(collider.x + collider.w);

    state.input.right = false;
    state.input.left = true;
    for (let frame = 0; frame < 180; frame += 1) state.frame(performance.now(), 1 / 60);
    expect(state.renders.at(-1)?.players[0]?.x).toBeGreaterThan(collider.x + collider.w);
    preview.stop();
  });
});
