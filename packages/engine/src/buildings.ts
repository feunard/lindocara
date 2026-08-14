import {
  type EditorAssetDefinition,
  type EditorAssetId,
  editorAsset,
} from "./tiny-swords-catalog.js";

/** The authored durability contract carried by a standing building element. */
export interface BuildingSettings {
  /** Indestructible buildings keep their HP value so toggling destruction back on is lossless. */
  destructible: boolean;
  maxHp: number;
}

/** One authored building projected into the heightfield room's centred, tile-unit space. */
export interface ZoneBuildingDefinition extends BuildingSettings {
  id: string;
  x: number;
  z: number;
  standingAssetId: EditorAssetId;
  destroyedAssetId: EditorAssetId;
  /** The original solid footprint remains authoritative after destruction: a ruin is still solid. */
  collider: { x: number; z: number; w: number; h: number };
}

export const MIN_BUILDING_HP = 1;
export const MAX_BUILDING_HP = 1_000_000;

export type BuildingArchetype = "house" | "tower" | "archery" | "barracks" | "monastery" | "castle";

const DESTROYED_HOUSE =
  "building.factions-knights-buildings-house.house-destroyed" as EditorAssetId;
const DESTROYED_TOWER =
  "building.factions-knights-buildings-tower.tower-destroyed" as EditorAssetId;
const DESTROYED_CASTLE =
  "building.factions-knights-buildings-castle.castle-destroyed" as EditorAssetId;
const DESTROYED_GOBLIN_HOUSE =
  "building.factions-goblins-buildings-wood-house.goblin-house-destroyed" as EditorAssetId;
const DESTROYED_GOBLIN_TOWER =
  "building.factions-goblins-buildings-wood-tower.wood-tower-destroyed" as EditorAssetId;

/** Ruins are terminal appearances, not a second destructible building. */
export function isDestroyedBuildingAsset(assetId: string): boolean {
  const asset = editorAsset(assetId);
  return asset?.editor.category === "buildings" && asset.tags.includes("destroyed");
}

/** A catalogue building which can still be damaged. Construction variants count as standing. */
export function isStandingBuildingAsset(assetId: string): assetId is EditorAssetId {
  const asset = editorAsset(assetId);
  return asset?.editor.category === "buildings" && !asset.tags.includes("destroyed");
}

export function buildingArchetype(assetId: string): BuildingArchetype | null {
  if (!isStandingBuildingAsset(assetId)) return null;
  const name = assetId.toLowerCase();
  if (name.includes("monastery")) return "monastery";
  if (name.includes("barracks")) return "barracks";
  if (name.includes("archery")) return "archery";
  if (name.includes("castle")) return "castle";
  if (name.includes("tower")) return "tower";
  if (name.includes("house")) return "house";
  return null;
}

/**
 * The closest shipped ruin for every standing building. Update 010 provides exact house, tower and
 * castle ruins. The older Free Pack has no dedicated barracks/archery/monastery wreck, so those
 * larger structures deliberately fall back to the neutral castle ruin instead of remaining intact.
 */
export function destroyedBuildingAssetId(assetId: string): EditorAssetId | null {
  const archetype = buildingArchetype(assetId);
  if (!archetype) return null;
  if (assetId.includes("factions-goblins")) {
    return archetype === "house" ? DESTROYED_GOBLIN_HOUSE : DESTROYED_GOBLIN_TOWER;
  }
  if (archetype === "house") return DESTROYED_HOUSE;
  if (archetype === "tower") return DESTROYED_TOWER;
  return DESTROYED_CASTLE;
}

function typeMultiplier(archetype: BuildingArchetype): number {
  switch (archetype) {
    case "house":
      return 1;
    case "tower":
    case "archery":
      return 1.25;
    case "barracks":
    case "monastery":
      return 1.5;
    case "castle":
      return 2;
  }
}

function footprintArea(asset: EditorAssetDefinition): number {
  return Math.max(1, asset.editor.visualFootprint.length);
}

/** Default HP grows with both the asset footprint and its authored building type. */
export function defaultBuildingMaxHp(assetId: string): number | null {
  const asset = editorAsset(assetId);
  const archetype = buildingArchetype(assetId);
  if (!asset || !archetype) return null;
  const raw = footprintArea(asset) * 100 * typeMultiplier(archetype);
  return Math.round(raw / 50) * 50;
}

export function defaultBuildingSettings(assetId: string): BuildingSettings | null {
  const maxHp = defaultBuildingMaxHp(assetId);
  return maxHp === null ? null : { destructible: true, maxHp };
}

/** Strict wire parser for an explicit building configuration. */
export function parseBuildingSettings(value: unknown): BuildingSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const { destructible, maxHp } = value as Record<string, unknown>;
  if (typeof destructible !== "boolean") return null;
  if (!Number.isSafeInteger(maxHp)) return null;
  const hp = maxHp as number;
  if (hp < MIN_BUILDING_HP || hp > MAX_BUILDING_HP) return null;
  return { destructible, maxHp: hp };
}
