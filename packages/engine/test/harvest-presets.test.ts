import { describe, expect, it } from "vitest";
import { parseHarvestProfile } from "../src/harvest.js";
import {
  HARVEST_PRESET_IDS,
  HARVEST_PRESETS,
  harvestPreset,
  harvestProfileFromPreset,
  isHarvestPresetId,
} from "../src/harvest-presets.js";
import { editorAsset } from "../src/tiny-swords-catalog.js";

describe("semantic harvest presets", () => {
  it("defines one valid explicit profile and two valid appearances for every stable preset", () => {
    expect(new Set(HARVEST_PRESET_IDS).size).toBe(HARVEST_PRESET_IDS.length);
    expect(HARVEST_PRESETS.map((preset) => preset.id)).toEqual(HARVEST_PRESET_IDS);
    for (const preset of HARVEST_PRESETS) {
      expect(parseHarvestProfile(preset.profile)).toEqual(preset.profile);
      expect(editorAsset(preset.intactAssetId)).not.toBeNull();
      if (preset.profile.exhaustedAssetId) {
        expect(editorAsset(preset.profile.exhaustedAssetId)).not.toBeNull();
      }
    }
  });

  it("models both catalogue sheep as wandering knife-harvested actors that disappear", () => {
    expect(harvestPreset("sheep")).toMatchObject({
      intactAssetId: "resource.terrain-resources-meat-sheep.sheep-idle",
      profile: {
        resource: "meat",
        tool: "knife",
        actorBehavior: "wander",
        exhaustionBehavior: "hide",
        exhaustedAssetId: null,
      },
    });
    expect(harvestPreset("happy_sheep")).toMatchObject({
      intactAssetId: "resource.resources-sheep.happysheep-idle",
      profile: {
        resource: "meat",
        tool: "knife",
        actorBehavior: "wander",
        exhaustionBehavior: "hide",
        exhaustedAssetId: null,
      },
    });
  });

  it("offers every catalogue tree as a semantic harvest preset", () => {
    expect(
      (
        [
          "tree_tall",
          "tree",
          "tree_medium",
          "tree_small",
          "tree_update_1",
          "tree_update_2",
          "tree_update_3",
          "tree_update_4",
          "tree_update_5",
          "tree_update_6",
        ] as const
      ).map((id) => {
        const preset = harvestPreset(id);
        return {
          id,
          intact: preset.intactAssetId,
          exhausted: preset.profile.exhaustedAssetId,
          yieldAmount: preset.profile.yieldAmount,
          hitsRequired: preset.profile.hitsRequired,
        };
      }),
    ).toEqual([
      {
        id: "tree_tall",
        intact: "resource.terrain-resources-wood-trees.tree2",
        exhausted: "resource.terrain-resources-wood-trees.stump-2",
        yieldAmount: 10,
        hitsRequired: 4,
      },
      {
        id: "tree",
        intact: "resource.terrain-resources-wood-trees.tree1",
        exhausted: "resource.terrain-resources-wood-trees.stump-1",
        yieldAmount: 8,
        hitsRequired: 3,
      },
      {
        id: "tree_medium",
        intact: "resource.terrain-resources-wood-trees.tree3",
        exhausted: "resource.terrain-resources-wood-trees.stump-3",
        yieldAmount: 6,
        hitsRequired: 3,
      },
      {
        id: "tree_small",
        intact: "resource.terrain-resources-wood-trees.tree4",
        exhausted: "resource.terrain-resources-wood-trees.stump-4",
        yieldAmount: 4,
        hitsRequired: 2,
      },
      ...([1, 2, 3, 4, 5, 6] as const).map((variant) => ({
        id: `tree_update_${variant}`,
        intact: `resource.resources-trees.tree-${variant}`,
        exhausted: "resource.resources-trees.stump",
        yieldAmount: 7,
        hitsRequired: 3,
      })),
    ]);
  });

  it("maps the small and large gold presets to the correctly-sized appearances", () => {
    expect(harvestPreset("gold_small")).toMatchObject({
      intactAssetId: "resource.terrain-resources-gold-gold-resource.gold-resource",
      profile: { goldValue: 25, hitsRequired: 2 },
    });
    expect(harvestPreset("gold_large")).toMatchObject({
      intactAssetId: "resource.terrain-resources-gold-gold-stones.gold-stone-6",
      profile: { goldValue: 100, hitsRequired: 5 },
    });
  });

  it("registers default tool hits at the authoritative action impact", () => {
    for (const preset of HARVEST_PRESETS) {
      expect(preset.profile.harvestDurationMs).toBe(0);
    }
  });

  it("returns detached per-instance profiles and never derives semantics from an appearance", () => {
    const first = harvestProfileFromPreset("tree");
    const second = harvestProfileFromPreset("tree");
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.collision).not.toBe(second.collision);
    expect(first.collision?.intact).not.toBe(second.collision?.intact);
    expect(first.collision?.depleted).not.toBe(second.collision?.depleted);

    const customAppearance = harvestPreset("happy_sheep").intactAssetId;
    expect(customAppearance).not.toBe(harvestPreset("tree").intactAssetId);
    expect(first).toMatchObject({ resource: "wood", tool: "axe" });
  });

  it("accepts only central stable ids", () => {
    expect(isHarvestPresetId("gold_large")).toBe(true);
    expect(isHarvestPresetId("resource.terrain-resources-gold-gold-resource.gold-resource")).toBe(
      false,
    );
  });
});
