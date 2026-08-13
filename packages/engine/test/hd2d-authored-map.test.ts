import { describe, expect, it } from "vitest";
import { AUTHORED_LEVEL_HEIGHT, compileAuthoredMap } from "../src/hd2d/authored-map.js";
import { EMPTY_MARKERS, type MapData } from "../src/map-data.js";
import { defaultEventPage, functionalEvent, type MapEvent } from "../src/map-events.js";
import { stairsFixedIndex, stairsTilePlacements } from "../src/tile-brush.js";
import { emptyLayer } from "../src/tile-layer-codec.js";
import { autotileId, fixedId } from "../src/tileset.js";
import { TERRAIN_MATERIAL_SLOTS, TINY_SWORDS_TILESET_ID } from "../src/tilesets/tiny-swords.js";
import { EDITOR_ASSETS } from "../src/tiny-swords-catalog.js";

function authored(): MapData {
  const ground = emptyLayer(3, 2);
  ground.ids = [
    autotileId(TERRAIN_MATERIAL_SLOTS.herbe[0], 0),
    autotileId(TERRAIN_MATERIAL_SLOTS.sable[1], 0),
    0,
    autotileId(TERRAIN_MATERIAL_SLOTS.neige[2], 0),
    autotileId(TERRAIN_MATERIAL_SLOTS.glace[0], 0),
    // The RETIRED thin-ice brush's first slot, written as a literal because the material it
    // belonged to no longer exists. Kept in this fixture on purpose: maps painted with that brush
    // are still out there, and they must compile to ordinary ice rather than fall down
    // `materialOfSlot`'s grass fallback — which would silently turn an authored frozen lake into a
    // walkable lawn. See `RETIRED_THIN_ICE_SLOTS` (`tilesets/tiny-swords.ts`).
    autotileId(16, 0),
  ];
  return {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: 3,
    rows: 2,
    layers: [ground, emptyLayer(3, 2), emptyLayer(3, 2)],
    elements: [
      {
        col: 1,
        row: 1,
        offsetX: 1,
        offsetY: 2,
        assetId: "building.buildings-black-buildings.house1",
      },
    ],
    spawn: { col: 0, row: 0 },
    markers: EMPTY_MARKERS,
  };
}

describe("compileAuthoredMap", () => {
  it("compiles rectangular terrain, content and event positions into one square heightfield", () => {
    const page = {
      ...defaultEventPage(),
      graphicAssetId: "resource.terrain-resources-wood-trees.tree3" as const,
    };
    const event: MapEvent = {
      ...functionalEvent({
        id: "11111111-1111-4111-8111-111111111111",
        col: 2,
        row: 1,
        ordinal: 0,
        kind: "npc",
      }),
      pages: [page],
    };

    const compiled = compileAuthoredMap(authored(), [event]);

    expect(compiled.size).toBe(3);
    expect(compiled.levels).toEqual([0, 1, null, 2, 0, 0, null, null, null]);
    expect(compiled.materials).toEqual([
      "herbe",
      "sable",
      "herbe",
      "neige",
      "glace",
      // The retired thin-ice slot, read as ordinary ice — not as grass.
      "glace",
      "herbe",
      "herbe",
      "herbe",
    ]);
    expect(compiled.spawns).toEqual([{ name: "default", x: -1, z: -1 }]);
    expect(compiled.elements).toEqual([
      {
        assetId: "building.buildings-black-buildings.house1",
        x: 0.25,
        z: 1,
      },
    ]);
    expect(compiled.colliders).not.toHaveLength(0);
    expect(compiled.events).toEqual([
      {
        id: event.id,
        x: 1,
        z: 0,
        graphicAssetId: "resource.terrain-resources-wood-trees.tree3",
      },
    ]);
  });

  it("leaves native resources out of static content and collision", () => {
    const source = authored();
    source.elements = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        col: 1,
        row: 1,
        offsetX: 0,
        offsetY: 0,
        assetId: "resource.terrain-resources-wood-trees.tree3",
      },
    ];
    const compiled = compileAuthoredMap(source);
    expect(compiled.elements).toEqual([]);
    expect(compiled.colliders).toEqual([]);
  });

  it("compiles a complete two-half stair stamp into one world-space ramp", () => {
    const cols = 4;
    const rows = 3;
    const groundBase = emptyLayer(cols, rows);
    const wallsBase = emptyLayer(cols, rows);
    const ground = { ...groundBase, ids: [...groundBase.ids] };
    const walls = { ...wallsBase, ids: [...wallsBase.ids] };
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const level = col >= 2 ? 1 : 0;
        ground.ids[row * cols + col] = autotileId(TERRAIN_MATERIAL_SLOTS.herbe[level], 0);
      }
    }
    const anchor = { col: 1, row: 2 };
    for (const part of stairsTilePlacements("east", 0)) {
      walls.ids[(anchor.row + part.row) * cols + anchor.col + part.col] = fixedId(part.fixedIndex);
    }
    const source: MapData = {
      ...authored(),
      cols,
      rows,
      layers: [ground, walls, emptyLayer(cols, rows)],
      elements: [],
      spawn: { col: 0, row: 0 },
    };
    expect(stairsFixedIndex("east", 0, "low")).toBe(2);
    expect(compileAuthoredMap(source).ramps).toEqual([
      { x: -1, z: -1, width: 1, depth: 2, direction: "east", lowLevel: 0 },
    ]);
  });

  it("authors a one-level walkable top on building colliders only", () => {
    const building = EDITOR_ASSETS.find((asset) => asset.editor.category === "buildings");
    if (!building) throw new Error("building fixture missing");
    const source = authored();
    source.elements = [{ col: 0, row: 0, offsetX: 0, offsetY: 0, assetId: building.id }];
    const compiled = compileAuthoredMap(source);
    expect(compiled.colliders).toHaveLength(1);
    expect(compiled.colliders[0]?.top).toBe(AUTHORED_LEVEL_HEIGHT);
  });
});
