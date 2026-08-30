import { describe, expect, it } from "vitest";

import { undergroundLevelOcclusionRuns } from "../src/hd2d/underground.js";

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
});
