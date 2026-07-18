import { describe, expect, it } from "vitest";
import { autotileVariantCount } from "../src/shared/autotile.js";
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
import { CLIFF_WALL_SLOT, TINY_SWORDS_TILESET } from "../src/shared/tilesets/tiny-swords.js";

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

  it("accepts every legal variant of a declared autotile", () => {
    // Bounded per slot's kind, not a flat sweep to `VARIANTS_PER_AUTOTILE`: `run4` (the cliff wall,
    // slot `CLIFF_WALL_SLOT`) only fills the first four of its reserved sixteen — see the "rejects"
    // case below for the other twelve.
    for (let slot = 0; slot < TINY_SWORDS_TILESET.autotiles.length; slot += 1) {
      const autotile = TINY_SWORDS_TILESET.autotiles[slot];
      const variants = autotile ? autotileVariantCount(autotile.kind) : VARIANTS_PER_AUTOTILE;
      for (let variant = 0; variant < variants; variant += 1) {
        expect(tileIdInTileset(TINY_SWORDS_TILESET, autotileId(slot, variant))).toBe(true);
      }
    }
  });

  it("rejects a run4 variant beyond its four legal masks", () => {
    // tiny-swords' cliff wall (CLIFF_WALL_SLOT) is `run4`: masks 0-3 are real, but the id space
    // reserves a full 16-wide block for every autotile, so ids naming variant 4..15 of this slot are
    // in-shape and pass every check that does not know the slot's *kind* — the exact hole that let
    // ids 53..64 reach `autotileOffset` and throw instead of being refused upstream.
    for (let variant = 4; variant < VARIANTS_PER_AUTOTILE; variant += 1) {
      expect(tileIdInTileset(TINY_SWORDS_TILESET, autotileId(CLIFF_WALL_SLOT, variant))).toBe(
        false,
      );
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
