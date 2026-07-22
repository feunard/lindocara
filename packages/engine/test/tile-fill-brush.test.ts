import {
  eraseRect,
  floodFill,
  paintRectAutotile,
  resolveWholeLayer,
} from "@lindocara/engine/tile-brush.js";
import { emptyLayer } from "@lindocara/engine/tile-layer-codec.js";
import { decodeTileId, EMPTY_TILE, fixedId } from "@lindocara/engine/tileset.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET } from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

const GRASS = GRASS_SLOTS[0];
const GRASS_2 = GRASS_SLOTS[1];
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

describe("the flood fill brush", () => {
  it("fills exactly a donut's hole and re-resolves the ring's inner edge", () => {
    // Outer 6x6 grass block on an 8x8 layer, cols/rows 1..6, leaving a 1-cell empty border.
    const outer = paintRectAutotile(emptyLayer(8, 8), set, GRASS, 1, 1, 6, 6);
    // A 2x2 hole punched in the middle: cols 3-4, rows 3-4. eraseRect re-resolves the ring's inner
    // edge around it, giving a real ring rather than a block with untouched stale edges.
    const ring = eraseRect(outer, set, 3, 3, 4, 4);

    // Before the fill, (3,2) sits just north of the hole: N/E/W neighbours are ring grass, S is the
    // hole (empty), so its edge16 mask is N(1)+E(2)+W(8) = 11. (2,3) sits just west of the hole:
    // N/S/W are ring grass, E is the hole, mask N(1)+S(4)+W(8) = 13.
    expect(variantAt(ring, 3, 2)).toBe(11);
    expect(variantAt(ring, 2, 3)).toBe(13);

    const filled = floodFill(ring, set, GRASS, 3, 3);

    // Exactly the hole's 4 cells changed from empty to filled — the ring's inner edge also changes
    // (its variant re-resolves), but diffing "was empty, now isn't" isolates the hole specifically.
    let changedFromEmpty = 0;
    for (let row = 0; row < ring.rows; row += 1) {
      for (let col = 0; col < ring.cols; col += 1) {
        if (idAt(ring, col, row) === EMPTY_TILE && idAt(filled, col, row) !== EMPTY_TILE) {
          changedFromEmpty += 1;
        }
      }
    }
    expect(changedFromEmpty).toBe(4);
    for (const [col, row] of [
      [3, 3],
      [3, 4],
      [4, 3],
      [4, 4],
    ] as const) {
      expect(idAt(ring, col, row)).toBe(EMPTY_TILE);
      expect(decodeTileId(idAt(filled, col, row))).toEqual({
        kind: "autotile",
        slot: GRASS,
        variant: 15,
      });
    }

    // The ring's inner edge closes around the now-filled hole: every side neighbour that used to
    // face empty space now faces grass, so both cells become fully interior — hand-computed
    // N+E+S+W = 1+2+4+8 = 15.
    expect(variantAt(filled, 3, 2)).toBe(15);
    expect(variantAt(filled, 2, 3)).toBe(15);
  });

  it("does not leak into the hole when filling the donut's outside", () => {
    const outer = paintRectAutotile(emptyLayer(8, 8), set, GRASS, 1, 1, 6, 6);
    const ring = eraseRect(outer, set, 3, 3, 4, 4);

    // The hole is fully enclosed by the ring, so it is a separate empty region from the outside
    // border. Filling from a corner must never reach it.
    const filled = floodFill(ring, set, GRASS_2, 0, 0);

    for (const [col, row] of [
      [3, 3],
      [3, 4],
      [4, 3],
      [4, 4],
    ] as const) {
      expect(idAt(filled, col, row)).toBe(EMPTY_TILE);
    }
    // The outside itself did get filled, confirming the fill actually ran.
    expect(decodeTileId(idAt(filled, 0, 0)).kind).toBe("autotile");
  });

  it("completes on a 100x100 uniform empty layer and matches a full recomputation", () => {
    // The safety cap inside floodRegion (4 * cells) is what stands between a broken visited-set and
    // an actual process hang here — a synchronous infinite loop cannot be preempted by a test
    // timeout, so the cap has to live in the algorithm itself. See mutation proof (a).
    const layer = emptyLayer(100, 100);
    const filled = floodFill(layer, set, GRASS, 50, 50);

    // Fully connected empty layer: the fill must reach every cell, not stop partway.
    expect(filled.ids.every((id) => id !== EMPTY_TILE)).toBe(true);
    expect(filled.ids).toEqual(resolveWholeLayer(filled, set).ids);
  });

  it("returns the same reference when filling a region with its own slot", () => {
    const ring = eraseRect(
      paintRectAutotile(emptyLayer(8, 8), set, GRASS, 1, 1, 6, 6),
      set,
      3,
      3,
      4,
      4,
    );
    expect(floodFill(ring, set, GRASS, 1, 1)).toBe(ring);
    // Filling empty with any slot is never a no-op, even though it "does nothing" in the sense of
    // not changing which slot occupies the region conceptually — empty is not a slot.
    expect(floodFill(ring, set, GRASS, 3, 3)).not.toBe(ring);
  });

  it("replaces exactly a fixed tile's one cell and re-resolves the grass around it", () => {
    const base = paintRectAutotile(emptyLayer(5, 5), set, GRASS, 0, 0, 4, 4);
    const ids = [...base.ids];
    ids[2 * 5 + 2] = fixedId(0); // hand-placed fixed tile at the centre, (2,2)
    const withFixed = { ...base, ids };

    const filled = floodFill(withFixed, set, GRASS_2, 2, 2);

    expect(decodeTileId(idAt(filled, 2, 2))).toEqual({
      kind: "autotile",
      slot: GRASS_2,
      variant: 0,
    });
    // The four neighbours stay grass slot 0, not the fixed tile's replacement slot.
    for (const [col, row] of [
      [2, 1],
      [3, 2],
      [2, 3],
      [1, 2],
    ] as const) {
      expect(decodeTileId(idAt(filled, col, row)).kind).toBe("autotile");
      expect((decodeTileId(idAt(filled, col, row)) as { slot: number }).slot).toBe(GRASS);
    }
    // North neighbour (2,1): its other three sides are still grass, but south now faces a
    // different slot, so that bit drops — hand-computed N+E+W = 1+2+8 = 11.
    expect(variantAt(filled, 2, 1)).toBe(11);
    // West neighbour (1,2): its east side faces the replaced cell — hand-computed N+S+W = 1+4+8 = 13.
    expect(variantAt(filled, 1, 2)).toBe(13);
  });

  it("does not spread a fixed-tile region through an adjacent fixed tile of the same index", () => {
    const base = paintRectAutotile(emptyLayer(5, 5), set, GRASS, 0, 0, 4, 4);
    const ids = [...base.ids];
    ids[2 * 5 + 2] = fixedId(0); // (2,2)
    ids[2 * 5 + 3] = fixedId(0); // (3,2), same fixed index, orthogonally adjacent
    const withFixed = { ...base, ids };

    const filled = floodFill(withFixed, set, GRASS_2, 2, 2);

    expect(decodeTileId(idAt(filled, 2, 2))).toEqual({
      kind: "autotile",
      slot: GRASS_2,
      variant: 0,
    });
    // The neighbouring fixed tile must survive untouched — a shared fixed index is not a shared
    // region. If the fixed-tile rule ever grew to treat all fixed tiles as one region, this would
    // wrongly turn into GRASS_2 as well.
    expect(decodeTileId(idAt(filled, 3, 2))).toEqual({ kind: "fixed", index: 0 });
  });

  // The oracle: incremental rects, erases and fills must never disagree with a full recomputation.
  // mulberry32, matching test/tile-rect-brush.test.ts's PRNG and the reasons a hand-rolled LCG was
  // rejected there.
  it("matches a full recomputation after any sequence of random rects, erases and fills", () => {
    let layer = emptyLayer(8, 6);
    let seed = 555444333;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const next = (bound: number): number => Math.floor(rand() * bound);
    for (let step = 0; step < 200; step += 1) {
      const kind = next(5);
      if (kind === 0) {
        layer = eraseRect(layer, set, next(8), next(6), next(8), next(6));
      } else if (kind === 1) {
        layer = floodFill(layer, set, GRASS, next(8), next(6));
      } else {
        layer = paintRectAutotile(layer, set, GRASS, next(8), next(6), next(8), next(6));
      }
      expect(layer.ids).toEqual(resolveWholeLayer(layer, set).ids);
    }
  });
});
