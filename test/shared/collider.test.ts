import { describe, expect, it } from "vitest";
import {
  colliderIndexFrom,
  emptyColliderIndex,
  overlapsCollider,
} from "../../src/shared/collider.js";
import { TILE_SIZE } from "../../src/shared/tilemap.js";

const COLS = 4;
const ROWS = 4;

describe("collider index", () => {
  it("reports no overlap when empty", () => {
    const index = emptyColliderIndex(COLS, ROWS);
    expect(overlapsCollider(index, { x: 0, y: 0 }, 32)).toBe(false);
  });

  it("detects a body overlapping a sub-cell rect", () => {
    // A 24x20 trunk in the middle of cell (1,1).
    const index = colliderIndexFrom(
      [{ x: TILE_SIZE + 20, y: TILE_SIZE + 40, width: 24, height: 20 }],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: TILE_SIZE + 16, y: TILE_SIZE + 36 }, 32)).toBe(true);
  });

  it("lets a body pass beside a sub-cell rect inside the same cell", () => {
    // This is the whole point of the tranche: the cell is occupied, the cell is not blocked.
    const index = colliderIndexFrom(
      [{ x: TILE_SIZE + 40, y: TILE_SIZE + 40, width: 16, height: 16 }],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: TILE_SIZE, y: TILE_SIZE }, 32)).toBe(false);
  });

  it("treats the far edge as exclusive, like isWalkableBox", () => {
    const index = colliderIndexFrom([{ x: 32, y: 0, width: 16, height: 16 }], COLS, ROWS);
    // Body [0,32) ends exactly where the rect starts: touching, not overlapping.
    expect(overlapsCollider(index, { x: 0, y: 0 }, 32)).toBe(false);
    expect(overlapsCollider(index, { x: 1, y: 0 }, 32)).toBe(true);
  });

  it("finds a rect from any cell it spans", () => {
    // Spans the (0,0)/(1,0)/(0,1)/(1,1) corner. A bucket lookup must never consult neighbours.
    const index = colliderIndexFrom(
      [{ x: TILE_SIZE - 8, y: TILE_SIZE - 8, width: 16, height: 16 }],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: TILE_SIZE - 12, y: TILE_SIZE - 12 }, 8)).toBe(true);
    expect(overlapsCollider(index, { x: TILE_SIZE + 4, y: TILE_SIZE + 4 }, 8)).toBe(true);
  });

  it("ignores rects outside the grid and degenerate bodies", () => {
    const index = colliderIndexFrom(
      [
        { x: -100, y: -100, width: 16, height: 16 },
        { x: 0, y: 0, width: 0, height: 16 },
      ],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: 0, y: 0 }, 32)).toBe(false);
    expect(overlapsCollider(emptyColliderIndex(COLS, ROWS), { x: 0, y: 0 }, 0)).toBe(false);
  });
});
