import { stairsFixedIndex } from "@lindocara/engine/tile-brush.js";
import type { TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import {
  autotileId,
  EMPTY_TILE,
  fixedId,
  VARIANTS_PER_AUTOTILE,
} from "@lindocara/engine/tileset.js";
import {
  CLIFF_FACE_FIXED_BASE,
  CLIFF_FACE_FIXED_LEVEL_STRIDE,
  CLIFF_WALL_SLOT,
  GRASS_SLOTS,
  TINY_SWORDS_TILESET,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import { autotileSheetCell, tileDrawAt } from "@lindocara/renderer/tile-draw.js";
import { describe, expect, it } from "vitest";

/**
 * The per-cell autotile arithmetic, exercised directly rather than mirrored. It lives in
 * `tile-draw.ts` — the module the map editor's stage draws from too, so the two cannot index the
 * sheet differently. It used to be reached through `renderer.js`'s re-export; that file went with
 * the PixiJS path (S3, 2026-08-04) and this now imports from the definition.
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

  it("carries Tiny Swords' two native side-ramp sources", () => {
    const art = {
      east: { col: 0, rotationQuarterTurns: 0 },
      west: { col: 3, rotationQuarterTurns: 0 },
    } as const;
    for (const direction of ["east", "west"] as const) {
      for (const part of ["high", "low"] as const) {
        const draw = tileDrawAt(
          TINY_SWORDS_TILESET,
          layerOf(fixedId(stairsFixedIndex(direction, 0, part))),
          0,
          0,
        );
        expect(draw?.cell).toEqual({
          col: art[direction].col,
          row: part === "high" ? 4 : 5,
        });
        expect(draw?.rotationQuarterTurns).toBe(art[direction].rotationQuarterTurns);
      }
    }
  });

  it("uses the same two native side source cells at both supported transition elevations", () => {
    for (const part of ["high", "low"] as const) {
      const low = tileDrawAt(
        TINY_SWORDS_TILESET,
        layerOf(fixedId(stairsFixedIndex("east", 0, part))),
        0,
        0,
      );
      const raised = tileDrawAt(
        TINY_SWORDS_TILESET,
        layerOf(fixedId(stairsFixedIndex("east", 1, part))),
        0,
        0,
      );
      expect(low?.cell).toEqual({ col: 0, row: part === "high" ? 4 : 5 });
      expect(raised?.cell).toEqual(low?.cell);
      expect(low?.tint).toBe(0xffffff);
      expect(raised?.tint).toBe(TINY_SWORDS_TILESET.autotiles[GRASS_SLOTS[1]]?.tint);
    }
  });

  it("draws every blocking elevation face at both raised levels", () => {
    for (const levelOffset of [0, CLIFF_FACE_FIXED_LEVEL_STRIDE]) {
      for (const rotation of [0, 1, 2, 3] as const) {
        const index = CLIFF_FACE_FIXED_BASE + levelOffset + rotation;
        expect(tileDrawAt(TINY_SWORDS_TILESET, layerOf(fixedId(index)), 0, 0)).toMatchObject({
          rotationQuarterTurns: rotation,
          renderLevel: levelOffset === 0 ? 1 : 2,
        });
        expect(TINY_SWORDS_TILESET.fixed[index]?.passable).toBe(false);
      }
    }
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
    // (col=-1, row=1) is the seam a negative camera-relative `startX` computes:
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
    // An undeclared slot, against a SYNTHETIC tileset: tiny-swords now declares all 64 slots the
    // id space reserves (the sunken levels took the last twelve), so it no longer has one to spare
    // as a witness, and `autotileId(64, 0)` is `FIXED_BASE` rather than an undeclared autotile.
    const sparse = { ...TINY_SWORDS_TILESET, autotiles: TINY_SWORDS_TILESET.autotiles.slice(0, 2) };
    expect(tileDrawAt(sparse, layerOf(autotileId(5, 0)), 0, 0)).toBeNull();
  });
});
