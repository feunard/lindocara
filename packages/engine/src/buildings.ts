import { type ElementOrientation, isElementOrientation } from "./element-orientation.js";
import type { GroundVector } from "./ground.js";
import { isUuid } from "./identifiers.js";
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
  /** Ordinary authored map used as this building's editable interior. */
  interiorMapId?: string;
  /** Optional authored footprint. Absent preserves the archetype's native dimensions. */
  dimensions?: BuildingDimensions;
}

export interface BuildingDimensions {
  /** Facade width in world tiles, before the authored quarter-turn is applied. */
  width: number;
  /** Distance from the front threshold to the back wall, in world tiles. */
  depth: number;
}

/** One authored building projected into the heightfield room's centred, tile-unit space. */
export interface ZoneBuildingDefinition extends BuildingSettings {
  id: string;
  x: number;
  z: number;
  standingAssetId: EditorAssetId;
  destroyedAssetId: EditorAssetId;
  orientation?: ElementOrientation;
  /** The original solid footprint remains authoritative after destruction: a ruin is still solid. */
  collider: BuildingCollider;
}

export interface BuildingCollider {
  x: number;
  z: number;
  w: number;
  h: number;
}

/** The player's world-position radius at which the doorway prompt and transition are reachable. */
export const BUILDING_DOOR_INTERACTION_RANGE = 0.55;

export interface BuildingDoorPlacement {
  x: number;
  z: number;
  assetId: string;
  orientation?: ElementOrientation;
  dimensions?: BuildingDimensions;
}

/** Shortest ground distance to a solid building base; zero while the point is inside the base. */
export function distanceToBuildingCollider(
  point: GroundVector,
  collider: BuildingCollider,
): number {
  const dx = Math.max(collider.x - point.x, 0, point.x - (collider.x + collider.w));
  const dz = Math.max(collider.z - point.z, 0, point.z - (collider.z + collider.h));
  return Math.hypot(dx, dz);
}

/**
 * Ground point at the centre of the visible front door. The authored building anchor already is
 * the front threshold; only buildings with an asymmetric facade need a lateral offset. Rotating
 * this local point by the authored quarter-turn keeps the door fixed to the model instead of
 * making the interaction follow an unrotated collider side.
 */
export function buildingDoorGroundPoint(placement: BuildingDoorPlacement): GroundVector {
  const archetype = buildingArchetype(placement.assetId);
  const size = archetype ? buildingVolumeDimensions(archetype, placement.dimensions) : null;
  const localX =
    archetype === "house"
      ? (size?.width ?? 0) * 0.2
      : archetype === "archery"
        ? (size?.width ?? 0) * 0.31
        : 0;
  const orientation = placement.orientation ?? 0;
  switch (orientation) {
    case 1:
      return { x: placement.x, z: placement.z + localX };
    case 2:
      return { x: placement.x - localX, z: placement.z };
    case 3:
      return { x: placement.x, z: placement.z - localX };
    default:
      return { x: placement.x + localX, z: placement.z };
  }
}

export function distanceToBuildingDoor(
  point: GroundVector,
  placement: BuildingDoorPlacement,
): number {
  const door = buildingDoorGroundPoint(placement);
  return Math.hypot(point.x - door.x, point.z - door.z);
}

export const MIN_BUILDING_HP = 1;
export const MAX_BUILDING_HP = 1_000_000;
export const MIN_BUILDING_DIMENSION = 1;
export const MAX_BUILDING_DIMENSION = 32;
/** Native footprints already use eighth-cell measurements, so resizing keeps that exact grid. */
export const BUILDING_DIMENSION_STEP = 1 / 8;
const BUILDING_DIMENSION_UNITS = 1 / BUILDING_DIMENSION_STEP;
const BUILDING_TRANSFORM_CODE_OFFSET = 4;
const BUILDING_DIMENSION_CODE_BASE = MAX_BUILDING_DIMENSION * BUILDING_DIMENSION_UNITS + 1;

export type BuildingArchetype =
  | "house"
  | "tower"
  | "windmill"
  | "archery"
  | "barracks"
  | "monastery"
  | "castle";

/**
 * Native building measurements in world tiles. Rendering and collision deliberately consume this
 * same table: changing a roof in one without the other would put the hero inside the visible mesh.
 */
export interface BuildingVolumeDimensions {
  /** Exact authored solid footprint. The placement anchor is the centre of the front edge. */
  width: number;
  depth: number;
  wallHeight: number;
  roofHeight: number;
  roofShape: "gable" | "cone" | "crenellated";
}

export function buildingVolumeDimensions(
  archetype: BuildingArchetype,
  dimensions?: BuildingDimensions,
): BuildingVolumeDimensions {
  const native: BuildingVolumeDimensions = (() => {
    switch (archetype) {
      case "tower":
        return { width: 2, depth: 2, wallHeight: 3.1, roofHeight: 0.5, roofShape: "crenellated" };
      case "windmill":
        return { width: 2.75, depth: 2, wallHeight: 2.65, roofHeight: 0.92, roofShape: "cone" };
      case "archery":
        return { width: 3, depth: 2.25, wallHeight: 1.42, roofHeight: 1.18, roofShape: "gable" };
      case "barracks":
        return {
          width: 3,
          depth: 2.375,
          wallHeight: 1.72,
          roofHeight: 0.48,
          roofShape: "crenellated",
        };
      case "monastery":
        return { width: 3, depth: 2.25, wallHeight: 1.58, roofHeight: 1.28, roofShape: "gable" };
      case "castle":
        return {
          width: 3,
          depth: 2.375,
          wallHeight: 2.02,
          roofHeight: 0.55,
          roofShape: "crenellated",
        };
      case "house":
        return { width: 2.75, depth: 2.125, wallHeight: 1.3, roofHeight: 1.38, roofShape: "gable" };
    }
  })();
  return dimensions ? { ...native, ...dimensions } : native;
}

export function parseBuildingDimensions(value: unknown): BuildingDimensions | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { width, depth } = value as Record<string, unknown>;
  if (typeof width !== "number" || typeof depth !== "number") return null;
  const widthUnits = width * BUILDING_DIMENSION_UNITS;
  const depthUnits = depth * BUILDING_DIMENSION_UNITS;
  if (!Number.isSafeInteger(widthUnits) || !Number.isSafeInteger(depthUnits)) return null;
  if (
    width < MIN_BUILDING_DIMENSION ||
    width > MAX_BUILDING_DIMENSION ||
    depth < MIN_BUILDING_DIMENSION ||
    depth > MAX_BUILDING_DIMENSION
  ) {
    return null;
  }
  return { width, depth };
}

export function buildingDimensionsOrDefault(
  assetId: string,
  dimensions?: BuildingDimensions,
): BuildingDimensions | null {
  const archetype = buildingArchetype(assetId);
  if (!archetype) return null;
  const size = buildingVolumeDimensions(archetype, dimensions);
  return { width: size.width, depth: size.depth };
}

/** Compact orientation + optional footprint in the existing map-element transform integer. */
export function encodeBuildingTransform(
  orientation: ElementOrientation = 0,
  dimensions?: BuildingDimensions,
): number {
  if (!dimensions) return orientation;
  const widthUnits = Math.round(dimensions.width * BUILDING_DIMENSION_UNITS);
  const depthUnits = Math.round(dimensions.depth * BUILDING_DIMENSION_UNITS);
  return (
    BUILDING_TRANSFORM_CODE_OFFSET +
    (widthUnits * BUILDING_DIMENSION_CODE_BASE + depthUnits) * 4 +
    orientation
  );
}

export function decodeBuildingTransform(
  code: number,
): { orientation: ElementOrientation; dimensions?: BuildingDimensions } | null {
  if (isElementOrientation(code)) return { orientation: code };
  if (!Number.isSafeInteger(code) || code < BUILDING_TRANSFORM_CODE_OFFSET) return null;
  const packed = code - BUILDING_TRANSFORM_CODE_OFFSET;
  const orientation = packed % 4;
  if (!isElementOrientation(orientation)) return null;
  const dimensionsCode = Math.floor(packed / 4);
  const dimensions = parseBuildingDimensions({
    width: Math.floor(dimensionsCode / BUILDING_DIMENSION_CODE_BASE) / BUILDING_DIMENSION_UNITS,
    depth: (dimensionsCode % BUILDING_DIMENSION_CODE_BASE) / BUILDING_DIMENSION_UNITS,
  });
  return dimensions ? { orientation, dimensions } : null;
}

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
  if (name.includes("windmill")) return "windmill";
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
  if (archetype === "tower" || archetype === "windmill") return DESTROYED_TOWER;
  return DESTROYED_CASTLE;
}

function typeMultiplier(archetype: BuildingArchetype): number {
  switch (archetype) {
    case "house":
      return 1;
    case "tower":
    case "windmill":
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
  const {
    destructible,
    maxHp,
    interiorMapId,
    dimensions: dimensionsValue,
  } = value as Record<string, unknown>;
  if (typeof destructible !== "boolean") return null;
  if (!Number.isSafeInteger(maxHp)) return null;
  const hp = maxHp as number;
  if (hp < MIN_BUILDING_HP || hp > MAX_BUILDING_HP) return null;
  if (interiorMapId !== undefined && !isUuid(interiorMapId)) return null;
  const dimensions =
    dimensionsValue === undefined ? undefined : parseBuildingDimensions(dimensionsValue);
  if (dimensions === null) return null;
  return {
    destructible,
    maxHp: hp,
    ...(typeof interiorMapId === "string" ? { interiorMapId } : {}),
    ...(dimensions ? { dimensions } : {}),
  };
}
