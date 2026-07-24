import { bakeCollision } from "@lindocara/engine/map-data.js";
import { PLAYER_SIZE } from "@lindocara/engine/simulation.js";
import {
  eraseTile,
  paintElevation,
  paintStairs,
  type StairsDirection,
  stairsFixedIndex,
  stairsTilePlacements,
  syncElevationWalls,
} from "@lindocara/engine/tile-brush.js";
import { emptyLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { isPathWalkable, kindAt, TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { decodeTileId } from "@lindocara/engine/tileset.js";
import {
  GRASS_SLOTS,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

const set = TINY_SWORDS_TILESET;
const COLS = 8;
const ROWS = 8;
const DIRECTIONS = ["north", "east", "south", "west"] as const;
const anchor = { col: 4, row: 4 };

const HIGH_SIDE: Readonly<Record<StairsDirection, { col: number; row: number }>> = {
  north: { col: 0, row: -1 },
  east: { col: 1, row: 0 },
  south: { col: 0, row: 1 },
  west: { col: -1, row: 0 },
};

const EXPECTED_ROTATION: Readonly<Record<StairsDirection, 0 | 1 | 2 | 3>> = {
  north: 3,
  east: 0,
  south: 1,
  west: 2,
};

const CLIFF_FLANK: Readonly<Record<StairsDirection, { col: number; row: number }>> = {
  north: { col: -1, row: 0 },
  east: { col: 0, row: -1 },
  south: { col: 1, row: 0 },
  west: { col: 0, row: 1 },
};

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

function relativePart(direction: StairsDirection, part: "high" | "low") {
  const placement = stairsTilePlacements(direction, 0).find((candidate) => candidate.part === part);
  if (!placement) throw new Error(`missing ${part} stairs part`);
  return placement;
}

function partCell(direction: StairsDirection, part: "high" | "low") {
  const placement = relativePart(direction, part);
  return { col: anchor.col + placement.col, row: anchor.row + placement.row };
}

function highCellFor(direction: StairsDirection): { col: number; row: number } {
  const high = partCell(direction, "high");
  const side = HIGH_SIDE[direction];
  return { col: high.col + side.col, row: high.row + side.row };
}

/**
 * Low terrain everywhere, with a high quadrant touching only the official stair's high endpoint.
 * This is the same corner join Pixel Frog's guide illustrates and it rotates with the asset.
 */
function fieldForDirection(direction: StairsDirection, lowLevel: 0 | 1 = 0): TileLayer[] {
  let layers = blank();
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      layers = paintElevation(layers, set, lowLevel, col, row);
    }
  }

  const high = highCellFor(direction);
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const inside =
        direction === "north"
          ? col <= high.col && row <= high.row
          : direction === "east"
            ? col >= high.col && row <= high.row
            : direction === "south"
              ? col >= high.col && row >= high.row
              : col <= high.col && row >= high.row;
      if (inside) layers = paintElevation(layers, set, lowLevel + 1, col, row);
    }
  }
  return layers;
}

function baked(layers: readonly TileLayer[]) {
  return bakeCollision({
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: COLS,
    rows: ROWS,
    layers: [...layers],
    elements: [],
    spawn: { col: 0, row: 7 },
  });
}

function bodyCentredOn(cell: { col: number; row: number }) {
  const inset = (TILE_SIZE - PLAYER_SIZE) / 2;
  return { x: cell.col * TILE_SIZE + inset, y: cell.row * TILE_SIZE + inset };
}

describe("the official two-cell stairs stamp", () => {
  it("writes both 64px atlas halves without repainting either elevation", () => {
    const layers = fieldForDirection("north");
    const groundBefore = layerAt(layers, 0);
    const stamped = paintStairs(layers, set, anchor.col, anchor.row, "north", 0);

    expect(layerAt(stamped, 0)).toBe(groundBefore);
    for (const placement of stairsTilePlacements("north", 0)) {
      expect(
        decodeTileId(
          idAt(layerAt(stamped, 1), anchor.col + placement.col, anchor.row + placement.row),
        ),
      ).toEqual({ kind: "fixed", index: placement.fixedIndex });
    }
  });

  it("refuses flat ground, a mismatched level, a second high face and an off-map pair", () => {
    let flat = blank();
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        flat = paintElevation(flat, set, 0, col, row);
      }
    }
    expect(paintStairs(flat, set, anchor.col, anchor.row, "north", 0)).toBe(flat);

    const boundary = fieldForDirection("north");
    expect(paintStairs(boundary, set, anchor.col, anchor.row, "north", 1)).toBe(boundary);

    // The anchor's eastern neighbour becomes a second high face: two passable whole cells must not
    // open an unrelated side of the cliff.
    const corner = paintElevation(boundary, set, 1, anchor.col + 1, anchor.row);
    expect(paintStairs(corner, set, anchor.col, anchor.row, "north", 0)).toBe(corner);

    expect(paintStairs(boundary, set, 0, anchor.row, "north", 0)).toBe(boundary);
  });

  it("uses the correct source half and rotation for all four high sides", () => {
    expect(DIRECTIONS.map((direction) => stairsFixedIndex(direction, 0, "high"))).toEqual([
      0, 4, 8, 12,
    ]);
    for (const direction of DIRECTIONS) {
      const stamped = paintStairs(
        fieldForDirection(direction),
        set,
        anchor.col,
        anchor.row,
        direction,
        0,
      );
      for (const part of ["high", "low"] as const) {
        const cell = partCell(direction, part);
        const fixedIndex = stairsFixedIndex(direction, 0, part);
        expect(decodeTileId(idAt(layerAt(stamped, 1), cell.col, cell.row))).toEqual({
          kind: "fixed",
          index: fixedIndex,
        });
        expect(set.fixed[fixedIndex]).toMatchObject({
          col: 0,
          row: part === "high" ? 4 : 5,
          passable: true,
          rotationQuarterTurns: EXPECTED_ROTATION[direction],
        });
      }
    }
  });

  it("supports the complete 1↔2 transition with the same two-cell asset", () => {
    const layers = fieldForDirection("west", 1);
    const stamped = paintStairs(layers, set, anchor.col, anchor.row, "west", 1);
    expect(layerAt(stamped, 0)).toBe(layerAt(layers, 0));

    for (const part of ["high", "low"] as const) {
      const fixedIndex = stairsFixedIndex("west", 1, part);
      expect(set.fixed[fixedIndex]?.tint).toBe(set.autotiles[GRASS_SLOTS[1]]?.tint);
      const cell = partCell("west", part);
      expect(decodeTileId(idAt(layerAt(stamped, 1), cell.col, cell.row))).toEqual({
        kind: "fixed",
        index: fixedIndex,
      });
    }
  });

  it("removes both halves when water replaces either stair cell", () => {
    for (const direction of DIRECTIONS) {
      for (const drownedPart of ["high", "low"] as const) {
        const stamped = paintStairs(
          fieldForDirection(direction),
          set,
          anchor.col,
          anchor.row,
          direction,
          0,
        );
        const drownedCell = partCell(direction, drownedPart);
        const ground = eraseTile(layerAt(stamped, 0), set, drownedCell.col, drownedCell.row);
        const drowned = syncElevationWalls(
          [ground, ...stamped.slice(1)],
          set,
          drownedCell.col,
          drownedCell.row,
        );

        for (const placement of stairsTilePlacements(direction, 0)) {
          const ref = decodeTileId(
            idAt(layerAt(drowned, 1), anchor.col + placement.col, anchor.row + placement.row),
          );
          expect(
            ref.kind === "fixed" &&
              (ref.index === stairsFixedIndex(direction, 0, "high") ||
                ref.index === stairsFixedIndex(direction, 0, "low")),
          ).toBe(false);
        }
      }
    }
  });

  it("removes both halves when the upper terrain no longer matches", () => {
    const direction = "east";
    const stamped = paintStairs(
      fieldForDirection(direction),
      set,
      anchor.col,
      anchor.row,
      direction,
      0,
    );
    const high = highCellFor(direction);
    const flattened = paintElevation(stamped, set, 0, high.col, high.row);
    for (const placement of stairsTilePlacements(direction, 0)) {
      expect(
        decodeTileId(
          idAt(layerAt(flattened, 1), anchor.col + placement.col, anchor.row + placement.row),
        ),
      ).not.toEqual({ kind: "fixed", index: placement.fixedIndex });
    }
  });

  it("bakes a bidirectional low → stair → stair → high route in every orientation and level", () => {
    for (const direction of DIRECTIONS) {
      for (const lowLevel of [0, 1] as const) {
        const stamped = paintStairs(
          fieldForDirection(direction, lowLevel),
          set,
          anchor.col,
          anchor.row,
          direction,
          lowLevel,
        );
        const collision = baked(stamped);
        const low = partCell(direction, "low");
        const highPart = partCell(direction, "high");
        const high = highCellFor(direction);
        for (const cell of [low, highPart, high]) {
          expect(kindAt(collision, cell.col, cell.row)).toBe("grass");
        }
        const route = [bodyCentredOn(low), bodyCentredOn(highPart), bodyCentredOn(high)];
        for (let index = 0; index < route.length - 1; index += 1) {
          const from = route[index];
          const to = route[index + 1];
          expect(from).toBeDefined();
          expect(to).toBeDefined();
          if (!from || !to) continue;
          expect(isPathWalkable(collision, from, to, PLAYER_SIZE)).toBe(true);
          expect(isPathWalkable(collision, to, from, PLAYER_SIZE)).toBe(true);
        }

        // A neighbouring, un-stamped cliff face stays closed: the stair opens only its own route.
        const flank = CLIFF_FLANK[direction];
        expect(kindAt(collision, highPart.col + flank.col, highPart.row + flank.row)).toBe(
          "forest",
        );
      }
    }
  });
});
