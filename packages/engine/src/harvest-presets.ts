import {
  cloneHarvestProfile,
  type HarvestProfile,
  type HarvestResourceKind,
  type HarvestTool,
} from "./harvest.js";
import type { EditorAssetId } from "./tiny-swords-catalog.js";

/**
 * Stable native-resource definitions for scenery assets.
 *
 * This list is the explicit gameplay catalogue: resource semantics are never inferred from a file
 * name, directory or broad catalogue category. Placing one of these exact assets as scenery makes
 * it a Peasant resource by default; legacy harvestable events keep their persisted profile.
 */
export const HARVEST_PRESET_IDS = [
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
  "wood_stump_1",
  "wood_stump_2",
  "wood_stump_3",
  "wood_stump_4",
  "wood_update_stump",
  "wood_cache",
  "wood_update_cache",
  "wood_update_cache_noshadow",
  "stone_outcrop",
  "stone_rock_2",
  "iron_outcrop",
  "iron_rock_4",
  "stone_deco_small",
  "stone_deco_medium",
  "stone_deco_large",
  "stone_water_free_1",
  "stone_water_free_2",
  "iron_water_free_3",
  "iron_water_free_4",
  "stone_water_update_1",
  "stone_water_update_2",
  "iron_water_update_3",
  "iron_water_update_4",
  "gold_small",
  "gold_stone_1",
  "gold_stone_2",
  "gold_stone_3",
  "gold_stone_4",
  "gold_stone_5",
  "gold_large",
  "gold_update_cache",
  "gold_update_cache_noshadow",
  "meat_cache",
  "meat_update_cache",
  "meat_update_cache_noshadow",
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

type ResourceSize = 1 | 2 | 3;

const TOOL_BY_RESOURCE: Readonly<Record<HarvestResourceKind, HarvestTool>> = {
  wood: "axe",
  stone: "pickaxe",
  iron: "pickaxe",
  gold: "pickaxe",
  meat: "knife",
};

const RESOURCE_COLLISION = {
  1: { offsetX: -14, offsetY: -12, width: 28, height: 12 },
  2: { offsetX: -20, offsetY: -17, width: 40, height: 17 },
  3: { offsetX: -26, offsetY: -22, width: 52, height: 22 },
} as const;

function staticResourcePreset(
  id: HarvestPresetId,
  intactAssetId: EditorAssetId,
  resource: HarvestResourceKind,
  size: ResourceSize,
): HarvestPresetDefinition {
  return {
    id,
    intactAssetId,
    profile: {
      resource,
      tool: TOOL_BY_RESOURCE[resource],
      yieldAmount: resource === "gold" ? 0 : size,
      goldValue: resource === "gold" ? size : 0,
      hitsRequired: size,
      range: resource === "wood" ? 96 : resource === "meat" ? 80 : 88,
      harvestDurationMs: 0,
      exhaustedAssetId: null,
      exhaustionBehavior: resource === "meat" ? "hide" : "fade",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 350 + size * 100,
      collision: {
        intact: { ...RESOURCE_COLLISION[size] },
        depleted: null,
      },
    },
  };
}

function treePreset(
  id: HarvestPresetId,
  intactAssetId: EditorAssetId,
  exhaustedAssetId: EditorAssetId,
  size: ResourceSize,
): HarvestPresetDefinition {
  const collision = RESOURCE_COLLISION[size];
  return {
    id,
    intactAssetId,
    profile: {
      resource: "wood",
      tool: "axe",
      yieldAmount: size,
      goldValue: 0,
      hitsRequired: size + 1,
      range: 96,
      harvestDurationMs: 0,
      exhaustedAssetId,
      exhaustionBehavior: "replace",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 350,
      collision: {
        intact: {
          offsetX: collision.offsetX,
          offsetY: collision.offsetY - size * 4,
          width: collision.width,
          height: collision.height + size * 4,
        },
        depleted:
          size === 1
            ? { offsetX: -12, offsetY: -10, width: 24, height: 10 }
            : { offsetX: -15, offsetY: -12, width: 30, height: 12 },
      },
    },
  };
}

function sheepPreset(
  id: "sheep" | "happy_sheep",
  intactAssetId: EditorAssetId,
): HarvestPresetDefinition {
  return {
    id,
    intactAssetId,
    profile: {
      resource: "meat",
      tool: "knife",
      yieldAmount: 1,
      goldValue: 0,
      // Warcraft-style critter interaction stays four deliberate clicks; only its reward changes.
      hitsRequired: 4,
      range: 80,
      harvestDurationMs: 0,
      exhaustedAssetId: null,
      exhaustionBehavior: "hide",
      respawn: "timed",
      respawnDelayMs: 300_000,
      fadeDurationMs: 450,
      collision: {
        intact: { offsetX: -24, offsetY: -28, width: 48, height: 28 },
        depleted: null,
      },
      actorBehavior: "wander",
    },
  };
}

export const HARVEST_PRESETS: readonly HarvestPresetDefinition[] = [
  treePreset(
    "tree_tall",
    "resource.terrain-resources-wood-trees.tree2",
    "resource.terrain-resources-wood-trees.stump-2",
    3,
  ),
  treePreset(
    "tree",
    "resource.terrain-resources-wood-trees.tree1",
    "resource.terrain-resources-wood-trees.stump-1",
    3,
  ),
  treePreset(
    "tree_medium",
    "resource.terrain-resources-wood-trees.tree3",
    "resource.terrain-resources-wood-trees.stump-3",
    2,
  ),
  treePreset(
    "tree_small",
    "resource.terrain-resources-wood-trees.tree4",
    "resource.terrain-resources-wood-trees.stump-4",
    1,
  ),
  ...([1, 2, 3, 4, 5, 6] as const).map((variant) =>
    treePreset(
      `tree_update_${variant}`,
      `resource.resources-trees.tree-${variant}`,
      "resource.resources-trees.stump",
      3,
    ),
  ),
  ...([1, 2, 3, 4] as const).map((variant) =>
    staticResourcePreset(
      `wood_stump_${variant}`,
      `resource.terrain-resources-wood-trees.stump-${variant}`,
      "wood",
      1,
    ),
  ),
  staticResourcePreset("wood_update_stump", "resource.resources-trees.stump", "wood", 1),
  staticResourcePreset(
    "wood_cache",
    "resource.terrain-resources-wood-wood-resource.wood-resource",
    "wood",
    1,
  ),
  staticResourcePreset("wood_update_cache", "resource.resources-resources.w-idle", "wood", 1),
  staticResourcePreset(
    "wood_update_cache_noshadow",
    "resource.resources-resources.w-idle-noshadow",
    "wood",
    1,
  ),
  staticResourcePreset("stone_outcrop", "decoration.terrain-decorations-rocks.rock1", "stone", 1),
  staticResourcePreset("stone_rock_2", "decoration.terrain-decorations-rocks.rock2", "stone", 2),
  staticResourcePreset("iron_outcrop", "decoration.terrain-decorations-rocks.rock3", "iron", 2),
  staticResourcePreset("iron_rock_4", "decoration.terrain-decorations-rocks.rock4", "iron", 3),
  staticResourcePreset("stone_deco_small", "decoration.deco.04", "stone", 1),
  staticResourcePreset("stone_deco_medium", "decoration.deco.05", "stone", 2),
  staticResourcePreset("stone_deco_large", "decoration.deco.06", "stone", 3),
  staticResourcePreset(
    "stone_water_free_1",
    "decoration.terrain-decorations-rocks-in-the-water.water-rocks-01",
    "stone",
    1,
  ),
  staticResourcePreset(
    "stone_water_free_2",
    "decoration.terrain-decorations-rocks-in-the-water.water-rocks-02",
    "stone",
    2,
  ),
  staticResourcePreset(
    "iron_water_free_3",
    "decoration.terrain-decorations-rocks-in-the-water.water-rocks-03",
    "iron",
    1,
  ),
  staticResourcePreset(
    "iron_water_free_4",
    "decoration.terrain-decorations-rocks-in-the-water.water-rocks-04",
    "iron",
    3,
  ),
  staticResourcePreset("stone_water_update_1", "terrain.terrain-water-rocks.rocks-01", "stone", 1),
  staticResourcePreset("stone_water_update_2", "terrain.terrain-water-rocks.rocks-02", "stone", 1),
  staticResourcePreset("iron_water_update_3", "terrain.terrain-water-rocks.rocks-03", "iron", 2),
  staticResourcePreset("iron_water_update_4", "terrain.terrain-water-rocks.rocks-04", "iron", 3),
  staticResourcePreset("gold_small", SMALL_GOLD_ASSET_ID, "gold", 1),
  staticResourcePreset(
    "gold_stone_1",
    "resource.terrain-resources-gold-gold-stones.gold-stone-1",
    "gold",
    1,
  ),
  staticResourcePreset(
    "gold_stone_2",
    "resource.terrain-resources-gold-gold-stones.gold-stone-2",
    "gold",
    1,
  ),
  staticResourcePreset(
    "gold_stone_3",
    "resource.terrain-resources-gold-gold-stones.gold-stone-3",
    "gold",
    2,
  ),
  staticResourcePreset(
    "gold_stone_4",
    "resource.terrain-resources-gold-gold-stones.gold-stone-4",
    "gold",
    2,
  ),
  staticResourcePreset(
    "gold_stone_5",
    "resource.terrain-resources-gold-gold-stones.gold-stone-5",
    "gold",
    3,
  ),
  staticResourcePreset("gold_large", LARGE_GOLD_ASSET_ID, "gold", 3),
  staticResourcePreset("gold_update_cache", "resource.resources-resources.g-idle", "gold", 1),
  staticResourcePreset(
    "gold_update_cache_noshadow",
    "resource.resources-resources.g-idle-noshadow",
    "gold",
    1,
  ),
  staticResourcePreset(
    "meat_cache",
    "resource.terrain-resources-meat-meat-resource.meat-resource",
    "meat",
    1,
  ),
  staticResourcePreset("meat_update_cache", "resource.resources-resources.m-idle", "meat", 1),
  staticResourcePreset(
    "meat_update_cache_noshadow",
    "resource.resources-resources.m-idle-noshadow",
    "meat",
    1,
  ),
  sheepPreset("sheep", "resource.terrain-resources-meat-sheep.sheep-idle"),
  sheepPreset("happy_sheep", "resource.resources-sheep.happysheep-idle"),
];

const HARVEST_PRESET_BY_ID = new Map(HARVEST_PRESETS.map((preset) => [preset.id, preset]));
const HARVEST_PRESET_BY_ASSET = new Map(
  HARVEST_PRESETS.map((preset) => [preset.intactAssetId, preset]),
);

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

/** The curated native-resource definition for one exact scenery asset. */
export function nativeHarvestPresetForAsset(
  assetId: EditorAssetId,
): HarvestPresetDefinition | null {
  return HARVEST_PRESET_BY_ASSET.get(assetId) ?? null;
}

export function isNativeHarvestAsset(assetId: EditorAssetId): boolean {
  return HARVEST_PRESET_BY_ASSET.has(assetId);
}

/** A detached runtime profile so no node can mutate the shared catalogue definition. */
export function nativeHarvestProfileForAsset(assetId: EditorAssetId): HarvestProfile | null {
  const preset = nativeHarvestPresetForAsset(assetId);
  return preset ? cloneHarvestProfile(preset.profile) : null;
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
