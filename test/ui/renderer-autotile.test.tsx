import type { TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { autotileId, EMPTY_TILE, VARIANTS_PER_AUTOTILE } from "@lindocara/engine/tileset.js";
import {
  CLIFF_WALL_SLOT,
  GRASS_SLOTS,
  TINY_SWORDS_TILESET,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";
import { autotileSheetCell } from "../../src/client/game/renderer.js";
import { tileDrawAt } from "../../src/client/game/tile-draw.js";

/**
 * `#paintLayeredCell`'s per-cell autotile arithmetic, exercised directly rather than mirrored: this
 * is the actual function the renderer calls, exported because it has no Pixi in it and needs none
 * to test. Lives under `test/ui/` rather than the workerd suite because importing `renderer.ts` at
 * all pulls in `pixi.js` and `client/i18n.ts`'s `localStorage` read, both of which need a DOM.
 */
describe("autotileSheetCell", () => {
  const cliffWall = TINY_SWORDS_TILESET.autotiles[CLIFF_WALL_SLOT];
  if (!cliffWall) throw new Error("fixture: tiny-swords lost its run4 cliff wall autotile");

  it("resolves every legal run4 variant to a sheet cell", () => {
    for (let variant = 0; variant < 4; variant += 1) {
      expect(autotileSheetCell(cliffWall, variant)).toBeDefined();
    }
  });

  it("degrades to undefined instead of throwing for a run4 variant its kind cannot produce", () => {
    // Ids 53..64 from the bug report: `1 + CLIFF_WALL_SLOT*16 + v` for v in 4..15. `tileIdInTileset`
    // (shared/tileset.ts) is supposed to keep these out of a saved map or a wire frame before they
    // ever get here — this proves the renderer's own arithmetic degrades on top of that, rather than
    // reaching `autotileOffset`'s throw, if a bad id ever reaches it anyway.
    for (let variant = 4; variant < VARIANTS_PER_AUTOTILE; variant += 1) {
      expect(() => autotileSheetCell(cliffWall, variant)).not.toThrow();
      expect(autotileSheetCell(cliffWall, variant)).toBeUndefined();
    }
  });
});

/**
 * `tileDrawAt` is the whole of the per-cell tile arithmetic, and both the world renderer and the
 * map editor stage now draw from it — the reason it lives in its own module is that two
 * hand-synchronised copies of it is how the editor and the game start disagreeing about what a map
 * looks like. These pin the answers both of them depend on.
 */
describe("tileDrawAt", () => {
  const cliffWall = TINY_SWORDS_TILESET.autotiles[CLIFF_WALL_SLOT];
  const raised = TINY_SWORDS_TILESET.autotiles[GRASS_SLOTS[1]];
  if (!cliffWall || !raised) throw new Error("fixture: tiny-swords lost a declared autotile");

  function layerOf(id: number): TileLayer {
    return { cols: 1, rows: 1, ids: [id] };
  }

  it("resolves an autotile id to its group origin plus the variant's offset", () => {
    // The cliff wall band starts at column 5, row 4. `run4` mask 0 is a lone one-wide wall, which
    // `RUN4_LUT` puts three cells along the band; mask 3 is the middle of a run, one cell along.
    // Spelled as literal sheet cells on purpose: recomputing the offset here would assert nothing.
    expect(cliffWall.origin).toEqual({ col: 5, row: 4 });
    expect(
      tileDrawAt(TINY_SWORDS_TILESET, layerOf(autotileId(CLIFF_WALL_SLOT, 0)), 0, 0)?.cell,
    ).toEqual({ col: 8, row: 4 });
    const middle = tileDrawAt(TINY_SWORDS_TILESET, layerOf(autotileId(CLIFF_WALL_SLOT, 3)), 0, 0);
    expect(middle?.cell).toEqual({ col: 6, row: 4 });
    expect(middle?.priority).toBe(cliffWall.priority);
  });

  it("carries the tileset entry's own tint, which is what makes raised ground read as height", () => {
    const draw = tileDrawAt(TINY_SWORDS_TILESET, layerOf(autotileId(GRASS_SLOTS[1], 0)), 0, 0);
    expect(draw?.tint).toBe(raised.tint);
    // Flat grass declares no tint and must draw untinted, not black.
    const flat = tileDrawAt(TINY_SWORDS_TILESET, layerOf(autotileId(GRASS_SLOTS[0], 0)), 0, 0);
    expect(flat?.tint).toBe(0xffffff);
  });

  it("draws nothing for an empty cell, an out-of-bounds cell or an undeclared slot", () => {
    expect(tileDrawAt(TINY_SWORDS_TILESET, layerOf(EMPTY_TILE), 0, 0)).toBeNull();
    // A column past the right edge must not wrap onto the next row's first cell, which is what a
    // bare `row * cols + col` does when nothing bounds `col`.
    const grid: TileLayer = {
      cols: 2,
      rows: 2,
      ids: [EMPTY_TILE, EMPTY_TILE, autotileId(GRASS_SLOTS[0], 0), EMPTY_TILE],
    };
    expect(tileDrawAt(TINY_SWORDS_TILESET, grid, 2, 0)).toBeNull();
    expect(tileDrawAt(TINY_SWORDS_TILESET, grid, 0, -1)).toBeNull();
    // (col=-1, row=1) is the seam `renderer.ts` computes from a negative camera-relative `startX`:
    // a bare `row * cols + col` folds it to index 1, which is *inside* the array and, on this grid,
    // non-empty — so without the `col < 0` guard this would silently return the previous row's tile
    // instead of nothing. `grid`'s own index 1 is EMPTY_TILE, which would pass either way, so this
    // needs its own fixture where the wrapped index actually resolves to a tile.
    const wrapGrid: TileLayer = {
      cols: 2,
      rows: 2,
      ids: [EMPTY_TILE, autotileId(GRASS_SLOTS[0], 0), EMPTY_TILE, EMPTY_TILE],
    };
    expect(tileDrawAt(TINY_SWORDS_TILESET, wrapGrid, -1, 1)).toBeNull();
    expect(tileDrawAt(TINY_SWORDS_TILESET, layerOf(autotileId(60, 0)), 0, 0)).toBeNull();
  });
});
