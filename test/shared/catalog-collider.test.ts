import { describe, expect, it } from "vitest";
import { CURATED_EDITOR_ASSET_IDS, editorAsset } from "../../src/shared/tiny-swords-catalog.js";

describe("catalogue colliders", () => {
  it("gives the curated tree a trunk collider, not a whole cell", () => {
    const tree = editorAsset("resource.terrain-resources-wood-trees.tree3");
    const collider = tree?.editor.collider;
    expect(collider).toBeDefined();
    if (!collider) return;
    expect(collider.width).toBeGreaterThan(0);
    expect(collider.width).toBeLessThan(64);
    expect(collider.height).toBeLessThan(64);
  });

  it("leaves the curated bush non-colliding, as before", () => {
    const bush = editorAsset("decoration.terrain-decorations-bushes.bushe1");
    expect(bush?.editor.collider).toBeUndefined();
  });

  it("keeps every collider inside its asset's visual footprint bounds", () => {
    for (const id of CURATED_EDITOR_ASSET_IDS) {
      const asset = editorAsset(id);
      const collider = asset?.editor.collider;
      if (!asset || !collider) continue;
      const cells = asset.editor.visualFootprint;
      const minCol = Math.min(...cells.map((c) => c.col));
      const maxCol = Math.max(...cells.map((c) => c.col));
      // Anchor space: x = 0 is the cell centre, so the footprint spans
      // [minCol*64 - 32, (maxCol+1)*64 - 32).
      expect(collider.x).toBeGreaterThanOrEqual(minCol * 64 - 32);
      expect(collider.x + collider.width).toBeLessThanOrEqual((maxCol + 1) * 64 - 32);
    }
  });
});
