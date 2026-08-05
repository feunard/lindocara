import { normalizeDirection, normalizeGround } from "@lindocara/engine/directional-combat.js";
import { type GroundVector, groundDistance } from "@lindocara/engine/ground.js";
import type { Vec2 } from "@lindocara/engine/simulation.js";
import type { TalentEffect } from "@lindocara/engine/talents.js";
import type {
  CombatActionRuntime,
  MonsterRuntime,
  PlayerRuntime,
  RangerVolleySequenceRuntime,
} from "./world-runtime.js";

type LinePiercerEffect = Extract<TalentEffect, { kind: "line_piercer" }>;
type FocusedVolleyEffect = Extract<TalentEffect, { kind: "focused_volley" }>;
type RetreatShotEffect = Extract<TalentEffect, { kind: "retreat_shot" }>;
type CometArrowEffect = Extract<TalentEffect, { kind: "comet_arrow" }>;
type TripleVolleyEffect = Extract<TalentEffect, { kind: "triple_volley" }>;

/** Windstep may cancel an unresolved hit or recovery, but never a stale action. */
export function windstepCanInterrupt(
  action: CombatActionRuntime | null,
  now: number,
): action is CombatActionRuntime {
  return action !== null && action.recoveryEndsAt > now;
}

export function swornPreyTarget(
  player: PlayerRuntime,
  monsters: Iterable<MonsterRuntime>,
  range: number,
  now: number,
  visible: (monster: MonsterRuntime) => boolean,
): MonsterRuntime | null {
  const facing = normalizeGround(player.facing);
  return (
    [...monsters]
      .filter((monster) => {
        if (monster.deadUntil > now || !visible(monster)) return false;
        const dx = monster.x - player.x;
        const dz = monster.z - player.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= 0 || distance > range) return false;
        const direction = { x: dx / distance, z: dz / distance };
        return direction.x * facing.x + direction.z * facing.z >= Math.cos(Math.PI / 3);
      })
      .sort((left, right) => {
        const leftDistance = groundDistance(left, player);
        const rightDistance = groundDistance(right, player);
        return leftDistance - rightDistance || left.id.localeCompare(right.id);
      })[0] ?? null
  );
}

export function scheduleAdditionalVolleys(
  action: CombatActionRuntime,
  effect: TripleVolleyEffect,
): RangerVolleySequenceRuntime | null {
  const salvos = Math.max(1, Math.min(5, Math.floor(effect.salvos)));
  if (salvos <= 1) return null;
  const intervalMs = Math.max(250, Math.min(5_000, Math.floor(effect.intervalMs)));
  const anticipationMs = Math.max(0, action.impactAt - action.startedAt);
  const recoveryMs = Math.max(0, action.recoveryEndsAt - action.impactAt);
  return {
    direction: { ...action.direction },
    salvos: Array.from({ length: salvos - 1 }, (_, index) => {
      const animationAt = action.startedAt + (index + 1) * intervalMs;
      const impactAt = animationAt + anticipationMs;
      return {
        actionId: crypto.randomUUID(),
        animationAt,
        impactAt,
        recoveryEndsAt: impactAt + recoveryMs,
        animationSent: false,
        fired: false,
      };
    }),
  };
}

export function advanceAdditionalVolleys(
  player: PlayerRuntime,
  now: number,
  animate: (salvo: RangerVolleySequenceRuntime["salvos"][number]) => void,
  fire: (salvo: RangerVolleySequenceRuntime["salvos"][number]) => void,
): void {
  const sequence = player.rangerVolleySequence;
  if (!sequence) return;
  if (!player.authorized || player.transitioning || player.life !== "alive") {
    player.rangerVolleySequence = null;
    return;
  }
  for (const salvo of sequence.salvos) {
    if (!salvo.animationSent && now >= salvo.animationAt) {
      salvo.animationSent = true;
      animate(salvo);
    }
    if (!salvo.fired && now >= salvo.impactAt) {
      if (!salvo.animationSent) {
        salvo.animationSent = true;
        animate(salvo);
      }
      salvo.fired = true;
      fire(salvo);
    }
  }
  if (sequence.salvos.every((salvo) => salvo.fired)) player.rangerVolleySequence = null;
}

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
export function retreatShotDirections(
  direction: GroundVector,
  effect: RetreatShotEffect,
): GroundVector[] {
  const facing = normalizeGround(direction);
  const count = Math.max(1, Math.min(5, Math.floor(effect.projectiles)));
  const spread = Math.max(0, Math.min(Math.PI / 2, effect.spreadRadians));
  const result: GroundVector[] = [];
  for (let index = 0; index < count; index++) {
    const offset = count === 1 ? 0 : -spread / 2 + (spread * index) / (count - 1);
    const cosine = Math.cos(offset);
    const sine = Math.sin(offset);
    result.push(
      normalizeGround({
        x: facing.x * cosine - facing.z * sine,
        z: facing.x * sine + facing.z * cosine,
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
