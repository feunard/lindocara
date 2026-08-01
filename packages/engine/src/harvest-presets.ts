import type { HarvestProfile } from "./harvest.js";
import type { EditorAssetId } from "./tiny-swords-catalog.js";

/**
 * Stable authoring templates for harvestable map events.
 *
 * The preset id carries semantics; asset ids are only the two appearances an author starts with.
 * Runtime code consumes the persisted HarvestProfile and never attempts to recover it from either
 * image id, its source filename, or its directory.
 */
export const HARVEST_PRESET_IDS = [
  "tree",
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

export const HARVEST_PRESETS: readonly HarvestPresetDefinition[] = [
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
      harvestDurationMs: 900,
      exhaustedAssetId: "resource.terrain-resources-wood-trees.stump-1",
      exhaustionBehavior: "replace",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 350,
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
      harvestDurationMs: 1_100,
      exhaustedAssetId: null,
      exhaustionBehavior: "fade",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 450,
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
      harvestDurationMs: 1_200,
      exhaustedAssetId: null,
      exhaustionBehavior: "fade",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 500,
    },
  },
  {
    id: "gold_small",
    intactAssetId: "resource.terrain-resources-gold-gold-stones.gold-stone-6",
    profile: {
      resource: "gold",
      tool: "pickaxe",
      yieldAmount: 0,
      goldValue: 25,
      hitsRequired: 2,
      range: 88,
      harvestDurationMs: 1_000,
      exhaustedAssetId: null,
      exhaustionBehavior: "fade",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 500,
    },
  },
  {
    id: "gold_large",
    intactAssetId: "resource.terrain-resources-gold-gold-resource.gold-resource",
    profile: {
      resource: "gold",
      tool: "pickaxe",
      yieldAmount: 0,
      goldValue: 100,
      hitsRequired: 5,
      range: 88,
      harvestDurationMs: 1_200,
      exhaustedAssetId: null,
      exhaustionBehavior: "fade",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 650,
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
      harvestDurationMs: 700,
      exhaustedAssetId: null,
      exhaustionBehavior: "hide",
      respawn: "permanent",
      respawnDelayMs: 0,
      fadeDurationMs: 350,
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
      harvestDurationMs: 900,
      exhaustedAssetId: "resource.terrain-resources-meat-meat-resource.meat-resource",
      exhaustionBehavior: "replace",
      respawn: "timed",
      respawnDelayMs: 300_000,
      fadeDurationMs: 450,
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
      harvestDurationMs: 1_000,
      exhaustedAssetId: "resource.terrain-resources-meat-meat-resource.meat-resource",
      exhaustionBehavior: "replace",
      respawn: "timed",
      respawnDelayMs: 300_000,
      fadeDurationMs: 450,
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
  return { ...harvestPreset(id).profile };
}
