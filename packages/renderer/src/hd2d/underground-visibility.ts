import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  undergroundFloorHeight,
  undergroundTerrainHeightAt,
  undergroundTransitionAt,
} from "@lindocara/engine/underground.js";

function cellAt(
  map: MapData,
  x: number,
  z: number,
): { col: number; row: number; index: number } | null {
  const col = Math.floor(x + map.size / 2);
  const row = Math.floor(z + map.size / 2);
  if (col < 0 || row < 0 || col >= map.size || row >= map.size) return null;
  return { col, row, index: row * map.size + col };
}

/**
 * The authored floor closest to a grounded body at this cell.
 *
 * Elevation alone cannot name a storey: a surface plateau at +0.9 used to be mistaken for upper
 * floor -1. Comparing against the actual surface and excavated floors keeps raised surface terrain
 * on the surface while still recovering the right storey after a teleport or initial join.
 */
export function groundedUndergroundVisibilityDepth(
  map: MapData,
  x: number,
  z: number,
  elevation: number,
): number | null {
  const cell = cellAt(map, x, z);
  if (!cell) return null;
  const explicitLiquid = map.liquids?.[cell.index] ?? null;
  const surfaceLevel = map.levels[cell.index];
  const surfaceHeight =
    explicitLiquid !== null
      ? map.liquidLevels?.[cell.index] === null || map.liquidLevels?.[cell.index] === undefined
        ? map.waterLevel
        : (map.liquidLevels[cell.index] ?? 0) * map.levelHeight
      : surfaceLevel === null || surfaceLevel === undefined
        ? map.waterLevel
        : surfaceLevel * map.levelHeight;
  let closestDepth: number | null = null;
  let closestDistance = Math.abs(elevation - surfaceHeight);

  for (const level of map.underground?.levels ?? []) {
    const containsCell = level.cells.some(
      (run) => run.row === cell.row && cell.col >= run.col && cell.col < run.col + run.length,
    );
    if (!containsCell) continue;
    const floor = undergroundTerrainHeightAt(
      map.underground,
      level.depth,
      cell.col,
      cell.row,
      map.levelHeight,
    );
    const distance = Math.abs(elevation - floor);
    if (distance >= closestDistance) continue;
    closestDepth = level.depth;
    closestDistance = distance;
  }
  return closestDepth;
}

/**
 * Whether vertical body motion is genuinely crossing an access rather than jumping beside it.
 * Rising never descends through a shaft, and the falling half of a local jump remains in its
 * current view until it passes below the exact ground elevation from which it took off.
 */
export function undergroundVisibilityTransitionAt(
  map: MapData,
  x: number,
  z: number,
  elevation: number,
  airborne: boolean,
  verticalVelocity: number,
  stableDepth: number | null,
  stableElevation: number,
): boolean {
  if (!map.underground) return false;
  if (!undergroundTransitionAt(map.underground, map.size, x, z, stableDepth)) return false;
  if (!airborne) return true;
  if (verticalVelocity > 0) return false;
  return elevation < stableElevation - 1e-3;
}

/** Stable visibility uses a storey's architectural floor, never local raised terrain. */
export function undergroundVisibilityElevation(depth: number | null): number {
  return depth === null ? 0 : undergroundFloorHeight(depth);
}
