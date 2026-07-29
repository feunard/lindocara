import type { TerrainGeometry } from "@lindocara/engine/game.js";
import type { Vec2 } from "@lindocara/engine/simulation.js";
import { hasRogueLineOfSight, shadowStepDestination } from "./rogue-skill-system.js";

export interface ShadowDanceCandidate extends Vec2 {
  id: string;
  deadUntil: number;
}

export interface ShadowDanceStrikePlan {
  targetId: string;
  targetPosition: Vec2;
  from: Vec2;
  landing: Vec2;
  repeated?: true;
}

export interface ShadowDancePlan {
  primaryTargetId: string;
  strikes: ShadowDanceStrikePlan[];
  finalPosition: Vec2;
}

export type ShadowDancePlanningResult =
  | { ok: true; plan: ShadowDancePlan }
  | { ok: false; reason: "no_target" | "blocked" };

export interface ShadowDancePlanningOptions {
  repeatPrimary?: boolean;
}

const MAX_PLANNED_STRIKES = 8;

function distance(left: Vec2, right: Vec2): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

/**
 * Computes the complete unique-target route from immutable server state. Selection uses the
 * previous target as its next origin, while every actual Rogue body transition and landing is
 * independently collision-checked.
 */
export function planShadowDance<T extends ShadowDanceCandidate>(
  origin: Vec2,
  candidates: Iterable<T>,
  range: number,
  maximumHits: number,
  now: number,
  terrain: TerrainGeometry,
  bodyRadius: (candidate: T) => number,
  options: ShadowDancePlanningOptions = {},
): ShadowDancePlanningResult {
  const pool = [...candidates];
  const selectedIds = new Set<string>();
  const strikes: ShadowDanceStrikePlan[] = [];
  let actorPosition = { x: origin.x, y: origin.y };
  let selectionOrigin = actorPosition;
  let firstVisibleTargetWasBlocked = false;
  const boundedHits = Math.max(1, Math.min(MAX_PLANNED_STRIKES, Math.floor(maximumHits)));

  while (strikes.length < boundedHits) {
    const ordered = pool
      .filter(
        (candidate) =>
          candidate.deadUntil <= now &&
          !selectedIds.has(candidate.id) &&
          distance(selectionOrigin, candidate) <= range &&
          hasRogueLineOfSight(selectionOrigin, candidate, terrain),
      )
      .sort(
        (left, right) =>
          distance(selectionOrigin, left) - distance(selectionOrigin, right) ||
          left.id.localeCompare(right.id),
      );

    let selected: { candidate: T; landing: Vec2 } | null = null;
    for (const candidate of ordered) {
      const landing = shadowStepDestination(
        actorPosition,
        candidate,
        bodyRadius(candidate),
        terrain,
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
      targetPosition: { x: selected.candidate.x, y: selected.candidate.y },
      from: { ...actorPosition },
      landing: { ...selected.landing },
    });
    selectedIds.add(selected.candidate.id);
    actorPosition = { ...selected.landing };
    selectionOrigin = { x: selected.candidate.x, y: selected.candidate.y };
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
      if (!hasRogueLineOfSight(actorPosition, primary, terrain)) break;
      const landing = shadowStepDestination(actorPosition, primary, bodyRadius(primary), terrain);
      if (!landing) break;
      strikes.push({
        targetId: primary.id,
        targetPosition: { x: primary.x, y: primary.y },
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
