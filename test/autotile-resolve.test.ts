import { describe, expect, it } from "vitest";
import {
  autotileOffset,
  EDGE16_LUT,
  edge16Mask,
  RUN4_LUT,
  run4Mask,
} from "../src/shared/autotile.js";

const none = () => false;
const all = () => true;

describe("edge16", () => {
  it("has one entry per neighbourhood", () => {
    expect(EDGE16_LUT).toHaveLength(16);
  });

  it("masks north, east, south and west as 1, 2, 4, 8", () => {
    expect(edge16Mask((dCol, dRow) => dCol === 0 && dRow === -1)).toBe(1);
    expect(edge16Mask((dCol, dRow) => dCol === 1 && dRow === 0)).toBe(2);
    expect(edge16Mask((dCol, dRow) => dCol === 0 && dRow === 1)).toBe(4);
    expect(edge16Mask((dCol, dRow) => dCol === -1 && dRow === 0)).toBe(8);
  });

  it("puts a lone tile on the island cell and a surrounded tile on the fill cell", () => {
    expect(autotileOffset("edge16", edge16Mask(none))).toEqual({ col: 3, row: 3 });
    expect(autotileOffset("edge16", edge16Mask(all))).toEqual({ col: 1, row: 1 });
  });
});

describe("run4", () => {
  it("masks west and east only", () => {
    expect(RUN4_LUT).toHaveLength(4);
    expect(run4Mask((dCol) => dCol === -1)).toBe(1);
    expect(run4Mask((dCol) => dCol === 1)).toBe(2);
    expect(run4Mask((_dCol, dRow) => dRow === -1)).toBe(0);
  });

  it("walks a horizontal run from left end through middle to right end", () => {
    expect(autotileOffset("run4", run4Mask(none))).toEqual({ col: 3, row: 0 });
    expect(
      autotileOffset(
        "run4",
        run4Mask((dCol) => dCol === 1),
      ),
    ).toEqual({ col: 0, row: 0 });
    expect(autotileOffset("run4", run4Mask(all))).toEqual({ col: 1, row: 0 });
    expect(
      autotileOffset(
        "run4",
        run4Mask((dCol) => dCol === -1),
      ),
    ).toEqual({ col: 2, row: 0 });
  });
});
