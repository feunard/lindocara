import {
  type HarvestPresetId,
  harvestPreset,
  harvestProfileFromPreset,
} from "@lindocara/engine/harvest-presets.js";
import { nativeHarvestEventForElement } from "@lindocara/engine/native-harvest.js";
import { describe, expect, it } from "vitest";

import { harvestCollisionElevation } from "../src/api/realtime/worldEvents.ts";

describe("small harvest scenery collision", () => {
  it.each(["wood_cache", "stone_deco_large", "iron_rock_4", "gold_small", "gold_stone_5"] as const)(
    "keeps %s jumpable and harvestable",
    (presetId: HarvestPresetId) => {
      const preset = harvestPreset(presetId);
      const profile = harvestProfileFromPreset(presetId);
      const event = nativeHarvestEventForElement(
        {
          col: 2,
          row: 3,
          offsetX: 0,
          offsetY: 0,
          assetId: preset.intactAssetId,
        },
        1,
      );

      expect(harvestCollisionElevation(profile, preset.intactAssetId, "intact")).toBe(1);
      expect(event).toMatchObject({
        kind: "harvestable",
        harvestProfile: {
          resource: profile.resource,
          tool: profile.tool,
        },
      });
    },
  );

  it("keeps intact trees tall while their harvested stump is one level", () => {
    const preset = harvestPreset("tree");
    const profile = harvestProfileFromPreset("tree");

    expect(harvestCollisionElevation(profile, preset.intactAssetId, "intact")).toBe(3);
    expect(harvestCollisionElevation(profile, profile.exhaustedAssetId, "depleted")).toBe(1);
  });

  it("scales a resized rock's finite collision height with its visible size", () => {
    const preset = harvestPreset("stone_deco_large");
    const profile = harvestProfileFromPreset("stone_deco_large");

    expect(harvestCollisionElevation(profile, preset.intactAssetId, "intact", 2)).toBe(2);
    expect(harvestCollisionElevation(profile, preset.intactAssetId, "intact", 0.5)).toBe(1);
  });
});
