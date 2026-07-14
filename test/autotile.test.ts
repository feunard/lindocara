import { describe, expect, it } from "vitest";
import { AUTOTILE_LUT, landMask, landTile } from "../src/client/game/autotile.js";
import type { TileKind, TileMap } from "../src/shared/tilemap.js";

function map(rows: string[]): TileMap {
  const kinds: TileKind[] = [];
  for (const row of rows) {
    for (const char of row) kinds.push(char === "." ? "grass" : "water");
  }
  const first = rows[0];
  if (first === undefined) throw new Error("no rows");
  return { cols: first.length, rows: rows.length, kinds };
}

describe("the land mask", () => {
  // N=1, E=2, S=4, W=8. A bit is set when that neighbour is land.
  it("reads its four orthogonal neighbours", () => {
    const m = map(["###", "#..", "###"]);
    // centre cell (1,1): E is land, everything else is water.
    expect(landMask(m, 1, 1)).toBe(2);
  });

  it("treats everything off the map as water, so the world's edge is a shoreline", () => {
    const m = map(["."]);
    expect(landMask(m, 0, 0)).toBe(0);
  });

  it("sees a cell surrounded by land as fully enclosed", () => {
    const m = map(["...", "...", "..."]);
    expect(landMask(m, 1, 1)).toBe(15);
  });

  // A forest is land. The rocky rim must NOT be drawn along a treeline, or every forest would
  // look like an island.
  it("counts a forest as land, not as a shoreline", () => {
    const m: TileMap = { cols: 3, rows: 1, kinds: ["grass", "forest", "water"] };
    expect(landMask(m, 0, 0)).toBe(2); // E (the forest) is land
  });
});

describe("the autotile table", () => {
  it("has exactly one tile for each of the 16 neighbourhoods", () => {
    expect(AUTOTILE_LUT).toHaveLength(16);
    for (let mask = 0; mask < 16; mask++) {
      const tile = AUTOTILE_LUT[mask];
      expect(tile, `mask ${mask} has no tile`).toBeDefined();
    }
  });

  // These four pin the table against the actual Tiny Swords sheet layout. Get one wrong and the
  // whole world renders with its edges inside out.
  it("maps the neighbourhood to the right cell of the sheet", () => {
    expect(AUTOTILE_LUT[15]).toEqual({ col: 1, row: 1 }); // surrounded: the plain fill
    expect(AUTOTILE_LUT[0]).toEqual({ col: 3, row: 3 }); // alone: an island of one tile
    expect(AUTOTILE_LUT[6]).toEqual({ col: 0, row: 0 }); // land E+S only: a top-left corner
    expect(AUTOTILE_LUT[14]).toEqual({ col: 1, row: 0 }); // land E+S+W, no N: a top edge
    expect(AUTOTILE_LUT[7]).toEqual({ col: 0, row: 1 }); // land N+E+S, no W: a left edge
  });

  it("picks a tile straight from a map", () => {
    const m = map(["###", "#..", "###"]);
    expect(landTile(m, 1, 1)).toEqual(AUTOTILE_LUT[2]);
  });
});
