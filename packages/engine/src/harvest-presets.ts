import { cloneHarvestProfile, type HarvestProfile } from "./harvest.js";
import type { EditorAssetId } from "./tiny-swords-catalog.js";

/**
 * Stable authoring templates for harvestable map events.
 *
 * The preset id carries semantics; asset ids are only the two appearances an author starts with.
 * Runtime code consumes the persisted HarvestProfile and never attempts to recover it from either
 * image id, its source filename, or its directory.
 */
export const HARVEST_PRESET_IDS = [
  "tree_tall",
  "tree",
  "tree_medium",
  "tree_small",
  "stone_outcrop",
  "iron_outcrop",
  "gold_small",
  "gold_large",
  "meat_cache",
  "sheep",
  "happy_sheep",
] as const;

export type HarvestPresetId = (typeof HARVEST_PRESET_IDS)[number];

export interface HarvestPresetDefinition {
  id: HarvestPresetId;
  intactAssetId: EditorAssetId;
  profile: HarvestProfile;
}

const SMALL_GOLD_ASSET_ID: EditorAssetId =
  "resource.terrain-resources-gold-gold-resource.gold-resource";
const LARGE_GOLD_ASSET_ID: EditorAssetId =
  "resource.terrain-resources-gold-gold-stones.gold-stone-6";

export const HARVEST_PRESETS: readonly HarvestPresetDefinition[] = [
  {
    id: "tree_tall",
    intactAssetId: "resource.terrain-resources-wood-trees.tree2",
    profile: {
      resource: "wood",
      tool: "axe",
      yieldAmount: 10,
      goldValue: 0,
      hitsRequired: 4,
      range: 96,
      harvestDurationMs: 0,
      exhaustedAssetId: "resource.terrain-resources-wood-trees.stump-2",
      exhaustionBehavior: "replace",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 350,
      collision: {
        intact: { offsetX: -30, offsetY: -44, width: 60, height: 44 },
        depleted: { offsetX: -22, offsetY: -16, width: 44, height: 16 },
      },
    },
  },
  {
    id: "tree",
    intactAssetId: "resource.terrain-resources-wood-trees.tree1",
    profile: {
      resource: "wood",
      tool: "axe",
      yieldAmount: 8,
      goldValue: 0,
      hitsRequired: 3,
      range: 96,
      harvestDurationMs: 0,
      exhaustedAssetId: "resource.terrain-resources-wood-trees.stump-1",
      exhaustionBehavior: "replace",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 350,
      collision: {
        intact: { offsetX: -26, offsetY: -36, width: 52, height: 36 },
        depleted: { offsetX: -20, offsetY: -15, width: 40, height: 15 },
      },
    },
  },
  {
    id: "tree_medium",
    intactAssetId: "resource.terrain-resources-wood-trees.tree3",
    profile: {
      resource: "wood",
      tool: "axe",
      yieldAmount: 6,
      goldValue: 0,
      hitsRequired: 3,
      range: 96,
      harvestDurationMs: 0,
      exhaustedAssetId: "resource.terrain-resources-wood-trees.stump-3",
      exhaustionBehavior: "replace",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 350,
      collision: {
        intact: { offsetX: -22, offsetY: -30, width: 44, height: 30 },
        depleted: { offsetX: -18, offsetY: -14, width: 36, height: 14 },
      },
    },
  },
  {
    id: "tree_small",
    intactAssetId: "resource.terrain-resources-wood-trees.tree4",
    profile: {
      resource: "wood",
      tool: "axe",
      yieldAmount: 4,
      goldValue: 0,
      hitsRequired: 2,
      range: 96,
      harvestDurationMs: 0,
      exhaustedAssetId: "resource.terrain-resources-wood-trees.stump-4",
      exhaustionBehavior: "replace",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 350,
      collision: {
        intact: { offsetX: -18, offsetY: -24, width: 36, height: 24 },
        depleted: { offsetX: -15, offsetY: -12, width: 30, height: 12 },
      },
    },
  },
  {
    id: "stone_outcrop",
    intactAssetId: "decoration.terrain-decorations-rocks.rock1",
    profile: {
      resource: "stone",
      tool: "pickaxe",
      yieldAmount: 6,
      goldValue: 0,
      hitsRequired: 4,
      range: 88,
      harvestDurationMs: 0,
      exhaustedAssetId: null,
      exhaustionBehavior: "fade",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 450,
      collision: {
        intact: { offsetX: -24, offsetY: -20, width: 48, height: 20 },
        depleted: null,
      },
    },
  },
  {
    id: "iron_outcrop",
    intactAssetId: "decoration.terrain-decorations-rocks.rock3",
    profile: {
      resource: "iron",
      tool: "pickaxe",
      yieldAmount: 4,
      goldValue: 0,
      hitsRequired: 5,
      range: 88,
      harvestDurationMs: 0,
      exhaustedAssetId: null,
      exhaustionBehavior: "fade",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 500,
      collision: {
        intact: { offsetX: -26, offsetY: -24, width: 52, height: 24 },
        depleted: null,
      },
    },
  },
  {
    id: "gold_small",
    intactAssetId: SMALL_GOLD_ASSET_ID,
    profile: {
      resource: "gold",
      tool: "pickaxe",
      yieldAmount: 0,
      goldValue: 25,
      hitsRequired: 2,
      range: 88,
      harvestDurationMs: 0,
      exhaustedAssetId: null,
      exhaustionBehavior: "fade",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 500,
      collision: {
        intact: { offsetX: -18, offsetY: -18, width: 36, height: 18 },
        depleted: null,
      },
    },
  },
  {
    id: "gold_large",
    intactAssetId: LARGE_GOLD_ASSET_ID,
    profile: {
      resource: "gold",
      tool: "pickaxe",
      yieldAmount: 0,
      goldValue: 100,
      hitsRequired: 5,
      range: 88,
      harvestDurationMs: 0,
      exhaustedAssetId: null,
      exhaustionBehavior: "fade",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 650,
      collision: {
        intact: { offsetX: -29, offsetY: -28, width: 58, height: 28 },
        depleted: null,
      },
    },
  },
  {
    id: "meat_cache",
    intactAssetId: "resource.terrain-resources-meat-meat-resource.meat-resource",
    profile: {
      resource: "meat",
      tool: "knife",
      yieldAmount: 4,
      goldValue: 0,
      hitsRequired: 1,
      range: 80,
      harvestDurationMs: 0,
      exhaustedAssetId: null,
      exhaustionBehavior: "hide",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 350,
      collision: {
        intact: { offsetX: -20, offsetY: -16, width: 40, height: 16 },
        depleted: null,
      },
    },
  },
  {
    id: "sheep",
    intactAssetId: "resource.terrain-resources-meat-sheep.sheep-idle",
    profile: {
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
    },
  },
  {
    id: "happy_sheep",
    intactAssetId: "resource.resources-sheep.happysheep-idle",
    profile: {
      resource: "meat",
      tool: "knife",
      yieldAmount: 8,
      goldValue: 0,
      hitsRequired: 4,
      range: 80,
      harvestDurationMs: 0,
      exhaustedAssetId: "resource.terrain-resources-meat-meat-resource.meat-resource",
      exhaustionBehavior: "replace",
      respawn: "timed",
      respawnDelayMs: 300_000,
      fadeDurationMs: 450,
      collision: {
        intact: { offsetX: -26, offsetY: -30, width: 52, height: 30 },
        depleted: { offsetX: -18, offsetY: -12, width: 36, height: 12 },
      },
    },
  },
];

const HARVEST_PRESET_BY_ID = new Map(HARVEST_PRESETS.map((preset) => [preset.id, preset]));

export function isHarvestPresetId(value: unknown): value is HarvestPresetId {
  return typeof value === "string" && HARVEST_PRESET_BY_ID.has(value as HarvestPresetId);
}

export function harvestPreset(id: HarvestPresetId): HarvestPresetDefinition {
  // Every HarvestPresetId comes from the tuple used to build this map.
  return HARVEST_PRESET_BY_ID.get(id) as HarvestPresetDefinition;
}

/** A detached profile lets each placed map instance override every authored value independently. */
export function harvestProfileFromPreset(id: HarvestPresetId): HarvestProfile {
  return cloneHarvestProfile(harvestPreset(id).profile);
}

function isLegacyGoldPresetFamily(profile: HarvestProfile): boolean {
  return (
    profile.resource === "gold" &&
    profile.tool === "pickaxe" &&
    profile.yieldAmount === 0 &&
    profile.exhaustionBehavior === "fade" &&
    profile.respawn === "permanent"
  );
}

/**
 * Compatibility read for the two gold presets shipped with their appearances reversed. It runs
 * only for the pre-collision schema and uses the original duration/fade signature to identify the
 * expected size. It replaces only the known wrong opposite id, so an author-corrected appearance
 * stays intact. Per-instance value/hit overrides do not suppress the visual repair. Runtime
 * gameplay never derives anything from an asset name/path; every other custom appearance is left
 * untouched and the normalized page persists on the next map save.
 */
export function migrateLegacyHarvestGraphicAsset(
  profile: HarvestProfile,
  graphicAssetId: EditorAssetId | null,
  legacyWithoutCollision: boolean,
  legacyHarvestDurationMs: number | null,
): EditorAssetId | null {
  if (!legacyWithoutCollision) return graphicAssetId;
  if (!isLegacyGoldPresetFamily(profile)) return graphicAssetId;
  const expectedAsset =
    legacyHarvestDurationMs === 1_000 && profile.fadeDurationMs === 500
      ? SMALL_GOLD_ASSET_ID
      : legacyHarvestDurationMs === 1_200 && profile.fadeDurationMs === 650
        ? LARGE_GOLD_ASSET_ID
        : null;
  if (expectedAsset === SMALL_GOLD_ASSET_ID && graphicAssetId === LARGE_GOLD_ASSET_ID) {
    return SMALL_GOLD_ASSET_ID;
  }
  if (expectedAsset === LARGE_GOLD_ASSET_ID && graphicAssetId === SMALL_GOLD_ASSET_ID) {
    return LARGE_GOLD_ASSET_ID;
  }
  return graphicAssetId;
}
