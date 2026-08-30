import { describe, expect, it } from "vitest";

import {
  surfaceLiquidOcclusionRuns,
  undergroundLevelOcclusionRuns,
  undergroundPreviewDepths,
} from "../src/hd2d/underground.js";

describe("underground storey visibility mask", () => {
  const map = {
    size: 5,
    underground: {
      levels: [],
      stairs: [
        {
          depth: 3,
          fromDepth: 2,
          col: 1,
          row: 1,
          direction: "east" as const,
          length: 2,
          width: 1,
        },
      ],
      shafts: [{ col: 4, row: 4, width: 1, length: 1, depth: 4 }],
    },
  };

  const covered = (depth: number): Set<string> => {
    const cells = new Set<string>();
    for (const run of undergroundLevelOcclusionRuns(map, depth)) {
      for (let col = run.col; col < run.col + run.length; col += 1) {
        cells.add(`${col}:${run.row}`);
      }
    }
    return cells;
  };

  it("reveals only the stair and shaft footprints toward the next floor", () => {
    const depthTwo = covered(2);
    expect(depthTwo.size).toBe(22);
    expect(depthTwo.has("1:1")).toBe(false);
    expect(depthTwo.has("2:1")).toBe(false);
    expect(depthTwo.has("4:4")).toBe(false);
    expect(depthTwo.has("0:0")).toBe(true);
  });

  it("keeps an unrelated deeper stair hidden while preserving a vertical shaft", () => {
    const depthOne = covered(1);
    expect(depthOne.size).toBe(24);
    expect(depthOne.has("1:1")).toBe(true);
    expect(depthOne.has("2:1")).toBe(true);
    expect(depthOne.has("4:4")).toBe(false);
  });

  it("reveals a lower shaft only from its authored starting basement", () => {
    const lowerMap = {
      size: 5,
      underground: {
        levels: [],
        stairs: [],
        shafts: [{ col: 3, row: 3, width: 1, length: 1, fromDepth: 1, depth: 2 }],
      },
    };
    const surface = new Set(
      undergroundLevelOcclusionRuns(lowerMap, 0).flatMap((run) =>
        Array.from({ length: run.length }, (_unused, offset) => `${run.col + offset}:${run.row}`),
      ),
    );
    const basement = new Set(
      undergroundLevelOcclusionRuns(lowerMap, 1).flatMap((run) =>
        Array.from({ length: run.length }, (_unused, offset) => `${run.col + offset}:${run.row}`),
      ),
    );
    expect(surface.has("3:3")).toBe(true);
    expect(basement.has("3:3")).toBe(false);
  });

  it("opens an upper floor only above its real staircase footprint", () => {
    const upperMap = {
      size: 5,
      underground: {
        levels: [],
        stairs: [
          {
            depth: 0,
            fromDepth: -1,
            col: 1,
            row: 1,
            direction: "east" as const,
            length: 2,
            width: 1,
          },
        ],
      },
    };
    const covered = new Set<string>();
    for (const run of undergroundLevelOcclusionRuns(upperMap, -1)) {
      for (let col = run.col; col < run.col + run.length; col += 1) {
        covered.add(`${col}:${run.row}`);
      }
    }

    expect(covered.size).toBe(23);
    expect(covered.has("1:1")).toBe(false);
    expect(covered.has("2:1")).toBe(false);
    expect(covered.has("0:0")).toBe(true);
  });

  it("does not let an upper-floor cutaway cover the ground-floor editing view", () => {
    const vertical = {
      levels: [],
      stairs: [
        {
          depth: 1,
          fromDepth: 0,
          col: 0,
          row: 0,
          direction: "east" as const,
          length: 2,
          width: 1,
        },
        {
          depth: 0,
          fromDepth: -1,
          col: 2,
          row: 2,
          direction: "east" as const,
          length: 2,
          width: 1,
        },
      ],
    };

    expect(undergroundPreviewDepths(vertical, null)).toEqual([1]);
    expect(undergroundPreviewDepths(vertical, -1)).toEqual([-1]);
  });

  it("occludes basements below water without closing real surface accesses", () => {
    const size = 4;
    const liquids = new Array<"water" | null>(size * size).fill("water");
    const runs = surfaceLiquidOcclusionRuns({
      size,
      levels: new Array<null>(size * size).fill(null),
      liquids,
      liquidLevels: new Array<number | null>(size * size).fill(null),
      levelHeight: 0.9,
      waterLevel: -0.05,
      underground: {
        levels: [],
        stairs: [
          {
            depth: 1,
            fromDepth: 0,
            col: 1,
            row: 1,
            direction: "east",
            length: 1,
            width: 1,
          },
        ],
        shafts: [{ col: 2, row: 2, width: 1, length: 1, depth: 2 }],
      },
    });
    const covered = new Set<string>();
    for (const run of runs) {
      expect(run.y).toBe(-0.05);
      for (let col = run.col; col < run.col + run.length; col += 1)
        covered.add(`${col}:${run.row}`);
    }

    expect(covered.size).toBe(14);
    expect(covered.has("1:1")).toBe(false);
    expect(covered.has("2:2")).toBe(false);
  });
});
