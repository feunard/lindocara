import { describe, expect, it } from "vitest";
import {
  addAxisCrossings,
  isLandKind,
  isSolidKind,
  isWalkableBox,
  kindAt,
  kindAtPoint,
  TILE_SIZE,
  type TileKind,
  type TileMap,
} from "../src/shared/tilemap.js";

/** 4x3 map. Row 1 is a wall of water with a one-tile bridge at col 2. */
function map(): TileMap {
  const g: TileKind = "grass";
  const w: TileKind = "water";
  const b: TileKind = "bridge";
  return {
    cols: 4,
    rows: 3,
    // row 0: g g g g
    // row 1: w w b w
    // row 2: g g g g
    kinds: [g, g, g, g, w, w, b, w, g, g, g, g],
  };
}

describe("tile kinds", () => {
  it("uses Tiny Swords' native tile size", () => {
    expect(TILE_SIZE).toBe(64);
  });

  it("makes only water solid — a bridge is the sanctioned way across it", () => {
    expect(isSolidKind("water")).toBe(true);
    expect(isSolidKind("bridge")).toBe(false);
    expect(isSolidKind("grass")).toBe(false);
    expect(isSolidKind("plateau")).toBe(false);
  });

  it("reads a kind by cell and by world point", () => {
    expect(kindAt(map(), 2, 1)).toBe("bridge");
    expect(kindAtPoint(map(), 2 * TILE_SIZE + 10, 1 * TILE_SIZE + 10)).toBe("bridge");
    expect(kindAtPoint(map(), 0, 0)).toBe("grass");
  });

  it("treats anything outside the map as solid, so nobody walks off the edge", () => {
    expect(kindAt(map(), -1, 0)).toBe("water");
    expect(kindAt(map(), 4, 0)).toBe("water");
    expect(kindAt(map(), 0, 3)).toBe("water");
    expect(isWalkableBox(map(), { x: -1, y: 0 }, 32)).toBe(false);
  });
});

describe("walking a box over tiles", () => {
  const m = map();

  it("lets a box stand on a single walkable tile", () => {
    expect(isWalkableBox(m, { x: 10, y: 10 }, 32)).toBe(true);
  });

  it("refuses a box wholly inside water", () => {
    expect(isWalkableBox(m, { x: 10, y: TILE_SIZE + 10 }, 32)).toBe(false);
  });

  // A box is not a point: standing with one corner in the water must fail, or players
  // clip into walls by half their body.
  it("refuses a box that only overlaps water at one corner", () => {
    const justAboveTheWall = { x: 10, y: TILE_SIZE - 4 };
    expect(isWalkableBox(m, justAboveTheWall, 32)).toBe(false);
  });

  it("lets a box cross on the bridge", () => {
    expect(isWalkableBox(m, { x: 2 * TILE_SIZE + 16, y: TILE_SIZE + 16 }, 32)).toBe(true);
  });

  it("refuses a box that spans the bridge and the water beside it", () => {
    const halfOffTheBridge = { x: 2 * TILE_SIZE - 8, y: TILE_SIZE + 16 };
    expect(isWalkableBox(m, halfOffTheBridge, 32)).toBe(false);
  });
});

// The far edge is computed as `position + size - 1`, not `position + size`. That `-1` only
// changes the outcome when `position + size` lands exactly on a multiple of TILE_SIZE — every
// other value floors to the same cell either way. None of the boxes above sum to a multiple of
// 64, so they would all still pass with the `-1` deleted. These pin the boundary itself.
describe("isWalkableBox at an exact tile boundary", () => {
  // 2x1 map: grass beside water. The seam between them sits at x = TILE_SIZE, a multiple of 64.
  function horizontalSeamMap(): TileMap {
    const g: TileKind = "grass";
    const w: TileKind = "water";
    return { cols: 2, rows: 1, kinds: [g, w] };
  }

  // 1x2 map: grass above water. The seam sits at y = TILE_SIZE.
  function verticalSeamMap(): TileMap {
    const g: TileKind = "grass";
    const w: TileKind = "water";
    return { cols: 1, rows: 2, kinds: [g, w] };
  }

  it("lets a box whose right edge lands exactly on the seam stay on the grass side", () => {
    const box = { x: 0, y: 0 };
    expect(isWalkableBox(horizontalSeamMap(), box, TILE_SIZE)).toBe(true);
  });

  it("refuses the same box shifted one pixel right, now crossing the seam into water", () => {
    const box = { x: 1, y: 0 };
    expect(isWalkableBox(horizontalSeamMap(), box, TILE_SIZE)).toBe(false);
  });

  it("lets a box whose bottom edge lands exactly on the seam stay on the grass side", () => {
    const box = { x: 0, y: 0 };
    expect(isWalkableBox(verticalSeamMap(), box, TILE_SIZE)).toBe(true);
  });

  it("refuses the same box shifted one pixel down, now crossing the seam into water", () => {
    const box = { x: 0, y: 1 };
    expect(isWalkableBox(verticalSeamMap(), box, TILE_SIZE)).toBe(false);
  });
});

describe("addAxisCrossings guards against non-finite input", () => {
  // `tile !== lastTile` never becomes false when either bound is NaN (`NaN !== NaN` is always
  // true), so the loop would never terminate — an infinite loop inside a Durable Object's 20Hz
  // tick, hanging the whole room. No caller can pass NaN today (every position is
  // server-computed), but the guard is free and this pins that it actually stops the loop
  // rather than relying on that invariant holding forever.
  it("does nothing and returns promptly when origin is NaN", () => {
    const into: number[] = [0, 1];
    addAxisCrossings(into, Number.NaN, 10);
    expect(into).toEqual([0, 1]);
  });

  it("does nothing and returns promptly when delta is NaN", () => {
    const into: number[] = [0, 1];
    addAxisCrossings(into, 10, Number.NaN);
    expect(into).toEqual([0, 1]);
  });

  it("does nothing and returns promptly when either bound is infinite", () => {
    const into: number[] = [0, 1];
    addAxisCrossings(into, 10, Number.POSITIVE_INFINITY);
    addAxisCrossings(into, Number.NEGATIVE_INFINITY, 10);
    expect(into).toEqual([0, 1]);
  });
});

describe("isWalkableBox with a degenerate size", () => {
  // Both at x = 0 and y = TILE_SIZE (each a multiple of 64), so `position + size - 1` underflows
  // into the previous cell on both axes and the loop bounds invert — the exact shape of the bug.
  const onWater = { x: 0, y: TILE_SIZE };

  it("refuses a zero-size box even though it sits on solid water", () => {
    expect(isSolidKind(kindAt(map(), 0, 1))).toBe(true);
    expect(isWalkableBox(map(), onWater, 0)).toBe(false);
  });

  it("refuses a negative-size box the same way", () => {
    expect(isWalkableBox(map(), onWater, -5)).toBe(false);
  });
});

describe("land versus void", () => {
  // Solidity and appearance are different questions. A forest is land you cannot walk into:
  // you see grass with trees standing on it, and the rocky shoreline is drawn against water,
  // not against the treeline.
  it("counts everything except water as land", () => {
    expect(isLandKind("grass")).toBe(true);
    expect(isLandKind("forest")).toBe(true);
    expect(isLandKind("building")).toBe(true);
    expect(isLandKind("bridge")).toBe(true);
    expect(isLandKind("plateau")).toBe(true);
    expect(isLandKind("water")).toBe(false);
  });

  it("makes forests and buildings solid even though they are land", () => {
    expect(isSolidKind("forest")).toBe(true);
    expect(isSolidKind("building")).toBe(true);
    expect(isSolidKind("water")).toBe(true);
    expect(isSolidKind("grass")).toBe(false);
    expect(isSolidKind("bridge")).toBe(false);
  });
});
