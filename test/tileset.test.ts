import { describe, expect, it } from "vitest";
import {
  AUTOTILE_SLOTS,
  autotileId,
  decodeTileId,
  EMPTY_TILE,
  FIXED_BASE,
  fixedId,
  VARIANTS_PER_AUTOTILE,
} from "../src/shared/tileset.js";

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
