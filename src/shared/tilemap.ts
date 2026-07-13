/**
 * The world's collision truth, as tiles.
 *
 * Platform-free on purpose: the server runs this to decide where players actually are, and the
 * browser runs the identical code to predict its own square (`net.ts` and `prediction.ts` both
 * collide locally). A tilemap only one side could see would desync on the first wall.
 *
 * This module knows nothing about sprites. It stores what a cell *is*, not what it looks like.
 */
import type { Vec2 } from "./simulation.js";

/** Tiny Swords' native tile size. The art is drawn at this scale; using any other would resample it. */
export const TILE_SIZE = 64;

export type TileKind = "grass" | "plateau" | "water" | "bridge";

/** Row-major, `cols * rows` entries. */
export interface TileMap {
  cols: number;
  rows: number;
  kinds: readonly TileKind[];
}

/** Water is the only barrier; a bridge is the sanctioned way across it. */
export function isSolidKind(kind: TileKind): boolean {
  return kind === "water";
}

/** Outside the map is water: it is a wall, and it needs no special case anywhere else. */
export function kindAt(map: TileMap, col: number, row: number): TileKind {
  if (col < 0 || row < 0 || col >= map.cols || row >= map.rows) return "water";
  return map.kinds[row * map.cols + col] ?? "water";
}

export function kindAtPoint(map: TileMap, x: number, y: number): TileKind {
  return kindAt(map, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE));
}

/**
 * A body is a box, not a point. Every cell the box touches must be walkable, or a player standing
 * with one shoulder in the water would be allowed to stand there.
 */
export function isWalkableBox(map: TileMap, position: Vec2, size: number): boolean {
  const left = Math.floor(position.x / TILE_SIZE);
  const top = Math.floor(position.y / TILE_SIZE);
  // The box's far edge is exclusive: a body exactly on a cell boundary does not touch the next cell.
  const right = Math.floor((position.x + size - 1) / TILE_SIZE);
  const bottom = Math.floor((position.y + size - 1) / TILE_SIZE);
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      if (isSolidKind(kindAt(map, col, row))) return false;
    }
  }
  return true;
}
