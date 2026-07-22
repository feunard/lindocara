import { TILE_KINDS, type TileKind, type TileMap } from "@lindocara/engine/tilemap.js";
import {
  AUTOTILE_LUT,
  landMask,
  landTile,
  needsFoam,
  tileVisual,
} from "@lindocara/renderer/autotile.js";
import { describe, expect, it } from "vitest";

function map(rows: string[]): TileMap {
  const kinds: TileKind[] = [];
  for (const row of rows) {
    for (const char of row) kinds.push(char === "." ? "grass" : "water");
  }
  const first = rows[0];
  if (first === undefined) throw new Error("no rows");
  return { cols: first.length, rows: rows.length, kinds };
}

describe("shoreline foam", () => {
  it("rings a lone island", () => {
    expect(needsFoam(map(["###", "#.#", "###"]), 1, 1)).toBe(true);
  });

  it("never puts foam on open water", () => {
    // The blob is drawn under land and clipped by it. Water asking for foam would paint a blob
    // with nothing on top to cut it back, which is a bright pill floating in the sea.
    expect(needsFoam(map(["###", "###", "###"]), 1, 1)).toBe(false);
  });

  it("skips land buried inside a landmass", () => {
    expect(needsFoam(map(["...", "...", "..."]), 1, 1)).toBe(false);
  });

  it("foams a tile whose only water neighbour is diagonal", () => {
    // The regression this exists for: the blob bleeds ~9px past the tile on every side, so a
    // diagonal step in a coastline shows water in the corner. Checking only the four orthogonals
    // (as landMask does) leaves a bite missing there.
    const m = map(["#..", "...", "..."]);
    expect(landMask(m, 1, 1)).toBe(0b1111);
    expect(needsFoam(m, 1, 1)).toBe(true);
  });

  it("foams land running off the edge of the map", () => {
    // Off-map reads as water, so a coast at the border is still a coast.
    expect(needsFoam(map(["...", "...", "..."]), 0, 0)).toBe(true);
  });
});

describe("the land mask", () => {
  // N=1, E=2, S=4, W=8. A bit is set when that neighbour is land.
  it("reads its four orthogonal neighbours", () => {
    const m = map(["###", "#..", "###"]);
    // centre cell (1,1): E is land, everything else is water.
    expect(landMask(m, 1, 1)).toBe(2);
  });

  it("isolates North: only N is land", () => {
    const m = map(["#.#", "#.#", "###"]);
    // centre cell (1,1): N at (1,0) is land, everything else is water
    expect(landMask(m, 1, 1)).toBe(1);
  });

  it("isolates South: only S is land", () => {
    const m = map(["###", "#.#", "#.#"]);
    // centre cell (1,1): S at (1,2) is land, everything else is water
    expect(landMask(m, 1, 1)).toBe(4);
  });

  it("isolates West: only W is land", () => {
    const m = map(["###", "..#", "###"]);
    // centre cell (1,1): W at (0,1) is land, everything else is water
    expect(landMask(m, 1, 1)).toBe(8);
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

describe("tileVisual", () => {
  // The forcing function this whole table exists for: TILE_KINDS is the same array TileKind is
  // derived from, so this loop cannot silently go stale the way a hand-copied list of kinds could.
  it("has an explicit visual treatment for every tile kind the renderer can encounter", () => {
    for (const kind of TILE_KINDS) {
      expect(() => tileVisual(kind), `no treatment for "${kind}"`).not.toThrow();
    }
    expect(tileVisual("water")).toBe("water");
    // Nothing emits plateau or bridge yet, but the day something does, this line is the record
    // that they were decided to look like land — not `isLandKind`'s catch-all agreeing by luck.
    expect(tileVisual("plateau")).toBe("land");
    expect(tileVisual("bridge")).toBe("land");
  });

  it("fails loudly instead of falling through to grass for a kind with no treatment", () => {
    expect(() => tileVisual("lava" as TileKind)).toThrow(/no visual treatment/);
  });
});
