import {
  createTerrainQuery,
  type TerrainMaterial,
  type TerrainQuery,
} from "@lindocara/engine/hd2d/terrain-query.js";
import { describe, expect, it } from "vitest";

/**
 * Builds a `TerrainQuery` from a hand-written level grid (`levels[j][i]`, `null` = water/out of
 * bounds). This is the collision primitive — the same one that moved into `@lindocara/engine` in
 * S2 as server authority — so every test here fixes an exact position and an exact radius, worked
 * out by hand against the grid, rather than deriving from a generated island where a regression
 * could hide behind the shape of the terrain.
 */
function makeQuery(
  levels: readonly (number | null)[][],
  opts: { levelHeight?: number; waterLevel?: number } = {},
): TerrainQuery {
  const size = levels.length;
  const at = (i: number, j: number): number | null => {
    const row = levels[j];
    if (!row) return null;
    return row[i] ?? null;
  };
  // Not exercised by the tests below (`heightAt`/`levelAt`/`maxHeightAround` never read it):
  // required only to satisfy `TerrainQuerySource`.
  const kindAt = (i: number, j: number): TerrainMaterial | null =>
    at(i, j) === null ? null : "herbe";
  return createTerrainQuery({
    size,
    levelHeight: opts.levelHeight ?? 1,
    waterLevel: opts.waterLevel ?? -1,
    at,
    kindAt,
  });
}

describe("heightAt / levelAt", () => {
  // size=4, c=2: cell i covers x ∈ [i-2, i-1), same for z with j.
  const levels = [
    [null, null, null, null],
    [null, 0, 3, null],
    [null, 0, 0, null],
    [null, null, null, null],
  ];

  it("heightAt returns the world height (level * levelHeight) on land", () => {
    const q = makeQuery(levels, { levelHeight: 0.9 });
    // Cell (2,1): level 3, center at x=0.5, z=-0.5.
    expect(q.heightAt(0.5, -0.5)).toBeCloseTo(3 * 0.9);
  });

  it("heightAt returns null on water", () => {
    const q = makeQuery(levels);
    // Cell (0,0), water (null): center x=-1.5, z=-1.5.
    expect(q.heightAt(-1.5, -1.5)).toBeNull();
  });

  it("heightAt returns null off the map", () => {
    const q = makeQuery(levels);
    expect(q.heightAt(-100, -100)).toBeNull();
  });

  it("levelAt returns the raw level, unscaled", () => {
    const q = makeQuery(levels, { levelHeight: 0.9 });
    expect(q.levelAt(0.5, -0.5)).toBe(3);
    expect(q.levelAt(-1.5, -1.5)).toBeNull();
    expect(q.levelAt(-100, -100)).toBeNull();
  });
});

describe("maxHeightAround", () => {
  it("a disc entirely on a flat cell returns that cell's height", () => {
    const levels = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1 });
    // Center of cell (1,1): x=-0.5, z=-0.5. Radius 0.2: stays entirely inside the cell.
    expect(q.maxHeightAround(-0.5, -0.5, 0.2)).toBe(0);
  });

  it("a disc overlapping a taller cell returns the TALLEST height", () => {
    const levels = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 2, 0], // cell (2,2) raised
      [0, 0, 0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1 });
    // A point in cell (1,1) [x,z ∈ [-1,0)], near the corner touching the raised cell (2,2)
    // [x,z ∈ [0,1)] — a radius large enough for the disc to actually reach that cell (distance to
    // the nearest corner: √0.02 ≈ 0.1414 < r = 0.15).
    expect(q.maxHeightAround(-0.1, -0.1, 0.15)).toBe(2);
  });

  it("a cell only grazed by the bounding box's corner, but outside the disc, doesn't count", () => {
    const levels = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 5, 0], // same raised cell, diagonal
      [0, 0, 0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1 });
    // Same position as the previous test, but a shorter radius: cell (2,2) still falls inside the
    // bounding box [wx-r, wx+r] x [wz-r, wz+r] (so it's included in the loop), but the cell's
    // closest point to the center (0, 0) is at √0.02 ≈ 0.1414, strictly farther than r = 0.12.
    // Without clamping to the nearest point — a bug that would test just the cell's center, or
    // count any cell whose bounding box intersects — this test would fail by returning 5 instead
    // of 0.
    expect(q.maxHeightAround(-0.1, -0.1, 0.12)).toBe(0);
  });

  it("takes the maximum among SEVERAL overlapped cells, not the first one found", () => {
    const levels = [
      [0, 0, 0, 0],
      [0, 1, 3, 0],
      [0, 0, 2, 0],
      [0, 0, 0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1 });
    // Centered exactly on the corner shared by the four cells (1,1)=1 (1,2)=3 (2,1)=0 (2,2)=2 — a
    // large radius covers all of them.
    expect(q.maxHeightAround(0, 0, 0.9)).toBe(3);
  });

  it("water counts as its own level, never as a wall", () => {
    const levels = [
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ];
    const q = makeQuery(levels, { levelHeight: 1, waterLevel: -0.5 });
    // Entirely in open water: no land cell in the disc, only the water level applies — never
    // `-Infinity`, never a value that would block movement.
    expect(q.maxHeightAround(-0.5, -0.5, 0.2)).toBe(-0.5);
  });

  it("out of bounds isn't a wall either — you can swim out to open sea", () => {
    const levels = [
      [0, 0],
      [0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1, waterLevel: -0.25 });
    // Far outside the 2x2 grid: every cell visited is out of bounds (`at` returns null exactly
    // like water), so the result is the water level, never a block.
    expect(q.maxHeightAround(-10, -10, 0.3)).toBe(-0.25);
  });

  it("a disc at the map's edge mixes land and out-of-bounds without ever blocking", () => {
    const levels = [
      [0, 0],
      [0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 2, waterLevel: -1 });
    // The extreme corner of cell (0,0) [x,z ∈ [-1,0)]: part of the disc spills outside the grid
    // (treated as water), the rest stays on land (level 0 * levelHeight 2 = 0). The maximum
    // between 0 (land) and -1 (water/out of bounds) is 0 — land wins, without any out-of-bounds
    // cell crashing or wrongly dominating.
    expect(q.maxHeightAround(-0.9, -0.9, 0.3)).toBe(0);
  });

  it("r = 0 returns the height of the cell under the point, never -Infinity", () => {
    // Final review pass (point C1): `r * r` is 0 with `r = 0`, and the queried point is at
    // distance 0 from its own cell — the old exclusion `>= r*r` (0 >= 0) wrongly ruled it out, and
    // the function returned `-Infinity` despite the JSDoc promising otherwise. Latent as long as
    // only `HERO.radius = 0.3` ever called this function; reachable the moment an entity's radius
    // is 0.
    const levels = [
      [0, 0, 0, 0],
      [0, 0, 3, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const q = makeQuery(levels, { levelHeight: 1 });
    // Cell (2,1): level 3, center at x=0.5, z=-0.5.
    expect(q.maxHeightAround(0.5, -0.5, 0)).toBe(3);
  });

  it("r = 0 on water returns the water level, never -Infinity", () => {
    const levels = [
      [null, null],
      [null, null],
    ];
    const q = makeQuery(levels, { levelHeight: 1, waterLevel: -0.5 });
    expect(q.maxHeightAround(0, 0, 0)).toBe(-0.5);
  });
});

// Final review's point C3 asked for a typed union rather than a `string`: this test mainly makes
// sure `TerrainMaterial` stays assignable wherever `kindAt` returns it, or it would have no
// compile-time purpose at all.
describe("TerrainMaterial", () => {
  it("kindAt returns one of the typed materials, never an arbitrary string", () => {
    const levels = [
      [0, 0],
      [0, 0],
    ];
    const kindAt = (i: number, j: number): TerrainMaterial | null =>
      levels[j]?.[i] === undefined ? null : "sable";
    const q = createTerrainQuery({
      size: 2,
      levelHeight: 1,
      waterLevel: -1,
      at: (i, j) => levels[j]?.[i] ?? null,
      kindAt,
    });
    const material: TerrainMaterial | null = q.kindAt(-0.5, -0.5);
    expect(material).toBe("sable");
  });
});
