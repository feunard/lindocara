import type { TalentEffect } from "@lindocara/engine/talents.js";
import type {
  CleanseableNegativeEffect,
  NegativeEffectRuntime,
  PlayerRuntime,
} from "./world-runtime.js";

type EmergencyMendEffect = Extract<TalentEffect, { kind: "emergency_mend" }>;
type LuminousTransfigurationEffect = Extract<TalentEffect, { kind: "luminous_transfiguration" }>;
type SanctuaryEffect = Extract<TalentEffect, { kind: "sanctuary" }>;
type NovaJudgmentEffect = Extract<TalentEffect, { kind: "nova_judgment" }>;
type NovaMercyEffect = Extract<TalentEffect, { kind: "nova_mercy" }>;

export interface SanctuaryRuntime {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  radius: number;
  power: number;
  nextTickAt: number;
  intervalMs: number;
  ticksRemaining: number;
}

export function emergencyMendPower(
  basePower: number,
  targetHp: number,
  targetMaxHp: number,
  effect: EmergencyMendEffect,
): number {
  const woundedRatio = Math.max(0, targetHp) / Math.max(1, targetMaxHp);
  const multiplier = woundedRatio <= effect.threshold ? 1 + effect.powerMultiplier : 1;
  return Math.max(0, Math.round(basePower * multiplier));
}

export function luminousTransfigurationPower(
  level: number,
  effect: LuminousTransfigurationEffect,
): number {
  return Math.max(
    0,
    Math.round(effect.power + Math.max(0, Math.floor(level) - 1) * effect.powerPerLevel),
  );
}

export function novaJudgmentDamageMultiplier(
  targetHp: number,
  targetMaxHp: number,
  effect: NovaJudgmentEffect | undefined,
): number {
  if (!effect) return 1;
  const healthRatio = Math.max(0, targetHp) / Math.max(1, targetMaxHp);
  const execution = healthRatio <= effect.executeThreshold ? 1 + effect.executeMultiplier : 1;
  return Math.max(0, effect.damageMultiplier) * Math.max(0, execution);
}

/** Mercy revives at most one corpse, selected by distance then stable hero id. */
export function nearestMercyCorpse<T extends { id: string }>(
  candidates: Iterable<T>,
  distanceToCorpse: (candidate: T) => number,
  canRevive: (candidate: T) => boolean,
): T | null {
  return (
    [...candidates]
      .filter(canRevive)
      .sort(
        (left, right) =>
          distanceToCorpse(left) - distanceToCorpse(right) || left.id.localeCompare(right.id),
      )[0] ?? null
  );
}

/**
 * Returns every crossed ally once in stable id order. A zero-length movement segment must pass a
 * false `crosses` predicate, so standing still can never manufacture passage healing.
 */
export function sacredPassageTargets<T extends { id: string }>(
  targets: Iterable<T>,
  healedIds: Set<string>,
  crosses: (target: T) => boolean,
): T[] {
  const result: T[] = [];
  for (const target of [...targets].sort((left, right) => left.id.localeCompare(right.id))) {
    if (healedIds.has(target.id) || !crosses(target)) continue;
    healedIds.add(target.id);
    result.push(target);
  }
  return result;
}

export function applyCleanseableNegativeEffect(
  player: PlayerRuntime,
  effect: NegativeEffectRuntime,
): void {
  const current = player.negativeEffects.get(effect.kind);
  if (!current || current.expiresAt <= effect.expiresAt)
    player.negativeEffects.set(effect.kind, { ...effect });
}

/** The cleanse contract is intentionally narrow: callers must name one supported effect kind. */
export function cleanseNegativeEffect(
  player: PlayerRuntime,
  kind: CleanseableNegativeEffect,
): boolean {
  return player.negativeEffects.delete(kind);
}

export function startSanctuary(
  sanctuaries: SanctuaryRuntime[],
  options: {
    ownerId: string;
    x: number;
    y: number;
    radius: number;
    power: number;
    effect: SanctuaryEffect;
    now: number;
  },
): SanctuaryRuntime {
  removeSanctuariesByOwner(sanctuaries, options.ownerId);
  const ticks = Math.max(1, Math.min(8, Math.floor(options.effect.ticks)));
  const intervalMs = Math.max(100, Math.min(2_000, Math.floor(options.effect.intervalMs)));
  const sanctuary: SanctuaryRuntime = {
    id: crypto.randomUUID(),
    ownerId: options.ownerId,
    x: options.x,
    y: options.y,
    radius: Math.max(0, options.radius),
    power: Math.max(0, Math.round(options.power * Math.max(0, options.effect.tickPowerRatio))),
    nextTickAt: options.now + intervalMs,
    intervalMs,
    ticksRemaining: ticks,
  };
  sanctuaries.push(sanctuary);
  return sanctuary;
}

export function advanceSanctuaries(
  sanctuaries: SanctuaryRuntime[],
  now: number,
  ownerIsActive: (ownerId: string) => boolean,
  healTick: (sanctuary: SanctuaryRuntime) => void,
): void {
  const survivors: SanctuaryRuntime[] = [];
  for (const sanctuary of sanctuaries) {
    if (!ownerIsActive(sanctuary.ownerId)) continue;
    while (sanctuary.ticksRemaining > 0 && now >= sanctuary.nextTickAt) {
      healTick(sanctuary);
      sanctuary.ticksRemaining -= 1;
      sanctuary.nextTickAt += sanctuary.intervalMs;
    }
    if (sanctuary.ticksRemaining > 0) survivors.push(sanctuary);
  }
  sanctuaries.splice(0, sanctuaries.length, ...survivors);
}

export function removeSanctuariesByOwner(sanctuaries: SanctuaryRuntime[], ownerId: string): void {
  for (let index = sanctuaries.length - 1; index >= 0; index--) {
    if (sanctuaries[index]?.ownerId === ownerId) sanctuaries.splice(index, 1);
  }
}

export function novaSpecializationMultipliers(
  judgment: NovaJudgmentEffect | undefined,
  mercy: NovaMercyEffect | undefined,
): { damage: number; healing: number } {
  if (judgment)
    return {
      damage: Math.max(0, judgment.damageMultiplier),
      healing: Math.max(0, judgment.healMultiplier),
    };
  if (mercy)
    return {
      damage: Math.max(0, mercy.damageMultiplier),
      healing: Math.max(0, mercy.healMultiplier),
    };
  return { damage: 1, healing: 1 };
}
