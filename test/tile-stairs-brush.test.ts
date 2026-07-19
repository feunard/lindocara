import { describe, expect, it } from "vitest";
import { bakeCollision } from "../src/shared/map-data.js";
import { paintElevation, paintStairs } from "../src/shared/tile-brush.js";
import { emptyLayer, type TileLayer } from "../src/shared/tile-layer-codec.js";
import { kindAt } from "../src/shared/tilemap.js";
import { decodeTileId } from "../src/shared/tileset.js";
import {
  CLIFF_WALL_SLOT,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
} from "../src/shared/tilesets/tiny-swords.js";

const set = TINY_SWORDS_TILESET;
const blank = (): TileLayer[] => [emptyLayer(8, 6), emptyLayer(8, 6), emptyLayer(8, 6)];

function layerAt(layers: readonly TileLayer[], index: number): TileLayer {
  const layer = layers[index];
  if (!layer) throw new Error(`missing layer ${index}`);
  return layer;
}

function idAt(layer: { cols: number; ids: readonly number[] }, col: number, row: number): number {
  return layer.ids[row * layer.cols + col] ?? 0;
}

describe("the stairs stamp", () => {
  it("writes the four ramp tiles onto layer 1 and closes the wall row beside it", () => {
    // A wall row: raise ground level 1 across cols 1..4 at row 2, which drops a cliff face into
    // row 3 beneath it (`syncElevationWalls` always targets the row below what it just raised).
    let layers: TileLayer[] = blank();
    for (const col of [1, 2, 3, 4]) {
      layers = paintElevation(layers, set, 1, col, 2);
    }
    // Sanity: before the stamp, row 3 is one continuous run — left end (E only, mask 2), two
    // middle cells (W+E, mask 3), right end (W only, mask 1). See tile-elevation-brush.test.ts's
    // "joins adjacent walls into a horizontal run" for the same two-cell case.
    expect(decodeTileId(idAt(layerAt(layers, 1), 1, 3))).toEqual({
      kind: "autotile",
      slot: CLIFF_WALL_SLOT,
      variant: 2,
    });
    expect(decodeTileId(idAt(layerAt(layers, 1), 4, 3))).toEqual({
      kind: "autotile",
      slot: CLIFF_WALL_SLOT,
      variant: 1,
    });

    // The stamp: top-left at (2,2). It spans rows 2..3, so its bottom row lands exactly on the
    // wall row and overwrites cols 2-3 of it.
    const stamped = paintStairs(layers, set, 2, 2);

    expect(decodeTileId(idAt(layerAt(stamped, 1), 2, 2))).toEqual({ kind: "fixed", index: 0 });
    expect(decodeTileId(idAt(layerAt(stamped, 1), 2, 3))).toEqual({ kind: "fixed", index: 1 });
    expect(decodeTileId(idAt(layerAt(stamped, 1), 3, 2))).toEqual({ kind: "fixed", index: 2 });
    expect(decodeTileId(idAt(layerAt(stamped, 1), 3, 3))).toEqual({ kind: "fixed", index: 3 });

    // Layer 0 (ground) is untouched by the stamp — only layer 1 is a stairs brush's business.
    expect(decodeTileId(idAt(layerAt(stamped, 0), 2, 2)).kind).toBe("autotile");
    expect(decodeTileId(idAt(layerAt(stamped, 0), 3, 2)).kind).toBe("autotile");

    // The two surviving wall cells, (1,3) and (4,3), are no longer adjacent to each other — the
    // stamp replaced cols 2-3 with fixed tiles, and `slotAt` reads a fixed tile as -1, never a
    // same-slot match (the same rule `floodFill`'s "replaces exactly a fixed tile's one cell"
    // test relies on). So each loses the same-slot neighbour it used to have: (1,3)'s east
    // neighbour (2,3) is now fixed, dropping its E bit; (4,3)'s west neighbour (3,3) is now fixed,
    // dropping its W bit. Both masks derive to run4Mask's 0 (neither W nor E) — RUN4_LUT[0], "a
    // lone one-wide wall" — not the run-end variants they held before the stamp cut the run in two.
    expect(decodeTileId(idAt(layerAt(stamped, 1), 1, 3))).toEqual({
      kind: "autotile",
      slot: CLIFF_WALL_SLOT,
      variant: 0,
    });
    expect(decodeTileId(idAt(layerAt(stamped, 1), 4, 3))).toEqual({
      kind: "autotile",
      slot: CLIFF_WALL_SLOT,
      variant: 0,
    });
  });

  it("refuses a stamp that would fall off the right edge, same reference back", () => {
    const layers = blank();
    const result = paintStairs(layers, set, layers[0]?.cols ? layers[0].cols - 1 : 7, 2);
    expect(result).toBe(layers);
    // Nothing was written anywhere.
    expect(layerAt(result, 1).ids.every((id) => id === 0)).toBe(true);
  });

  it("leaves all four stamp cells intact when elevation is painted beside it", () => {
    const stamped = paintStairs(blank(), set, 2, 2);

    // Raising the ground directly above the stamp's top-left cell makes `syncElevationWalls` want
    // to drop a wall onto (2,2) — the row below what was just raised — but (2,2) is a fixed ramp
    // tile, and since Task 2 `syncWall` refuses to touch a fixed tile at all.
    const afterElevation = paintElevation(stamped, set, 1, 2, 1);

    expect(decodeTileId(idAt(layerAt(afterElevation, 0), 2, 1))).toEqual({
      kind: "autotile",
      slot: 1,
      variant: 0,
    });
    expect(decodeTileId(idAt(layerAt(afterElevation, 1), 2, 2))).toEqual({
      kind: "fixed",
      index: 0,
    });
    expect(decodeTileId(idAt(layerAt(afterElevation, 1), 2, 3))).toEqual({
      kind: "fixed",
      index: 1,
    });
    expect(decodeTileId(idAt(layerAt(afterElevation, 1), 3, 2))).toEqual({
      kind: "fixed",
      index: 2,
    });
    expect(decodeTileId(idAt(layerAt(afterElevation, 1), 3, 3))).toEqual({
      kind: "fixed",
      index: 3,
    });
  });

  it("bakes a stamp cell over a wall as walkable, and a remaining wall cell beside it as solid", () => {
    // A flat grass field (level 0 everywhere, so an empty-ground cell never reads as the baked
    // "water" void this test isn't about), then a level-1 drop across cols 1..4 at row 2, casting
    // a wall at row 3 exactly as in the first test above.
    let layers: TileLayer[] = blank();
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        layers = paintElevation(layers, set, 0, col, row);
      }
    }
    for (const col of [1, 2, 3, 4]) {
      layers = paintElevation(layers, set, 1, col, 2);
    }
    const stamped = paintStairs(layers, set, 2, 2);

    const baked = bakeCollision({
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: 8,
      rows: 6,
      layers: stamped,
      elements: [],
      spawn: { col: 0, row: 0 },
    });

    // "Ramps join levels" has no other observable than the bake: the two stamp cells that used to
    // be wall (the stamp's bottom row, (2,3) and (3,3)) are now walkable grass, not forest.
    expect(kindAt(baked, 2, 3)).toBe("grass");
    expect(kindAt(baked, 3, 3)).toBe("grass");
    // A wall cell beside the stamp, never touched by it, is still solid.
    expect(kindAt(baked, 1, 3)).toBe("forest");
  });
});
