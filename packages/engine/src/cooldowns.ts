import { RESURRECT_COOLDOWN_MS } from "./death.js";
import { ATTACK_COOLDOWN_MS, CLASS_STATS } from "./game.js";
import { CLASS_SKILLS, SKILL_SLOTS } from "./skills.js";

export type SkillCooldowns = [number, number, number, number, number];

/** Absolute server timestamps. Clients may display them, but never submit them. */
export interface CombatCooldownState {
  attackUntil: number;
  healUntil: number;
  skillCooldowns: number[];
  guardUntil: number;
  resurrectUntil: number;
}

const MAX_HEAL_COOLDOWN_MS = Math.max(
  0,
  ...Object.values(CLASS_STATS).map((stats) => stats.heal?.cooldownMs ?? 0),
);
const MAX_GUARD_DURATION_MS = Math.max(
  0,
  ...Object.values(CLASS_SKILLS)
    .flat()
    .map((skill) => (skill.effect === "guard" ? (skill.durationMs ?? 0) : 0)),
);
const MAX_SKILL_COOLDOWN_MS: SkillCooldowns = SKILL_SLOTS.map((slot) =>
  Math.max(0, ...Object.values(CLASS_SKILLS).map((skills) => skills[slot - 1]?.cooldownMs ?? 0)),
) as SkillCooldowns;

export function emptyCombatCooldowns(): CombatCooldownState {
  return {
    attackUntil: 0,
    healUntil: 0,
    skillCooldowns: [0, 0, 0, 0, 0],
    guardUntil: 0,
    resurrectUntil: 0,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function boundedDeadline(value: unknown, now: number, maximumAheadMs: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const deadline = Math.trunc(value);
  if (deadline <= now || deadline > now + maximumAheadMs) return 0;
  return deadline;
}

/**
 * Treat durable state as untrusted input. Expired, negative, non-finite and implausibly-future
 * values become available immediately instead of granting an attacker an endless cooldown.
 */
export function normalizeCombatCooldowns(value: unknown, now: number): CombatCooldownState {
  const empty = emptyCombatCooldowns();
  if (!Number.isFinite(now) || !isRecord(value)) return empty;
  const skills = Array.isArray(value.skillCooldowns) ? value.skillCooldowns : [];
  return {
    attackUntil: boundedDeadline(value.attackUntil, now, ATTACK_COOLDOWN_MS),
    healUntil: boundedDeadline(value.healUntil, now, MAX_HEAL_COOLDOWN_MS),
    skillCooldowns: SKILL_SLOTS.map((slot) =>
      boundedDeadline(skills[slot - 1], now, MAX_SKILL_COOLDOWN_MS[slot - 1] ?? 0),
    ) as SkillCooldowns,
    guardUntil: boundedDeadline(value.guardUntil, now, MAX_GUARD_DURATION_MS),
    resurrectUntil: boundedDeadline(value.resurrectUntil, now, RESURRECT_COOLDOWN_MS),
  };
}

export function hasActiveCombatCooldowns(state: CombatCooldownState): boolean {
  return (
    state.attackUntil > 0 ||
    state.healUntil > 0 ||
    state.guardUntil > 0 ||
    state.resurrectUntil > 0 ||
    state.skillCooldowns.some((deadline) => deadline > 0)
  );
}

export function latestCombatCooldown(state: CombatCooldownState): number {
  return Math.max(
    state.attackUntil,
    state.healUntil,
    state.guardUntil,
    state.resurrectUntil,
    ...state.skillCooldowns,
  );
}
