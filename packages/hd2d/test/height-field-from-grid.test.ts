import { describe, expect, it } from "vitest";

import { heightFieldFromGrid } from "../src/terrain/height-field-from-grid.js";

const field = heightFieldFromGrid({
  size: 2,
  levels: [0, 1, null, 0],
  materials: ["herbe", "herbe", "herbe", "sable"],
  materialKey: (material, level) => (material === "herbe" ? `lvl${level}` : material),
});

describe("heightFieldFromGrid", () => {
  it("reads levels row-major", () => {
    expect(field.levelAt(0, 0)).toBe(0);
    expect(field.levelAt(1, 0)).toBe(1);
    expect(field.levelAt(0, 1)).toBeNull();
    expect(field.levelAt(1, 1)).toBe(0);
  });

  it("returns null off the grid rather than reading a neighbouring row", () => {
    expect(field.levelAt(-1, 0)).toBeNull();
    expect(field.levelAt(2, 0)).toBeNull();
    expect(field.materialAt(0, -1)).toBeNull();
  });

  it("routes the material through the caller's key function", () => {
    expect(field.materialAt(1, 0)).toBe("lvl1");
    expect(field.materialAt(1, 1)).toBe("sable");
  });

  it("has no material where there is water", () => {
    expect(field.materialAt(0, 1)).toBeNull();
  });
});
