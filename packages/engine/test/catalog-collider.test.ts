import { buildingArchetype } from "@lindocara/engine/buildings.js";
import {
  FACTION_BUILDING_FACTIONS,
  FACTION_BUILDING_MODELS,
  FACTION_BUILDING_PURPOSES,
} from "@lindocara/engine/faction-buildings.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import {
  CURATED_EDITOR_ASSET_IDS,
  EDITOR_ASSETS,
  type EditorAssetDefinition,
  editorAsset,
  editorAssetCollisionElevation,
  LINDOCARA_BUILDING_ASSET_IDS,
  LINDOCARA_INTERIOR_ASSET_IDS,
  LINDOCARA_RUNNER_ASSET_IDS,
  LINDOCARA_STRUCTURE_ASSET_IDS,
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

  it("assigns finite collision elevations by scenery family", () => {
    expect(
      editorAssetCollisionElevation(
        "decoration.terrain-decorations-rocks-in-the-water.water-rocks-01",
      ),
    ).toBe(1);
    expect(editorAssetCollisionElevation("resource.terrain-resources-wood-trees.stump-1")).toBe(1);
    expect(editorAssetCollisionElevation("resource.terrain-resources-wood-trees.tree3")).toBe(3);
    expect(editorAssetCollisionElevation(LINDOCARA_BUILDING_ASSET_IDS.house)).toBe(2);
    expect(editorAssetCollisionElevation(LINDOCARA_BUILDING_ASSET_IDS.stoneTower)).toBe(3);
    expect(editorAssetCollisionElevation(LINDOCARA_BUILDING_ASSET_IDS.windmill)).toBe(3);
    expect(editorAssetCollisionElevation(LINDOCARA_RUNNER_ASSET_IDS.spikeTrap)).toBe(1);
    expect(editorAssetCollisionElevation(LINDOCARA_RUNNER_ASSET_IDS.pushTrap)).toBe(1);
    expect(editorAssetCollisionElevation(LINDOCARA_RUNNER_ASSET_IDS.launchTrap)).toBe(1);
    expect(editorAssetCollisionElevation(LINDOCARA_RUNNER_ASSET_IDS.barricade)).toBe(2);
    expect(editorAssetCollisionElevation(LINDOCARA_RUNNER_ASSET_IDS.goblinBarricade)).toBe(1);
    expect(editorAssetCollisionElevation(LINDOCARA_RUNNER_ASSET_IDS.orcBarricade)).toBe(3);
  });

  it("offers all six native runner props as placeable world obstacles", () => {
    const placeableIds = PLACEABLE_EDITOR_ASSETS.map((asset) => asset.id);
    for (const assetId of Object.values(LINDOCARA_RUNNER_ASSET_IDS)) {
      expect(placeableIds).toContain(assetId);
      expect(editorAsset(assetId)?.role).toBe("world-obstacle");
    }
    expect(editorAsset(LINDOCARA_RUNNER_ASSET_IDS.spikeTrap)?.role).toBe("world-obstacle");
    expect(editorAsset(LINDOCARA_RUNNER_ASSET_IDS.spikeTrap)?.editor.native3d).toEqual({
      width: 1.5,
      depth: 1.5,
    });
    expect(editorAsset(LINDOCARA_RUNNER_ASSET_IDS.barricade)?.editor.native3d).toEqual({
      width: 2.75,
      depth: 1.125,
    });
  });

  it("offers the complete interior set and marks wall-mounted art explicitly", () => {
    const interior = PLACEABLE_EDITOR_ASSETS.filter(
      (asset) => asset.editor.category === "interior-furniture",
    );
    expect(interior.map((asset) => asset.id)).toEqual(
      expect.arrayContaining(Object.values(LINDOCARA_INTERIOR_ASSET_IDS)),
    );
    expect(editorAsset(LINDOCARA_INTERIOR_ASSET_IDS.doorTimber)?.editor.wallMounted).toBe(true);
    expect(editorAsset(LINDOCARA_INTERIOR_ASSET_IDS.wallTapestry)?.editor.wallMounted).toBe(true);
    expect(editorAsset(LINDOCARA_INTERIOR_ASSET_IDS.sofa)?.editor.collider).toBeDefined();
  });

  it("offers all cave, castle, and timber walls and ceilings as architecture", () => {
    const architecture = PLACEABLE_EDITOR_ASSETS.filter(
      (asset) => asset.editor.category === "architecture",
    );
    expect(architecture.map((asset) => asset.id)).toEqual(
      expect.arrayContaining(Object.values(LINDOCARA_STRUCTURE_ASSET_IDS)),
    );
    expect(architecture).toHaveLength(6);
    for (const asset of architecture) {
      expect(asset.editor.native3d).toBeDefined();
      expect(asset.editor.architecturalVolume).toBeDefined();
      expect(asset.editor.destructibility).toBe("indestructible");
    }
  });

  it("offers the seven human buildings and forty faction buildings", () => {
    const placeableBuildings = PLACEABLE_EDITOR_ASSETS.filter(
      (asset) => asset.editor.category === "buildings",
    );
    expect(placeableBuildings).toHaveLength(47);
    expect(FACTION_BUILDING_MODELS).toHaveLength(40);
    const humanArchetypes = placeableBuildings
      .filter((asset) => asset.editor.buildingFaction === undefined)
      .map((asset) => buildingArchetype(asset.id))
      .sort((a, b) => String(a).localeCompare(String(b)));
    expect(humanArchetypes).toEqual([
      "archery",
      "barracks",
      "castle",
      "house",
      "monastery",
      "tower",
      "windmill",
    ]);
    for (const faction of FACTION_BUILDING_FACTIONS) {
      for (const purpose of FACTION_BUILDING_PURPOSES) {
        const models = placeableBuildings.filter(
          (asset) =>
            asset.editor.buildingFaction === faction && asset.editor.buildingPurpose === purpose,
        );
        expect(
          models
            .map((asset) => asset.editor.buildingVariant)
            .sort((left, right) => String(left).localeCompare(String(right))),
        ).toEqual(["a", "b"]);
        expect(models.every((asset) => buildingArchetype(asset.id) !== null)).toBe(true);
      }
    }
    const goblinAssets = placeableBuildings.filter(
      (asset) => asset.editor.buildingFaction === "goblin",
    );
    expect(goblinAssets).toHaveLength(10);
    expect(
      goblinAssets.every((asset) => asset.sourcePath.includes("Factions/Goblins/Buildings")),
    ).toBe(true);
    expect(
      goblinAssets
        .filter((asset) => asset.editor.buildingVariant === "b")
        .every((asset) => asset.editor.sourceRect?.width === 256),
    ).toBe(true);
    const orcAssets = placeableBuildings.filter(
      (asset) => asset.editor.buildingFaction === "orc-troll",
    );
    expect(orcAssets).toHaveLength(10);
    expect(orcAssets.every((asset) => asset.sourcePath.includes("Root Troll/Dead Tree.png"))).toBe(
      true,
    );
    const beastfolkAssets = placeableBuildings.filter(
      (asset) => asset.editor.buildingFaction === "beastfolk",
    );
    expect(beastfolkAssets).toHaveLength(10);
    expect(
      beastfolkAssets.every((asset) => asset.sourcePath.includes("Gnoll/Gnoll_Idle.png")),
    ).toBe(true);
    expect(beastfolkAssets.every((asset) => asset.editor.sourceRect?.width === 192)).toBe(true);
    const wildAssets = placeableBuildings.filter(
      (asset) => asset.editor.buildingFaction === "wild-tribe",
    );
    expect(wildAssets).toHaveLength(10);
    expect(
      wildAssets.every((asset) => asset.sourcePath.includes("Caveborn/Cave/Cave_Idle.png")),
    ).toBe(true);
    expect(wildAssets.every((asset) => asset.editor.sourceRect?.height === 192)).toBe(true);
  });

  it("keeps every bounded small prop at the stump's one-level collision", () => {
    for (const asset of EDITOR_ASSETS as readonly EditorAssetDefinition[]) {
      if (!asset.editor.collider || asset.editor.category === "buildings") continue;
      const stump = asset.tags.some((tag) => tag.includes("stump"));
      const tree = asset.editor.category === "trees" || asset.tags.includes("trees");
      if (tree && !stump) continue;
      if (
        asset.id === LINDOCARA_RUNNER_ASSET_IDS.barricade ||
        asset.id === LINDOCARA_RUNNER_ASSET_IDS.orcBarricade
      )
        continue;
      expect(editorAssetCollisionElevation(asset), asset.id).toBe(1);
    }
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

  it("offers one wooden bridge while the second orientation stays readable and placeable in code", () => {
    // Two cards described one sheet at two rotations. Placement now reads the orientation off the
    // crossing and the inspector switches it, so the vertical id must survive as an ASSET while
    // disappearing as a CARD: every stored map holding one still resolves, and MapService still
    // encodes its dimensions off `bridgeOrientation(row.kind)`.
    const placeableIds = PLACEABLE_EDITOR_ASSETS.map((asset) => asset.id);
    expect(placeableIds).toContain("terrain.bridge.wood.horizontal");
    expect(placeableIds).not.toContain("terrain.bridge.wood.vertical");
    expect(editorAsset("terrain.bridge.wood.vertical")).not.toBeNull();
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
