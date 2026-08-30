import { isWalkable } from "@lindocara/engine/game.js";
import {
  bakeCollision,
  canPlaceElement,
  EMPTY_MARKERS,
  elementCells,
  elementFitsMap,
  elementPlacementCells,
  elementWorldCollider,
  MARKER_LABEL_MAX,
  type MapData,
  mapSpawnPoint,
  parseMapData,
  parseMapElements,
  parseMapMarkers,
  terrainFromMap,
} from "@lindocara/engine/map-data.js";
import { layersFromBlocks } from "@lindocara/engine/map-migrate.js";
import { emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { isSolidKind, kindAt, TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { editorAsset, LINDOCARA_RUNNER_ASSET_IDS } from "@lindocara/engine/tiny-swords-catalog.js";
import { mapDataFromBlocks } from "@lindocara/testing/map-fixtures.js";
import { describe, expect, it } from "vitest";

/** Stand-in when a `layersFromBlocks` index read has to be narrowed. */
const EMPTY_2X2 = emptyLayer(2, 2);

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

  it("no longer bakes a tree into the grid — its trunk is a collider", () => {
    // The intended behaviour change: an element's solidity left the tile grid. A tree used to turn
    // its whole 64x64 cell to "forest", so you bumped into a canopy you could see straight through.
    // The cell now stays grass and the trunk rectangle blocks instead; a bush still blocks nothing.
    const tree = { col: 0, row: 0, offsetX: 0, offsetY: 0, assetId: TREE } as const;
    const bush = { col: 3, row: 0, offsetX: 0, offsetY: 0, assetId: BUSH } as const;
    const map: MapData = { ...MAP, elements: [tree, bush] };
    const tiles = bakeCollision(map);
    expect(isSolidKind(kindAt(tiles, 0, 0))).toBe(false);
    expect(isSolidKind(kindAt(tiles, 3, 0))).toBe(false);

    const terrain = terrainFromMap(map);
    const trunk = elementWorldCollider(tree);
    expect(trunk).not.toBeNull();
    if (!trunk) return;
    expect(isWalkable({ x: trunk.x, y: trunk.y }, 8, terrain)).toBe(false);
    // Beside the trunk, inside the same cell, is open ground now.
    expect(isWalkable({ x: 0, y: 0 }, 8, terrain)).toBe(true);
    expect(elementWorldCollider(bush)).toBeNull();
  });

  it("leaves a stone on water solid — it was already water", () => {
    const tiles = bakeCollision({
      ...MAP,
      elements: [{ col: 1, row: 1, offsetX: 0, offsetY: 0, assetId: STONE }],
    });
    expect(isSolidKind(kindAt(tiles, 1, 1))).toBe(true);
    // Still water, not "forest": a stone does not turn the sea into land, and the renderer must
    // keep drawing water under it.
    expect(kindAt(tiles, 1, 1)).toBe("water");
  });

  it("does not mutate the map it was handed", () => {
    const elements = [{ col: 0, row: 0, offsetX: 0, offsetY: 0, assetId: TREE } as const];
    const source: MapData = { ...MAP, elements };
    bakeCollision(source);
    expect(source.layers).toEqual(MAP.layers);
    expect(source.elements).toEqual(elements);
  });

  it("round-trips ordinary scenery scale into a collider centred on the same foot", () => {
    const original = { col: 2, row: 2, offsetX: 0, offsetY: 0, assetId: TREE } as const;
    const parsed = parseMapElements([{ ...original, scale: 2 }], 10, 10)?.[0];
    expect(parsed?.scale).toBe(2);
    if (!parsed) return;
    const baseline = elementWorldCollider(original);
    const scaled = elementWorldCollider(parsed);
    expect(baseline).not.toBeNull();
    expect(scaled).not.toBeNull();
    if (!baseline || !scaled) return;
    const footX = (original.col + 0.5) * TILE_SIZE;
    const footY = (original.row + 1) * TILE_SIZE;
    expect(scaled.width).toBeCloseTo(baseline.width * 2);
    expect(scaled.height).toBeCloseTo(baseline.height * 2);
    expect(scaled.x - footX).toBeCloseTo((baseline.x - footX) * 2);
    expect(scaled.y - footY).toBeCloseTo((baseline.y - footY) * 2);
    expect(parseMapElements([{ ...original, scale: 0.1 }], 10, 10)).toBeNull();
  });
});

describe("placement rules", () => {
  it("allows every known scenery asset on grass and water", () => {
    for (const assetId of [TREE, BUSH, STONE] as const) {
      expect(canPlaceElement(assetId, "grass")).toBe(true);
      expect(canPlaceElement(assetId, "water")).toBe(true);
    }
  });

  it("keeps catalogue terrain metadata advisory instead of using it as an authoring gate", () => {
    expect(editorAsset(TREE)?.editor.allowedTerrain).toEqual(["grass"]);
    expect(canPlaceElement(TREE, "grass")).toBe(true);
    expect(canPlaceElement(TREE, "water")).toBe(true);
  });

  it("keeps base geometry precise while allowing an offset tree across a shoreline", () => {
    // Base geometry remains useful for diagnostics/collision even though it no longer decides which
    // terrain an author may decorate.
    const shore: MapData = mapDataFromBlocks({
      blocks: [".#..", ".#..", ".#..", ".#.."],
      elements: [],
      spawn: { col: 3, row: 3 },
    });
    const ground = bakeCollision({ ...shore, elements: [] });
    expect(kindAt(ground, 0, 0)).toBe("grass");
    expect(kindAt(ground, 1, 0)).toBe("water");

    const overhang = { col: 0, row: 0, offsetX: 0, offsetY: 0, assetId: TREE } as const;
    expect(
      elementPlacementCells(overhang).every((cell) =>
        canPlaceElement(TREE, kindAt(ground, cell.col, cell.row)),
      ),
    ).toBe(true);

    // Offset a full cell toward the water: the trunk cell is correctly reported in water and the
    // scenery is still legal there.
    const inWater = { col: 0, row: 0, offsetX: 3, offsetY: 0, assetId: TREE } as const;
    const trunkCells = elementPlacementCells(inWater);
    expect(trunkCells).toContainEqual({ col: 1, row: 0 });
    expect(
      trunkCells.every((cell) => canPlaceElement(TREE, kindAt(ground, cell.col, cell.row))),
    ).toBe(true);
  });

  it("keeps a collider-less decoration on its anchor cell for placement (D19)", () => {
    // A bush has no trunk, so nothing overhangs and nothing sinks — its anchor cell is the whole rule.
    const bush = { col: 2, row: 2, offsetX: 3, offsetY: 3, assetId: BUSH } as const;
    expect(elementPlacementCells(bush)).toEqual([{ col: 2, row: 2 }]);
  });
});

describe("parsing a map off the wire", () => {
  // A 2x2 map, layered exactly as an HTTP body carries it: three run-length strings, ground first.
  const GROUND = encodeTileLayer(layersFromBlocks(["..", "##"]).layers[0] ?? EMPTY_2X2);
  const BLANK = encodeTileLayer(EMPTY_2X2);

  function wire(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: 2,
      rows: 2,
      layers: [GROUND, BLANK, BLANK],
      elements: [],
      spawn: { col: 0, row: 0 },
      ...overrides,
    };
  }

  it("accepts a well-formed map", () => {
    const map = parseMapData(wire({ elements: [{ col: 0, row: 0, kind: "tree", variant: 1 }] }));
    expect(map).not.toBe(null);
    expect(map?.elements[0]?.assetId).toBe(TREE_ALT);
    expect(map?.layers).toHaveLength(3);
    expect(map?.layers[0]?.ids).toEqual(layersFromBlocks(["..", "##"]).layers[0]?.ids);
  });

  it("accepts validated interior envelopes and rejects them on exterior maps", () => {
    expect(
      parseMapData(
        wire({
          environment: "interior",
          interiorShell: {
            style: "volcano",
            openOuterWalls: false,
            openInnerWalls: true,
            openings: [{ side: "south", col: 0, row: 1, length: 2 }],
            innerWalls: [{ col: 0, row: 0, length: 2 }],
          },
        }),
      )?.interiorShell,
    ).toEqual({
      style: "volcano",
      openOuterWalls: false,
      openInnerWalls: true,
      openings: [{ side: "south", col: 0, row: 1, length: 2 }],
      innerWalls: [{ col: 0, row: 0, length: 2 }],
    });
    expect(parseMapData(wire({ interiorShell: { style: "castle" } }))).toBeNull();
    expect(
      parseMapData(wire({ environment: "interior", interiorShell: { style: "sand" } })),
    ).toBeNull();
    expect(
      parseMapData(
        wire({ environment: "interior", interiorShell: { style: "castle", openOuterWalls: 1 } }),
      ),
    ).toBeNull();
    expect(
      parseMapData(
        wire({
          environment: "interior",
          interiorShell: { style: "castle", innerWalls: [{ col: 1, row: 0, length: 2 }] },
        }),
      ),
    ).toBeNull();
    expect(
      parseMapData(
        wire({
          environment: "interior",
          interiorShell: {
            style: "castle",
            openings: [{ side: "south", col: 1, row: 1, length: 2 }],
          },
        }),
      ),
    ).toBeNull();
  });

  it("parses explicit bridge dimensions and derives their resized footprint and collider", () => {
    const bridge = {
      col: 3,
      row: 3,
      offsetX: 0,
      offsetY: 0,
      assetId: "terrain.bridge.wood.horizontal" as const,
      bridge: { length: 5, width: 2 },
    };
    expect(elementCells(bridge)).toHaveLength(10);
    expect(elementWorldCollider(bridge)).toEqual({ x: 64, y: 128, width: 320, height: 128 });
    expect(elementFitsMap(bridge, 8, 8)).toBe(true);
    expect(elementFitsMap({ ...bridge, col: 1 }, 8, 8)).toBe(false);
    const { bridge: _dimensions, ...legacyBridge } = bridge;
    expect(elementFitsMap({ ...legacyBridge, col: 1 }, 8, 8)).toBe(true);

    const parsed = parseMapData(
      wire({
        cols: 8,
        rows: 8,
        layers: [
          encodeTileLayer(emptyLayer(8, 8)),
          encodeTileLayer(emptyLayer(8, 8)),
          encodeTileLayer(emptyLayer(8, 8)),
        ],
        elements: [bridge],
      }),
    );
    expect(parsed?.elements[0]?.bridge).toEqual({ length: 5, width: 2 });
    expect(
      parseMapData(
        wire({
          elements: [
            { col: 0, row: 0, offsetX: 0, offsetY: 0, assetId: BUSH, bridge: bridge.bridge },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("parses, rotates and resizes catalogue-native 3D scenery", () => {
    const barricade = {
      col: 4,
      row: 4,
      offsetX: 0,
      offsetY: 0,
      assetId: LINDOCARA_RUNNER_ASSET_IDS.barricade,
      rotation: 90,
      dimensions: { width: 4, depth: 1.5 },
    } as const;
    expect(elementWorldCollider(barricade)).toMatchObject({ width: 96, height: 256 });
    const { dimensions: _dimensions, rotation: _rotation, ...legacyBarricade } = barricade;
    expect(elementWorldCollider(legacyBarricade)).toMatchObject({ width: 116, height: 48 });
    expect(elementFitsMap(barricade, 10, 10)).toBe(true);
    const parsed = parseMapData(
      wire({
        cols: 10,
        rows: 10,
        layers: [
          encodeTileLayer(emptyLayer(10, 10)),
          encodeTileLayer(emptyLayer(10, 10)),
          encodeTileLayer(emptyLayer(10, 10)),
        ],
        elements: [barricade],
      }),
    );
    expect(parsed?.elements[0]).toMatchObject({
      rotation: 90,
      dimensions: { width: 4, depth: 1.5 },
    });
    expect(
      parseMapData(
        wire({
          elements: [{ ...barricade, col: 0, row: 0, dimensions: { width: 1.1, depth: 2 } }],
        }),
      ),
    ).toBeNull();
  });

  /**
   * Every one of these would otherwise reach the renderer and throw on the first paint. Each case
   * is a *well-formed* map with exactly one thing wrong, so it can only fail for the reason it
   * names — an earlier rewrite fed `blocks` bodies here, which all died on the missing tilesetId
   * before reaching their own subject and asserted nothing.
   */
  it("rejects malformed terrain instead of throwing", () => {
    const bad: [string, unknown][] = [
      ["not an object", null],
      ["a string", "nope"],
      ["an empty object", {}],
      ["an unknown tileset", wire({ tilesetId: "not-a-tileset" })],
      ["a non-string tileset", wire({ tilesetId: 7 })],
      ["a zero-sized map", wire({ cols: 0 })],
      ["a non-integer size", wire({ rows: 1.5 })],
      ["two layers instead of three", wire({ layers: [GROUND, BLANK] })],
      ["four layers instead of three", wire({ layers: [GROUND, BLANK, BLANK, BLANK] })],
      ["a layer that is not a string", wire({ layers: [GROUND, BLANK, { ids: [] }] })],
      [
        "a layer shorter than the map",
        wire({ layers: [encodeTileLayer(emptyLayer(2, 1)), BLANK, BLANK] }),
      ],
      ["a layer whose size disagrees with cols/rows", wire({ cols: 3 })],
      [
        "a layer id past what the tileset declares",
        wire({
          layers: [encodeTileLayer({ cols: 2, rows: 2, ids: [9999, 0, 0, 0] }), BLANK, BLANK],
        }),
      ],
      ["elements that are not an array", wire({ elements: "nope" })],
      [
        "an unknown element kind",
        wire({ elements: [{ col: 0, row: 0, kind: "dragon", variant: 0 }] }),
      ],
      [
        "a non-editor asset id",
        wire({ elements: [{ col: 0, row: 0, assetId: "ui.cursor.default" }] }),
      ],
      [
        "an unknown asset id",
        wire({ elements: [{ col: 0, row: 0, assetId: "decoration.unknown" }] }),
      ],
      [
        "an element past the right edge",
        wire({ elements: [{ col: 99, row: 0, kind: "tree", variant: 0 }] }),
      ],
      [
        "an element at a negative column",
        wire({ elements: [{ col: -1, row: 0, kind: "tree", variant: 0 }] }),
      ],
      ["a spawn off the map", wire({ spawn: { col: 99, row: 0 } })],
      ["a null spawn", wire({ spawn: null })],
      ["malformed markers", wire({ markers: { entries: "no" } })],
    ];
    for (const [why, value] of bad) {
      expect(parseMapData(value), why).toBe(null);
    }
  });
});

describe("terrainFromMap", () => {
  const data = mapDataFromBlocks({
    blocks: ["####", "#..#", "#..#", "####"],
    elements: [{ col: 1, row: 1, offsetX: 0, offsetY: 0, assetId: TREE }],
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
        monsterSpawns: [{ col: 0, row: 0, species: "mire_troll", patrolRadius: -1 }],
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
    const open = layersFromBlocks(["....", "....", "....", "...."]);
    const base = {
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: open.cols,
      rows: open.rows,
      layers: open.layers.map(encodeTileLayer),
      elements: [],
      spawn: { col: 0, row: 0 },
    };
    expect(parseMapData(base)?.markers).toEqual(EMPTY_MARKERS);
    expect(parseMapData({ ...base, markers: GOOD })?.markers).toEqual(GOOD);
    expect(parseMapData({ ...base, markers: { entries: "no" } })).toBeNull();
  });
});
