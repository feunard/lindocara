import {
  normalizeDirection,
  sweptProjectileTerrainImpact,
} from "@lindocara/engine/directional-combat.js";
import { isWalkable, type TerrainGeometry } from "@lindocara/engine/game.js";
import { PLAYER_SIZE, type Vec2 } from "@lindocara/engine/simulation.js";

export interface ShadowStepCandidate extends Vec2 {
  id: string;
  deadUntil: number;
}

export interface ShadowStepPlan {
  targetId: string;
  targetPosition: Vec2;
  destination: Vec2;
}

export type ShadowStepPlanningResult =
  | { ok: true; plan: ShadowStepPlan }
  | { ok: false; reason: "no_target" | "blocked" };

export interface ShadowStepPlanningOptions {
  /** Ignores the route and sight blockers, but never authorizes an invalid landing. */
  phaseThroughObstacles?: boolean;
}

export interface ShadowReturnPoint extends Vec2 {
  expiresAt: number;
}

export type ShadowReturnPlanningResult =
  | { ok: true; destination: Vec2 }
  | { ok: false; reason: "expired" | "blocked" };

const BODY_SWEEP_RADIUS = (PLAYER_SIZE - 1) / 2;
const TARGET_CLEARANCE = 4;

function centre(position: Vec2): Vec2 {
  return { x: position.x + PLAYER_SIZE / 2, y: position.y + PLAYER_SIZE / 2 };
}

/**
 * Collision-aware sight for Rogue target acquisition. The historical tile-only helper is enough
 * for old combat arcs, but a teleport must also treat an authored tree trunk as opaque.
 */
export function hasRogueLineOfSight(from: Vec2, to: Vec2, terrain: TerrainGeometry): boolean {
  return (
    sweptProjectileTerrainImpact(centre(from), centre(to), 0, terrain.tiles, terrain.colliders) ===
    null
  );
}

/** A teleport path is a swept player body, never a point jump through a narrow obstacle. */
export function isShadowStepPathClear(
  from: Vec2,
  destination: Vec2,
  terrain: TerrainGeometry,
): boolean {
  if (!isShadowStepLandingValid(destination, terrain)) return false;
  return (
    sweptProjectileTerrainImpact(
      centre(from),
      centre(destination),
      BODY_SWEEP_RADIUS,
      terrain.tiles,
      terrain.colliders,
    ) === null
  );
}

export function isShadowStepLandingValid(destination: Vec2, terrain: TerrainGeometry): boolean {
  return isWalkable(destination, PLAYER_SIZE, terrain);
}

function nearestShadowStepTarget<T extends ShadowStepCandidate>(
  origin: Vec2,
  candidates: Iterable<T>,
  range: number,
  now: number,
  terrain: TerrainGeometry,
  options: ShadowStepPlanningOptions,
): T | null {
  let selected: T | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (
      candidate.deadUntil > now ||
      (!options.phaseThroughObstacles && !hasRogueLineOfSight(origin, candidate, terrain))
    )
      continue;
    const distance = Math.hypot(candidate.x - origin.x, candidate.y - origin.y);
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
  origin: Vec2,
  target: Vec2,
  targetBodyRadius: number,
  terrain: TerrainGeometry,
  options: ShadowStepPlanningOptions = {},
): Vec2 | null {
  const axis = normalizeDirection(
    { x: target.x - origin.x, y: target.y - origin.y },
    { x: 1, y: 0 },
  );
  const lateralClockwise = { x: -axis.y, y: axis.x };
  const lateralCounterClockwise = { x: axis.y, y: -axis.x };
  const clearance = PLAYER_SIZE / 2 + Math.max(0, targetBodyRadius) + TARGET_CLEARANCE;
  const targetCentre = centre(target);
  for (const direction of [axis, lateralClockwise, lateralCounterClockwise]) {
    const destination = {
      x: targetCentre.x + direction.x * clearance - PLAYER_SIZE / 2,
      y: targetCentre.y + direction.y * clearance - PLAYER_SIZE / 2,
    };
    const valid = options.phaseThroughObstacles
      ? isShadowStepLandingValid(destination, terrain)
      : isShadowStepPathClear(origin, destination, terrain);
    if (valid) return destination;
  }
  return null;
}

/**
 * Plans the complete server-authored teleport. It intentionally does not skip a blocked nearest
 * target in favour of an easier distant one: target selection happens first, then that target's
 * deterministic landing either succeeds or fails cleanly.
 */
export function planShadowStep<T extends ShadowStepCandidate>(
  origin: Vec2,
  candidates: Iterable<T>,
  range: number,
  now: number,
  terrain: TerrainGeometry,
  bodyRadius: (candidate: T) => number,
  options: ShadowStepPlanningOptions = {},
): ShadowStepPlanningResult {
  const target = nearestShadowStepTarget(origin, candidates, range, now, terrain, options);
  if (!target) return { ok: false, reason: "no_target" };
  const destination = shadowStepDestination(origin, target, bodyRadius(target), terrain, options);
  return destination
    ? {
        ok: true,
        plan: {
          targetId: target.id,
          targetPosition: { x: target.x, y: target.y },
          destination,
        },
      }
    : { ok: false, reason: "blocked" };
}

/** The return crosses intervening terrain, but a remembered coordinate is never trusted as a landing. */
export function planShadowReturn(
  point: ShadowReturnPoint,
  now: number,
  terrain: TerrainGeometry,
): ShadowReturnPlanningResult {
  if (point.expiresAt <= now) return { ok: false, reason: "expired" };
  const destination = { x: point.x, y: point.y };
  return isShadowStepLandingValid(destination, terrain)
    ? { ok: true, destination }
    : { ok: false, reason: "blocked" };
}
