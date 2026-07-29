import { normalizeDirection } from "@lindocara/engine/directional-combat.js";
import type { Vec2 } from "@lindocara/engine/simulation.js";
import type { TalentEffect } from "@lindocara/engine/talents.js";

type LinePiercerEffect = Extract<TalentEffect, { kind: "line_piercer" }>;
type FocusedVolleyEffect = Extract<TalentEffect, { kind: "focused_volley" }>;
type RetreatShotEffect = Extract<TalentEffect, { kind: "retreat_shot" }>;
type CometArrowEffect = Extract<TalentEffect, { kind: "comet_arrow" }>;

/** First target takes normal damage; every prior distinct target raises the next impact. */
export function linePiercerPowerRatio(
  distinctHitsIncludingCurrent: number,
  effect: LinePiercerEffect,
): number {
  const priorTargets = Math.max(0, Math.floor(distinctHitsIncludingCurrent) - 1);
  const bonus = Math.min(
    Math.max(0, effect.maxBonus),
    priorTargets * Math.max(0, effect.bonusPerTarget),
  );
  return 1 + bonus;
}

/** One large target may receive several arrows, with every impact after the first diminished. */
export function focusedVolleyPowerRatio(
  targetHitCountIncludingCurrent: number,
  effect: FocusedVolleyEffect,
): number {
  const priorHits = Math.max(0, Math.floor(targetHitCountIncludingCurrent) - 1);
  return Math.max(
    Math.max(0, Math.min(1, effect.minimumPowerRatio)),
    1 - priorHits * Math.max(0, effect.decayPerHit),
  );
}

/** Returns a deterministic forward fan; the dash itself still travels backward on the server. */
export function retreatShotDirections(direction: Vec2, effect: RetreatShotEffect): Vec2[] {
  const facing = normalizeDirection(direction);
  const count = Math.max(1, Math.min(5, Math.floor(effect.projectiles)));
  const spread = Math.max(0, Math.min(Math.PI / 2, effect.spreadRadians));
  const result: Vec2[] = [];
  for (let index = 0; index < count; index++) {
    const offset = count === 1 ? 0 : -spread / 2 + (spread * index) / (count - 1);
    const cosine = Math.cos(offset);
    const sine = Math.sin(offset);
    result.push(
      normalizeDirection({
        x: facing.x * cosine - facing.y * sine,
        y: facing.x * sine + facing.y * cosine,
      }),
    );
  }
  return result;
}

/**
 * Resolves the server-selected comet splash in stable id order. The direct target is excluded so
 * the explosion cannot duplicate the projectile impact.
 */
export function applyCometExplosion<T extends { id: string }>(
  targets: Iterable<T>,
  directTargetId: string,
  effect: CometArrowEffect,
  canHit: (target: T, radius: number) => boolean,
  hit: (target: T, powerRatio: number) => void,
): number {
  let hits = 0;
  for (const target of [...targets].sort((left, right) => left.id.localeCompare(right.id))) {
    if (target.id === directTargetId || !canHit(target, effect.radius)) continue;
    hit(target, Math.max(0, effect.splashPowerRatio));
    hits += 1;
  }
  return hits;
}
