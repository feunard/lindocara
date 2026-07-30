import type { PlayerClass } from "./game.js";

export const DAMAGE_TYPES = ["physical", "magical"] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const COMBAT_STAT_KEYS = [
  "dodgeChance",
  "parryChance",
  "physicalResistance",
  "magicalResistance",
  "criticalChance",
] as const;
export type CombatStatKey = (typeof COMBAT_STAT_KEYS)[number];

/** All values are ratios: `0.12` means twelve percent. */
export interface CombatStats {
  dodgeChance: number;
  parryChance: number;
  physicalResistance: number;
  magicalResistance: number;
  criticalChance: number;
}

export type CombatStatBonuses = Readonly<Partial<Record<CombatStatKey, number>>>;

/**
 * Hard caps keep permanent progression useful without letting one character erase another class's
 * identity. Active Warrior guard and talent parries are separate authored mechanics.
 */
export const COMBAT_STAT_CAPS: Readonly<CombatStats> = {
  dodgeChance: 0.35,
  parryChance: 0.25,
  physicalResistance: 0.45,
  magicalResistance: 0.45,
  criticalChance: 0.4,
};

/**
 * Baselines are deliberately asymmetric while keeping incoming effective health in the same broad
 * band. Dodge answers every direct strike; passive parry answers physical strikes only.
 */
export const CLASS_COMBAT_STATS: Readonly<Record<PlayerClass, CombatStats>> = {
  warrior: {
    dodgeChance: 0.03,
    parryChance: 0.12,
    physicalResistance: 0.22,
    magicalResistance: 0.05,
    criticalChance: 0.07,
  },
  ranger: {
    dodgeChance: 0.1,
    parryChance: 0.04,
    physicalResistance: 0.1,
    magicalResistance: 0.1,
    criticalChance: 0.12,
  },
  priest: {
    dodgeChance: 0.04,
    parryChance: 0.02,
    physicalResistance: 0.05,
    magicalResistance: 0.22,
    criticalChance: 0.08,
  },
  rogue: {
    dodgeChance: 0.2,
    parryChance: 0.05,
    physicalResistance: 0.03,
    magicalResistance: 0.03,
    criticalChance: 0.2,
  },
};

export const CRITICAL_DAMAGE_MULTIPLIER = 1.5;

export interface CombatEntropyState {
  dodge: number;
  parry: number;
  critical: number;
}

export interface EntropyRoll {
  triggered: boolean;
  next: number;
}

export interface AvoidanceOutcome {
  avoidedBy: "dodge" | "parry" | null;
  damage: number;
  entropy: CombatEntropyState;
}

export interface CriticalOutcome {
  critical: boolean;
  damage: number;
  entropy: CombatEntropyState;
}

function clampRatio(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(maximum, value));
}

export function combatStatsForClass(
  playerClass: PlayerClass,
  bonuses: CombatStatBonuses = {},
): CombatStats {
  const base = CLASS_COMBAT_STATS[playerClass];
  return {
    dodgeChance: clampRatio(
      base.dodgeChance + (bonuses.dodgeChance ?? 0),
      COMBAT_STAT_CAPS.dodgeChance,
    ),
    parryChance: clampRatio(
      base.parryChance + (bonuses.parryChance ?? 0),
      COMBAT_STAT_CAPS.parryChance,
    ),
    physicalResistance: clampRatio(
      base.physicalResistance + (bonuses.physicalResistance ?? 0),
      COMBAT_STAT_CAPS.physicalResistance,
    ),
    magicalResistance: clampRatio(
      base.magicalResistance + (bonuses.magicalResistance ?? 0),
      COMBAT_STAT_CAPS.magicalResistance,
    ),
    criticalChance: clampRatio(
      base.criticalChance + (bonuses.criticalChance ?? 0),
      COMBAT_STAT_CAPS.criticalChance,
    ),
  };
}

/**
 * A deterministic entropy roll gives the authored long-run chance while preventing unfair hit or
 * miss streaks. The state is room-local and never client-authored.
 */
export function resolveEntropyChance(entropy: number, chance: number): EntropyRoll {
  const boundedChance = clampRatio(chance, 1);
  const boundedEntropy = Number.isFinite(entropy) ? ((entropy % 1) + 1) % 1 : 0;
  if (boundedChance === 0) return { triggered: false, next: boundedEntropy };
  const next = boundedEntropy + boundedChance;
  return next >= 1 ? { triggered: true, next: next - 1 } : { triggered: false, next };
}

/**
 * A stable per-hero seed prevents every reconnecting hero from sharing the exact same proc cadence.
 * FNV-1a is sufficient here: this is fairness distribution, never cryptographic randomness.
 */
export function initialCombatEntropy(heroId: string): CombatEntropyState {
  const seed = (suffix: string): number => {
    let hash = 0x811c9dc5;
    for (const character of `${heroId}:${suffix}`) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) / 0x1_0000_0000;
  };
  return {
    dodge: seed("dodge"),
    parry: seed("parry"),
    critical: seed("critical"),
  };
}

export function resolveIncomingAttack(
  damage: number,
  damageType: DamageType,
  stats: CombatStats,
  entropy: CombatEntropyState,
): AvoidanceOutcome {
  const dodge = resolveEntropyChance(entropy.dodge, stats.dodgeChance);
  const afterDodge = { ...entropy, dodge: dodge.next };
  if (dodge.triggered) return { avoidedBy: "dodge", damage: 0, entropy: afterDodge };

  if (damageType === "physical") {
    const parry = resolveEntropyChance(afterDodge.parry, stats.parryChance);
    const afterParry = { ...afterDodge, parry: parry.next };
    if (parry.triggered) return { avoidedBy: "parry", damage: 0, entropy: afterParry };
    const resistance = clampRatio(stats.physicalResistance, COMBAT_STAT_CAPS.physicalResistance);
    return {
      avoidedBy: null,
      damage: Math.max(1, Math.round(Math.max(0, damage) * (1 - resistance))),
      entropy: afterParry,
    };
  }

  const resistance = clampRatio(stats.magicalResistance, COMBAT_STAT_CAPS.magicalResistance);
  return {
    avoidedBy: null,
    damage: Math.max(1, Math.round(Math.max(0, damage) * (1 - resistance))),
    entropy: afterDodge,
  };
}

export function resolveCriticalDamage(
  damage: number,
  stats: CombatStats,
  entropy: CombatEntropyState,
  canCrit = true,
): CriticalOutcome {
  if (!canCrit)
    return {
      critical: false,
      damage: Math.max(1, Math.round(damage)),
      entropy,
    };
  const roll = resolveEntropyChance(entropy.critical, stats.criticalChance);
  return {
    critical: roll.triggered,
    damage: Math.max(1, Math.round(damage * (roll.triggered ? CRITICAL_DAMAGE_MULTIPLIER : 1))),
    entropy: { ...entropy, critical: roll.next },
  };
}
