/**
 * A D1 map is grass and water and nothing else. It must still get the 4x4 autotiled rocky rim and
 * the animated shoreline foam that Verdant Reach has — a user map that draws as a flat two-colour
 * grid is a broken map, not a plain one.
 *
 * This should pass the moment it is written, and that is the point of writing it. `landMask` reads
 * only whether the four orthogonal neighbours are land; `needsFoam` reads only whether any of the
 * eight is water. Neither knows or cares where the `TileMap` came from. The cheapest way for this
 * requirement to break silently is for everyone to assume it holds because it holds for the zone it
 * was built against — so it is pinned against a map built by hand instead.
 */
import { describe, expect, it } from "vitest";
import { landMask, needsFoam } from "../src/client/game/autotile.js";
import { bakeCollision, type MapData } from "../src/shared/map-data.js";

/** A 4x3 grass island in open water — the shape every shoreline rule cares about. */
const ISLAND: MapData = {
  blocks: ["######", "#....#", "#....#", "#....#", "######"],
  elements: [],
  spawn: { col: 2, row: 2 },
};

describe("a D1 map's shoreline", () => {
  it("autotiles its edges instead of drawing one tile everywhere", () => {
    const tiles = bakeCollision(ISLAND);
    // An inland cell has land on all four sides...
    expect(landMask(tiles, 2, 2)).toBe(0b1111);
    // ...and the island's edges do not. If every cell returned the same mask the autotiler would
    // draw one tile across the whole island and there would be no rim at all.
    expect(landMask(tiles, 1, 1)).not.toBe(0b1111);
    const masks = new Set<number>();
    for (let row = 1; row <= 3; row++) {
      for (let col = 1; col <= 4; col++) masks.add(landMask(tiles, col, row));
    }
    expect(masks.size).toBeGreaterThan(1);
  });

  it("foams the shore, but not the middle of the island or the open water", () => {
    const tiles = bakeCollision(ISLAND);
    let foamed = 0;
    for (let row = 0; row < tiles.rows; row++) {
      for (let col = 0; col < tiles.cols; col++) if (needsFoam(tiles, col, row)) foamed++;
    }
    // 12 land cells, of which exactly two — (2,2) and (3,2) — have all eight neighbours on land.
    // Those are inland and must NOT foam: foam under a cell surrounded by ground is overdraw the
    // ground hides anyway, and a forest's worth of it is not free.
    expect(needsFoam(tiles, 2, 2)).toBe(false);
    expect(needsFoam(tiles, 3, 2)).toBe(false);
    expect(foamed).toBe(10);
    // Water never foams: the blob is drawn under land and clipped by it, so foam on the open sea
    // would be a bright pill floating in the middle of nothing.
    expect(needsFoam(tiles, 0, 0)).toBe(false);
    expect(needsFoam(tiles, 5, 4)).toBe(false);
  });

  it("still foams a coast when a tree is standing on it", () => {
    // A baked tree is `forest` — land. It must not punch a hole in the shoreline.
    const tiles = bakeCollision({
      ...ISLAND,
      elements: [{ col: 1, row: 1, kind: "tree", variant: 0 }],
    });
    expect(needsFoam(tiles, 1, 1)).toBe(true);
    expect(landMask(tiles, 2, 2)).toBe(0b1111);
  });
});
