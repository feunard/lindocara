/**
 * Sub-cell collision, as rectangles.
 *
 * The tile grid answers "is this cell solid"; this answers "is this *part* of a cell solid", which
 * is what a tree trunk needs. Platform-free for the same reason `tilemap.ts` is: the server decides
 * where a body actually is, and the browser predicts with the identical code. A collider only one
 * side could see would desync on the first trunk.
 *
 * Rectangles are bucketed per tile cell at build time and listed in EVERY cell they span, so a
 * query only ever reads the buckets of the cells the body itself touches — never a neighbour, and
 * never the whole list. That keeps the cost bounded by body size instead of by the map's element
 * count.
 */
import type { Rect } from "./game.js";
import type { Vec2 } from "./simulation.js";
import { TILE_SIZE } from "./tilemap.js";

export interface ColliderIndex {
  cols: number;
  rows: number;
  /** `cols * rows` buckets, row-major, indexed exactly like `TileMap.kinds`. */
  buckets: readonly (readonly Rect[])[];
}

const EMPTY_BUCKET: readonly Rect[] = [];

export function emptyColliderIndex(cols: number, rows: number): ColliderIndex {
  const count = Math.max(0, cols) * Math.max(0, rows);
  return { cols, rows, buckets: new Array<readonly Rect[]>(count).fill(EMPTY_BUCKET) };
}

export function colliderIndexFrom(
  rects: readonly Rect[],
  cols: number,
  rows: number,
): ColliderIndex {
  const count = Math.max(0, cols) * Math.max(0, rows);
  const buckets: Rect[][] = Array.from({ length: count }, () => []);
  for (const rect of rects) {
    // A degenerate rect has no interior, so it can never overlap a half-open body interval.
    // Dropping it here keeps the query loop free of the check.
    if (!(rect.width > 0) || !(rect.height > 0)) continue;
    if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) continue;
    const left = Math.max(0, Math.floor(rect.x / TILE_SIZE));
    const top = Math.max(0, Math.floor(rect.y / TILE_SIZE));
    const right = Math.min(cols - 1, Math.floor((rect.x + rect.width - 1) / TILE_SIZE));
    const bottom = Math.min(rows - 1, Math.floor((rect.y + rect.height - 1) / TILE_SIZE));
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        buckets[row * cols + col]?.push(rect);
      }
    }
  }
  return { cols, rows, buckets };
}

/** The index back to a flat rect list, each rect once. The wire ships rects, not buckets: the
 *  receiver rebuilds its own index, so bucket layout never has to be a wire concern. A rect
 *  spanning several cells is listed in every bucket it spans, so this de-duplicates — otherwise
 *  the wire would carry the same rect once per cell it touches. */
export function flattenColliderIndex(index: ColliderIndex): [number, number, number, number][] {
  const seen = new Set<string>();
  const rects: [number, number, number, number][] = [];
  for (const bucket of index.buckets) {
    for (const rect of bucket) {
      const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rects.push([rect.x, rect.y, rect.width, rect.height]);
    }
  }
  return rects;
}

/**
 * `position` is the body's top-left corner and the far edge is exclusive — the same convention
 * `isWalkableBox` uses, so a body sitting exactly on a collider's edge is beside it, not inside it.
 */
export function overlapsCollider(index: ColliderIndex, position: Vec2, size: number): boolean {
  if (size <= 0) return false;
  const left = Math.max(0, Math.floor(position.x / TILE_SIZE));
  const top = Math.max(0, Math.floor(position.y / TILE_SIZE));
  const right = Math.min(index.cols - 1, Math.floor((position.x + size - 1) / TILE_SIZE));
  const bottom = Math.min(index.rows - 1, Math.floor((position.y + size - 1) / TILE_SIZE));
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const bucket = index.buckets[row * index.cols + col];
      if (!bucket) continue;
      for (const rect of bucket) {
        if (
          position.x < rect.x + rect.width &&
          rect.x < position.x + size &&
          position.y < rect.y + rect.height &&
          rect.y < position.y + size
        ) {
          return true;
        }
      }
    }
  }
  return false;
}
