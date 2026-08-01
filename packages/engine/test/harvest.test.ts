import {
  HARVEST_PROFILE_LIMITS,
  HARVEST_RESOURCE_KINDS,
  type HarvestProfile,
  harvestToolForResource,
  harvestToolMatchesResource,
  parseHarvestProfile,
} from "@lindocara/engine/harvest.js";
import { describe, expect, it } from "vitest";

const STUMP_ASSET_ID = "resource.terrain-resources-wood-trees.stump-1";

const WOOD_PROFILE: HarvestProfile = {
  resource: "wood",
  tool: "axe",
  yieldAmount: 8,
  goldValue: 0,
  hitsRequired: 3,
  range: 96,
  harvestDurationMs: 900,
  exhaustedAssetId: STUMP_ASSET_ID,
  exhaustionBehavior: "replace",
  respawn: "permanent",
  respawnDelayMs: 0,
  fadeDurationMs: 350,
};

describe("harvest profile", () => {
  it("round-trips a fully authored material profile", () => {
    expect(parseHarvestProfile(WOOD_PROFILE)).toEqual(WOOD_PROFILE);
  });

  it("centralizes the required tool for every resource kind", () => {
    expect(HARVEST_RESOURCE_KINDS.map(harvestToolForResource)).toEqual([
      "axe",
      "pickaxe",
      "pickaxe",
      "pickaxe",
      "knife",
    ]);
    expect(harvestToolMatchesResource("wood", "axe")).toBe(true);
    expect(harvestToolMatchesResource("wood", "pickaxe")).toBe(false);
    expect(parseHarvestProfile({ ...WOOD_PROFILE, tool: "knife" })).toBeNull();
  });

  it("routes gold through the existing currency value instead of a material yield", () => {
    const gold: HarvestProfile = {
      ...WOOD_PROFILE,
      resource: "gold",
      tool: "pickaxe",
      yieldAmount: 0,
      goldValue: 125,
      exhaustedAssetId: null,
      exhaustionBehavior: "fade",
      respawn: "timed",
      respawnDelayMs: 60_000,
    };
    expect(parseHarvestProfile(gold)).toEqual(gold);
    expect(parseHarvestProfile({ ...gold, yieldAmount: 1 })).toBeNull();
    expect(parseHarvestProfile({ ...gold, goldValue: 0 })).toBeNull();
    expect(parseHarvestProfile({ ...WOOD_PROFILE, goldValue: 1 })).toBeNull();
  });

  it("validates exhaustion and respawn combinations", () => {
    expect(parseHarvestProfile({ ...WOOD_PROFILE, exhaustedAssetId: null })).toBeNull();
    expect(
      parseHarvestProfile({
        ...WOOD_PROFILE,
        exhaustionBehavior: "hide",
        exhaustedAssetId: STUMP_ASSET_ID,
      }),
    ).toBeNull();
    expect(
      parseHarvestProfile({
        ...WOOD_PROFILE,
        exhaustionBehavior: "hide",
        exhaustedAssetId: null,
      }),
    ).toEqual({ ...WOOD_PROFILE, exhaustionBehavior: "hide", exhaustedAssetId: null });
    expect(parseHarvestProfile({ ...WOOD_PROFILE, respawnDelayMs: 1_000 })).toBeNull();
    expect(
      parseHarvestProfile({ ...WOOD_PROFILE, respawn: "timed", respawnDelayMs: 999 }),
    ).toBeNull();
    expect(
      parseHarvestProfile({ ...WOOD_PROFILE, respawn: "timed", respawnDelayMs: 1_000 }),
    ).not.toBeNull();
  });

  it("rejects malformed, unknown and out-of-range fields without throwing", () => {
    const invalidProfiles: unknown[] = [
      null,
      [],
      { ...WOOD_PROFILE, resource: "wool" },
      { ...WOOD_PROFILE, tool: "shovel" },
      { ...WOOD_PROFILE, yieldAmount: HARVEST_PROFILE_LIMITS.yieldAmount.max + 1 },
      { ...WOOD_PROFILE, hitsRequired: 0 },
      { ...WOOD_PROFILE, range: HARVEST_PROFILE_LIMITS.range.min - 1 },
      { ...WOOD_PROFILE, harvestDurationMs: 1.5 },
      { ...WOOD_PROFILE, exhaustedAssetId: "not.a.catalog-asset" },
      { ...WOOD_PROFILE, exhaustionBehavior: "explode" },
      { ...WOOD_PROFILE, respawn: "instant" },
      { ...WOOD_PROFILE, fadeDurationMs: HARVEST_PROFILE_LIMITS.fadeDurationMs.max + 1 },
    ];

    for (const profile of invalidProfiles) {
      expect(() => parseHarvestProfile(profile)).not.toThrow();
      expect(parseHarvestProfile(profile)).toBeNull();
    }
  });
});
