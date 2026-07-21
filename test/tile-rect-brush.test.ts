import { eraseRect, paintRectAutotile, resolveWholeLayer } from "@lindocara/engine/tile-brush.js";
import { emptyLayer } from "@lindocara/engine/tile-layer-codec.js";
import { decodeTileId } from "@lindocara/engine/tileset.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET } from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

const GRASS = GRASS_SLOTS[0];
const set = TINY_SWORDS_TILESET;

function idAt(layer: { cols: number; ids: readonly number[] }, col: number, row: number): number {
  return layer.ids[row * layer.cols + col] ?? 0;
}

function variantAt(
  layer: { cols: number; ids: readonly number[] },
  col: number,
  row: number,
): number {
  const ref = decodeTileId(idAt(layer, col, row));
  return ref.kind === "autotile" ? ref.variant : -1;
}

describe("the rectangle autotile brush", () => {
  // Corners (1,1)-(4,3): 4 columns x 3 rows, i.e. a "3x2" rectangle by delta (c1-c0=3, r1-r0=2).
  // Big enough that the middle row has cells with a same-slot neighbour on all four sides.
  it("paints a filled rectangle with edge16 variants matching each cell's position", () => {
    const layer = paintRectAutotile(emptyLayer(8, 6), set, GRASS, 1, 1, 4, 3);

    // Interior: row 2, cols 2-3 each have all four neighbours in the rect. N=1,E=2,S=4,W=8 -> 15.
    expect(variantAt(layer, 2, 2)).toBe(15);
    expect(variantAt(layer, 3, 2)).toBe(15);

    // Corners: only the two in-rect sides contribute.
    expect(variantAt(layer, 1, 1)).toBe(6); // top-left: E+S = 2+4
    expect(variantAt(layer, 4, 1)).toBe(12); // top-right: S+W = 4+8
    expect(variantAt(layer, 1, 3)).toBe(3); // bottom-left: N+E = 1+2
    expect(variantAt(layer, 4, 3)).toBe(9); // bottom-right: N+W = 1+8

    // Edges: three in-rect sides contribute.
    expect(variantAt(layer, 2, 1)).toBe(14); // top edge: E+S+W = 2+4+8
    expect(variantAt(layer, 3, 1)).toBe(14); // top edge
    expect(variantAt(layer, 1, 2)).toBe(7); // left edge: N+E+S = 1+2+4
    expect(variantAt(layer, 4, 2)).toBe(13); // right edge: N+S+W = 1+4+8

    // Nothing painted outside the rect's one-cell border.
    expect(idAt(layer, 0, 0)).toBe(0);
    expect(idAt(layer, 5, 4)).toBe(0);
  });

  it("clamps a rect flush against col 0 without wrapping into the previous row", () => {
    // c0 = -2 clamps to 0. If the write ever computed a raw (possibly negative) column offset
    // into the flat ids array instead of clamping per-row, this would spill into the tail of
    // row 1 instead of being cut off at the left edge of row 2.
    const layer = paintRectAutotile(emptyLayer(8, 6), set, GRASS, -2, 2, 1, 3);

    expect(layer.ids).toHaveLength(48);
    // End of the row above the rect: untouched.
    expect(idAt(layer, 7, 1)).toBe(0);
    // Left edge of the rect, flush at col 0: no west neighbour, so no W bit.
    expect(variantAt(layer, 0, 2)).toBe(6); // top-left corner: E+S = 2+4
    expect(variantAt(layer, 0, 3)).toBe(3); // bottom-left corner: N+E = 1+2
    // Rect's own right edge (col 1) still resolves normally.
    expect(variantAt(layer, 1, 2)).toBe(12); // top-right corner: S+W = 4+8
  });

  it("treats corners given in either order identically", () => {
    const forward = paintRectAutotile(emptyLayer(8, 6), set, GRASS, 1, 1, 4, 3);
    const backward = paintRectAutotile(emptyLayer(8, 6), set, GRASS, 4, 3, 1, 1);
    expect(backward.ids).toEqual(forward.ids);
  });

  it("returns the same reference when the region clamps away entirely", () => {
    const layer = emptyLayer(8, 6);
    // Fully off the west edge: clamped c0..c1 would be empty.
    expect(paintRectAutotile(layer, set, GRASS, -5, 0, -1, 2)).toBe(layer);
    expect(eraseRect(layer, set, -5, 0, -1, 2)).toBe(layer);
  });

  it("overwrites a fixed tile inside the region, unlike ambient wall upkeep", () => {
    const base = emptyLayer(8, 6);
    const ids = [...base.ids];
    ids[2 * 8 + 2] = 1025; // a hand-placed fixed tile at (2,2), inside the rect below
    const layer = paintRectAutotile({ ...base, ids }, set, GRASS, 1, 1, 4, 3);
    // The rect is explicit intent: the fixed tile is gone, replaced by the autotile.
    expect(decodeTileId(idAt(layer, 2, 2)).kind).toBe("autotile");
  });

  it("leaves the layer and tileset it was given untouched", () => {
    const layer = emptyLayer(8, 6);
    const snapshot = [...layer.ids];
    paintRectAutotile(layer, set, GRASS, 1, 1, 4, 3);
    expect(layer.ids).toEqual(snapshot);
  });

  // The oracle: incremental rect painting/erasing must never disagree with a full recomputation.
  // mulberry32, not a hand-rolled LCG — see test/tile-brush.test.ts for why the LCG degenerated.
  it("matches a full recomputation after any sequence of random rects and erases", () => {
    let layer = emptyLayer(8, 6);
    let seed = 987654321;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const next = (bound: number): number => Math.floor(rand() * bound);
    for (let step = 0; step < 200; step += 1) {
      const c0 = next(8);
      const r0 = next(6);
      const c1 = next(8);
      const r1 = next(6);
      layer =
        next(4) === 0
          ? eraseRect(layer, set, c0, r0, c1, r1)
          : paintRectAutotile(layer, set, GRASS, c0, r0, c1, r1);
      expect(layer.ids).toEqual(resolveWholeLayer(layer, set).ids);
    }
  });
});
