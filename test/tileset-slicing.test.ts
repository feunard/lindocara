import { describe, expect, it } from "vitest";
import { autotileOffset } from "../src/shared/autotile.js";
import { decodeTileId, FIXED_BASE } from "../src/shared/tileset.js";
import {
  CLIFF_WALL_SLOT,
  GRASS_SLOTS,
  TINY_SWORDS_SHEET_COLS,
  TINY_SWORDS_SHEET_ROWS,
  TINY_SWORDS_TILESET,
} from "../src/shared/tilesets/tiny-swords.js";

/**
 * The arithmetic the renderer performs per cell, isolated so it can be asserted without Pixi.
 *
 * Shared arithmetic, so it lives in the workers suite rather than `test/ui/`: the UI project only
 * globs `*.test.tsx`, and this file imports nothing from the DOM.
 */
function sheetCell(id: number): { col: number; row: number } | null {
  const ref = decodeTileId(id);
  if (ref.kind !== "autotile") return null;
  const autotile = TINY_SWORDS_TILESET.autotiles[ref.slot];
  if (!autotile) return null;
  const offset = autotileOffset(autotile.kind, ref.variant);
  return { col: autotile.origin.col + offset.col, row: autotile.origin.row + offset.row };
}

/** The fixed half of the same decision: a fixed id names its cell outright. */
function fixedSheetCell(id: number): { col: number; row: number } | null {
  const ref = decodeTileId(id);
  if (ref.kind !== "fixed") return null;
  const fixed = TINY_SWORDS_TILESET.fixed[ref.index];
  if (!fixed) return null;
  return { col: fixed.col, row: fixed.row };
}

describe("resolving a frozen id to a sheet cell", () => {
  it("puts flat grass in the first group", () => {
    expect(sheetCell(1 + GRASS_SLOTS[0] * 16 + 15)).toEqual({ col: 1, row: 1 });
  });

  it("puts raised grass in the group at column five", () => {
    expect(sheetCell(1 + GRASS_SLOTS[1] * 16 + 15)).toEqual({ col: 6, row: 1 });
  });

  it("puts a cliff wall in the wall band at row four", () => {
    expect(sheetCell(1 + CLIFF_WALL_SLOT * 16 + 3)).toEqual({ col: 6, row: 4 });
  });

  it("stays inside the sheet for every declared slot and variant", () => {
    // The bound is what `sliceTilesetSheet` actually allocates: a cell outside it resolves to
    // `Texture.EMPTY` at draw time — a hole in the ground nothing else would report. The
    // `toBeGreaterThan(0)` guards keep an empty tileset from making the loops vacuous.
    expect(TINY_SWORDS_TILESET.autotiles.length).toBeGreaterThan(0);
    let checked = 0;
    for (let slot = 0; slot < TINY_SWORDS_TILESET.autotiles.length; slot += 1) {
      const autotile = TINY_SWORDS_TILESET.autotiles[slot];
      const variants = autotile?.kind === "run4" ? 4 : 16;
      for (let variant = 0; variant < variants; variant += 1) {
        const cell = sheetCell(1 + slot * 16 + variant);
        expect(cell).not.toBeNull();
        expect(cell?.col).toBeGreaterThanOrEqual(0);
        expect(cell?.row).toBeGreaterThanOrEqual(0);
        expect(cell?.col).toBeLessThan(TINY_SWORDS_SHEET_COLS);
        expect(cell?.row).toBeLessThan(TINY_SWORDS_SHEET_ROWS);
        checked += 1;
      }
    }
    expect(checked).toBe(52);
  });

  it("keeps every fixed tile inside the sheet too", () => {
    expect(TINY_SWORDS_TILESET.fixed.length).toBeGreaterThan(0);
    for (let index = 0; index < TINY_SWORDS_TILESET.fixed.length; index += 1) {
      const cell = fixedSheetCell(FIXED_BASE + index);
      expect(cell).not.toBeNull();
      expect(cell?.col).toBeGreaterThanOrEqual(0);
      expect(cell?.row).toBeGreaterThanOrEqual(0);
      expect(cell?.col).toBeLessThan(TINY_SWORDS_SHEET_COLS);
      expect(cell?.row).toBeLessThan(TINY_SWORDS_SHEET_ROWS);
    }
  });
});
