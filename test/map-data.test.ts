import { describe, expect, it } from "vitest";
import { blocksFromMapData, mapDataFromBlocks } from "../src/shared/legacy-blocks.js";
import {
  bakeCollision,
  canPlaceElement,
  EMPTY_MARKERS,
  MARKER_LABEL_MAX,
  type MapData,
  mapSpawnPoint,
  parseMapData,
  parseMapMarkers,
  terrainFromMap,
} from "../src/shared/map-data.js";
import { isSolidKind, kindAt, TILE_SIZE } from "../src/shared/tilemap.js";
import { editorAsset } from "../src/shared/tiny-swords-catalog.js";

const TREE = "resource.terrain-resources-wood-trees.tree3" as const;
const TREE_ALT = "resource.terrain-resources-wood-trees.tree4" as const;
const BUSH = "decoration.terrain-decorations-bushes.bushe1" as const;
const STONE = "decoration.terrain-decorations-rocks.rock1" as const;

const MAP: MapData = mapDataFromBlocks({
  blocks: ["....", ".##.", "....", "...."],
  elements: [],
  spawn: { col: 0, row: 0 },
});

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
    expect(blocksFromMapData(source)).toEqual(["....", ".##.", "....", "...."]);
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
  const data = mapDataFromBlocks({
    blocks: ["####", "#..#", "#..#", "####"],
    elements: [{ col: 1, row: 1, assetId: TREE }],
    spawn: { col: 2, row: 2 },
  });

  it("builds geometry whose tiles are the baked map", () => {
    const terrain = terrainFromMap(data);
    expect(terrain.width).toBe(4 * TILE_SIZE);
    expect(terrain.height).toBe(4 * TILE_SIZE);
    expect(terrain.tiles).toEqual(bakeCollision(data));
    expect(terrain.obstacles).toEqual([]);
    // This used to pin the whole map as a safe zone, which is what made every placed monster
    // harmless on every authored map: `monster-system` reads that rect as "monsters may not touch
    // a player here". An authored map has no way to declare such a place, so it has none.
    expect(terrain.safeZone).toBeNull();
    expect(terrain.spawnPoints).toEqual([mapSpawnPoint(data)]);
  });

  it("centres the spawn point on its cell", () => {
    expect(mapSpawnPoint(data)).toEqual({
      x: 2 * TILE_SIZE + TILE_SIZE / 2,
      y: 2 * TILE_SIZE + TILE_SIZE / 2,
    });
  });
});

describe("map markers", () => {
  const GOOD = {
    entries: [{ id: "front-door", col: 1, row: 1 }],
    exits: [{ id: "cave", col: 2, row: 2 }],
    monsterSpawns: [{ col: 3, row: 1, species: "spear_goblin", patrolRadius: 96 }],
  };

  it("parses a well-formed marker collection", () => {
    expect(parseMapMarkers(GOOD, 4, 4)).toEqual(GOOD);
  });

  it("normalizes optional marker labels without changing stable ids", () => {
    expect(
      parseMapMarkers(
        {
          entries: [{ id: "front-door", label: "  Front door  ", col: 1, row: 1 }],
          exits: [{ id: "cave", label: "", col: 2, row: 2 }],
          monsterSpawns: [],
        },
        4,
        4,
      ),
    ).toEqual({
      entries: [{ id: "front-door", label: "Front door", col: 1, row: 1 }],
      exits: [{ id: "cave", col: 2, row: 2 }],
      monsterSpawns: [],
    });
  });

  it("rejects non-string or overlong marker labels", () => {
    for (const label of [42, "x".repeat(MARKER_LABEL_MAX + 1)]) {
      expect(
        parseMapMarkers(
          {
            entries: [{ id: "front-door", label, col: 1, row: 1 }],
            exits: [],
            monsterSpawns: [],
          },
          4,
          4,
        ),
      ).toBeNull();
    }
  });

  it("defaults an absent collection to empty", () => {
    expect(parseMapMarkers(undefined, 4, 4)).toEqual(EMPTY_MARKERS);
  });

  it("rejects malformed markers instead of throwing", () => {
    const bad: unknown[] = [
      null,
      "markers",
      {
        entries: [{ id: "x", col: 9, row: 0 }],
        exits: [],
        monsterSpawns: [],
      }, // out of bounds
      {
        entries: [{ id: "UPPER", col: 0, row: 0 }],
        exits: [],
        monsterSpawns: [],
      }, // id pattern
      {
        entries: [
          { id: "a", col: 0, row: 0 },
          { id: "a", col: 1, row: 1 },
        ],
        exits: [],
        monsterSpawns: [],
      }, // dup id
      {
        entries: [],
        exits: [],
        monsterSpawns: [{ col: 0, row: 0, species: "dragon", patrolRadius: 96 }],
      },
      {
        entries: [],
        exits: [],
        monsterSpawns: [{ col: 0, row: 0, species: "mire_troll", patrolRadius: 8 }],
      },
      {
        entries: [],
        exits: [],
        monsterSpawns: [{ col: 0, row: 0, species: "mire_troll", patrolRadius: 4096 }],
      },
      {
        entries: Array.from({ length: 9 }, (_, i) => ({
          id: `e${i}`,
          col: 0,
          row: 0,
        })),
        exits: [],
        monsterSpawns: [],
      },
    ];
    for (const value of bad) expect(parseMapMarkers(value, 4, 4)).toBeNull();
  });

  it("rides through parseMapData and defaults when absent", () => {
    const base = {
      blocks: ["....", "....", "....", "...."],
      elements: [],
      spawn: { col: 0, row: 0 },
    };
    expect(parseMapData(base)?.markers).toEqual(EMPTY_MARKERS);
    expect(parseMapData({ ...base, markers: GOOD })?.markers).toEqual(GOOD);
    expect(parseMapData({ ...base, markers: { entries: "no" } })).toBeNull();
  });
});
