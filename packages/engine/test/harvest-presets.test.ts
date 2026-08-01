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

  it("models both catalogue sheep explicitly as knife-harvested meat", () => {
    expect(harvestPreset("sheep")).toMatchObject({
      intactAssetId: "resource.terrain-resources-meat-sheep.sheep-idle",
      profile: { resource: "meat", tool: "knife" },
    });
    expect(harvestPreset("happy_sheep")).toMatchObject({
      intactAssetId: "resource.resources-sheep.happysheep-idle",
      profile: { resource: "meat", tool: "knife" },
    });
  });

  it("returns detached per-instance profiles and never derives semantics from an appearance", () => {
    const first = harvestProfileFromPreset("tree");
    const second = harvestProfileFromPreset("tree");
    expect(first).toEqual(second);
    expect(first).not.toBe(second);

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
