import type { Input, Vec2 } from "./simulation.js";
import { isSolidKind, kindAt, TILE_SIZE, type TileMap } from "./tilemap.js";

const DIRECTION_EPSILON = 1e-6;
const IMPACT_EPSILON = 1e-9;

export const DEFAULT_FACING: Readonly<Vec2> = Object.freeze({ x: 1, y: 0 });

export interface Circle {
  center: Vec2;
  radius: number;
}

export interface FrontalArc {
  origin: Vec2;
  direction: Vec2;
  radius: number;
  innerRadius: number;
  halfAngleRadians: number;
}

export interface DirectionalCone {
  origin: Vec2;
  direction: Vec2;
  length: number;
  halfAngleRadians: number;
}

export interface StrikeCapsule {
  start: Vec2;
  end: Vec2;
  radius: number;
}

export interface ProjectileAdvance {
  from: Vec2;
  to: Vec2;
  distance: number;
}

export interface SegmentImpact {
  /** Fraction along the swept segment, from zero at its origin to one at its destination. */
  fraction: number;
  point: Vec2;
  kind: "entity" | "terrain";
  /** Stable identifier used to make equal-distance impacts deterministic. */
  id: string;
}

export interface TerrainImpact extends SegmentImpact {
  kind: "terrain";
  col: number;
  row: number;
}

function finiteVec(value: Vec2): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
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

/** The last non-zero authoritative movement becomes facing; standing still preserves it. */
export function orientationFromMovement(movement: Vec2, current: Vec2 = DEFAULT_FACING): Vec2 {
  if (!finiteVec(movement) || Math.hypot(movement.x, movement.y) <= DIRECTION_EPSILON) {
    return normalizeDirection(current);
  }
  return normalizeDirection(movement, current);
}

/**
 * Turns one tick's movement `Input` into the vector `orientationFromMovement` expects. This is
 * the one conversion the server's `movement-system.ts` applies to a dequeued command every tick,
 * and the map-preview sandbox applies to its locally-polled input every tick — same function, so
 * a builder walking the preview turns exactly like a player would in the real room.
 */
export function facingFromInput(input: Input, current: Vec2 = DEFAULT_FACING): Vec2 {
  return orientationFromMovement(
    { x: Number(input.right) - Number(input.left), y: Number(input.down) - Number(input.up) },
    current,
  );
}

export function frontalArc(
  origin: Vec2,
  direction: Vec2,
  radius: number,
  halfAngleRadians: number,
  innerRadius = 0,
): FrontalArc {
  return {
    origin: { ...origin },
    direction: normalizeDirection(direction),
    radius: Math.max(0, radius),
    innerRadius: Math.max(0, Math.min(innerRadius, radius)),
    halfAngleRadians: Math.max(0, Math.min(Math.PI, halfAngleRadians)),
  };
}

export function directionalCone(
  origin: Vec2,
  direction: Vec2,
  length: number,
  halfAngleRadians: number,
): DirectionalCone {
  return {
    origin: { ...origin },
    direction: normalizeDirection(direction),
    length: Math.max(0, length),
    halfAngleRadians: Math.max(0, Math.min(Math.PI / 2, halfAngleRadians)),
  };
}

export function strikeCapsule(
  origin: Vec2,
  direction: Vec2,
  length: number,
  radius: number,
): StrikeCapsule {
  const facing = normalizeDirection(direction);
  const safeLength = Math.max(0, length);
  return {
    start: { ...origin },
    end: {
      x: origin.x + facing.x * safeLength,
      y: origin.y + facing.y * safeLength,
    },
    radius: Math.max(0, radius),
  };
}

/** Circle/entity intersection with a frontal annular sector. */
export function circleIntersectsArc(circle: Circle, arc: FrontalArc): boolean {
  if (
    !finiteVec(circle.center) ||
    !finiteNonNegative(circle.radius) ||
    !finiteVec(arc.origin) ||
    !finiteNonNegative(arc.radius) ||
    !finiteNonNegative(arc.innerRadius) ||
    !finiteNonNegative(arc.halfAngleRadians)
  ) {
    return false;
  }
  const dx = circle.center.x - arc.origin.x;
  const dy = circle.center.y - arc.origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance > arc.radius + circle.radius) return false;
  if (distance + circle.radius < arc.innerRadius) return false;
  if (distance <= circle.radius + DIRECTION_EPSILON) return true;

  const facing = normalizeDirection(arc.direction);
  const dot = (dx * facing.x + dy * facing.y) / distance;
  const angularPadding = Math.asin(Math.min(1, circle.radius / distance));
  return dot + IMPACT_EPSILON >= Math.cos(Math.min(Math.PI, arc.halfAngleRadians + angularPadding));
}

/** Circle/entity intersection with a finite directional cone. */
export function circleIntersectsCone(circle: Circle, cone: DirectionalCone): boolean {
  if (
    !finiteVec(circle.center) ||
    !finiteNonNegative(circle.radius) ||
    !finiteVec(cone.origin) ||
    !finiteNonNegative(cone.length) ||
    !finiteNonNegative(cone.halfAngleRadians)
  ) {
    return false;
  }
  const facing = normalizeDirection(cone.direction);
  const dx = circle.center.x - cone.origin.x;
  const dy = circle.center.y - cone.origin.y;
  const forward = dx * facing.x + dy * facing.y;
  if (forward < -circle.radius || forward > cone.length + circle.radius) return false;
  const sideways = Math.abs(dx * -facing.y + dy * facing.x);
  const coneRadius = Math.max(0, forward) * Math.tan(cone.halfAngleRadians);
  return sideways <= coneRadius + circle.radius + IMPACT_EPSILON;
}

function distanceSquaredToSegment(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= DIRECTION_EPSILON * DIRECTION_EPSILON) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }
  const fraction = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
  );
  const closestX = start.x + dx * fraction;
  const closestY = start.y + dy * fraction;
  return (point.x - closestX) ** 2 + (point.y - closestY) ** 2;
}

export function circleIntersectsCapsule(circle: Circle, capsule: StrikeCapsule): boolean {
  if (
    !finiteVec(circle.center) ||
    !finiteNonNegative(circle.radius) ||
    !finiteVec(capsule.start) ||
    !finiteVec(capsule.end) ||
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
  position: Vec2,
  direction: Vec2,
  speed: number,
  dtSeconds: number,
): ProjectileAdvance {
  const from = { ...position };
  const distance = Math.max(0, speed) * Math.max(0, dtSeconds);
  const facing = normalizeDirection(direction);
  return {
    from,
    to: { x: from.x + facing.x * distance, y: from.y + facing.y * distance },
    distance,
  };
}

/**
 * Sweeps a projectile circle against an entity circle and returns the first contact. This uses
 * the whole segment, so a projectile moving farther than an entity's diameter in one tick cannot
 * tunnel through it.
 */
export function sweptProjectileEntityImpact(
  start: Vec2,
  end: Vec2,
  projectileRadius: number,
  entity: Circle,
  entityId: string,
): SegmentImpact | null {
  if (
    !finiteVec(start) ||
    !finiteVec(end) ||
    !finiteNonNegative(projectileRadius) ||
    !finiteVec(entity.center) ||
    !finiteNonNegative(entity.radius)
  ) {
    return null;
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const ox = start.x - entity.center.x;
  const oy = start.y - entity.center.y;
  const radius = projectileRadius + entity.radius;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) {
    return { fraction: 0, point: { ...start }, kind: "entity", id: entityId };
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
    point: pointAlong(start, end, fraction),
    kind: "entity",
    id: entityId,
  };
}

function segmentAabbEntry(
  start: Vec2,
  end: Vec2,
  left: number,
  top: number,
  right: number,
  bottom: number,
): number | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  let entry = 0;
  let exit = 1;
  const axes: readonly [number, number, number, number][] = [
    [start.x, dx, left, right],
    [start.y, dy, top, bottom],
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

/** Sweeps a projectile circle against the collision tiles and returns the first blocked cell. */
export function sweptProjectileTerrainImpact(
  start: Vec2,
  end: Vec2,
  radius: number,
  tiles: TileMap,
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
      const fraction = segmentAabbEntry(
        start,
        end,
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
  return first;
}

function compareImpacts(a: SegmentImpact, b: SegmentImpact): number {
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
