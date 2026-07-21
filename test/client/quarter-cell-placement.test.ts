import { describe, expect, it } from "vitest";
import { ELEMENT_OFFSET_PX, quarterCellAt } from "../../src/shared/map-data.js";
import { TILE_SIZE } from "../../src/shared/tilemap.js";

describe("quarter-cell quantisation", () => {
  it("splits a cell into four steps per axis", () => {
    expect(quarterCellAt(0, 0)).toEqual({ col: 0, row: 0, offsetX: 0, offsetY: 0 });
    expect(quarterCellAt(TILE_SIZE - 1, 0)).toEqual({ col: 0, row: 0, offsetX: 3, offsetY: 0 });
    expect(quarterCellAt(TILE_SIZE, 0)).toEqual({ col: 1, row: 0, offsetX: 0, offsetY: 0 });
  });

  it("round-trips back to the quantised pixel", () => {
    for (let px = 0; px < TILE_SIZE * 3; px += 7) {
      const q = quarterCellAt(px, px);
      const back = q.col * TILE_SIZE + q.offsetX * ELEMENT_OFFSET_PX;
      expect(back).toBeLessThanOrEqual(px);
      expect(px - back).toBeLessThan(ELEMENT_OFFSET_PX);
    }
  });

  it("clamps negatives to the origin cell rather than producing a negative offset", () => {
    expect(quarterCellAt(-1, -1)).toEqual({ col: -1, row: -1, offsetX: 3, offsetY: 3 });
  });
});
