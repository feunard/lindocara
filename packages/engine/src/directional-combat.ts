/**
 * Two vocabularies live in this file, deliberately and visibly:
 *
 * - **directions**, still `Vec2`. `normalizeDirection`, `orientationFromMovement`,
 *   `movementDirectionFromInput` and `facingFromInput` are shared with the client's pixel
 *   prediction path, which has not moved yet; they are pure angle arithmetic and mean the same
 *   thing in either unit system. `normalizeGround` below is their ground-typed door.
 * - **geometry**, now `GroundVector`. Every shape, point and impact is a position on the GROUND
 *   PLANE in tile units, `x`/`z`. That is what makes a converted runtime entity — whose `y` is
 *   ELEVATION — fail to compile here instead of silently being measured across the wrong plane.
 *
 * The one exception is `sweptProjectileTerrainImpact` at the bottom, which still indexes a PIXEL
 * `TileMap` and therefore still speaks `Vec2`. It is the pixel path's own function and dies with
 * it; `sweptGroundTerrainImpact` (`packages/server/src/world/terrain-access.ts`) is its heightfield
 * successor and the one every converted system calls.
 */

import { type ColliderIndex, collidersOnSegment } from "./collider.js";
import { type GroundVector, groundOf, planarOf } from "./ground.js";
import type { ColliderRect } from "./hd2d/collider-index.js";
import type { Input, Vec2 } from "./simulation.js";
import { isSolidKind, kindAt, TILE_SIZE, type TileMap } from "./tilemap.js";

const DIRECTION_EPSILON = 1e-6;
const IMPACT_EPSILON = 1e-9;
const ANALOG_DIRECTION_EPSILON = 0.2;

export const DEFAULT_FACING: Readonly<Vec2> = Object.freeze({ x: 1, y: 0 });

/** The ground-plane default facing: `DEFAULT_FACING` read through the same bridge as everything else. */
export const DEFAULT_GROUND_FACING: Readonly<GroundVector> = Object.freeze({ x: 1, z: 0 });

export interface Circle {
  center: GroundVector;
  radius: number;
}

export interface FrontalArc {
  origin: GroundVector;
  direction: GroundVector;
  radius: number;
  innerRadius: number;
  halfAngleRadians: number;
}

export interface DirectionalCone {
  origin: GroundVector;
  direction: GroundVector;
  length: number;
  halfAngleRadians: number;
}

export interface StrikeCapsule {
  start: GroundVector;
  end: GroundVector;
  radius: number;
}

export interface ProjectileAdvance {
  from: GroundVector;
  to: GroundVector;
  distance: number;
}

export interface SegmentImpact {
  /** Fraction along the swept segment, from zero at its origin to one at its destination. */
  fraction: number;
  point: GroundVector;
  kind: "entity" | "terrain";
  /** Stable identifier used to make equal-distance impacts deterministic. */
  id: string;
}

/**
 * The PIXEL path's terrain impact. It does not extend `SegmentImpact` on purpose: its `point` is a
 * pixel `Vec2` and letting the two share a type is exactly how one would end up compared against
 * the other. See the file header.
 */
export interface TerrainImpact {
  fraction: number;
  point: Vec2;
  kind: "terrain";
  id: string;
  /** Cell impacts carry their cell; a sub-cell collider impact has none, and is identified by id. */
  col?: number;
  row?: number;
}

function finiteVec(value: Vec2): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function finiteGround(value: GroundVector): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.z);
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function pointAlong(start: Vec2, end: Vec2, fraction: number): Vec2 {
  return {
    x: start.x + (end.x - start.x) * fraction,
    y: start.y + (end.y - start.y) * fraction,
  };
}

function groundAlong(start: GroundVector, end: GroundVector, fraction: number): GroundVector {
  return {
    x: start.x + (end.x - start.x) * fraction,
    z: start.z + (end.z - start.z) * fraction,
  };
}

/**
 * Returns a unit vector. A zero or invalid direction keeps the supplied authoritative facing;
 * if both are unusable, the stable right-facing default is returned.
 */
export function normalizeDirection(direction: Vec2, fallback: Vec2 = DEFAULT_FACING): Vec2 {
  const source = finiteVec(direction) ? direction : fallback;
  const length = Math.hypot(source.x, source.y);
  if (Number.isFinite(length) && length > DIRECTION_EPSILON) {
    return { x: source.x / length, y: source.y / length };
  }
  const fallbackLength = finiteVec(fallback) ? Math.hypot(fallback.x, fallback.y) : 0;
  if (Number.isFinite(fallbackLength) && fallbackLength > DIRECTION_EPSILON) {
    return { x: fallback.x / fallbackLength, y: fallback.y / fallbackLength };
  }
  return { ...DEFAULT_FACING };
}

/**
 * `normalizeDirection` on the ground plane. It crosses the `planarOf`/`groundOf` bridge once, here,
 * rather than at every geometry call site: the arithmetic is identical, only the field names
 * differ, and one crossing in the engine is auditable where fifty in the world systems are not.
 */
export function normalizeGround(
  direction: GroundVector,
  fallback: GroundVector = DEFAULT_GROUND_FACING,
): GroundVector {
  return groundOf(normalizeDirection(planarOf(direction), planarOf(fallback)));
}

/** The last non-zero authoritative movement becomes facing; standing still preserves it. */
export function orientationFromMovement(movement: Vec2, current: Vec2 = DEFAULT_FACING): Vec2 {
  if (!finiteVec(movement) || Math.hypot(movement.x, movement.y) <= DIRECTION_EPSILON) {
    return normalizeDirection(current);
  }
  return normalizeDirection(movement, current);
}

/** Builds movement direction from digital booleans, with analogue fallback when available. */
export function movementDirectionFromInput(input: Input): Vec2 {
  const axisX = Number(input.axisX);
  const axisY = Number(input.axisY);
  const useAxisX = Number.isFinite(axisX) && Math.abs(axisX) > ANALOG_DIRECTION_EPSILON;
  const useAxisY = Number.isFinite(axisY) && Math.abs(axisY) > ANALOG_DIRECTION_EPSILON;
  if (useAxisX || useAxisY) {
    return {
      x: Number.isFinite(axisX) ? axisX : 0,
      y: Number.isFinite(axisY) ? axisY : 0,
    };
  }
  return {
    x: Number(input.right) - Number(input.left),
    y: Number(input.down) - Number(input.up),
  };
}

/**
 * Turns one tick's movement `Input` into the vector `orientationFromMovement` expects. This is
 * the one conversion the server's `movement-system.ts` applies to a dequeued command every tick,
 * and the map-preview sandbox applies to its locally-polled input every tick — same function, so
 * a builder walking the preview turns exactly like a player would in the real room.
 */
export function facingFromInput(input: Input, current: Vec2 = DEFAULT_FACING): Vec2 {
  return orientationFromMovement(movementDirectionFromInput(input), current);
}

export function frontalArc(
  origin: GroundVector,
  direction: GroundVector,
  radius: number,
  halfAngleRadians: number,
  innerRadius = 0,
): FrontalArc {
  return {
    origin: { x: origin.x, z: origin.z },
    direction: normalizeGround(direction),
    radius: Math.max(0, radius),
    innerRadius: Math.max(0, Math.min(innerRadius, radius)),
    halfAngleRadians: Math.max(0, Math.min(Math.PI, halfAngleRadians)),
  };
}

export function directionalCone(
  origin: GroundVector,
  direction: GroundVector,
  length: number,
  halfAngleRadians: number,
): DirectionalCone {
  return {
    origin: { x: origin.x, z: origin.z },
    direction: normalizeGround(direction),
    length: Math.max(0, length),
    halfAngleRadians: Math.max(0, Math.min(Math.PI / 2, halfAngleRadians)),
  };
}

export function strikeCapsule(
  origin: GroundVector,
  direction: GroundVector,
  length: number,
  radius: number,
): StrikeCapsule {
  const facing = normalizeGround(direction);
  const safeLength = Math.max(0, length);
  return {
    start: { x: origin.x, z: origin.z },
    end: {
      x: origin.x + facing.x * safeLength,
      z: origin.z + facing.z * safeLength,
    },
    radius: Math.max(0, radius),
  };
}

/** Circle/entity intersection with a frontal annular sector. */
export function circleIntersectsArc(circle: Circle, arc: FrontalArc): boolean {
  if (
    !finiteGround(circle.center) ||
    !finiteNonNegative(circle.radius) ||
    !finiteGround(arc.origin) ||
    !finiteNonNegative(arc.radius) ||
    !finiteNonNegative(arc.innerRadius) ||
    !finiteNonNegative(arc.halfAngleRadians)
  ) {
    return false;
  }
  const dx = circle.center.x - arc.origin.x;
  const dy = circle.center.z - arc.origin.z;
  const distance = Math.hypot(dx, dy);
  if (distance > arc.radius + circle.radius) return false;
  if (distance + circle.radius < arc.innerRadius) return false;
  if (distance <= circle.radius + DIRECTION_EPSILON) return true;

  const facing = normalizeGround(arc.direction);
  const dot = (dx * facing.x + dy * facing.z) / distance;
  const angularPadding = Math.asin(Math.min(1, circle.radius / distance));
  return dot + IMPACT_EPSILON >= Math.cos(Math.min(Math.PI, arc.halfAngleRadians + angularPadding));
}

/** Circle/entity intersection with a finite directional cone. */
export function circleIntersectsCone(circle: Circle, cone: DirectionalCone): boolean {
  if (
    !finiteGround(circle.center) ||
    !finiteNonNegative(circle.radius) ||
    !finiteGround(cone.origin) ||
    !finiteNonNegative(cone.length) ||
    !finiteNonNegative(cone.halfAngleRadians)
  ) {
    return false;
  }
  const facing = normalizeGround(cone.direction);
  const dx = circle.center.x - cone.origin.x;
  const dy = circle.center.z - cone.origin.z;
  const forward = dx * facing.x + dy * facing.z;
  if (forward < -circle.radius || forward > cone.length + circle.radius) return false;
  const sideways = Math.abs(dx * -facing.z + dy * facing.x);
  const coneRadius = Math.max(0, forward) * Math.tan(cone.halfAngleRadians);
  return sideways <= coneRadius + circle.radius + IMPACT_EPSILON;
}

function distanceSquaredToSegment(
  point: GroundVector,
  start: GroundVector,
  end: GroundVector,
): number {
  const dx = end.x - start.x;
  const dy = end.z - start.z;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= DIRECTION_EPSILON * DIRECTION_EPSILON) {
    return (point.x - start.x) ** 2 + (point.z - start.z) ** 2;
  }
  const fraction = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dy) / lengthSquared),
  );
  const closestX = start.x + dx * fraction;
  const closestZ = start.z + dy * fraction;
  return (point.x - closestX) ** 2 + (point.z - closestZ) ** 2;
}

export function circleIntersectsCapsule(circle: Circle, capsule: StrikeCapsule): boolean {
  if (
    !finiteGround(circle.center) ||
    !finiteNonNegative(circle.radius) ||
    !finiteGround(capsule.start) ||
    !finiteGround(capsule.end) ||
    !finiteNonNegative(capsule.radius)
  ) {
    return false;
  }
  const combinedRadius = circle.radius + capsule.radius;
  return (
    distanceSquaredToSegment(circle.center, capsule.start, capsule.end) <=
    combinedRadius * combinedRadius + IMPACT_EPSILON
  );
}

export function advanceProjectile(
  position: GroundVector,
  direction: GroundVector,
  speed: number,
  dtSeconds: number,
): ProjectileAdvance {
  const from = { x: position.x, z: position.z };
  const distance = Math.max(0, speed) * Math.max(0, dtSeconds);
  const facing = normalizeGround(direction);
  return {
    from,
    to: { x: from.x + facing.x * distance, z: from.z + facing.z * distance },
    distance,
  };
}

/**
 * Sweeps a projectile circle against an entity circle and returns the first contact. This uses
 * the whole segment, so a projectile moving farther than an entity's diameter in one tick cannot
 * tunnel through it.
 */
export function sweptProjectileEntityImpact(
  start: GroundVector,
  end: GroundVector,
  projectileRadius: number,
  entity: Circle,
  entityId: string,
): SegmentImpact | null {
  if (
    !finiteGround(start) ||
    !finiteGround(end) ||
    !finiteNonNegative(projectileRadius) ||
    !finiteGround(entity.center) ||
    !finiteNonNegative(entity.radius)
  ) {
    return null;
  }
  const dx = end.x - start.x;
  const dy = end.z - start.z;
  const ox = start.x - entity.center.x;
  const oy = start.z - entity.center.z;
  const radius = projectileRadius + entity.radius;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) {
    return { fraction: 0, point: { x: start.x, z: start.z }, kind: "entity", id: entityId };
  }
  const a = dx * dx + dy * dy;
  if (a <= DIRECTION_EPSILON * DIRECTION_EPSILON) return null;
  const b = 2 * (ox * dx + oy * dy);
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const fraction = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (fraction < 0 || fraction > 1) return null;
  return {
    fraction,
    point: groundAlong(start, end, fraction),
    kind: "entity",
    id: entityId,
  };
}

/**
 * The slab test, in scalars rather than in either vocabulary: `(originU, originV)` is the segment's
 * start, `(deltaU, deltaV)` its displacement, and the four bounds its axis-aligned box. Written this
 * way so the pixel sweep, the ground sweep and the server's heightfield sweep are literally the
 * same arithmetic — "two intersection routines that should agree" is how an arrow passes through a
 * trunk on one side and not the other, and that comment already applies once inside this file.
 */
export function segmentBoxEntry(
  originU: number,
  originV: number,
  deltaU: number,
  deltaV: number,
  minU: number,
  minV: number,
  maxU: number,
  maxV: number,
): number | null {
  let entry = 0;
  let exit = 1;
  const axes: readonly [number, number, number, number][] = [
    [originU, deltaU, minU, maxU],
    [originV, deltaV, minV, maxV],
  ];
  for (const [origin, delta, min, max] of axes) {
    if (Math.abs(delta) <= DIRECTION_EPSILON) {
      if (origin < min || origin > max) return null;
      continue;
    }
    const first = (min - origin) / delta;
    const second = (max - origin) / delta;
    const axisEntry = Math.min(first, second);
    const axisExit = Math.max(first, second);
    entry = Math.max(entry, axisEntry);
    exit = Math.min(exit, axisExit);
    if (entry > exit) return null;
  }
  return entry >= 0 && entry <= 1 ? entry : null;
}

/**
 * Direct swept-segment test for a small provenance-aware rectangle set. Callers that must exclude
 * one authored collider by identity can test the remaining rectangles without rebuilding a full
 * map-sized ColliderIndex for every candidate.
 */
export function segmentIntersectsRect(
  start: GroundVector,
  end: GroundVector,
  rect: ColliderRect,
  radius = 0,
): boolean {
  return sweptRectEntry(start, end, rect, radius) !== null;
}

/**
 * The swept entry fraction of a ground segment into one dilated `ColliderRect`, or `null` when it
 * never enters. `segmentIntersectsRect` is the boolean question; the fraction is what a sweep that
 * must report WHERE it was stopped needs, and both must come from one routine.
 */
export function sweptRectEntry(
  start: GroundVector,
  end: GroundVector,
  rect: ColliderRect,
  radius = 0,
): number | null {
  if (
    !finiteGround(start) ||
    !finiteGround(end) ||
    !finiteNonNegative(radius) ||
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.z) ||
    !finiteNonNegative(rect.w) ||
    !finiteNonNegative(rect.h)
  ) {
    return null;
  }
  return segmentBoxEntry(
    start.x,
    start.z,
    end.x - start.x,
    end.z - start.z,
    rect.x - radius,
    rect.z - radius,
    rect.x + rect.w + radius,
    rect.z + rect.h + radius,
  );
}

/**
 * Sweeps a projectile circle against the collision tiles and the sub-cell colliders, returning
 * whichever it meets first. Both use the same `segmentBoxEntry`: two intersection routines that
 * "should" agree is how an arrow passes through a trunk on one side and not the other.
 *
 * **The PIXEL path's function**, and the only `Vec2` geometry left in this file. Its `TileMap` is
 * pixel-indexed from a top-left origin, so it cannot answer for a grid-centred heightfield at all.
 * `sweptGroundTerrainImpact` (`packages/server/src/world/terrain-access.ts`) is its successor and
 * carries the identical sweep against relief and the tile-unit collider index.
 */
export function sweptProjectileTerrainImpact(
  start: Vec2,
  end: Vec2,
  radius: number,
  tiles: TileMap,
  colliders?: ColliderIndex,
): TerrainImpact | null {
  if (!finiteVec(start) || !finiteVec(end) || !finiteNonNegative(radius)) return null;
  const minCol = Math.floor((Math.min(start.x, end.x) - radius) / TILE_SIZE);
  const maxCol = Math.floor((Math.max(start.x, end.x) + radius) / TILE_SIZE);
  const minRow = Math.floor((Math.min(start.y, end.y) - radius) / TILE_SIZE);
  const maxRow = Math.floor((Math.max(start.y, end.y) + radius) / TILE_SIZE);
  let first: TerrainImpact | null = null;
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      if (!isSolidKind(kindAt(tiles, col, row))) continue;
      const fraction = segmentBoxEntry(
        start.x,
        start.y,
        end.x - start.x,
        end.y - start.y,
        col * TILE_SIZE - radius,
        row * TILE_SIZE - radius,
        (col + 1) * TILE_SIZE + radius,
        (row + 1) * TILE_SIZE + radius,
      );
      if (fraction === null) continue;
      const candidate: TerrainImpact = {
        fraction,
        point: pointAlong(start, end, fraction),
        kind: "terrain",
        id: `${row}:${col}`,
        col,
        row,
      };
      if (!first || compareImpacts(candidate, first) < 0) first = candidate;
    }
  }
  if (colliders) {
    // `collidersOnSegment` takes top-left corners; the projectile's box is its centre line dilated
    // by the radius on every side, so shift both ends back by the radius rather than only growing
    // the far edge — otherwise a collider just left of `start` is never even a candidate.
    const candidates = collidersOnSegment(
      colliders,
      { x: start.x - radius, y: start.y - radius },
      { x: end.x - radius, y: end.y - radius },
      Math.max(1, radius * 2),
    );
    for (let index = 0; index < candidates.length; index++) {
      const rect = candidates[index];
      if (!rect) continue;
      const fraction = segmentBoxEntry(
        start.x,
        start.y,
        end.x - start.x,
        end.y - start.y,
        rect.x - radius,
        rect.y - radius,
        rect.x + rect.width + radius,
        rect.y + rect.height + radius,
      );
      if (fraction === null) continue;
      const candidate: TerrainImpact = {
        fraction,
        point: pointAlong(start, end, fraction),
        kind: "terrain",
        id: `c${index}`,
      };
      if (!first || compareImpacts(candidate, first) < 0) first = candidate;
    }
  }
  return first;
}

/**
 * Ordering only, so it reads no point: the ground impacts and the pixel path's `TerrainImpact` are
 * both ordered by fraction, then terrain-wins-ties, then stable id.
 */
function compareImpacts(
  a: Pick<SegmentImpact, "fraction" | "kind" | "id">,
  b: Pick<SegmentImpact, "fraction" | "kind" | "id">,
): number {
  const difference = a.fraction - b.fraction;
  if (Math.abs(difference) > IMPACT_EPSILON) return difference;
  if (a.kind !== b.kind) return a.kind === "terrain" ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/** Terrain wins exact ties, then stable ids make simultaneous entity contacts reproducible. */
export function firstSegmentImpact(
  impacts: readonly (SegmentImpact | null | undefined)[],
): SegmentImpact | null {
  let first: SegmentImpact | null = null;
  for (const impact of impacts) {
    if (!impact) continue;
    if (!first || compareImpacts(impact, first) < 0) first = impact;
  }
  return first;
}
