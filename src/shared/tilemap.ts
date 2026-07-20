/**
 * The world's collision truth, as tiles.
 *
 * Platform-free on purpose: the server runs this to decide where players actually are, and the
 * browser runs the identical code to predict its own square (`net.ts` and `prediction.ts` both
 * collide locally). A tilemap only one side could see would desync on the first wall.
 *
 * This module knows nothing about sprites. It stores what a cell *is*, not what it looks like.
 */
import {
  addEdgeCrossings,
  type ColliderIndex,
  collidersOnSegment,
  overlapsCollider,
} from "./collider.js";
import type { Vec2 } from "./simulation.js";

/** Tiny Swords' native tile size. The art is drawn at this scale; using any other would resample it. */
export const TILE_SIZE = 64;

/**
 * What a cell IS. Appearance and solidity are separate questions, which is why `forest` and
 * `building` exist: they are land you cannot walk into. You see grass with trees or a house
 * standing on it — not a lake.
 *
 * `TileKind` is derived from this array, not declared as its own literal union, so anything that
 * must handle every kind (the renderer's ground-texture treatment — see `tileVisual` in
 * `client/game/autotile.ts`) can enumerate them at runtime instead of a hand-kept parallel list
 * silently drifting out of sync with this one.
 */
export const TILE_KINDS = ["grass", "plateau", "forest", "building", "water", "bridge"] as const;
export type TileKind = (typeof TILE_KINDS)[number];

/** Row-major, `cols * rows` entries. */
export interface TileMap {
  cols: number;
  rows: number;
  kinds: readonly TileKind[];
}

/** Water is the void. Forests and buildings are land, but you still cannot walk through them. */
export function isSolidKind(kind: TileKind): boolean {
  return kind === "water" || kind === "forest" || kind === "building";
}

/**
 * Land is everything that is not the void. The autotiled rocky rim is drawn where land meets
 * water — NOT where grass meets a treeline, because a forest is grass with trees standing on it.
 */
export function isLandKind(kind: TileKind): boolean {
  return kind !== "water";
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
  // A non-positive size has no tiles to check. Without this guard the loops below can end up
  // with `right < left` (or `bottom < top`), never run, and fall through to `true` — reporting
  // a degenerate box as walkable even when it sits exactly on a solid tile.
  if (size <= 0) return false;
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

/**
 * Every `t` in `(0, 1)` where `origin + t * delta` crosses a tile boundary. A fixed sampling
 * stride was tried here first and rejected: a ray can graze a solid tile's corner in a chord
 * shorter than any practical stride (the crossing lives in a tiny slice of `t`, not a tiny slice
 * of world distance, so no fixed step size is safe), which is exactly the kind of gap that lets a
 * mover keep re-deciding a blocked line is "clear" forever. Walking every real boundary crossing
 * instead means no crossing, however brief, can fall between two samples.
 */
export function addAxisCrossings(into: number[], origin: number, delta: number): void {
  // `NaN !== NaN`, so a NaN origin or delta would make the loop below never reach `lastTile` —
  // an infinite loop inside a Durable Object's tick, hanging the whole room. No caller passes
  // NaN today (every position is server-computed), but this is a 20Hz tick loop; the guard is
  // free, and it matches the defensiveness `withinRange` already has against a non-finite range.
  if (!Number.isFinite(origin) || !Number.isFinite(delta)) return;
  if (delta === 0) return;
  const step = delta > 0 ? 1 : -1;
  const firstTile = Math.floor(origin / TILE_SIZE);
  const lastTile = Math.floor((origin + delta) / TILE_SIZE);
  for (let tile = firstTile; tile !== lastTile; tile += step) {
    const boundary = (step > 0 ? tile + 1 : tile) * TILE_SIZE;
    const t = (boundary - origin) / delta;
    if (t > 0 && t < 1) into.push(t);
  }
}

/**
 * Sweeps a `size`x`size` box in a straight line from `from` to `to` (both top-left corners, the
 * same convention as `isWalkable`/`resolveTerrain`), true only if the box stays fully walkable
 * for the *entire* path, not just at its ends.
 *
 * This is deliberately not `isWalkable` at two points, nor a point-sampled ray: a body can clip a
 * wall's corner over a stretch too short for its own center point's line to ever touch a solid
 * tile. A caller that treats "the center line is clear" as "the body can walk straight there"
 * attempts a direct move, gets shoved back by real (box) collision the instant the body actually
 * reaches the corner, and — once it disagrees with collision like that — repeats forever: this is
 * the same disagreement `hasLineOfSight` was rewritten to close, one level down, between a
 * direct-move decision and the body it is deciding for.
 */
export function isPathWalkable(
  map: TileMap,
  from: Vec2,
  to: Vec2,
  size: number,
  colliders?: ColliderIndex,
): boolean {
  if (size <= 0) return false;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const crossings = [0, 1];
  addAxisCrossings(crossings, from.x, dx);
  addAxisCrossings(crossings, from.x + size - 1, dx);
  addAxisCrossings(crossings, from.y, dy);
  addAxisCrossings(crossings, from.y + size - 1, dy);
  // A sub-cell collider can sit entirely between two tile-boundary midpoints, so it needs its own
  // edges in the crossing list or the sweep steps over it — sometimes, depending on geometry.
  if (colliders) {
    for (const rect of collidersOnSegment(colliders, from, to, size)) {
      addEdgeCrossings(crossings, from.x, dx, size, rect.x, rect.width);
      addEdgeCrossings(crossings, from.y, dy, size, rect.y, rect.height);
    }
  }
  crossings.sort((a, b) => a - b);
  for (let index = 0; index < crossings.length - 1; index++) {
    const entry = crossings[index];
    const exit = crossings[index + 1];
    if (entry === undefined || exit === undefined) continue;
    const midpoint = (entry + exit) / 2;
    const position = { x: from.x + dx * midpoint, y: from.y + dy * midpoint };
    if (!isWalkableBox(map, position, size)) return false;
    if (colliders && overlapsCollider(colliders, position, size)) return false;
  }
  return true;
}
