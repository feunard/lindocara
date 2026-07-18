import { describe, expect, it } from "vitest";
import { eraseTile, paintAutotile, resolveWholeLayer } from "../src/shared/tile-brush.js";
import { emptyLayer } from "../src/shared/tile-layer-codec.js";
import { decodeTileId } from "../src/shared/tileset.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET } from "../src/shared/tilesets/tiny-swords.js";

const GRASS = GRASS_SLOTS[0];
const set = TINY_SWORDS_TILESET;

function idAt(layer: { cols: number; ids: readonly number[] }, col: number, row: number): number {
  return layer.ids[row * layer.cols + col] ?? 0;
}

describe("the autotile brush", () => {
  it("paints a lone tile as the island variant", () => {
    const layer = paintAutotile(emptyLayer(5, 5), set, GRASS, 2, 2);
    expect(decodeTileId(idAt(layer, 2, 2))).toEqual({ kind: "autotile", slot: GRASS, variant: 0 });
  });

  it("re-resolves the neighbour it just joined", () => {
    let layer = paintAutotile(emptyLayer(5, 5), set, GRASS, 2, 2);
    layer = paintAutotile(layer, set, GRASS, 3, 2);
    // (2,2) now has an east neighbour: mask 2. (3,2) has a west neighbour: mask 8.
    expect(decodeTileId(idAt(layer, 2, 2))).toEqual({ kind: "autotile", slot: GRASS, variant: 2 });
    expect(decodeTileId(idAt(layer, 3, 2))).toEqual({ kind: "autotile", slot: GRASS, variant: 8 });
  });

  it("re-resolves the neighbours an erase orphaned", () => {
    let layer = paintAutotile(emptyLayer(5, 5), set, GRASS, 2, 2);
    layer = paintAutotile(layer, set, GRASS, 3, 2);
    layer = eraseTile(layer, set, 3, 2);
    expect(idAt(layer, 3, 2)).toBe(0);
    expect(decodeTileId(idAt(layer, 2, 2))).toEqual({ kind: "autotile", slot: GRASS, variant: 0 });
  });

  it("leaves a hand-placed fixed tile alone when a neighbour is repainted", () => {
    const base = emptyLayer(5, 5);
    const ids = [...base.ids];
    ids[2 * 5 + 2] = 1025;
    const layer = paintAutotile({ ...base, ids }, set, GRASS, 3, 2);
    expect(idAt(layer, 2, 2)).toBe(1025);
  });

  // The test that guards the whole frozen-variant design.
  it("matches a full recomputation after any sequence of paints and erases", () => {
    let layer = emptyLayer(8, 6);
    // mulberry32: a small, deterministic, decently-mixed PRNG. Two things this test tried first
    // and rejected, both discovered by deliberately breaking neighbour re-resolution and checking
    // this test still failed as it should:
    //  - The brief's plain `seed * 1103515245` overflows Number.MAX_SAFE_INTEGER within a few
    //    iterations; the resulting float precision loss made `next(4)` return 0 for 399 of 400
    //    steps, so the walk almost only erased an already-empty grid and painted one cell total.
    //  - Switching that multiply to `Math.imul` (a true 32-bit LCG) still failed: an LCG's low
    //    bits are short-period, and `% bound` reads exactly those bits, so the column sequence
    //    cycled through just 6 values in a fixed order and never produced enough adjacent pairs.
    // mulberry32 mixes high and low bits before returning, has no such weakness, and — checked
    // the same way — reliably fails within a handful of steps once neighbour resolution is
    // disabled.
    let seed = 12345;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const next = (bound: number): number => Math.floor(rand() * bound);
    for (let step = 0; step < 400; step += 1) {
      const col = next(8);
      const row = next(6);
      layer =
        next(4) === 0
          ? eraseTile(layer, set, col, row)
          : paintAutotile(layer, set, GRASS, col, row);
      expect(layer.ids).toEqual(resolveWholeLayer(layer, set).ids);
    }
  });
});
