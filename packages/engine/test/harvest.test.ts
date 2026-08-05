import {
  animalCarcassHarvestProfile,
  DEFAULT_HARVEST_COLLISIONS,
  HARVEST_PROFILE_LIMITS,
  HARVEST_RESOURCE_KINDS,
  type HarvestProfile,
  harvestColliderAt,
  harvestFootprintFitsMap,
  harvestGroundColliderAt,
  harvestToolForResource,
  harvestToolMatchesResource,
  parseHarvestProfile,
} from "@lindocara/engine/harvest.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
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
  collision: {
    intact: { offsetX: -26, offsetY: -36, width: 52, height: 36 },
    depleted: { offsetX: -20, offsetY: -15, width: 40, height: 15 },
  },
};

describe("harvest profile", () => {
  it("round-trips a fully authored material profile", () => {
    expect(parseHarvestProfile(WOOD_PROFILE)).toEqual(WOOD_PROFILE);
  });

  it("normalizes legacy maps without collision from resource semantics, never appearance", () => {
    const { collision: _legacyMissing, ...legacy } = WOOD_PROFILE;
    expect(parseHarvestProfile(legacy)).toEqual({
      ...legacy,
      harvestDurationMs: 0,
      collision: DEFAULT_HARVEST_COLLISIONS.wood,
    });
    expect(
      parseHarvestProfile({
        ...legacy,
        exhaustedAssetId: "resource.terrain-resources-wood-trees.stump-4",
      }),
    ).toMatchObject({ collision: DEFAULT_HARVEST_COLLISIONS.wood });
  });

  it("preserves an explicitly customized legacy duration outside the shipped preset signature", () => {
    const { collision: _legacyMissing, ...legacy } = WOOD_PROFILE;
    expect(parseHarvestProfile({ ...legacy, harvestDurationMs: 901 })).toMatchObject({
      harvestDurationMs: 901,
      collision: DEFAULT_HARVEST_COLLISIONS.wood,
    });
  });

  it("migrates inherited legacy timing when an instance overrides its resource quantity", () => {
    const { collision: _legacyMissing, ...legacy } = WOOD_PROFILE;
    expect(parseHarvestProfile({ ...legacy, yieldAmount: 12 })).toMatchObject({
      yieldAmount: 12,
      harvestDurationMs: 0,
      collision: DEFAULT_HARVEST_COLLISIONS.wood,
    });
  });

  it("projects different explicit tree sizes from the event foot", () => {
    expect(harvestColliderAt(WOOD_PROFILE, 2, 3, "intact")).toEqual({
      x: 134,
      y: 220,
      width: 52,
      height: 36,
    });
    expect(harvestColliderAt(WOOD_PROFILE, 2, 3, "depleted")).toEqual({
      x: 140,
      y: 241,
      width: 40,
      height: 15,
    });
  });

  it("projects the same footprint onto the grid-centred ground plane", () => {
    // The tile-unit twin of the case above. Two independent things have to be right and the
    // compiler can check neither: the SCALE (the authored box stays pixels, so every field is
    // divided by `TILE_SIZE`) and the ORIGIN (cell indices are top-left, the grid is centred, so
    // half the grid comes off). Getting only one right typechecks and puts every tree trunk either
    // 64x too far out or a whole half-map to the south-east.
    const size = 16;
    // Cell (2, 3)'s foot is its horizontal centre and its far edge: x = 2.5 - 8, z = 4 - 8.
    expect(harvestGroundColliderAt(WOOD_PROFILE, 2, 3, "intact", size)).toEqual({
      x: 2.5 - 8 + -26 / TILE_SIZE,
      z: 4 - 8 + -36 / TILE_SIZE,
      w: 52 / TILE_SIZE,
      h: 36 / TILE_SIZE,
    });
    expect(harvestGroundColliderAt(WOOD_PROFILE, 2, 3, "depleted", size)).toEqual({
      x: 2.5 - 8 + -20 / TILE_SIZE,
      z: 4 - 8 + -15 / TILE_SIZE,
      w: 40 / TILE_SIZE,
      h: 15 / TILE_SIZE,
    });

    // It is the exact inverse of the pixel projection, which is the property that stops the two
    // from drifting: same rectangle, two coordinate frames.
    const pixel = harvestColliderAt(WOOD_PROFILE, 2, 3, "intact");
    const ground = harvestGroundColliderAt(WOOD_PROFILE, 2, 3, "intact", size);
    if (!pixel || !ground) throw new Error("both projections must exist for an intact wood node");
    expect(ground.x).toBeCloseTo(pixel.x / TILE_SIZE - size / 2, 10);
    expect(ground.z).toBeCloseTo(pixel.y / TILE_SIZE - size / 2, 10);
    expect(ground.w).toBeCloseTo(pixel.width / TILE_SIZE, 10);
    expect(ground.h).toBeCloseTo(pixel.height / TILE_SIZE, 10);
  });

  it("has no depleted ground footprint when exhaustion is not a replacement", () => {
    // Fade and hide REMOVE collision; a hidden collider would be an invisible wall. The ground
    // projection has to inherit that rule, not re-derive it.
    const fading: HarvestProfile = { ...WOOD_PROFILE, exhaustionBehavior: "fade" };
    expect(harvestGroundColliderAt(fading, 2, 3, "depleted", 16)).toBeNull();
    expect(harvestGroundColliderAt(fading, 2, 3, "intact", 16)).not.toBeNull();
  });

  it("rejects any intact or replacement footprint that crosses the map boundary", () => {
    const leftOverflow: HarvestProfile = {
      ...WOOD_PROFILE,
      collision: {
        intact: { offsetX: -40, offsetY: -30, width: 64, height: 30 },
        depleted: WOOD_PROFILE.collision?.depleted ?? null,
      },
    };
    expect(harvestFootprintFitsMap(leftOverflow, 0, 2, 8, 8)).toBe(false);
    expect(harvestFootprintFitsMap(leftOverflow, 1, 2, 8, 8)).toBe(true);

    const replacementOverflow: HarvestProfile = {
      ...WOOD_PROFILE,
      collision: {
        intact: { offsetX: -20, offsetY: -30, width: 40, height: 30 },
        depleted: { offsetX: 0, offsetY: -14, width: 64, height: 14 },
      },
    };
    expect(harvestFootprintFitsMap(replacementOverflow, 7, 2, 8, 8)).toBe(false);
    expect(harvestFootprintFitsMap(replacementOverflow, 6, 2, 8, 8)).toBe(true);
    expect(harvestFootprintFitsMap(WOOD_PROFILE, 1.5, 2, 8, 8)).toBe(false);
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

  it("opts only explicit animal species into carcass harvesting", () => {
    expect(animalCarcassHarvestProfile("war_pig", "timed", 42_000)).toMatchObject({
      resource: "meat",
      tool: "knife",
      respawn: "timed",
      respawnDelayMs: 42_000,
    });
    expect(animalCarcassHarvestProfile("war_pig", "never", 42_000)).toMatchObject({
      respawn: "permanent",
      respawnDelayMs: 0,
    });
    expect(animalCarcassHarvestProfile("spear_goblin", "timed", 42_000)).toBeNull();
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
      collision: {
        intact: { ...DEFAULT_HARVEST_COLLISIONS.gold.intact },
        depleted: null,
      },
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
        collision: { ...WOOD_PROFILE.collision, depleted: null },
      }),
    ).toEqual({
      ...WOOD_PROFILE,
      exhaustionBehavior: "hide",
      exhaustedAssetId: null,
      collision: { ...WOOD_PROFILE.collision, depleted: null },
    });
    expect(parseHarvestProfile({ ...WOOD_PROFILE, respawnDelayMs: 1_000 })).toBeNull();
    expect(
      parseHarvestProfile({ ...WOOD_PROFILE, respawn: "timed", respawnDelayMs: 999 }),
    ).toBeNull();
    expect(
      parseHarvestProfile({ ...WOOD_PROFILE, respawn: "timed", respawnDelayMs: 1_000 }),
    ).not.toBeNull();
  });

  it("migrates the shipped sheep signature to harmless wandering with no meat left behind", () => {
    expect(
      parseHarvestProfile({
        resource: "meat",
        tool: "knife",
        yieldAmount: 6,
        goldValue: 0,
        hitsRequired: 3,
        range: 80,
        harvestDurationMs: 0,
        exhaustedAssetId: "resource.terrain-resources-meat-meat-resource.meat-resource",
        exhaustionBehavior: "replace",
        respawn: "timed",
        respawnDelayMs: 300_000,
        fadeDurationMs: 450,
        collision: {
          intact: { offsetX: -24, offsetY: -28, width: 48, height: 28 },
          depleted: { offsetX: -18, offsetY: -12, width: 36, height: 12 },
        },
      }),
    ).toMatchObject({
      actorBehavior: "wander",
      exhaustionBehavior: "hide",
      exhaustedAssetId: null,
      collision: { depleted: null },
    });
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
      { ...WOOD_PROFILE, actorBehavior: "hostile" },
      { ...WOOD_PROFILE, fadeDurationMs: HARVEST_PROFILE_LIMITS.fadeDurationMs.max + 1 },
      {
        ...WOOD_PROFILE,
        collision: {
          ...WOOD_PROFILE.collision,
          intact: { offsetX: 0, offsetY: 0, width: 0, height: 1 },
        },
      },
      {
        ...WOOD_PROFILE,
        collision: {
          intact: { offsetX: -20, offsetY: -20, width: 40, height: 20 },
          depleted: { offsetX: -24, offsetY: -20, width: 48, height: 20 },
        },
      },
    ];

    for (const profile of invalidProfiles) {
      expect(() => parseHarvestProfile(profile)).not.toThrow();
      expect(parseHarvestProfile(profile)).toBeNull();
    }
  });
});
