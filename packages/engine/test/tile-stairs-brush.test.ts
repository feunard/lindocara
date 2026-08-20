import { bakeCollision } from "@lindocara/engine/map-data.js";
import { PLAYER_SIZE } from "@lindocara/engine/simulation.js";
import {
  eraseTile,
  inferStairsPlacement,
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
const DIRECTIONS = ["east", "west"] as const;
const anchor = { col: 4, row: 4 };

const HIGH_SIDE: Readonly<Record<StairsDirection, { col: number; row: number }>> = {
  east: { col: 1, row: 0 },
  west: { col: -1, row: 0 },
};

const EXPECTED_ART: Readonly<Record<StairsDirection, { col: 0 | 3; rotationQuarterTurns: 0 }>> = {
  east: { col: 0, rotationQuarterTurns: 0 },
  west: { col: 3, rotationQuarterTurns: 0 },
};

const CLIFF_FLANK: Readonly<Record<StairsDirection, { col: number; row: number }>> = {
  east: { col: 0, row: -1 },
  west: { col: 0, row: -1 },
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

/** Low terrain beside a straight two-cell cliff edge, matching the native side-ramp composition. */
function fieldForDirection(direction: StairsDirection, lowLevel: 0 | 1 | 2 = 0): TileLayer[] {
  let layers = blank();
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      layers = paintElevation(layers, set, lowLevel, col, row);
    }
  }

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const inside = direction === "east" ? col > anchor.col : col < anchor.col;
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
    const layers = fieldForDirection("east");
    const groundBefore = layerAt(layers, 0);
    const stamped = paintStairs(layers, set, anchor.col, anchor.row, "east", 0);

    expect(layerAt(stamped, 0)).toBe(groundBefore);
    for (const placement of stairsTilePlacements("east", 0)) {
      expect(
        decodeTileId(
          idAt(layerAt(stamped, 1), anchor.col + placement.col, anchor.row + placement.row),
        ),
      ).toEqual({ kind: "fixed", index: placement.fixedIndex });
    }
  });

  it("refuses flat ground, a mismatched level and an off-map pair", () => {
    let flat = blank();
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        flat = paintElevation(flat, set, 0, col, row);
      }
    }
    expect(paintStairs(flat, set, anchor.col, anchor.row, "east", 0)).toBe(flat);

    const boundary = fieldForDirection("east");
    expect(paintStairs(boundary, set, anchor.col, anchor.row, "east", 1)).toBe(boundary);

    // A neighbouring high face does not invalidate the two endpoints the selected direction joins.
    const corner = paintElevation(boundary, set, 1, anchor.col - 1, anchor.row);
    expect(paintStairs(corner, set, anchor.col, anchor.row, "east", 0)).not.toBe(corner);

    expect(paintStairs(boundary, set, anchor.col, 0, "east", 0)).toBe(boundary);
  });

  it("uses the two native side-ramp sources", () => {
    expect(DIRECTIONS.map((direction) => stairsFixedIndex(direction, 0, "high"))).toEqual([0, 4]);
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
          col: EXPECTED_ART[direction].col,
          row: part === "high" ? 4 : 5,
          passable: true,
          rotationQuarterTurns: EXPECTED_ART[direction].rotationQuarterTurns,
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

  it("appends a complete 2↔3 transition without moving the historical ids", () => {
    const stamped = paintStairs(
      fieldForDirection("east", 2),
      set,
      anchor.col,
      anchor.row,
      "east",
      2,
    );
    expect(stairsFixedIndex("east", 0, "high")).toBe(0);
    expect(stairsFixedIndex("west", 1, "low")).toBe(7);
    for (const part of ["high", "low"] as const) {
      const fixedIndex = stairsFixedIndex("east", 2, part);
      expect(fixedIndex).toBe(part === "high" ? 16 : 17);
      const cell = partCell("east", part);
      expect(decodeTileId(idAt(layerAt(stamped, 1), cell.col, cell.row))).toEqual({
        kind: "fixed",
        index: fixedIndex,
      });
      expect(set.fixed[fixedIndex]?.renderLevel).toBe(3);
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

  it("bakes a bidirectional low → stair → stair → high route in all directions and levels", () => {
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
        expect(kindAt(collision, low.col, low.row)).toBe("ramp");
        expect(kindAt(collision, highPart.col, highPart.row)).toBe("ramp");
        expect(kindAt(collision, high.col, high.row)).toBe("grass");
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

describe("inferStairsPlacement", () => {
  it("reads the direction and the joined levels off the terrain", () => {
    for (const direction of DIRECTIONS) {
      for (const lowLevel of [0, 1, 2] as const) {
        const ground = layerAt(fieldForDirection(direction, lowLevel), 0);
        expect(inferStairsPlacement(ground, anchor.col, anchor.row)).toEqual({
          direction,
          lowLevel,
        });
      }
    }
  });

  it("answers null on flat ground, so a click can say no instead of doing nothing", () => {
    let flat = blank();
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) flat = paintElevation(flat, set, 0, col, row);
    }
    expect(inferStairsPlacement(layerAt(flat, 0), anchor.col, anchor.row)).toBeNull();
  });

  it("answers null for a bank whose high side is north or south: there is no art for those", () => {
    // Higher ground above the anchor rather than beside it. `STAIRS_DIRECTIONS` is east/west
    // because Pixel Frog ships two side ramps, so this cliff simply has no staircase.
    let field = blank();
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        field = paintElevation(field, set, row < anchor.row ? 1 : 0, col, row);
      }
    }
    expect(inferStairsPlacement(layerAt(field, 0), anchor.col, anchor.row)).toBeNull();
  });

  it("breaks a genuine tie with the caller's preference", () => {
    // A trench: higher ground on BOTH sides of the ramp's two cells, so east and west both fit.
    let trench = blank();
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        trench = paintElevation(trench, set, col === anchor.col ? 0 : 1, col, row);
      }
    }
    const ground = layerAt(trench, 0);
    expect(inferStairsPlacement(ground, anchor.col, anchor.row, "west")).toMatchObject({
      direction: "west",
    });
    expect(inferStairsPlacement(ground, anchor.col, anchor.row, "east")).toMatchObject({
      direction: "east",
    });
  });
});
