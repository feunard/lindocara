import { describe, expect, it } from "vitest";

import {
  authoredBridgeTop,
  compileAuthoredMap,
  compileAuthoredMapContent,
} from "../src/hd2d/authored-map.js";
import { colliderContainsPoint, createColliderIndex } from "../src/hd2d/collider-index.js";
import { EMPTY_MARKERS, type MapData } from "../src/map-data.js";
import { defaultEventPage, functionalEvent, type MapEvent } from "../src/map-events.js";
import {
  canStand,
  groundUnder,
  groundUnderBody,
  zoneTerrainFromHeightfield,
} from "../src/terrain-access.js";
import { stairsFixedIndex, stairsTilePlacements } from "../src/tile-brush.js";
import { emptyLayer } from "../src/tile-layer-codec.js";
import { autotileId, fixedId } from "../src/tileset.js";
import {
  terrainFixedIndex,
  TERRAIN_MATERIAL_SLOTS,
  TINY_SWORDS_TILESET_ID,
  waterFixedIndex,
} from "../src/tilesets/tiny-swords.js";
import {
  editorAsset,
  LINDOCARA_BUILDING_ASSET_IDS,
  LINDOCARA_STRUCTURE_ASSET_IDS,
} from "../src/tiny-swords-catalog.js";

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
  it("compiles walls as columns and ceilings as raised passable slabs", () => {
    const cols = 8;
    const ground = emptyLayer(cols, cols);
    ground.ids = ground.ids.map(() => autotileId(TERRAIN_MATERIAL_SLOTS.herbe[0], 0));
    const source: MapData = {
      ...authored(),
      cols,
      rows: cols,
      layers: [ground, emptyLayer(cols, cols), emptyLayer(cols, cols)],
      elements: [
        {
          col: 4,
          row: 4,
          offsetX: 0,
          offsetY: 0,
          assetId: LINDOCARA_STRUCTURE_ASSET_IDS.caveWall,
          rotation: 37,
          dimensions: { width: 6, depth: 1.6 },
        },
        {
          col: 4,
          row: 2,
          offsetX: 0,
          offsetY: 0,
          assetId: LINDOCARA_STRUCTURE_ASSET_IDS.caveCeiling,
          dimensions: { width: 6, depth: 6 },
        },
      ],
      spawn: { col: 0, row: 0 },
    };

    const compiled = compileAuthoredMap(source);
    const [wall, ceiling] = compiled.colliders;
    expect(wall).toMatchObject({ rotation: (37 * Math.PI) / 180, top: 5.4 });
    expect(wall?.bottom).toBeUndefined();
    expect(ceiling?.bottom).toBeCloseTo(2.7);
    expect((ceiling?.top ?? 0) - (ceiling?.bottom ?? 0)).toBeCloseTo(0.84);
    expect(compiled.elements).toEqual([
      expect.objectContaining({
        assetId: LINDOCARA_STRUCTURE_ASSET_IDS.caveWall,
        rotation: 37,
        dimensions: { width: 6, depth: 1.6 },
      }),
      expect.objectContaining({
        assetId: LINDOCARA_STRUCTURE_ASSET_IDS.caveCeiling,
        dimensions: { width: 6, depth: 6 },
      }),
    ]);
    for (const id of Object.values(LINDOCARA_STRUCTURE_ASSET_IDS)) {
      expect(editorAsset(id)?.editor).toMatchObject({
        native3d: expect.any(Object),
        architecturalVolume: expect.any(Object),
        destructibility: "indestructible",
      });
    }
    const terrain = zoneTerrainFromHeightfield(compiled);
    const wallPoint = compiled.elements[0];
    const ceilingPoint = compiled.elements[1];
    if (!wallPoint || !ceilingPoint || ceiling?.top === undefined) {
      throw new Error("compiled architecture fixture missing");
    }
    expect(canStand(terrain, wallPoint.x, wallPoint.z, 0.2, 0)).toBe(false);
    expect(canStand(terrain, ceilingPoint.x, ceilingPoint.z, 0.2, 0)).toBe(true);
    expect(canStand(terrain, ceilingPoint.x, ceilingPoint.z, 0.2, ceiling.top)).toBe(true);
  });

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
    expect(compiled.liquids).toEqual([
      null,
      null,
      "water",
      null,
      null,
      null,
      "water",
      "water",
      "water",
    ]);
    expect(compiled.liquidLevels).toEqual(Array(9).fill(null));
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

  it("preserves raised water and lava as liquid surfaces instead of ground", () => {
    const size = 3;
    const ground = emptyLayer(size, size);
    ground.ids = Array<number>(size * size).fill(autotileId(TERRAIN_MATERIAL_SLOTS.herbe[0], 0));
    ground.ids[4] = fixedId(waterFixedIndex(2));
    ground.ids[5] = fixedId(terrainFixedIndex("lave", 3));
    const compiled = compileAuthoredMap({
      ...authored(),
      cols: size,
      rows: size,
      layers: [ground, emptyLayer(size, size), emptyLayer(size, size)],
      elements: [],
      spawn: { col: 0, row: 0 },
    });

    expect(compiled.levels[4]).toBeNull();
    expect(compiled.levels[5]).toBeNull();
    expect(compiled.liquids?.[4]).toBe("water");
    expect(compiled.liquids?.[5]).toBe("lava");
    expect(compiled.liquidLevels?.[4]).toBe(2);
    expect(compiled.liquidLevels?.[5]).toBe(3);

    const terrain = zoneTerrainFromHeightfield(compiled);
    expect(terrain.query.heightAt(0, 0)).toBeNull();
    expect(terrain.query.liquidAt(0, 0)).toBe("water");
    expect(terrain.query.waterLevelAt(0, 0)).toBeCloseTo(1.8);
    expect(terrain.query.liquidAt(1, 0)).toBe("lava");
    expect(terrain.query.waterLevelAt(1, 0)).toBeCloseTo(2.7);
  });

  it("recompiles content and collision while reusing unchanged terrain arrays", () => {
    const source = authored();
    const terrain = compileAuthoredMap(source);
    const changed: MapData = {
      ...source,
      spawn: { col: 2, row: 0 },
      elements: source.elements.map((element) => ({ ...element, col: 0, row: 1 })),
    };

    const incremental = compileAuthoredMapContent(changed, terrain);
    expect(incremental).toEqual(compileAuthoredMap(changed));
    expect(incremental.levels).toBe(terrain.levels);
    expect(incremental.materials).toBe(terrain.materials);
    expect(incremental.ramps).toBe(terrain.ramps);
    expect(incremental.colliders).not.toEqual(terrain.colliders);
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

  /**
   * Quest #13 / #26's third mechanism: the collider's base and the art's base must be the SAME
   * ground.
   *
   * `elementFootPixel` puts an element's foot on its cell's far Z edge, so the foot is always at
   * least a row south of `levels[row * size + col]`. The art has always grounded at the foot
   * (`placeArt` samples `heightAt` there); the collider read the storage cell. On flat ground the
   * two agree and nothing showed. Across a step they differ by the whole level difference, which is
   * how a castle came to be DRAWN on a plateau while its colliders were built from the valley two
   * levels below, and why walking that plateau met a wall with nothing on it.
   *
   * Stated as an invariant rather than as numbers: how far a roof stands above the ground it is
   * drawn on cannot depend on where the terrain happens to step.
   */
  it("bases a building on the ground its art is drawn on, not on its storage cell", () => {
    const COLS = 16;
    const build = (levelAt: (col: number, row: number) => number): MapData => {
      const ids: number[] = [];
      for (let row = 0; row < COLS; row += 1) {
        for (let col = 0; col < COLS; col += 1) {
          const slots = TERRAIN_MATERIAL_SLOTS.herbe;
          ids.push(autotileId(slots[levelAt(col, row)] ?? slots[0], 0));
        }
      }
      return {
        ...authored(),
        cols: COLS,
        rows: COLS,
        layers: [
          { ...emptyLayer(COLS, COLS), ids },
          emptyLayer(COLS, COLS),
          emptyLayer(COLS, COLS),
        ],
        elements: [
          {
            col: 6,
            row: 8,
            offsetX: 0,
            offsetY: 0,
            assetId: LINDOCARA_BUILDING_ASSET_IDS.castle,
          },
        ],
        spawn: { col: 0, row: 0 },
      };
    };

    /** The roof's height above whatever ground the compiled ART stands on. */
    const clearance = (source: MapData): number => {
      const compiled = compileAuthoredMap(source);
      const terrain = zoneTerrainFromHeightfield(compiled);
      const element = compiled.elements[0];
      const roof = compiled.colliders[0];
      if (!element || !roof?.top) throw new Error("castle fixture missing");
      return roof.top - (terrain.query.heightAt(element.x, element.z) ?? 0);
    };

    // Storage cell is row 8 and the foot lands in row 9, so a step between them is exactly the
    // disagreement: level 0 under the anchor, level 2 under the art.
    expect(clearance(build(() => 0))).toBeCloseTo(
      clearance(build((_c, row) => (row >= 9 ? 2 : 0))),
      6,
    );
    // And it survives a step the other way, and one running east to west.
    expect(clearance(build(() => 2))).toBeCloseTo(clearance(build((col) => (col >= 7 ? 2 : 0))), 6);
  });

  it.each([
    [LINDOCARA_BUILDING_ASSET_IDS.house, 2.68, "gable", 1],
    [LINDOCARA_BUILDING_ASSET_IDS.archeryGuild, 2.6, "gable", 1],
    [LINDOCARA_BUILDING_ASSET_IDS.monastery, 2.86, "gable", 1],
    [LINDOCARA_BUILDING_ASSET_IDS.barracks, 1.81, "flat", 5],
    [LINDOCARA_BUILDING_ASSET_IDS.castle, 2.11, "flat", 57],
    [LINDOCARA_BUILDING_ASSET_IDS.stoneTower, 3.12, "flat", 13],
    [LINDOCARA_BUILDING_ASSET_IDS.windmill, 3.57, "cone", 1],
  ])("authors %s with its native %s roof at %s", (assetId, roofTop, roofShape, colliderCount) => {
    const source = authored();
    // `col: 1`, not 0, and the reason is the point of the quest above: an element's foot lands a
    // row south of its storage cell, and this fixture's cell (0,1) is `neige` at LEVEL 2. Anchoring
    // at column 0 therefore bases the building 1.8 up and every roof number below stops reading as
    // "above its own ground". Column 1's foot lands on (1,1), which is level 0.
    source.elements = [{ col: 1, row: 0, offsetX: 0, offsetY: 0, assetId, orientation: 1 }];
    const compiled = compileAuthoredMap(source);
    expect(compiled.elements[0]?.orientation).toBe(1);
    expect(compiled.colliders).toHaveLength(colliderCount);
    expect(compiled.colliders[0]?.top).toBeCloseTo(roofTop);
    expect(compiled.colliders[0]?.support).toBe("center");

    const collider = compiled.colliders[0];
    if (!collider) throw new Error("compiled building collider missing");
    const terrain = zoneTerrainFromHeightfield(compiled);
    const centreX = collider.x + collider.w / 2;
    const centreZ = collider.z + collider.h / 2;
    expect(canStand(terrain, centreX, centreZ, 0.25, 0)).toBe(false);
    expect(canStand(terrain, collider.x - 0.2, centreZ, 0.25, 0)).toBe(false);
    expect(canStand(terrain, collider.x + collider.w + 0.2, centreZ, 0.25, 0)).toBe(false);
    expect(canStand(terrain, centreX, collider.z - 0.2, 0.25, 0)).toBe(false);
    expect(canStand(terrain, centreX, collider.z + collider.h + 0.2, 0.25, 0)).toBe(false);
    expect(terrain.query.surfaceAt?.(centreX, centreZ, roofTop + 0.01)).toBeCloseTo(roofTop);
    expect(groundUnder(terrain, centreX, centreZ, 0)).toBeCloseTo(roofTop);
    expect(canStand(terrain, centreX, centreZ, 0.25, roofTop)).toBe(true);
    if (roofShape === "gable") {
      expect(compiled.colliders[0]?.surface).toMatchObject({ shape: "gable", axis: "z" });
      const eave = compiled.colliders[0]?.surface?.eave;
      expect(eave).toBeTypeOf("number");
      expect(
        terrain.query.surfaceAt?.(centreX, collider.z + 1e-4, Number.POSITIVE_INFINITY),
      ).toBeCloseTo(eave as number, 3);
    } else if (roofShape === "cone") {
      expect(compiled.colliders[0]).toMatchObject({
        footprint: "ellipse",
        surface: { shape: "cone" },
      });
      // A round mill no longer owns the empty corners of its former rectangular hitbox.
      expect(
        terrain.query.surfaceAt?.(collider.x + 1e-4, collider.z + 1e-4, Number.POSITIVE_INFINITY),
      ).toBeNull();
    }
  });

  it.each([
    [LINDOCARA_BUILDING_ASSET_IDS.barracks, 1.81, 2.09, 4],
    [LINDOCARA_BUILDING_ASSET_IDS.stoneTower, 3.12, 3.47, 12],
  ])(
    "turns %s's visible roof edge into collision while keeping its deck walkable",
    (assetId, roofTop, parapetTop, edgeCount) => {
      const source = authored();
      // See the note on the roof table above: column 0's foot lands on a level-2 cell.
      source.elements = [{ col: 1, row: 0, offsetX: 0, offsetY: 0, assetId }];
      const compiled = compileAuthoredMap(source);
      const roof = compiled.colliders[0];
      const edges = compiled.colliders.slice(1);
      if (!roof || !edges[0]) throw new Error("crenellated building collision missing");
      expect(edges).toHaveLength(edgeCount);
      expect(edges.every((edge) => Math.abs((edge.top ?? 0) - parapetTop) < 1e-6)).toBe(true);

      const terrain = zoneTerrainFromHeightfield(compiled);
      const centreX = roof.x + roof.w / 2;
      const centreZ = roof.z + roof.h / 2;
      expect(canStand(terrain, centreX, centreZ, 0.1, roofTop)).toBe(true);

      const edge = edges[0];
      const edgeX = edge.x + edge.w / 2;
      const edgeZ = edge.z + edge.h / 2;
      expect(canStand(terrain, edgeX, edgeZ, 0.08, roofTop)).toBe(false);
      expect(canStand(terrain, edgeX, edgeZ, 0.08, parapetTop)).toBe(true);
    },
  );

  it("gives a castle's central deck and four corner towers their own roof-edge collision", () => {
    const source = authored();
    source.elements = [
      {
        // Column 1 for the same reason as the roof table: a foot from column 0 lands on level 2.
        col: 1,
        row: 0,
        offsetX: 0,
        offsetY: 0,
        assetId: LINDOCARA_BUILDING_ASSET_IDS.castle,
      },
    ];
    const compiled = compileAuthoredMap(source);
    expect(compiled.colliders).toHaveLength(57);
    const mainRoof = compiled.colliders[0];
    const mainEdges = compiled.colliders.slice(1, 5);
    const towerRoofs = [5, 18, 31, 44].map((index) => compiled.colliders[index]);
    const towerEdges = [
      ...compiled.colliders.slice(6, 18),
      ...compiled.colliders.slice(19, 31),
      ...compiled.colliders.slice(32, 44),
      ...compiled.colliders.slice(45, 57),
    ];
    expect(mainRoof).toMatchObject({ top: 2.11, w: 2.32, h: 1.92 });
    expect(mainEdges.every((edge) => edge.top === 2.39)).toBe(true);
    expect(towerRoofs.every((roof) => roof?.footprint === "ellipse")).toBe(true);
    expect(towerRoofs.every((roof) => Math.abs((roof?.top ?? 0) - 2.3) < 1e-6)).toBe(true);
    expect(towerEdges).toHaveLength(48);
    expect(towerEdges.every((edge) => Math.abs((edge.top ?? 0) - 2.65) < 1e-6)).toBe(true);
  });

  it.each([
    [LINDOCARA_BUILDING_ASSET_IDS.windmill, { width: 13.75, depth: 10 }, 10.2, 10.2],
    [LINDOCARA_BUILDING_ASSET_IDS.barracks, { width: 12, depth: 9.5 }, 9.28, 7.68],
    [LINDOCARA_BUILDING_ASSET_IDS.castle, { width: 12, depth: 9.5 }, 9.28, 7.68],
  ])(
    "keeps a greatly resized %s collision on its real architecture",
    (assetId, dimensions, expectedWidth, expectedDepth) => {
      const size = 32;
      const ground = emptyLayer(size, size);
      ground.ids = Array<number>(size * size).fill(autotileId(TERRAIN_MATERIAL_SLOTS.herbe[0], 0));
      const source: MapData = {
        ...authored(),
        cols: size,
        rows: size,
        layers: [ground, emptyLayer(size, size), emptyLayer(size, size)],
        elements: [
          {
            col: 16,
            row: 20,
            offsetX: 0,
            offsetY: 0,
            assetId,
            building: { destructible: true, maxHp: 900, dimensions },
          },
        ],
      };
      const compiled = compileAuthoredMap(source);
      const mainRoof = compiled.colliders[0];
      if (!mainRoof) throw new Error("resized building roof missing");
      expect(mainRoof.w).toBeCloseTo(expectedWidth);
      expect(mainRoof.h).toBeCloseTo(expectedDepth);

      const centreX = mainRoof.x + mainRoof.w / 2;
      const centreZ = mainRoof.z + mainRoof.h / 2;
      const emptyX = centreX + dimensions.width / 2 - 0.05;
      const emptyZ = centreZ;
      expect(
        compiled.colliders.some((collider) => colliderContainsPoint(collider, emptyX, emptyZ)),
      ).toBe(false);
      const terrain = zoneTerrainFromHeightfield(compiled);
      expect(terrain.query.surfaceAt?.(emptyX, emptyZ, Number.POSITIVE_INFINITY)).toBeCloseTo(0);
      expect(canStand(terrain, emptyX, emptyZ, 0.2, 0)).toBe(true);
    },
  );

  it("rotates a tower's individual battlement collisions with its resized ellipse", () => {
    const source = authored();
    source.elements = [
      {
        col: 1,
        row: 1,
        offsetX: 0,
        offsetY: 0,
        assetId: LINDOCARA_BUILDING_ASSET_IDS.stoneTower,
        rotation: 37,
        building: {
          destructible: true,
          maxHp: 1_500,
          dimensions: { width: 3, depth: 2 },
        },
      },
    ];
    const compiled = compileAuthoredMap(source);
    const roof = compiled.colliders[0];
    const edges = compiled.colliders.slice(1);
    expect(roof?.rotation).toBeCloseTo((37 * Math.PI) / 180);
    expect(edges).toHaveLength(12);
    expect(edges[0]?.rotation).toBeCloseTo((37 * Math.PI) / 180);
    expect(edges[3]?.rotation).toBeCloseTo((-53 * Math.PI) / 180);
  });

  it("compiles a resized building's model metadata and roof from one footprint", () => {
    const size = 12;
    const ground = emptyLayer(size, size);
    ground.ids = Array<number>(size * size).fill(autotileId(TERRAIN_MATERIAL_SLOTS.herbe[0], 0));
    const source: MapData = {
      ...authored(),
      cols: size,
      rows: size,
      layers: [ground, emptyLayer(size, size), emptyLayer(size, size)],
      elements: [
        {
          col: 6,
          row: 7,
          offsetX: 0,
          offsetY: 0,
          assetId: LINDOCARA_BUILDING_ASSET_IDS.house,
          building: {
            destructible: true,
            maxHp: 900,
            dimensions: { width: 5, depth: 3.125 },
          },
        },
      ],
    };

    const compiled = compileAuthoredMap(source);
    expect(compiled.elements[0]).toMatchObject({
      assetId: LINDOCARA_BUILDING_ASSET_IDS.house,
      building: { width: 5, depth: 3.125 },
    });
    expect(compiled.colliders[0]).toMatchObject({ w: 5, h: 3.125, support: "center" });
    expect(compiled.colliders[0]?.surface).toMatchObject({ shape: "gable", axis: "x" });
  });

  it("compiles a building's free angle into its model, roof and exact oriented collision", () => {
    const size = 12;
    const ground = emptyLayer(size, size);
    ground.ids = Array<number>(size * size).fill(autotileId(TERRAIN_MATERIAL_SLOTS.herbe[0], 0));
    const source: MapData = {
      ...authored(),
      cols: size,
      rows: size,
      layers: [ground, emptyLayer(size, size), emptyLayer(size, size)],
      elements: [
        {
          col: 6,
          row: 7,
          offsetX: 0,
          offsetY: 0,
          assetId: LINDOCARA_BUILDING_ASSET_IDS.house,
          rotation: 37,
          building: { destructible: true, maxHp: 900 },
        },
      ],
    };

    const compiled = compileAuthoredMap(source);
    const roof = compiled.colliders[0];
    if (!roof) throw new Error("rotated roof collision missing");
    expect(compiled.elements[0]).toMatchObject({ rotation: 37 });
    expect(roof.rotation).toBeCloseTo((37 * Math.PI) / 180);
    expect(colliderContainsPoint(roof, roof.x + roof.w / 2, roof.z + roof.h / 2)).toBe(true);
    expect(colliderContainsPoint(roof, roof.x, roof.z)).toBe(false);
  });

  it.each([
    {
      id: "terrain.bridge.wood.horizontal" as const,
      anchor: { col: 3, row: 3 },
      water: [
        [2, 3],
        [3, 3],
        [4, 3],
      ] as const,
      rail: { x: 0, z: 0.46 },
      deck: { w: 3, h: 1 },
    },
    {
      id: "terrain.bridge.wood.vertical" as const,
      anchor: { col: 3, row: 4 },
      water: [
        [3, 2],
        [3, 3],
        [3, 4],
      ] as const,
      rail: { x: 0.46, z: 0 },
      deck: { w: 1, h: 3 },
    },
  ])("authors $id as a walkable platform with solid side rails", (fixture) => {
    const cols = 7;
    const rows = 7;
    const ground = emptyLayer(cols, rows);
    const groundIds = Array<number>(cols * rows).fill(
      autotileId(TERRAIN_MATERIAL_SLOTS.herbe[0], 0),
    );
    for (const [col, row] of fixture.water) groundIds[row * cols + col] = 0;
    ground.ids = groundIds;
    const source: MapData = {
      ...authored(),
      cols,
      rows,
      layers: [ground, emptyLayer(cols, rows), emptyLayer(cols, rows)],
      elements: [
        {
          ...fixture.anchor,
          offsetX: 0,
          offsetY: 0,
          assetId: fixture.id,
        },
      ],
      spawn: { col: 0, row: 0 },
    };

    const compiled = compileAuthoredMap(source);
    expect(compiled.levels[3 * cols + 3]).toBeNull();
    expect(compiled.colliders).toHaveLength(3);
    expect(compiled.colliders[0]).toMatchObject({ ...fixture.deck, top: 0 });
    expect(compiled.colliders[1]?.top).toBeCloseTo(0.9);
    expect(compiled.colliders[2]?.top).toBeCloseTo(0.9);

    const terrain = zoneTerrainFromHeightfield(compiled);
    expect(terrain.query.heightAt(0, 0)).toBeNull();
    expect(terrain.query.surfaceAt?.(0, 0, 0.02)).toBe(0);
    expect(groundUnder(terrain, 0, 0, -1)).toBe(0);
    expect(canStand(terrain, 0, 0, 0.25, 0)).toBe(true);
    expect(canStand(terrain, fixture.rail.x, fixture.rail.z, 0.1, 0)).toBe(false);
    expect(canStand(terrain, fixture.rail.x, fixture.rail.z, 0.05, 0.9)).toBe(true);
  });

  it("selects raised bridge banks instead of the larger level-zero area beside a cliff", () => {
    const size = 7;
    const levels = Array<number | null>(size * size).fill(0);
    levels[3 * size + 1] = 2;
    levels[3 * size + 5] = 2;
    const bridge = {
      col: 3,
      row: 3,
      offsetX: 0,
      offsetY: 0,
      assetId: "terrain.bridge.wood.horizontal" as const,
    };

    expect(authoredBridgeTop({ cols: size, rows: size }, bridge, levels, size)).toBe(1.8);
    levels[3 * size + 5] = 1;
    expect(authoredBridgeTop({ cols: size, rows: size }, bridge, levels, size)).toBe(1.8);

    // The raised support can be the deck's own end cell while the immediately-adjacent terrain is
    // already back at level 0. This is the editor placement case that used to drop the bridge.
    levels.fill(0);
    levels[3 * size + 2] = 2;
    expect(authoredBridgeTop({ cols: size, rows: size }, bridge, levels, size)).toBe(1.8);
  });

  it("compiles a resized bridge's visual centre, deck and rails from the same dimensions", () => {
    const size = 10;
    const ground = emptyLayer(size, size);
    ground.ids = Array<number>(size * size).fill(autotileId(TERRAIN_MATERIAL_SLOTS.herbe[0], 0));
    const source: MapData = {
      ...authored(),
      cols: size,
      rows: size,
      layers: [ground, emptyLayer(size, size), emptyLayer(size, size)],
      elements: [
        {
          col: 4,
          row: 5,
          offsetX: 0,
          offsetY: 0,
          assetId: "terrain.bridge.wood.horizontal",
          bridge: { length: 5, width: 2 },
        },
      ],
    };

    const compiled = compileAuthoredMap(source);
    expect(compiled.elements).toEqual([
      {
        assetId: "terrain.bridge.wood.horizontal",
        x: -0.5,
        z: 0,
        bridge: { length: 5, width: 2 },
      },
    ]);
    expect(compiled.colliders[0]).toMatchObject({ x: -3, z: -1, w: 5, h: 2, top: 0 });
    expect(compiled.colliders[1]).toMatchObject({ x: -3, z: -1, w: 5, h: 0.11 });
    expect(compiled.colliders[2]).toMatchObject({ x: -3, z: 0.89, w: 5, h: 0.11 });
    // The deck is a slab: it has an UNDERSIDE, so ground beneath a raised crossing stays walkable.
    // Its rails stand on it, so theirs is the deck's own top.
    expect(compiled.colliders[0]?.bottom).toBeCloseTo(-0.18, 6);
    expect(compiled.colliders[1]?.bottom).toBe(0);
    expect(compiled.colliders[2]?.bottom).toBe(0);
  });

  it("leaves the bank under a raised deck walkable", () => {
    const size = 10;
    const ground = emptyLayer(size, size);
    // The banks either side stand two levels up; the channel between them stays at ground level.
    ground.ids = Array.from({ length: size * size }, (_unused, index) =>
      autotileId(TERRAIN_MATERIAL_SLOTS.herbe[index % size === 2 || index % size === 6 ? 2 : 0], 0),
    );
    const compiled = compileAuthoredMap({
      ...authored(),
      cols: size,
      rows: size,
      layers: [ground, emptyLayer(size, size), emptyLayer(size, size)],
      elements: [
        {
          col: 4,
          row: 5,
          offsetX: 0,
          offsetY: 0,
          assetId: "terrain.bridge.wood.horizontal",
          bridge: { length: 5, width: 1 },
        },
      ],
    });
    const deck = compiled.colliders[0];
    if (!deck) throw new Error("the bridge compiled no deck");
    expect(deck.top).toBeGreaterThan(1);
    const index = createColliderIndex();
    for (const collider of compiled.colliders) index.add(collider);
    // A body on the channel floor: under the planking, so it walks through. Standing on the deck
    // is still fine, and a body raised into the deck is still refused.
    expect(index.blocked(-0.5, 0.5, 0.3, 0)).toBe(false);
    expect(index.blocked(-0.5, 0.5, 0.3, deck.top ?? 0)).toBe(false);
    expect(index.blocked(-0.5, 0.5, 0.3, (deck.bottom ?? 0) - 0.1)).toBe(true);

    // And the SERVER agrees, from the same bake. This is the half that matters most: a client that
    // walks under a deck the room refuses would be rubber-banded back out from under it.
    const terrain = zoneTerrainFromHeightfield(compiled);
    expect(canStand(terrain, -0.5, 0.5, 0.3, 0)).toBe(true);

    // The two ground questions, on the one point where they differ. `groundUnder` is POSITIONAL —
    // the highest surface here, whatever its height — and the landing paths want exactly that.
    // `groundUnderBody` is the one a body underfoot asks: the deck is more than a step above a
    // monster on the channel floor, so it is not that monster's ground and it does not lift it.
    expect(groundUnder(terrain, -0.5, 0.5, 0)).toBeCloseTo(deck.top ?? 0);
    expect(groundUnderBody(terrain, -0.5, 0.5, 0)).toBe(0);
    // A body that IS on the deck keeps it: its own ceiling clears the planking it stands on.
    expect(groundUnderBody(terrain, -0.5, 0.5, deck.top ?? 0)).toBeCloseTo(deck.top ?? 0);
  });

  it("keeps a freely rotated bridge's deck, rails and visual on the same angle", () => {
    const size = 10;
    const ground = emptyLayer(size, size);
    ground.ids = Array<number>(size * size).fill(autotileId(TERRAIN_MATERIAL_SLOTS.herbe[0], 0));
    const source: MapData = {
      ...authored(),
      cols: size,
      rows: size,
      layers: [ground, emptyLayer(size, size), emptyLayer(size, size)],
      elements: [
        {
          col: 4,
          row: 5,
          offsetX: 0,
          offsetY: 0,
          assetId: "terrain.bridge.wood.horizontal",
          rotation: 37,
          bridge: { length: 5, width: 2 },
        },
      ],
    };

    const compiled = compileAuthoredMap(source);
    expect(compiled.elements[0]).toMatchObject({ rotation: 37, bridge: { length: 5, width: 2 } });
    expect(compiled.colliders).toHaveLength(3);
    for (const collider of compiled.colliders) {
      expect(collider.rotation).toBeCloseTo((37 * Math.PI) / 180);
    }
  });
});
