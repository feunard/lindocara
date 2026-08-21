import type { HeightField } from "@lindocara/hd2d/terrain/field.js";
import { groundMaskData } from "@lindocara/hd2d/terrain/water.js";
import { describe, expect, it } from "vitest";

/** A 3x2 field: the left column is open sea, the middle is ground, the right is a pit. */
function field(): HeightField {
  const levels: (number | null)[] = [null, 0, -2, null, 0, -1];
  return {
    cols: 3,
    rows: 2,
    levelAt: (i, j) => levels[j * 3 + i] ?? null,
    materialAt: () => "herbe",
  };
}

describe("the sea's ground mask", () => {
  it("marks every cell that HAS ground, sunken ones included", () => {
    // The whole point: a pit floor is dry ground below the sea's own plane, so the sea must be cut
    // there exactly as it is over a plateau. Reading the mask off the level's SIGN instead of its
    // presence would flood every pit, which is the bug this exists to prevent.
    expect([...groundMaskData(field())]).toEqual([0, 255, 255, 0, 255, 255]);
  });

  it("is one texel per cell, row-major, so the cut lands on cell boundaries", () => {
    const mask = groundMaskData(field());
    expect(mask).toHaveLength(6);
    // Row 1, column 0 is sea; the plane keeps drawing there.
    expect(mask[3]).toBe(0);
  });
});
