import { ROGUE_BALANCE } from "@lindocara/engine/rogue.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";
import { skillWithTalents, type TalentEffect, talentEffects } from "@lindocara/engine/talents.js";
import {
  consumeDamageOverTimePower,
  type DamageOverTimeRuntime,
} from "./damage-over-time-system.js";
import type { PlayerRuntime } from "./world-runtime.js";

type ExecutorEffect = Extract<TalentEffect, { kind: "rogue_executor" }>;
type PredatorEffect = Extract<TalentEffect, { kind: "rogue_predator" }>;
type SmokeScreenEffect = Extract<TalentEffect, { kind: "rogue_smoke_screen" }>;
type DarkHarvestEffect = Extract<TalentEffect, { kind: "rogue_dark_harvest" }>;
type RuptureEffect = Extract<TalentEffect, { kind: "rogue_rupture" }>;

/**
 * Poisoned Shiv detonates a bounded share of its own existing poison. Consumed future ticks are
 * removed first, then amplified so Rupture accelerates damage and adds real total damage.
 */
export function rupturePoisonWithShiv(
  effects: DamageOverTimeRuntime[],
  sourceId: string,
  targetId: string,
  effect: RuptureEffect,
): { consumedPower: number; damage: number } {
  const consumedPower = consumeDamageOverTimePower(
    effects,
    {
      kind: "poison",
      sourceId,
      sourceSkillId: "poisoned_shiv",
      targetKind: "monster",
      targetId,
    },
    effect.remainingDamageRatio,
  );
  return {
    consumedPower,
    damage: Math.max(0, Math.round(consumedPower * Math.max(1, effect.detonationMultiplier))),
  };
}

/**
 * Grants one bounded Opening window. A second source replaces the first instead of stacking its
 * multiplier; this also makes refresh semantics explicit for every future Rogue evolution.
 */
export function grantRogueOpening(
  player: PlayerRuntime,
  source: NonNullable<PlayerRuntime["opening"]>["source"],
  now: number,
  bonusRatio: number = ROGUE_BALANCE.opening.bonusRatio,
): void {
  player.opening = {
    source,
    expiresAt: now + ROGUE_BALANCE.opening.durationMs,
    bonusRatio: Math.max(0, bonusRatio),
  };
  player.dirty = true;
}

/**
 * Intermediate power adds a bounded share of the normal Opening ratio. A named evolution may
 * replace the base ratio, but never turns that generic investment into a second stacking state.
 */
export function rogueOpeningBonusRatio(
  player: PlayerRuntime,
  slot: Extract<SkillSlot, 2 | 3>,
  evolvedBonusRatio?: number,
): number {
  const powerBonus = talentEffects(player.class, player.talents, slot).reduce(
    (total, effect) => total + (effect.kind === "power_multiplier" ? effect.value : 0),
    0,
  );
  return Math.max(
    0,
    (evolvedBonusRatio ?? ROGUE_BALANCE.opening.bonusRatio) +
      ROGUE_BALANCE.opening.bonusRatio * Math.max(0, powerBonus),
  );
}

/** Returns the live window without consuming it, clearing a stale runtime object on the way. */
export function activeRogueOpening(
  player: PlayerRuntime,
  now: number,
): NonNullable<PlayerRuntime["opening"]> | null {
  if (!player.opening) return null;
  if (player.opening.expiresAt > now) return player.opening;
  player.opening = null;
  player.dirty = true;
  return null;
}

/**
 * Consumes Opening only when the caller has already established a real authoritative hit. Merely
 * starting an attack, playing two dagger frames, or missing an arc never reaches this boundary.
 */
export function consumeRogueOpening(
  player: PlayerRuntime,
  now: number,
): NonNullable<PlayerRuntime["opening"]> | null {
  const opening = activeRogueOpening(player, now);
  if (!opening) return null;
  player.opening = null;
  player.dirty = true;
  return opening;
}

/** Tick cleanup keeps expired windows out of room memory; the client already owns the deadline. */
export function expireRogueOpening(player: PlayerRuntime, now: number): boolean {
  const hadOpening = player.opening !== null;
  activeRogueOpening(player, now);
  return hadOpening && player.opening === null;
}

export function isRogueStealthed(player: PlayerRuntime, now: number): boolean {
  return player.class === "rogue" && player.rogueStealthUntil > now;
}

/**
 * Enters real server stealth without starting its cooldown. Monster threat/navigation is owned by
 * the World and is cleared by the caller immediately after this state transition.
 */
export function enterRogueStealth(player: PlayerRuntime, now: number): boolean {
  if (player.class !== "rogue" || player.rogueStealthUntil > now) return false;
  player.rogueStealthUntil = now + ROGUE_BALANCE.vanish.maximumDurationMs;
  player.dirty = true;
  return true;
}

export interface RogueStealthExitOptions {
  offensive?: boolean;
  openingBonusRatio?: number;
}

/**
 * The Vanish cooldown is deliberately armed here, never on cast. Offensive exits grant one
 * Opening before the accepted action reaches its active frame; damage, expiry and room boundaries
 * do not.
 */
export function exitRogueStealth(
  player: PlayerRuntime,
  now: number,
  options: RogueStealthExitOptions = {},
): boolean {
  if (player.rogueStealthUntil <= 0) return false;
  const wasActive = player.rogueStealthUntil > now;
  player.rogueStealthUntil = 0;
  player.rogueSmokeProtectionUntil = 0;
  player.skillCooldowns[2] = Math.max(
    player.skillCooldowns[2] ?? 0,
    now + skillWithTalents(player.class, player.talents, 3).cooldownMs,
  );
  if (options.offensive && wasActive) {
    grantRogueOpening(
      player,
      "vanish",
      now,
      options.openingBonusRatio ?? ROGUE_BALANCE.opening.bonusRatio,
    );
  }
  player.dirty = true;
  return true;
}

export function expireRogueStealth(player: PlayerRuntime, now: number): boolean {
  return player.rogueStealthUntil > 0 && player.rogueStealthUntil <= now
    ? exitRogueStealth(player, now)
    : false;
}

export function expireRogueShadowDanceProtection(player: PlayerRuntime, now: number): boolean {
  if (
    player.rogueShadowDanceInvulnerableUntil <= 0 ||
    player.rogueShadowDanceInvulnerableUntil > now
  )
    return false;
  player.rogueShadowDanceInvulnerableUntil = 0;
  return true;
}

export function armRogueExecution(
  player: PlayerRuntime,
  targetId: string,
  now: number,
  effect: ExecutorEffect,
): void {
  player.rogueExecution = {
    targetId,
    expiresAt: now + Math.max(0, effect.killWindowMs),
  };
}

export function resolveRogueExecutionKill(
  player: PlayerRuntime,
  targetId: string,
  now: number,
  effect: ExecutorEffect,
): boolean {
  const execution = player.rogueExecution;
  if (!execution || execution.targetId !== targetId || execution.expiresAt < now) return false;
  player.rogueExecution = null;
  const currentDeadline = Math.max(now, player.skillCooldowns[1] ?? 0);
  const remaining = Math.max(0, currentDeadline - now);
  player.skillCooldowns[1] =
    now +
    Math.max(
      0,
      Math.round(remaining * (1 - Math.max(0, Math.min(1, effect.cooldownReductionRatio)))),
    );
  player.dirty = true;
  return true;
}

export function expireRogueExecution(player: PlayerRuntime, now: number): boolean {
  if (!player.rogueExecution || player.rogueExecution.expiresAt >= now) return false;
  player.rogueExecution = null;
  return true;
}

export function armRoguePredatorShiv(
  player: PlayerRuntime,
  now: number,
  effect: PredatorEffect,
): void {
  player.roguePredatorShivUntil = now + Math.max(0, effect.shivWindowMs);
}

export function consumeRoguePredatorShivMultiplier(
  player: PlayerRuntime,
  now: number,
  effect: PredatorEffect | undefined,
): number {
  if (!effect || player.roguePredatorShivUntil <= now) {
    if (player.roguePredatorShivUntil > 0 && player.roguePredatorShivUntil <= now)
      player.roguePredatorShivUntil = 0;
    return 1;
  }
  player.roguePredatorShivUntil = 0;
  player.dirty = true;
  return Math.max(1, effect.poisonPowerMultiplier);
}

export function applyRogueSmokeProtection(
  player: PlayerRuntime,
  now: number,
  effect: SmokeScreenEffect,
): void {
  player.rogueSmokeProtectionUntil = now + Math.max(0, effect.protectionMs);
  player.dirty = true;
}

export function expireRogueSmokeProtection(player: PlayerRuntime, now: number): boolean {
  if (player.rogueSmokeProtectionUntil <= 0 || player.rogueSmokeProtectionUntil > now) return false;
  player.rogueSmokeProtectionUntil = 0;
  return true;
}

export function expireRoguePredatorShiv(player: PlayerRuntime, now: number): boolean {
  if (player.roguePredatorShivUntil <= 0 || player.roguePredatorShivUntil > now) return false;
  player.roguePredatorShivUntil = 0;
  return true;
}

export function expireRogueShadowReturn(player: PlayerRuntime, now: number): boolean {
  if (!player.rogueShadowReturn || player.rogueShadowReturn.expiresAt >= now) return false;
  player.rogueShadowReturn = null;
  return true;
}

export function reduceRogueShadowDanceCooldown(
  player: PlayerRuntime,
  now: number,
  kills: number,
  effect: DarkHarvestEffect,
): number {
  const current = Math.max(now, player.skillCooldowns[4] ?? 0);
  const reduction = Math.max(0, Math.floor(kills)) * Math.max(0, effect.cooldownReductionPerKillMs);
  const next = Math.max(now, current - reduction);
  player.skillCooldowns[4] = next;
  player.dirty = true;
  return next;
}

/**
 * Rogue combat windows are deliberately session-local. This single reset boundary is reused by
 * death, disconnect and map transition so no caller can forget one of the related states.
 */
export function clearRogueTransientState(player: PlayerRuntime): void {
  player.opening = null;
  player.rogueStealthUntil = 0;
  player.rogueSmokeProtectionUntil = 0;
  player.roguePredatorShivUntil = 0;
  player.rogueShadowDanceInvulnerableUntil = 0;
  player.rogueShadowReturn = null;
  player.rogueExecution = null;
}
