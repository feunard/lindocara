import { normalizeGround } from "@lindocara/engine/directional-combat.js";
import { type GroundVector, groundDistance, type WorldPosition } from "@lindocara/engine/ground.js";
import {
  BODY_RADIUS,
  canStand,
  groundUnder,
  sweptGroundTerrainImpact,
  type ZoneTerrain,
} from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";

export interface ShadowStepCandidate extends GroundVector {
  id: string;
  deadUntil: number;
}

export interface ShadowStepPlan {
  targetId: string;
  targetPosition: GroundVector;
  destination: WorldPosition;
}

export type ShadowStepPlanningResult =
  | { ok: true; plan: ShadowStepPlan }
  | { ok: false; reason: "no_target" | "blocked" };

export interface ShadowStepPlanningOptions {
  /** Ignores the route and sight blockers, but never authorizes an invalid landing. */
  phaseThroughObstacles?: boolean;
}

export interface ShadowReturnPoint extends WorldPosition {
  expiresAt: number;
}

export type ShadowReturnPlanningResult =
  | { ok: true; destination: WorldPosition }
  | { ok: false; reason: "expired" | "blocked" };

/**
 * The body swept along a teleport route: one hair under the navigation body, exactly as the pixel
 * version's `(PLAYER_SIZE - 1) / 2` was. The hair is what lets a rogue slip through a gap that is
 * precisely body-wide instead of being refused by floating-point luck.
 */
const BODY_SWEEP_RADIUS = BODY_RADIUS - 0.5 / TILE_SIZE;
/** Daylight left between the landing and the target's own body. Four pixels, as before. */
const TARGET_CLEARANCE = 4 / TILE_SIZE;

/**
 * Collision-aware sight for Rogue target acquisition. The historical relief-only helper is enough
 * for old combat arcs, but a teleport must also treat an authored tree trunk as opaque — which is
 * why this asks `sweptGroundTerrainImpact` (relief AND props) rather than `groundLineOfSight`
 * (relief only).
 *
 * `groundY` is the rogue's own ground: relief at or below the rogue's level does not block sight,
 * and anything above it does.
 *
 * The `+ PLAYER_SIZE / 2` that used to recentre both ends is gone. A tile-unit position is already
 * the body's centre; adding half a body would have aimed the sight line off the shoulder.
 */
export function hasRogueLineOfSight(
  from: GroundVector,
  to: GroundVector,
  terrain: ZoneTerrain,
  groundY: number,
): boolean {
  return sweptGroundTerrainImpact(terrain, from, to, 0, groundY) === null;
}

/** A teleport path is a swept player body, never a point jump through a narrow obstacle. */
export function isShadowStepPathClear(
  from: GroundVector,
  destination: GroundVector,
  terrain: ZoneTerrain,
  groundY: number,
): boolean {
  if (!isShadowStepLandingValid(destination, terrain, groundY)) return false;
  return sweptGroundTerrainImpact(terrain, from, destination, BODY_SWEEP_RADIUS, groundY) === null;
}

/**
 * A landing must be somewhere the rogue could be STANDING — `canStand`, the one walkability
 * question the server has. Grounded on the rogue's own level, so a shadow step is no more a way up
 * a cliff than walking is (`MAX_STEP` is 0).
 */
export function isShadowStepLandingValid(
  destination: GroundVector,
  terrain: ZoneTerrain,
  groundY: number,
): boolean {
  return canStand(terrain, destination.x, destination.z, BODY_RADIUS, groundY);
}

function nearestShadowStepTarget<T extends ShadowStepCandidate>(
  origin: GroundVector,
  candidates: Iterable<T>,
  range: number,
  now: number,
  terrain: ZoneTerrain,
  groundY: number,
  options: ShadowStepPlanningOptions,
): T | null {
  let selected: T | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (
      candidate.deadUntil > now ||
      (!options.phaseThroughObstacles && !hasRogueLineOfSight(origin, candidate, terrain, groundY))
    )
      continue;
    const distance = groundDistance(candidate, origin);
    if (distance > range) continue;
    if (
      distance < selectedDistance ||
      (distance === selectedDistance &&
        selected !== null &&
        candidate.id.localeCompare(selected.id) < 0)
    ) {
      selected = candidate;
      selectedDistance = distance;
    }
  }
  return selected;
}

/**
 * Behind is defined by the server-owned origin-to-target axis. If that landing is blocked, the
 * clockwise then counter-clockwise lateral points are attempted in a stable order.
 */
export function shadowStepDestination(
  origin: GroundVector,
  target: GroundVector,
  targetBodyRadius: number,
  terrain: ZoneTerrain,
  groundY: number,
  options: ShadowStepPlanningOptions = {},
): WorldPosition | null {
  const axis = normalizeGround({ x: target.x - origin.x, z: target.z - origin.z }, { x: 1, z: 0 });
  const lateralClockwise = { x: -axis.z, z: axis.x };
  const lateralCounterClockwise = { x: axis.z, z: -axis.x };
  const clearance = BODY_RADIUS + Math.max(0, targetBodyRadius) + TARGET_CLEARANCE;
  for (const direction of [axis, lateralClockwise, lateralCounterClockwise]) {
    const destination = {
      x: target.x + direction.x * clearance,
      z: target.z + direction.z * clearance,
    };
    const valid = options.phaseThroughObstacles
      ? isShadowStepLandingValid(destination, terrain, groundY)
      : isShadowStepPathClear(origin, destination, terrain, groundY);
    // All three axes travel out of here: the landing's elevation is the ground it lands on, never
    // a value dropped because a two-axis type happened to be satisfied.
    if (valid) {
      return {
        x: destination.x,
        y: groundUnder(terrain, destination.x, destination.z, groundY),
        z: destination.z,
      };
    }
  }
  return null;
}

/**
 * Plans the complete server-authored teleport. It intentionally does not skip a blocked nearest
 * target in favour of an easier distant one: target selection happens first, then that target's
 * deterministic landing either succeeds or fails cleanly.
 */
export function planShadowStep<T extends ShadowStepCandidate>(
  origin: WorldPosition,
  candidates: Iterable<T>,
  range: number,
  now: number,
  terrain: ZoneTerrain,
  bodyRadius: (candidate: T) => number,
  options: ShadowStepPlanningOptions = {},
): ShadowStepPlanningResult {
  const groundY = groundUnder(terrain, origin.x, origin.z, origin.y);
  const target = nearestShadowStepTarget(origin, candidates, range, now, terrain, groundY, options);
  if (!target) return { ok: false, reason: "no_target" };
  const destination = shadowStepDestination(
    origin,
    target,
    bodyRadius(target),
    terrain,
    groundY,
    options,
  );
  return destination
    ? {
        ok: true,
        plan: {
          targetId: target.id,
          targetPosition: { x: target.x, z: target.z },
          destination,
        },
      }
    : { ok: false, reason: "blocked" };
}

/** The return crosses intervening terrain, but a remembered coordinate is never trusted as a landing. */
export function planShadowReturn(
  point: ShadowReturnPoint,
  now: number,
  terrain: ZoneTerrain,
): ShadowReturnPlanningResult {
  if (point.expiresAt <= now) return { ok: false, reason: "expired" };
  // The remembered elevation is what the rogue left from; the landing is re-validated against it
  // and its own `y` re-derived from the terrain rather than replayed from the memory.
  return isShadowStepLandingValid(point, terrain, point.y)
    ? {
        ok: true,
        destination: {
          x: point.x,
          y: groundUnder(terrain, point.x, point.z, point.y),
          z: point.z,
        },
      }
    : { ok: false, reason: "blocked" };
}
