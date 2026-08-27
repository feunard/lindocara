import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { bakeCollision, EMPTY_MARKERS } from "@lindocara/engine/map-data.js";
import { PLAYER_SIZE } from "@lindocara/engine/simulation.js";
import {
  eraseStairsAt,
  eraseTile,
  groundElevationAt,
  inferStairsPlacement,
  inferStairsRun,
  paintElevation,
  paintOneCellRamp,
  paintStairsRun,
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
  isRampFixedIndex,
  oneCellRampFixedIndex,
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

  it("erases both official halves from either clicked part without changing the ground", () => {
    for (const part of ["high", "low"] as const) {
      const stamped = paintStairs(
        fieldForDirection("east"),
        set,
        anchor.col,
        anchor.row,
        "east",
        0,
      );
      const groundBefore = layerAt(stamped, 0);
      const clicked = partCell("east", part);
      const erased = eraseStairsAt(stamped, set, clicked.col, clicked.row);

      expect(layerAt(erased, 0)).toBe(groundBefore);
      for (const placement of stairsTilePlacements("east", 0)) {
        const ref = decodeTileId(
          idAt(layerAt(erased, 1), anchor.col + placement.col, anchor.row + placement.row),
        );
        expect(ref.kind === "fixed" && isRampFixedIndex(ref.index)).toBe(false);
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

  it("climbs a bank whose high side is north, which used to have no ramp at all", () => {
    // Higher ground ABOVE the anchor rather than beside it. This answered null while a ramp was the
    // official 64x128 side sprite, because Pixel Frog ships two side ramps and neither faces this
    // way. A meshed ramp is geometry, so the limit went with the sprite.
    let field = blank();
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        field = paintElevation(field, set, row < anchor.row ? 1 : 0, col, row);
      }
    }
    expect(inferStairsPlacement(layerAt(field, 0), anchor.col, anchor.row)).toEqual({
      direction: "north",
      lowLevel: 0,
    });
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

describe("a one-cell ramp", () => {
  /** Flat low ground with a plateau on ONE side of the anchor, whichever side is asked for. */
  function bankTo(direction: "east" | "west" | "south" | "north"): TileLayer[] {
    const high = { east: [1, 0], west: [-1, 0], south: [0, 1], north: [0, -1] }[direction];
    let layers = blank();
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) layers = paintElevation(layers, set, 0, col, row);
    }
    const [dc, dr] = high as [number, number];
    for (let row = 0; row < ROWS; row += 1) {
      for (let col = 0; col < COLS; col += 1) {
        const beyond =
          dc !== 0
            ? dc > 0
              ? col > anchor.col
              : col < anchor.col
            : dr > 0
              ? row > anchor.row
              : row < anchor.row;
        if (beyond) layers = paintElevation(layers, set, 1, col, row);
      }
    }
    return layers;
  }

  it("stamps a single passable cell on every one of the four sides", () => {
    for (const direction of ["east", "west", "south", "north"] as const) {
      const layers = bankTo(direction);
      const painted = paintOneCellRamp(layers, set, anchor.col, anchor.row, direction, 0);
      expect(painted).not.toBe(layers);
      const walls = layerAt(painted, 1);
      expect(decodeTileId(idAt(walls, anchor.col, anchor.row))).toEqual({
        kind: "fixed",
        index: oneCellRampFixedIndex(direction, 0),
      });
      // ONE cell: the neighbour along the old two-cell axis is not part of it.
      const second = decodeTileId(idAt(walls, anchor.col, anchor.row - 1));
      expect(second.kind === "fixed" && isRampFixedIndex(second.index)).toBe(false);
    }
  });

  it("refuses flat ground and a mismatched pair of levels", () => {
    const flatOnly = bankTo("east");
    // Climbing away from the plateau is climbing into nothing.
    expect(paintOneCellRamp(flatOnly, set, anchor.col, anchor.row, "west", 0)).toBe(flatOnly);
    // And a transition the terrain does not make: this bank joins 0 to 1, not 1 to 2.
    expect(paintOneCellRamp(flatOnly, set, anchor.col, anchor.row, "east", 1)).toBe(flatOnly);
  });

  it("compiles to a 1x1 ramp rectangle carrying its direction", () => {
    const layers = bankTo("south");
    const painted = paintOneCellRamp(layers, set, anchor.col, anchor.row, "south", 0);
    const compiled = compileAuthoredMap({
      environment: "exterior",
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: COLS,
      rows: ROWS,
      layers: painted,
      elements: [],
      spawn: { col: 0, row: 0 },
      markers: EMPTY_MARKERS,
    });
    expect(compiled.ramps).toEqual([
      {
        x: anchor.col - Math.max(COLS, ROWS) / 2,
        z: anchor.row - Math.max(COLS, ROWS) / 2,
        width: 1,
        depth: 1,
        direction: "south",
        lowLevel: 0,
      },
    ]);
  });
});

describe("automatic stair runs", () => {
  it("infers front, back, left, and right approaches", () => {
    const sides = {
      east: { col: 1, row: 0 },
      west: { col: -1, row: 0 },
      south: { col: 0, row: 1 },
      north: { col: 0, row: -1 },
    } as const;
    for (const direction of ["east", "west", "south", "north"] as const) {
      const side = sides[direction];
      let layers = blank();
      layers = paintElevation(layers, set, 1, anchor.col + side.col, anchor.row + side.row);
      expect(inferStairsRun(layerAt(layers, 0), anchor.col, anchor.row, direction)).toMatchObject({
        direction,
        highLevel: 1,
      });
    }
  });

  it("starts on water when a raised bank is within reach", () => {
    let layers = blank();
    layers = paintElevation(layers, set, 1, anchor.col, anchor.row);
    const plan = inferStairsRun(layerAt(layers, 0), anchor.col + 1, anchor.row, "west");
    expect(plan).toMatchObject({ direction: "west", highLevel: 1 });
    expect(plan?.cells).toEqual([
      expect.objectContaining({ col: anchor.col + 1, row: anchor.row, lowLevel: 0 }),
    ]);
    if (!plan) throw new Error("expected stairs from the water edge");

    const painted = paintStairsRun(layers, set, plan);
    expect(groundElevationAt(layerAt(painted, 0), anchor.col + 1, anchor.row)).toBe(0);
    expect(decodeTileId(idAt(layerAt(painted, 1), anchor.col + 1, anchor.row))).toEqual({
      kind: "fixed",
      index: oneCellRampFixedIndex("west", 0),
    });
  });

  it("builds a widened ten-level descent into empty cells", () => {
    const size = 24;
    let layers: TileLayer[] = [
      emptyLayer(size, size),
      emptyLayer(size, size),
      emptyLayer(size, size),
    ];
    for (const row of [10, 11, 12]) layers = paintElevation(layers, set, 10, 4, row);
    const plan = inferStairsRun(layerAt(layers, 0), 4, 11, "west");
    expect(plan).toMatchObject({ direction: "west", highLevel: 10 });
    expect(plan?.cells).toHaveLength(30);
    if (!plan) throw new Error("expected a ten-level stair run");

    const painted = paintStairsRun(layers, set, plan);
    expect(groundElevationAt(layerAt(painted, 0), 5, 10)).toBe(9);
    expect(groundElevationAt(layerAt(painted, 0), 14, 12)).toBe(0);
    const compiled = compileAuthoredMap({
      environment: "exterior",
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: size,
      rows: size,
      layers: painted,
      elements: [],
      spawn: { col: 0, row: 0 },
      markers: EMPTY_MARKERS,
    });
    expect(compiled.ramps).toHaveLength(10);
    expect(compiled.ramps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "west", lowLevel: 9, width: 1, depth: 3 }),
        expect.objectContaining({ direction: "west", lowLevel: 0, width: 1, depth: 3 }),
      ]),
    );
  });

  it("erases a complete widened run from any one of its cells and restores the cliffs", () => {
    const size = 24;
    let layers: TileLayer[] = [
      emptyLayer(size, size),
      emptyLayer(size, size),
      emptyLayer(size, size),
    ];
    for (const row of [10, 11, 12]) layers = paintElevation(layers, set, 4, 4, row);
    const plan = inferStairsRun(layerAt(layers, 0), 4, 11, "west");
    if (!plan) throw new Error("expected a widened stair run");
    const painted = paintStairsRun(layers, set, plan);
    const groundBefore = layerAt(painted, 0);

    // The clicked cell is in the middle lane and halfway down the staircase, not at an endpoint.
    const erased = eraseStairsAt(painted, set, 6, 11);
    expect(erased).not.toBe(painted);
    expect(layerAt(erased, 0)).toBe(groundBefore);
    for (const cell of plan.cells) {
      const ref = decodeTileId(idAt(layerAt(erased, 1), cell.col, cell.row));
      expect(ref.kind === "fixed" && isRampFixedIndex(ref.index)).toBe(false);
    }
    expect(
      compileAuthoredMap({
        environment: "exterior",
        tilesetId: TINY_SWORDS_TILESET_ID,
        cols: size,
        rows: size,
        layers: erased,
        elements: [],
        spawn: { col: 0, row: 0 },
        markers: EMPTY_MARKERS,
      }).ramps,
    ).toEqual([]);
  });
});
