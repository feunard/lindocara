import { type GroundVector, groundDistance, type WorldPosition } from "@lindocara/engine/ground.js";
import { groundUnder, type ZoneTerrain } from "@lindocara/engine/terrain-access.js";

import { hasRogueLineOfSight, shadowStepDestination } from "./rogue-skill-system.js";

export interface ShadowDanceCandidate extends GroundVector {
  id: string;
  deadUntil: number;
}

export interface ShadowDanceStrikePlan {
  targetId: string;
  targetPosition: GroundVector;
  from: WorldPosition;
  landing: WorldPosition;
  repeated?: true;
}

export interface ShadowDancePlan {
  primaryTargetId: string;
  strikes: ShadowDanceStrikePlan[];
  finalPosition: WorldPosition;
}

export type ShadowDancePlanningResult =
  | { ok: true; plan: ShadowDancePlan }
  | { ok: false; reason: "no_target" | "blocked" };

export interface ShadowDancePlanningOptions {
  repeatPrimary?: boolean;
}

const MAX_PLANNED_STRIKES = 8;

/** Ground distance: `y` is elevation now, and a dance is a route across the floor. */
function distance(left: GroundVector, right: GroundVector): number {
  return groundDistance(left, right);
}

/**
 * Computes the complete unique-target route from immutable server state. Selection uses the
 * previous target as its next origin, while every actual Rogue body transition and landing is
 * independently collision-checked.
 */
export function planShadowDance<T extends ShadowDanceCandidate>(
  origin: WorldPosition,
  candidates: Iterable<T>,
  range: number,
  maximumHits: number,
  now: number,
  terrain: ZoneTerrain,
  bodyRadius: (candidate: T) => number,
  options: ShadowDancePlanningOptions = {},
): ShadowDancePlanningResult {
  const pool = [...candidates];
  const selectedIds = new Set<string>();
  const strikes: ShadowDanceStrikePlan[] = [];
  // The rogue's own ground decides every sight test and every landing along the route: `MAX_STEP`
  // is 0, so a dance is no more a way up a cliff than a single shadow step is.
  const groundY = groundUnder(terrain, origin.x, origin.z, origin.y);
  let actorPosition: WorldPosition = { x: origin.x, y: origin.y, z: origin.z };
  let selectionOrigin: GroundVector = { x: origin.x, z: origin.z };
  let firstVisibleTargetWasBlocked = false;
  const boundedHits = Math.max(1, Math.min(MAX_PLANNED_STRIKES, Math.floor(maximumHits)));

  while (strikes.length < boundedHits) {
    const ordered = pool
      .filter(
        (candidate) =>
          candidate.deadUntil <= now &&
          !selectedIds.has(candidate.id) &&
          distance(selectionOrigin, candidate) <= range &&
          hasRogueLineOfSight(selectionOrigin, candidate, terrain, groundY),
      )
      .sort(
        (left, right) =>
          distance(selectionOrigin, left) - distance(selectionOrigin, right) ||
          left.id.localeCompare(right.id),
      );

    let selected: { candidate: T; landing: WorldPosition } | null = null;
    for (const candidate of ordered) {
      const landing = shadowStepDestination(
        actorPosition,
        candidate,
        bodyRadius(candidate),
        terrain,
        groundY,
      );
      if (!landing) {
        if (strikes.length === 0) firstVisibleTargetWasBlocked = true;
        continue;
      }
      selected = { candidate, landing };
      break;
    }
    if (!selected) break;

    strikes.push({
      targetId: selected.candidate.id,
      targetPosition: { x: selected.candidate.x, z: selected.candidate.z },
      from: { ...actorPosition },
      landing: { ...selected.landing },
    });
    selectedIds.add(selected.candidate.id);
    actorPosition = { ...selected.landing };
    selectionOrigin = { x: selected.candidate.x, z: selected.candidate.z };
  }

  const first = strikes[0];
  if (!first)
    return {
      ok: false,
      reason: firstVisibleTargetWasBlocked ? "blocked" : "no_target",
    };
  if (options.repeatPrimary) {
    const primary = pool.find((candidate) => candidate.id === first.targetId);
    while (primary && strikes.length < boundedHits && primary.deadUntil <= now) {
      if (!hasRogueLineOfSight(actorPosition, primary, terrain, groundY)) break;
      const landing = shadowStepDestination(
        actorPosition,
        primary,
        bodyRadius(primary),
        terrain,
        groundY,
      );
      if (!landing) break;
      strikes.push({
        targetId: primary.id,
        targetPosition: { x: primary.x, z: primary.z },
        from: { ...actorPosition },
        landing: { ...landing },
        repeated: true,
      });
      actorPosition = { ...landing };
    }
  }
  return {
    ok: true,
    plan: {
      primaryTargetId: first.targetId,
      strikes,
      finalPosition: { ...actorPosition },
    },
  };
}
