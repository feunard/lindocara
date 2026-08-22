import { describe, expect, it } from "vitest";

import {
  HARVEST_PRESET_IDS,
  HARVEST_PRESETS,
  harvestPreset,
  harvestProfileFromPreset,
  isHarvestPresetId,
  isNativeHarvestAsset,
  NATIVE_HARVEST_RESPAWN_MS,
  nativeHarvestProfileForAsset,
} from "../src/harvest-presets.js";
import { parseHarvestProfile } from "../src/harvest.js";
import { editorAsset } from "../src/tiny-swords-catalog.js";

describe("semantic harvest presets", () => {
  it("defines one valid explicit profile and valid catalogue appearances for every stable preset", () => {
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
        hitsRequired: 4,
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
        hitsRequired: 4,
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
        yieldAmount: 3,
        hitsRequired: 4,
      },
      {
        id: "tree",
        intact: "resource.terrain-resources-wood-trees.tree1",
        exhausted: "resource.terrain-resources-wood-trees.stump-1",
        yieldAmount: 3,
        hitsRequired: 4,
      },
      {
        id: "tree_medium",
        intact: "resource.terrain-resources-wood-trees.tree3",
        exhausted: "resource.terrain-resources-wood-trees.stump-3",
        yieldAmount: 2,
        hitsRequired: 3,
      },
      {
        id: "tree_small",
        intact: "resource.terrain-resources-wood-trees.tree4",
        exhausted: "resource.terrain-resources-wood-trees.stump-4",
        yieldAmount: 1,
        hitsRequired: 2,
      },
      ...([1, 2, 3, 4, 5, 6] as const).map((variant) => ({
        id: `tree_update_${variant}`,
        intact: `resource.resources-trees.tree-${variant}`,
        exhausted: "resource.resources-trees.stump",
        yieldAmount: 3,
        hitsRequired: 4,
      })),
    ]);
  });

  it("maps the small and large gold presets to the correctly-sized appearances", () => {
    expect(harvestPreset("gold_small")).toMatchObject({
      intactAssetId: "resource.terrain-resources-gold-gold-resource.gold-resource",
      profile: { goldValue: 10, goldValueRange: { min: 10, max: 25 }, hitsRequired: 1 },
    });
    expect(harvestPreset("gold_large")).toMatchObject({
      intactAssetId: "resource.terrain-resources-gold-gold-stones.gold-stone-6",
      profile: { goldValue: 100, goldValueRange: { min: 85, max: 100 }, hitsRequired: 3 },
    });
  });

  it("assigns an explicit random range to every native gold size", () => {
    expect(
      HARVEST_PRESETS.filter((preset) => preset.profile.resource === "gold").map((preset) => [
        preset.id,
        preset.profile.goldValueRange,
      ]),
    ).toEqual([
      ["gold_small", { min: 10, max: 25 }],
      ["gold_stone_1", { min: 10, max: 25 }],
      ["gold_stone_2", { min: 10, max: 25 }],
      ["gold_stone_3", { min: 45, max: 65 }],
      ["gold_stone_4", { min: 45, max: 65 }],
      ["gold_stone_5", { min: 85, max: 100 }],
      ["gold_large", { min: 85, max: 100 }],
      ["gold_update_cache", { min: 10, max: 25 }],
      ["gold_update_cache_noshadow", { min: 10, max: 25 }],
    ]);
  });

  it("registers default tool hits at the authoritative action impact", () => {
    for (const preset of HARVEST_PRESETS) {
      expect(preset.profile.harvestDurationMs).toBe(0);
    }
  });

  it("returns detached profiles and maps only explicitly curated native appearances", () => {
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
    expect(isNativeHarvestAsset(harvestPreset("happy_sheep").intactAssetId)).toBe(true);
    expect(nativeHarvestProfileForAsset(harvestPreset("happy_sheep").intactAssetId)).toMatchObject({
      resource: "meat",
      tool: "knife",
      actorBehavior: "wander",
    });
    expect(isNativeHarvestAsset("decoration.terrain-decorations-rocks.rock2")).toBe(true);
  });

  it("rolls native materials within their resource-specific limits", () => {
    for (const preset of HARVEST_PRESETS) {
      if (preset.profile.resource === "gold") {
        expect(preset.profile.goldValueRange?.min).toBeGreaterThanOrEqual(10);
        expect(preset.profile.goldValueRange?.max).toBeLessThanOrEqual(100);
      } else {
        expect(preset.profile.yieldRange?.min).toBe(1);
        expect(preset.profile.yieldRange?.max).toBe(preset.profile.resource === "meat" ? 5 : 3);
      }
    }
    expect(harvestPreset("sheep").profile.yieldRange).toEqual({ min: 1, max: 5 });
    expect(harvestPreset("happy_sheep").profile.yieldRange).toEqual({ min: 1, max: 5 });
  });

  it("respawns every native resource after five real-time minutes", () => {
    for (const preset of HARVEST_PRESETS) {
      expect(preset.profile).toMatchObject({
        respawn: "timed",
        respawnDelayMs: NATIVE_HARVEST_RESPAWN_MS,
      });
    }
  });

  it("never treats a standalone tree stump as a native harvest resource", () => {
    for (const assetId of [
      "resource.terrain-resources-wood-trees.stump-1",
      "resource.terrain-resources-wood-trees.stump-2",
      "resource.terrain-resources-wood-trees.stump-3",
      "resource.terrain-resources-wood-trees.stump-4",
      "resource.resources-trees.stump",
    ] as const) {
      expect(isNativeHarvestAsset(assetId)).toBe(false);
      expect(nativeHarvestProfileForAsset(assetId)).toBeNull();
    }
  });

  it("accepts only central stable ids", () => {
    expect(isHarvestPresetId("gold_large")).toBe(true);
    expect(isHarvestPresetId("resource.terrain-resources-gold-gold-resource.gold-resource")).toBe(
      false,
    );
  });
});
