import { bakeCollision } from "@lindocara/engine/map-data.js";
import { paintElevation, paintStairs, type StairsDirection } from "@lindocara/engine/tile-brush.js";
import { emptyLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { kindAt } from "@lindocara/engine/tilemap.js";
import { decodeTileId } from "@lindocara/engine/tileset.js";
import {
  CLIFF_WALL_SLOT,
  GRASS_SLOTS,
  RAMP_FIXED_TILE_COUNT,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

const set = TINY_SWORDS_TILESET;
const COLS = 8;
const ROWS = 8;
const blank = (): TileLayer[] => [
  emptyLayer(COLS, ROWS),
  emptyLayer(COLS, ROWS),
  emptyLayer(COLS, ROWS),
];

function layerAt(layers: readonly TileLayer[], index: number): TileLayer {
  const layer = layers[index];
  if (!layer) throw new Error(`missing layer ${index}`);
  return layer;
}

function idAt(layer: { cols: number; ids: readonly number[] }, col: number, row: number): number {
  return layer.ids[row * layer.cols + col] ?? 0;
}

/**
 * A flat level-0 grass field with a level-1 plateau across rows 0..2 (cols 1..6), which casts one
 * cliff-wall row at row 3 — the row directly below the raised ground. The lower ground sits at rows
 * 3..5, so a gateway stamped over the wall row joins the plateau (up) to the lower ground (down).
 */
function fieldWithPlateau(): TileLayer[] {
  let layers = blank();
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      layers = paintElevation(layers, set, 0, col, row);
    }
  }
  for (const row of [0, 1, 2]) {
    for (const col of [1, 2, 3, 4, 5, 6]) {
      layers = paintElevation(layers, set, 1, col, row);
    }
  }
  return layers;
}

function fieldForDirection(direction: StairsDirection): TileLayer[] {
  let layers = blank();
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      layers = paintElevation(layers, set, 0, col, row);
    }
  }
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const high =
        direction === "north"
          ? row <= 2
          : direction === "south"
            ? row >= 3
            : direction === "east"
              ? col >= 4
              : col <= 3;
      if (high) layers = paintElevation(layers, set, 1, col, row);
    }
  }
  return layers;
}

describe("the stairs gateway stamp", () => {
  it("stamps the two banks three columns apart and clears the wall over the path between them", () => {
    const layers = fieldWithPlateau();
    // Before the stamp, row 3 carries one continuous cliff-wall run across cols 1..6.
    expect(decodeTileId(idAt(layerAt(layers, 1), 3, 3)).kind).toBe("autotile");
    expect(decodeTileId(idAt(layerAt(layers, 1), 4, 3)).kind).toBe("autotile");

    // Anchor at (2,2): the gateway spans cols 2..5, rows 2..3. Left bank at col 2, right bank at col
    // 5 (three columns apart, exactly the ramp tiles' atlas spacing), path in cols 3-4.
    const stamped = paintStairs(layers, set, 2, 2);
    const walls = layerAt(stamped, 1);
    const ground = layerAt(stamped, 0);

    // Left bank (fixed 0/1) at col 2, right bank (fixed 2/3) at col 5.
    expect(decodeTileId(idAt(walls, 2, 2))).toEqual({ kind: "fixed", index: 0 });
    expect(decodeTileId(idAt(walls, 2, 3))).toEqual({ kind: "fixed", index: 1 });
    expect(decodeTileId(idAt(walls, 5, 2))).toEqual({ kind: "fixed", index: 2 });
    expect(decodeTileId(idAt(walls, 5, 3))).toEqual({ kind: "fixed", index: 3 });

    // The two middle columns are the walkable path: the cliff wall is cleared on layer 1 across both
    // rows, so nothing solid stands in the opening.
    for (const col of [3, 4]) {
      for (const row of [2, 3]) {
        expect(decodeTileId(idAt(walls, col, row)).kind).toBe("empty");
      }
    }

    // ...and layer 0 under the path carries lower-level grass (slot 0, the level the ramp descends
    // to) across both rows — the notch is walkable ground, not a void.
    for (const col of [3, 4]) {
      const high = decodeTileId(idAt(ground, col, 2));
      expect(high.kind).toBe("autotile");
      if (high.kind === "autotile") expect(high.slot).toBe(GRASS_SLOTS[1]);
      const low = decodeTileId(idAt(ground, col, 3));
      expect(low.kind).toBe("autotile");
      if (low.kind === "autotile") expect(low.slot).toBe(GRASS_SLOTS[0]);
    }

    // The wall cells flanking the gateway, never touched by it, remain cliff wall.
    for (const col of [1, 6]) {
      const ref = decodeTileId(idAt(walls, col, 3));
      expect(ref.kind).toBe("autotile");
      if (ref.kind === "autotile") expect(ref.slot).toBe(CLIFF_WALL_SLOT);
    }
  });

  it("refuses a stamp whose 4-wide footprint would fall off the right edge, same reference back", () => {
    const layers = blank();
    // Max legal anchor col on an 8-wide map is COLS - 4 = 4; col 5 pushes the right bank (col + 3 =
    // 8) off the edge.
    const result = paintStairs(layers, set, 5, 2);
    expect(result).toBe(layers);
    expect(layerAt(result, 1).ids.every((id) => id === 0)).toBe(true);
    expect(layerAt(result, 0).ids.every((id) => id === 0)).toBe(true);
  });

  it("rotates the complete footprint and bank ids towards every high side", () => {
    const cases = [
      { direction: "north" as const, cols: 4, rows: 2, firstIndex: 0 },
      { direction: "east" as const, cols: 2, rows: 4, firstIndex: 4 },
      { direction: "south" as const, cols: 4, rows: 2, firstIndex: 8 },
      { direction: "west" as const, cols: 2, rows: 4, firstIndex: 12 },
    ];
    for (const testCase of cases) {
      const stamped = paintStairs(blank(), set, 2, 1, testCase.direction, 0);
      const walls = layerAt(stamped, 1);
      const fixed = walls.ids
        .map((id, index) => ({ ref: decodeTileId(id), index }))
        .filter((entry) => entry.ref.kind === "fixed" && entry.ref.index < RAMP_FIXED_TILE_COUNT);
      expect(fixed).toHaveLength(4);
      expect(
        fixed
          .map((entry) => entry.ref)
          .filter((ref) => ref.kind === "fixed")
          .map((ref) => ref.index)
          .sort((left, right) => left - right),
      ).toEqual([
        testCase.firstIndex,
        testCase.firstIndex + 1,
        testCase.firstIndex + 2,
        testCase.firstIndex + 3,
      ]);
      const occupiedCols = new Set(fixed.map((entry) => entry.index % COLS));
      const occupiedRows = new Set(fixed.map((entry) => Math.floor(entry.index / COLS)));
      expect(Math.max(...occupiedCols) - Math.min(...occupiedCols) + 1).toBe(testCase.cols);
      expect(Math.max(...occupiedRows) - Math.min(...occupiedRows) + 1).toBe(testCase.rows);
    }
  });

  it("authors a level 1 to level 2 transition without flattening either side to ground", () => {
    const stamped = paintStairs(blank(), set, 2, 2, "north", 1);
    const ground = layerAt(stamped, 0);
    for (const col of [2, 3, 4, 5]) {
      const high = decodeTileId(idAt(ground, col, 2));
      const low = decodeTileId(idAt(ground, col, 3));
      expect(high.kind === "autotile" ? high.slot : -1).toBe(GRASS_SLOTS[2]);
      expect(low.kind === "autotile" ? low.slot : -1).toBe(GRASS_SLOTS[1]);
    }
  });

  it("leaves all four bank tiles intact when elevation is painted beside them", () => {
    const stamped = paintStairs(blank(), set, 2, 2);

    // Raising the ground directly above the left bank's top cell makes `syncElevationWalls` want to
    // drop a wall onto (2,2) — the row below what was just raised — but (2,2) is a fixed ramp tile,
    // and since Task 2 `syncWall` refuses to touch a fixed tile at all.
    const afterElevation = paintElevation(stamped, set, 1, 2, 1);
    const walls = layerAt(afterElevation, 1);

    expect(decodeTileId(idAt(walls, 2, 2))).toEqual({ kind: "fixed", index: 0 });
    expect(decodeTileId(idAt(walls, 2, 3))).toEqual({ kind: "fixed", index: 1 });
    expect(decodeTileId(idAt(walls, 5, 2))).toEqual({ kind: "fixed", index: 2 });
    expect(decodeTileId(idAt(walls, 5, 3))).toEqual({ kind: "fixed", index: 3 });
  });

  it("bakes a walkable gateway that connects the plateau to the lower ground", () => {
    const stamped = paintStairs(fieldWithPlateau(), set, 2, 2);
    const baked = bakeCollision({
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: COLS,
      rows: ROWS,
      layers: stamped,
      elements: [],
      spawn: { col: 0, row: 0 },
    });

    // The gateway is walkable end to end down path column 3: the plateau notch (row 2), the cleared
    // wall row (row 3) and the lower ground below it (row 4) are all grass — a player can descend.
    expect(kindAt(baked, 3, 2)).toBe("grass");
    expect(kindAt(baked, 3, 3)).toBe("grass");
    expect(kindAt(baked, 3, 4)).toBe("grass");
    // The second path column too.
    expect(kindAt(baked, 4, 3)).toBe("grass");
    // The banks are walkable ramp (the fixed ramp tiles are passable).
    expect(kindAt(baked, 2, 3)).toBe("grass");
    expect(kindAt(baked, 5, 3)).toBe("grass");
    // The wall cells flanking the opening stay solid, so the gateway is the ONLY way through the
    // cliff — a bank of forest on either side of a walkable channel.
    expect(kindAt(baked, 1, 3)).toBe("forest");
    expect(kindAt(baked, 6, 3)).toBe("forest");
  });

  it("is the walkable opening through a cliff in all four orientations", () => {
    const cases: readonly {
      direction: StairsDirection;
      anchor: { col: number; row: number };
      path: readonly { col: number; row: number }[];
      blocked: readonly { col: number; row: number }[];
    }[] = [
      {
        direction: "north",
        anchor: { col: 2, row: 2 },
        path: [
          { col: 3, row: 2 },
          { col: 3, row: 3 },
        ],
        blocked: [
          { col: 1, row: 3 },
          { col: 6, row: 3 },
        ],
      },
      {
        direction: "south",
        anchor: { col: 2, row: 2 },
        path: [
          { col: 3, row: 2 },
          { col: 3, row: 3 },
        ],
        blocked: [
          { col: 1, row: 2 },
          { col: 6, row: 2 },
        ],
      },
      {
        direction: "east",
        anchor: { col: 3, row: 2 },
        path: [
          { col: 3, row: 3 },
          { col: 4, row: 3 },
        ],
        blocked: [
          { col: 3, row: 1 },
          { col: 3, row: 6 },
        ],
      },
      {
        direction: "west",
        anchor: { col: 3, row: 2 },
        path: [
          { col: 3, row: 3 },
          { col: 4, row: 3 },
        ],
        blocked: [
          { col: 4, row: 1 },
          { col: 4, row: 6 },
        ],
      },
    ];

    for (const testCase of cases) {
      const stamped = paintStairs(
        fieldForDirection(testCase.direction),
        set,
        testCase.anchor.col,
        testCase.anchor.row,
        testCase.direction,
      );
      const baked = bakeCollision({
        tilesetId: TINY_SWORDS_TILESET_ID,
        cols: COLS,
        rows: ROWS,
        layers: stamped,
        elements: [],
        spawn: { col: 0, row: 0 },
      });
      for (const cell of testCase.path) expect(kindAt(baked, cell.col, cell.row)).toBe("grass");
      for (const cell of testCase.blocked) expect(kindAt(baked, cell.col, cell.row)).toBe("forest");
    }
  });
});
