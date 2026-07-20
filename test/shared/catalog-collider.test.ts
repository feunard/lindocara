import { describe, expect, it } from "vitest";
import { TILE_SIZE } from "../../src/shared/tilemap.js";
import { CURATED_EDITOR_ASSET_IDS, editorAsset } from "../../src/shared/tiny-swords-catalog.js";

describe("catalogue colliders", () => {
  it("gives the curated tree a trunk collider, not a whole cell", () => {
    const tree = editorAsset("resource.terrain-resources-wood-trees.tree3");
    const collider = tree?.editor.collider;
    expect(collider).toBeDefined();
    if (!collider) return;
    expect(collider.width).toBeGreaterThan(0);
    expect(collider.width).toBeLessThan(TILE_SIZE);
    expect(collider.height).toBeLessThan(TILE_SIZE);
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
      const minRow = Math.min(...cells.map((c) => c.row));
      const maxRow = Math.max(...cells.map((c) => c.row));
      // Foot space: x = 0 is the cell centre, so the footprint spans
      // [minCol*TILE_SIZE - TILE_SIZE/2, (maxCol+1)*TILE_SIZE - TILE_SIZE/2).
      expect(collider.x).toBeGreaterThanOrEqual(minCol * TILE_SIZE - TILE_SIZE / 2);
      expect(collider.x + collider.width).toBeLessThanOrEqual(
        (maxCol + 1) * TILE_SIZE - TILE_SIZE / 2,
      );
      // And y = 0 is the ground line. A collider must rise from it, never hang below it: a
      // collider with y + height > 0 sits in the cell SOUTH of the art it belongs to, blocking
      // empty ground while leaving the trunk walkable.
      expect(collider.y + collider.height).toBeLessThanOrEqual(0);
      expect(collider.y).toBeGreaterThanOrEqual((minRow - maxRow - 1) * TILE_SIZE);
    }
  });

  it("puts the curated tree's collider above the ground line, not below it", () => {
    // The regression guard for the coordinate-space bug: authoring against the sprite CONTAINER
    // (which sits footOffset px below the visible pixels) instead of the visible foot put this
    // collider entirely inside the next cell south.
    const collider = editorAsset("resource.terrain-resources-wood-trees.tree3")?.editor.collider;
    expect(collider).toBeDefined();
    if (!collider) return;
    expect(collider.y).toBeLessThan(0);
    expect(collider.y + collider.height).toBeLessThanOrEqual(0);
  });
});
