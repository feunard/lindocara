import {
  BUILDING_DIMENSION_STEP,
  type BuildingDimensionAxis,
  type BuildingDimensions,
  buildingDimensionsOrDefault,
  MAX_BUILDING_DIMENSION,
  MIN_BUILDING_DIMENSION,
  parseBuildingDimensions,
  proportionalBuildingDimensions,
} from "./buildings.js";
import { editorAsset } from "./tiny-swords-catalog.js";

/** True for catalogue scenery rendered as native fixed geometry rather than a billboard. */
export function isNativeSceneryAsset(assetId: string): boolean {
  return editorAsset(assetId)?.editor.native3d !== undefined;
}

/** Shared footprint lookup for buildings and every catalogue-declared native 3D prop. */
export function nativeSceneryDimensionsOrDefault(
  assetId: string,
  dimensions?: BuildingDimensions,
): BuildingDimensions | null {
  const building = buildingDimensionsOrDefault(assetId, dimensions);
  if (building) return building;
  const native = editorAsset(assetId)?.editor.native3d;
  if (!native) return null;
  return dimensions ? parseBuildingDimensions(dimensions) : parseBuildingDimensions(native);
}

/** Resize one native footprint axis while preserving the model's authored proportions. */
export function proportionalNativeSceneryDimensions(
  assetId: string,
  axis: BuildingDimensionAxis,
  value: number,
): BuildingDimensions | null {
  const building = proportionalBuildingDimensions(assetId, axis, value);
  if (building) return building;
  const native = nativeSceneryDimensionsOrDefault(assetId);
  if (!native || !Number.isFinite(value)) return null;
  const minimumScale = Math.max(
    MIN_BUILDING_DIMENSION / native.width,
    MIN_BUILDING_DIMENSION / native.depth,
  );
  const maximumScale = Math.min(
    MAX_BUILDING_DIMENSION / native.width,
    MAX_BUILDING_DIMENSION / native.depth,
  );
  const scale = Math.max(minimumScale, Math.min(maximumScale, value / native[axis]));
  const snap = (dimension: number): number =>
    Math.max(
      MIN_BUILDING_DIMENSION,
      Math.min(
        MAX_BUILDING_DIMENSION,
        Math.round((dimension * scale) / BUILDING_DIMENSION_STEP) * BUILDING_DIMENSION_STEP,
      ),
    );
  return parseBuildingDimensions({ width: snap(native.width), depth: snap(native.depth) });
}
