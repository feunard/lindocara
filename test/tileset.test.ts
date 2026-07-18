import { describe, expect, it } from "vitest";
import {
  AUTOTILE_SLOTS,
  autotileId,
  decodeTileId,
  EMPTY_TILE,
  FIXED_BASE,
  fixedId,
  tileIdInTileset,
  VARIANTS_PER_AUTOTILE,
} from "../src/shared/tileset.js";
import { TINY_SWORDS_TILESET } from "../src/shared/tilesets/tiny-swords.js";

describe("tile id space", () => {
  it("reserves zero for an empty cell", () => {
    expect(EMPTY_TILE).toBe(0);
    expect(decodeTileId(EMPTY_TILE)).toEqual({ kind: "empty" });
  });

  it("packs an autotile slot and variant into one id", () => {
    expect(autotileId(0, 0)).toBe(1);
    expect(autotileId(0, 15)).toBe(16);
    expect(autotileId(1, 0)).toBe(17);
  });

  it("round-trips every autotile slot and variant", () => {
    for (let slot = 0; slot < AUTOTILE_SLOTS; slot += 1) {
      for (let variant = 0; variant < VARIANTS_PER_AUTOTILE; variant += 1) {
        expect(decodeTileId(autotileId(slot, variant))).toEqual({
          kind: "autotile",
          slot,
          variant,
        });
      }
    }
  });

  it("starts fixed tiles above the whole autotile space", () => {
    expect(FIXED_BASE).toBe(1 + AUTOTILE_SLOTS * VARIANTS_PER_AUTOTILE);
    expect(fixedId(0)).toBe(FIXED_BASE);
    expect(decodeTileId(fixedId(7))).toEqual({ kind: "fixed", index: 7 });
  });

  it("reads a negative or fractional id as empty rather than throwing", () => {
    expect(decodeTileId(-1)).toEqual({ kind: "empty" });
    expect(decodeTileId(1.5)).toEqual({ kind: "empty" });
  });
});

describe("tileIdInTileset", () => {
  it("accepts the empty tile regardless of what the tileset declares", () => {
    expect(tileIdInTileset(TINY_SWORDS_TILESET, EMPTY_TILE)).toBe(true);
  });

  it("accepts every slot and variant of a declared autotile", () => {
    for (let slot = 0; slot < TINY_SWORDS_TILESET.autotiles.length; slot += 1) {
      for (let variant = 0; variant < VARIANTS_PER_AUTOTILE; variant += 1) {
        expect(tileIdInTileset(TINY_SWORDS_TILESET, autotileId(slot, variant))).toBe(true);
      }
    }
  });

  it("accepts every declared fixed-tile index", () => {
    for (let index = 0; index < TINY_SWORDS_TILESET.fixed.length; index += 1) {
      expect(tileIdInTileset(TINY_SWORDS_TILESET, fixedId(index))).toBe(true);
    }
  });

  it("rejects an autotile slot the tileset does not declare", () => {
    // tiny-swords ships 4 autotiles (slots 0-3); slot 4 is in-shape for the id space but
    // unresolvable against this tileset.
    expect(
      tileIdInTileset(TINY_SWORDS_TILESET, autotileId(TINY_SWORDS_TILESET.autotiles.length, 0)),
    ).toBe(false);
  });

  it("rejects a fixed-tile index the tileset does not declare", () => {
    expect(tileIdInTileset(TINY_SWORDS_TILESET, fixedId(TINY_SWORDS_TILESET.fixed.length))).toBe(
      false,
    );
  });

  it("rejects an id nowhere near either declared range", () => {
    expect(tileIdInTileset(TINY_SWORDS_TILESET, 9999)).toBe(false);
    expect(tileIdInTileset(TINY_SWORDS_TILESET, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});
