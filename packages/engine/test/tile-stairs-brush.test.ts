import { bakeCollision } from "@lindocara/engine/map-data.js";
import {
  eraseTile,
  paintElevation,
  paintStairs,
  type StairsDirection,
  stairsFixedIndex,
  syncElevationWalls,
} from "@lindocara/engine/tile-brush.js";
import { emptyLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { kindAt } from "@lindocara/engine/tilemap.js";
import { decodeTileId } from "@lindocara/engine/tileset.js";
import {
  CLIFF_WALL_SLOT,
  GRASS_SLOTS,
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

function anchorFor(direction: StairsDirection): { col: number; row: number } {
  return direction === "east" || direction === "west" ? { col: 3, row: 4 } : { col: 4, row: 3 };
}

function highCellFor(
  direction: StairsDirection,
  anchor = anchorFor(direction),
): { col: number; row: number } {
  if (direction === "north") return { col: anchor.col, row: anchor.row - 1 };
  if (direction === "east") return { col: anchor.col + 1, row: anchor.row };
  if (direction === "south") return { col: anchor.col, row: anchor.row + 1 };
  return { col: anchor.col - 1, row: anchor.row };
}

/** A straight low/high boundary with the clicked anchor on its low side. */
function fieldForDirection(direction: StairsDirection, lowLevel: 0 | 1 = 0): TileLayer[] {
  let layers = blank();
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      layers = paintElevation(layers, set, lowLevel, col, row);
    }
  }
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const high =
        direction === "north"
          ? row <= 2
          : direction === "south"
            ? row >= 4
            : direction === "east"
              ? col >= 4
              : col <= 2;
      if (high) layers = paintElevation(layers, set, lowLevel + 1, col, row);
    }
  }
  return layers;
}

describe("the simple stairs stamp", () => {
  it("replaces exactly one blocking cliff cell without repainting either elevation", () => {
    const layers = fieldForDirection("north");
    const anchor = anchorFor("north");
    const groundBefore = layerAt(layers, 0);
    const wallBefore = decodeTileId(idAt(layerAt(layers, 1), anchor.col, anchor.row));
    expect(wallBefore.kind).toBe("autotile");
    if (wallBefore.kind === "autotile") expect(wallBefore.slot).toBe(CLIFF_WALL_SLOT);

    const stamped = paintStairs(layers, set, anchor.col, anchor.row, "north", 0);
    expect(layerAt(stamped, 0)).toBe(groundBefore);
    expect(decodeTileId(idAt(layerAt(stamped, 1), anchor.col, anchor.row))).toEqual({
      kind: "fixed",
      index: stairsFixedIndex("north", 0),
    });

    for (const col of [anchor.col - 1, anchor.col + 1]) {
      const ref = decodeTileId(idAt(layerAt(stamped, 1), col, anchor.row));
      expect(ref.kind).toBe("autotile");
      if (ref.kind === "autotile") expect(ref.slot).toBe(CLIFF_WALL_SLOT);
    }
  });

  it("refuses flat ground, a mismatched level and a cliff corner, same reference back", () => {
    let flat = blank();
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        flat = paintElevation(flat, set, 0, col, row);
      }
    }
    expect(paintStairs(flat, set, 4, 3, "north", 0)).toBe(flat);

    const boundary = fieldForDirection("north");
    expect(paintStairs(boundary, set, 4, 3, "north", 1)).toBe(boundary);

    // North and east are both high: one passable whole cell would open two cliff faces.
    const corner = paintElevation(boundary, set, 1, 5, 3);
    expect(paintStairs(corner, set, 4, 3, "north", 0)).toBe(corner);
  });

  it("writes one rotated simple-asset id for every uphill direction", () => {
    for (const direction of ["north", "east", "south", "west"] as const) {
      const layers = fieldForDirection(direction);
      const anchor = anchorFor(direction);
      const stamped = paintStairs(layers, set, anchor.col, anchor.row, direction, 0);
      const ramps = layerAt(stamped, 1)
        .ids.map((id) => decodeTileId(id))
        .filter((ref) => ref.kind === "fixed" && ref.index === stairsFixedIndex(direction, 0));
      expect(ramps).toHaveLength(1);
      const entry = set.fixed[stairsFixedIndex(direction, 0)];
      expect(entry).toMatchObject({
        col: 0,
        row: 4,
        passable: true,
        rotationQuarterTurns: ["north", "east", "south", "west"].indexOf(direction),
      });
    }
  });

  it("uses the darker simple asset for a 1↔2 boundary without modifying ground", () => {
    const layers = fieldForDirection("north", 1);
    const anchor = anchorFor("north");
    const stamped = paintStairs(layers, set, anchor.col, anchor.row, "north", 1);
    expect(layerAt(stamped, 0)).toBe(layerAt(layers, 0));
    expect(decodeTileId(idAt(layerAt(stamped, 1), anchor.col, anchor.row))).toEqual({
      kind: "fixed",
      index: stairsFixedIndex("north", 1),
    });
    expect(set.fixed[stairsFixedIndex("north", 1)]?.tint).toBe(set.autotiles[GRASS_SLOTS[1]]?.tint);
  });

  it("removes the ramp when water replaces its cell and restores normal cliff upkeep", () => {
    const anchor = anchorFor("north");
    const stamped = paintStairs(
      fieldForDirection("north"),
      set,
      anchor.col,
      anchor.row,
      "north",
      0,
    );
    const ground = eraseTile(layerAt(stamped, 0), set, anchor.col, anchor.row);
    const drowned = syncElevationWalls([ground, ...stamped.slice(1)], set, anchor.col, anchor.row);
    const ref = decodeTileId(idAt(layerAt(drowned, 1), anchor.col, anchor.row));
    expect(ref.kind).toBe("autotile");
    if (ref.kind === "autotile") expect(ref.slot).toBe(CLIFF_WALL_SLOT);
    expect(
      kindAt(
        bakeCollision({
          tilesetId: TINY_SWORDS_TILESET_ID,
          cols: COLS,
          rows: ROWS,
          layers: drowned,
          elements: [],
          spawn: { col: 0, row: 7 },
        }),
        anchor.col,
        anchor.row,
      ),
    ).toBe("forest");
  });

  it("removes an orphaned ramp when either elevation no longer matches", () => {
    const anchor = anchorFor("north");
    const high = highCellFor("north", anchor);
    const stamped = paintStairs(
      fieldForDirection("north"),
      set,
      anchor.col,
      anchor.row,
      "north",
      0,
    );
    const flattened = paintElevation(stamped, set, 0, high.col, high.row);
    expect(decodeTileId(idAt(layerAt(flattened, 1), anchor.col, anchor.row))).toEqual({
      kind: "empty",
    });
  });

  it("bakes one bidirectional opening through the cliff in all four orientations", () => {
    for (const direction of ["north", "east", "south", "west"] as const) {
      const anchor = anchorFor(direction);
      const high = highCellFor(direction, anchor);
      const stamped = paintStairs(
        fieldForDirection(direction),
        set,
        anchor.col,
        anchor.row,
        direction,
      );
      const baked = bakeCollision({
        tilesetId: TINY_SWORDS_TILESET_ID,
        cols: COLS,
        rows: ROWS,
        layers: stamped,
        elements: [],
        spawn: { col: 0, row: 7 },
      });
      expect(kindAt(baked, anchor.col, anchor.row)).toBe("grass");
      expect(kindAt(baked, high.col, high.row)).toBe("grass");

      const flankA =
        direction === "north" || direction === "south"
          ? { col: anchor.col - 1, row: anchor.row }
          : { col: anchor.col, row: anchor.row - 1 };
      const flankB =
        direction === "north" || direction === "south"
          ? { col: anchor.col + 1, row: anchor.row }
          : { col: anchor.col, row: anchor.row + 1 };
      expect(kindAt(baked, flankA.col, flankA.row)).toBe("forest");
      expect(kindAt(baked, flankB.col, flankB.row)).toBe("forest");
    }
  });
});
