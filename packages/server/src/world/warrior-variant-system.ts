import { maxHpForLevel } from "@lindocara/engine/game.js";
import { groundDistance, type WorldPosition } from "@lindocara/engine/ground.js";
import type { SkillDefinition } from "@lindocara/engine/skills.js";
import { type TalentEffect, talentEffect } from "@lindocara/engine/talents.js";
import type { PlayerRuntime } from "./world-runtime.js";

type AllyPredicate = (source: PlayerRuntime, target: PlayerRuntime) => boolean;
type VisibilityPredicate = (source: PlayerRuntime, target: PlayerRuntime) => boolean;

type SeismicImpactEffect = Extract<TalentEffect, { kind: "seismic_impact" }>;
type ColossusChargeEffect = Extract<TalentEffect, { kind: "colossus_charge" }>;
type KingChallengeEffect = Extract<TalentEffect, { kind: "king_challenge" }>;
type RallyingCryEffect = Extract<TalentEffect, { kind: "rallying_cry" }>;
type CycloneEffect = Extract<TalentEffect, { kind: "cyclone" }>;
type CounterOffensiveEffect = Extract<TalentEffect, { kind: "counter_offensive" }>;
type EyeOfTheStormEffect = Extract<TalentEffect, { kind: "eye_of_the_storm" }>;

function cycloneTiming(effect: CycloneEffect): { ticks: number; intervalMs: number } {
  return {
    ticks: Math.max(1, Math.min(8, Math.floor(effect.ticks))),
    intervalMs: Math.max(50, Math.min(1_000, Math.floor(effect.intervalMs))),
  };
}

/** Ground distance, never `Math.hypot(x, y)`: `y` is elevation now. */
function distance(left: PlayerRuntime, right: PlayerRuntime): number {
  return groundDistance(left, right);
}

/**
 * Applies room-local warrior protection before the target's own Iron Guard. Group protection uses
 * the strongest nearby Rempart once; it never compounds when several warriors guard together.
 */
export function damageAfterWarriorProtection(
  target: PlayerRuntime,
  rawDamage: number,
  players: Iterable<PlayerRuntime>,
  now: number,
  areAllies: AllyPredicate,
  hasVisibility: VisibilityPredicate,
  onPrevented?: (protector: PlayerRuntime, amount: number) => void,
): number {
  let allyReduction = 0;
  let selectedProtector: PlayerRuntime | null = null;
  for (const protector of players) {
    if (
      protector === target ||
      protector.class !== "warrior" ||
      protector.life !== "alive" ||
      !protector.authorized ||
      !protector.guarding ||
      !areAllies(protector, target)
    )
      continue;
    const effect = talentEffect(protector.class, protector.talents, "ally_guard", 2);
    if (!effect || distance(protector, target) > effect.radius || !hasVisibility(protector, target))
      continue;
    if (
      effect.reduction > allyReduction ||
      (effect.reduction === allyReduction &&
        (selectedProtector === null || protector.id.localeCompare(selectedProtector.id) < 0))
    ) {
      allyReduction = effect.reduction;
      selectedProtector = protector;
    }
  }

  const challengeReduction = activeChallengeReduction(target, now);
  const combinedReduction = Math.min(
    0.65,
    1 - (1 - Math.max(0, allyReduction)) * (1 - Math.max(0, challengeReduction)),
  );
  const applied = Math.max(1, Math.ceil(Math.max(0, rawDamage) * (1 - combinedReduction)));
  if (selectedProtector && allyReduction > 0)
    onPrevented?.(
      selectedProtector,
      Math.max(0, rawDamage - Math.ceil(rawDamage * (1 - allyReduction))),
    );
  return applied;
}

/** Returns the single bounded Rallying Cry multiplier active at the moment damage resolves. */
export function activeRallyPowerMultiplier(player: PlayerRuntime, now: number): number {
  let multiplier = player.rallyPowerUntil > now ? Math.max(0, player.rallyPowerMultiplier) : 0;
  for (const [sourceId, banner] of player.warriorBannerPower) {
    if (banner.expiresAt <= now) {
      player.warriorBannerPower.delete(sourceId);
      continue;
    }
    multiplier += Math.max(0, banner.multiplier);
  }
  return Math.min(0.75, multiplier);
}

export function activeChallengeReduction(player: PlayerRuntime, now: number): number {
  const challenge = player.challengeReductionUntil > now ? player.challengeReduction : 0;
  const banner =
    player.warriorBannerChallengeUntil > now ? player.warriorBannerChallengeReduction : 0;
  return Math.min(0.4, Math.max(0, challenge) + Math.max(0, banner));
}

/** Applies the strongest temporary power bonus without stacking equal support auras. */
export function applyBoundedPowerBuff(
  target: PlayerRuntime,
  powerMultiplier: number,
  durationMs: number,
  now: number,
): void {
  const current = target.rallyPowerUntil > now ? target.rallyPowerMultiplier : 0;
  target.rallyPowerMultiplier = Math.min(0.75, Math.max(current, Math.max(0, powerMultiplier)));
  target.rallyPowerUntil = Math.max(
    target.rallyPowerUntil > now ? target.rallyPowerUntil : 0,
    now + Math.max(0, durationMs),
  );
}

export function chargeCounterOffensive(
  player: PlayerRuntime,
  preventedDamage: number,
  effect: CounterOffensiveEffect | undefined,
  source: "guard" | "parry" | "ally",
): number {
  if (!effect || preventedDamage <= 0) return player.warriorCounterReserve;
  const ratio =
    source === "parry"
      ? effect.parryChargeRatio
      : source === "ally"
        ? effect.allyChargeRatio
        : effect.guardedChargeRatio;
  const cap = maxHpForLevel(player.level) * Math.max(0, effect.maxStoredRatio);
  player.warriorCounterReserve = Math.min(
    cap,
    player.warriorCounterReserve + preventedDamage * Math.max(0, ratio),
  );
  return player.warriorCounterReserve;
}

export function consumeCounterOffensive(player: PlayerRuntime): number {
  const power = Math.max(0, Math.round(player.warriorCounterReserve));
  player.warriorCounterReserve = 0;
  return power;
}

export function applyWarBanner(
  caster: PlayerRuntime,
  players: Iterable<PlayerRuntime>,
  rally: RallyingCryEffect | undefined,
  challenge: KingChallengeEffect | undefined,
  durationMs: number,
  now: number,
  areAllies: AllyPredicate,
  inAura: (target: PlayerRuntime) => boolean,
): void {
  const expiresAt = now + Math.max(0, durationMs);
  if (rally) {
    for (const target of players) {
      if (
        target.life !== "alive" ||
        !target.authorized ||
        !areAllies(caster, target) ||
        !inAura(target)
      )
        continue;
      target.warriorBannerPower.set(caster.id, {
        multiplier: Math.max(0, rally.powerMultiplier),
        expiresAt,
      });
    }
  }
  if (challenge) {
    caster.warriorBannerChallengeReduction = Math.max(0, caster.challengeReduction);
    caster.warriorBannerChallengeUntil = expiresAt;
  }
}

export function startWarriorVortex(
  player: PlayerRuntime,
  center: WorldPosition,
  radius: number,
  effect: EyeOfTheStormEffect,
  now: number,
  followsOwner: boolean,
): void {
  player.warriorVortex = {
    ...center,
    radius: Math.max(0, radius),
    expiresAt: now + Math.max(0, effect.durationMs),
    nextPulseAt: now,
    pulseIntervalMs: Math.max(50, effect.pulseIntervalMs),
    pullDistance: Math.max(0, effect.pullDistance),
    slowRatio: Math.max(0, Math.min(0.95, effect.slowRatio)),
    slowDurationMs: Math.max(0, effect.slowDurationMs),
    followsOwner,
  };
}

export function advanceWarriorVortices(
  players: Iterable<PlayerRuntime>,
  now: number,
  pulse: (player: PlayerRuntime, center: WorldPosition, effect: EyeOfTheStormEffect) => void,
): void {
  for (const player of players) {
    const vortex = player.warriorVortex;
    if (!vortex) continue;
    if (
      !player.authorized ||
      player.transitioning ||
      player.life !== "alive" ||
      vortex.expiresAt <= now
    ) {
      player.warriorVortex = null;
      continue;
    }
    if (vortex.followsOwner) {
      vortex.x = player.x;
      vortex.y = player.y;
      vortex.z = player.z;
    }
    while (vortex.nextPulseAt <= now && vortex.nextPulseAt < vortex.expiresAt) {
      pulse(player, vortex, {
        kind: "eye_of_the_storm",
        durationMs: Math.max(0, vortex.expiresAt - vortex.nextPulseAt),
        pulseIntervalMs: vortex.pulseIntervalMs,
        pullDistance: vortex.pullDistance,
        slowRatio: vortex.slowRatio,
        slowDurationMs: vortex.slowDurationMs,
      });
      vortex.nextPulseAt += vortex.pulseIntervalMs;
    }
  }
}

export function applyKingsChallenge(
  player: PlayerRuntime,
  enemiesTaunted: number,
  effect: KingChallengeEffect,
  now: number,
): void {
  const reduction = Math.min(
    Math.max(0, effect.maxReduction),
    Math.max(0, enemiesTaunted) * Math.max(0, effect.reductionPerEnemy),
  );
  player.challengeReduction = reduction;
  player.challengeReductionUntil = reduction > 0 ? now + Math.max(0, effect.durationMs) : 0;
}

/**
 * Applies one shared, non-stacking buff value to every visible ally in range. Recasts refresh the
 * deadline and keep the strongest bounded multiplier rather than multiplying several buffs.
 */
export function applyRallyingCry(
  caster: PlayerRuntime,
  players: Iterable<PlayerRuntime>,
  effect: RallyingCryEffect,
  radius: number,
  now: number,
  areAllies: AllyPredicate,
  hasVisibility: VisibilityPredicate,
): number {
  let affected = 0;
  for (const target of players) {
    if (
      target.life !== "alive" ||
      !target.authorized ||
      !areAllies(caster, target) ||
      distance(caster, target) > Math.max(0, radius) ||
      !hasVisibility(caster, target)
    )
      continue;
    applyBoundedPowerBuff(target, effect.powerMultiplier, effect.durationMs, now);
    affected += 1;
  }
  return affected;
}

/**
 * Colossus Charge crosses living enemies until terrain stops it. Contacts are ordered by their
 * swept fraction, then id, and bounded so one cast can never fan out into an unbounded room hit.
 */
export function colossusChargeImpacts<T extends { id: string }>(
  impacts: readonly { target: T; fraction: number }[],
  terrainFraction: number,
  effect: ColossusChargeEffect,
): { target: T; powerRatio: number }[] {
  const limit = Math.max(1, Math.min(12, Math.floor(effect.maxTargets)));
  return impacts
    .filter((entry) => entry.fraction <= terrainFraction)
    .sort(
      (left, right) =>
        left.fraction - right.fraction || left.target.id.localeCompare(right.target.id),
    )
    .slice(0, limit)
    .map((entry, index) => ({
      target: entry.target,
      powerRatio: index === 0 ? 1 : Math.max(0, effect.throughPowerRatio),
    }));
}

/**
 * Runs the server-selected shockwave set in stable id order. The direct collision target is
 * excluded so the arrival wave cannot duplicate the charge's primary impact.
 */
export function applySeismicImpact<T extends { id: string }>(
  targets: Iterable<T>,
  directTargetId: string | null,
  effect: SeismicImpactEffect,
  canHit: (target: T, radius: number) => boolean,
  hit: (target: T, powerRatio: number) => void,
): number {
  let hits = 0;
  for (const target of [...targets].sort((left, right) => left.id.localeCompare(right.id))) {
    if (target.id === directTargetId || !canHit(target, effect.radius)) continue;
    hit(target, effect.powerRatio);
    hits += 1;
  }
  return hits;
}

export function cycloneRecoveryMs(effect: CycloneEffect, baseRecoveryMs: number): number {
  const { ticks, intervalMs } = cycloneTiming(effect);
  return Math.max(baseRecoveryMs, ticks * intervalMs);
}

/** Ordered visual contacts mirror the exact bounded schedule consumed by the room tick. */
export function cycloneImpactTimes(effect: CycloneEffect, firstImpactAt: number): number[] {
  const { ticks, intervalMs } = cycloneTiming(effect);
  return Array.from({ length: ticks }, (_, index) => firstImpactAt + index * intervalMs);
}

export function startWarriorCyclone(
  player: PlayerRuntime,
  actionId: string,
  skill: SkillDefinition,
  effect: CycloneEffect,
  now: number,
): void {
  const { ticks, intervalMs } = cycloneTiming(effect);
  const basePower = skill.power + Math.max(0, player.level - 1) * 2;
  player.warriorCyclone = {
    actionId,
    nextTickAt: now,
    ticksRemaining: ticks,
    intervalMs,
    radius: Math.max(0, skill.radius ?? skill.range),
    power: Math.max(1, Math.round(basePower * Math.max(0, effect.powerRatio))),
  };
}

/**
 * Advances every Cyclone from the room tick. Catch-up is bounded by the stored tick budget, so a
 * delayed tick cannot create more hits than the talent defines.
 */
export function advanceWarriorCyclones(
  players: Iterable<PlayerRuntime>,
  now: number,
  strike: (player: PlayerRuntime, radius: number, power: number, actionId: string) => void,
): void {
  for (const player of players) {
    const cyclone = player.warriorCyclone;
    if (!cyclone) continue;
    if (!player.authorized || player.transitioning || player.life !== "alive") {
      player.warriorCyclone = null;
      continue;
    }
    while (cyclone.ticksRemaining > 0 && now >= cyclone.nextTickAt) {
      strike(player, cyclone.radius, cyclone.power, cyclone.actionId);
      cyclone.ticksRemaining -= 1;
      cyclone.nextTickAt += cyclone.intervalMs;
    }
    if (cyclone.ticksRemaining === 0) player.warriorCyclone = null;
  }
}
