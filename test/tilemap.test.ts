import { describe, expect, it } from "vitest";
import {
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
