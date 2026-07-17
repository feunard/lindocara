import { describe, expect, it } from "vitest";
import {
  bakeCollision,
  canPlaceElement,
  type MapData,
  mapSpawnPoint,
  parseMapData,
  terrainFromMap,
} from "../src/shared/map-data.js";
import { isSolidKind, kindAt, TILE_SIZE } from "../src/shared/tilemap.js";
import { editorAsset } from "../src/shared/tiny-swords-catalog.js";

const TREE = "resource.terrain-resources-wood-trees.tree3" as const;
const TREE_ALT = "resource.terrain-resources-wood-trees.tree4" as const;
const BUSH = "decoration.terrain-decorations-bushes.bushe1" as const;
const STONE = "decoration.terrain-decorations-rocks.rock1" as const;

const MAP: MapData = {
  blocks: ["....", ".##.", "....", "...."],
  elements: [],
  spawn: { col: 0, row: 0 },
};

describe("baking a map's collision", () => {
  it("keeps grass walkable and water solid", () => {
    const tiles = bakeCollision(MAP);
    expect(kindAt(tiles, 0, 0)).toBe("grass");
    expect(isSolidKind(kindAt(tiles, 1, 1))).toBe(true);
  });

  it("bakes a tree solid but leaves a bush walkable", () => {
    const tiles = bakeCollision({
      ...MAP,
      elements: [
        { col: 0, row: 0, assetId: TREE },
        { col: 3, row: 0, assetId: BUSH },
      ],
    });
    expect(isSolidKind(kindAt(tiles, 0, 0))).toBe(true);
    expect(isSolidKind(kindAt(tiles, 3, 0))).toBe(false);
  });

  it("leaves a stone on water solid — it was already water", () => {
    const tiles = bakeCollision({
      ...MAP,
      elements: [{ col: 1, row: 1, assetId: STONE }],
    });
    expect(isSolidKind(kindAt(tiles, 1, 1))).toBe(true);
    // Still water, not "forest": a stone does not turn the sea into land, and the renderer must
    // keep drawing water under it.
    expect(kindAt(tiles, 1, 1)).toBe("water");
  });

  it("does not mutate the map it was handed", () => {
    const elements = [{ col: 0, row: 0, assetId: TREE } as const];
    const source: MapData = { ...MAP, elements };
    bakeCollision(source);
    expect(source.blocks).toEqual(["....", ".##.", "....", "...."]);
    expect(source.elements).toEqual(elements);
  });
});

describe("placement rules", () => {
  it("refuses a tree or a bush on water, and allows a stone there", () => {
    expect(canPlaceElement(TREE, "water")).toBe(false);
    expect(canPlaceElement(BUSH, "water")).toBe(false);
    expect(canPlaceElement(STONE, "water")).toBe(true);
  });

  it("allows all three on grass", () => {
    for (const assetId of [TREE, BUSH, STONE] as const) {
      expect(canPlaceElement(assetId, "grass")).toBe(true);
    }
  });

  it("reads the same placement metadata exposed to client and server code", () => {
    expect(editorAsset(TREE)?.editor.allowedTerrain).toEqual(["grass"]);
    expect(canPlaceElement(TREE, "grass")).toBe(true);
    expect(canPlaceElement(TREE, "water")).toBe(false);
  });
});

describe("parsing a map off the wire", () => {
  it("accepts a well-formed map", () => {
    const map = parseMapData({
      blocks: ["..", "##"],
      elements: [{ col: 0, row: 0, kind: "tree", variant: 1 }],
      spawn: { col: 0, row: 0 },
    });
    expect(map).not.toBe(null);
    expect(map?.elements[0]?.assetId).toBe(TREE_ALT);
  });

  // Every one of these would otherwise reach decodeTileMap and throw on the first paint.
  it("rejects malformed terrain instead of throwing", () => {
    const bad: unknown[] = [
      null,
      "nope",
      {},
      { blocks: [], elements: [], spawn: { col: 0, row: 0 } },
      { blocks: ["..", "###"], elements: [], spawn: { col: 0, row: 0 } },
      { blocks: ["xx"], elements: [], spawn: { col: 0, row: 0 } },
      { blocks: [".."], elements: "nope", spawn: { col: 0, row: 0 } },
      {
        blocks: [".."],
        elements: [{ col: 0, row: 0, kind: "dragon", variant: 0 }],
        spawn: { col: 0, row: 0 },
      },
      {
        blocks: [".."],
        elements: [{ col: 0, row: 0, assetId: "ui.cursor.default" }],
        spawn: { col: 0, row: 0 },
      },
      {
        blocks: [".."],
        elements: [{ col: 0, row: 0, assetId: "decoration.unknown" }],
        spawn: { col: 0, row: 0 },
      },
      {
        blocks: [".."],
        elements: [{ col: 99, row: 0, kind: "tree", variant: 0 }],
        spawn: { col: 0, row: 0 },
      },
      {
        blocks: [".."],
        elements: [{ col: -1, row: 0, kind: "tree", variant: 0 }],
        spawn: { col: 0, row: 0 },
      },
      { blocks: [".."], elements: [], spawn: { col: 99, row: 0 } },
      { blocks: [".."], elements: [], spawn: null },
    ];
    for (const value of bad) {
      expect(parseMapData(value), JSON.stringify(value)).toBe(null);
    }
  });
});

describe("terrainFromMap", () => {
  const data = {
    blocks: ["####", "#..#", "#..#", "####"],
    elements: [{ col: 1, row: 1, assetId: TREE }],
    spawn: { col: 2, row: 2 },
  };

  it("builds geometry whose tiles are the baked map", () => {
    const terrain = terrainFromMap(data);
    expect(terrain.width).toBe(4 * TILE_SIZE);
    expect(terrain.height).toBe(4 * TILE_SIZE);
    expect(terrain.tiles).toEqual(bakeCollision(data));
    expect(terrain.obstacles).toEqual([]);
    expect(terrain.safeZone).toEqual({ x: 0, y: 0, width: 4 * TILE_SIZE, height: 4 * TILE_SIZE });
    expect(terrain.spawnPoints).toEqual([mapSpawnPoint(data)]);
  });

  it("centres the spawn point on its cell", () => {
    expect(mapSpawnPoint(data)).toEqual({
      x: 2 * TILE_SIZE + TILE_SIZE / 2,
      y: 2 * TILE_SIZE + TILE_SIZE / 2,
    });
  });
});
