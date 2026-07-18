import { describe, expect, it } from "vitest";
import { autotileSheetCell } from "../../src/client/game/renderer.js";
import { VARIANTS_PER_AUTOTILE } from "../../src/shared/tileset.js";
import { CLIFF_WALL_SLOT, TINY_SWORDS_TILESET } from "../../src/shared/tilesets/tiny-swords.js";

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
