import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  CURATED_EDITOR_ASSET_IDS,
  editorAsset,
  PLACEABLE_EDITOR_ASSETS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

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

  it("gives both bridge orientations a full three-cell deck footprint", () => {
    expect(editorAsset("terrain.bridge.wood.horizontal")?.editor.collider).toEqual({
      x: -96,
      y: -64,
      width: 192,
      height: 64,
    });
    expect(editorAsset("terrain.bridge.wood.vertical")?.editor.collider).toEqual({
      x: -32,
      y: -192,
      width: 64,
      height: 192,
    });
  });

  it("offers the Update 010 animation once while preserving duplicate ids for old maps", () => {
    const placeableIds = PLACEABLE_EDITOR_ASSETS.map((asset) => asset.id);
    expect(placeableIds).toContain("resource.resources-trees.tree-1");
    for (const duplicateId of [
      "resource.resources-trees.tree-2",
      "resource.resources-trees.tree-3",
      "resource.resources-trees.tree-4",
      "resource.resources-trees.tree-5",
      "resource.resources-trees.tree-6",
    ]) {
      expect(placeableIds).not.toContain(duplicateId);
      expect(editorAsset(duplicateId)).not.toBeNull();
    }
  });

  it("hides redundant resource cards while keeping their saved-map identities readable", () => {
    const placeableIds = PLACEABLE_EDITOR_ASSETS.map((asset) => asset.id);
    const hiddenDuplicates = [
      "resource.resources-resources.g-idle-noshadow",
      "resource.resources-resources.m-idle-noshadow",
      "resource.resources-resources.w-idle-noshadow",
      "terrain.terrain-water-rocks.rocks-01",
      "terrain.terrain-water-rocks.rocks-02",
      "terrain.terrain-water-rocks.rocks-03",
      "terrain.terrain-water-rocks.rocks-04",
    ];
    for (const duplicateId of hiddenDuplicates) {
      expect(placeableIds).not.toContain(duplicateId);
      expect(editorAsset(duplicateId)).not.toBeNull();
    }
    for (const canonicalId of [
      "resource.resources-resources.g-idle",
      "resource.resources-resources.m-idle",
      "resource.resources-resources.w-idle",
      "decoration.terrain-decorations-rocks-in-the-water.water-rocks-01",
      "decoration.terrain-decorations-rocks-in-the-water.water-rocks-02",
      "decoration.terrain-decorations-rocks-in-the-water.water-rocks-03",
      "decoration.terrain-decorations-rocks-in-the-water.water-rocks-04",
    ]) {
      expect(placeableIds).toContain(canonicalId);
    }
  });
});
