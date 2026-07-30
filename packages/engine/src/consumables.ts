import {
  type CombatStatBonuses,
  type CombatStatKey,
  normalizeCombatStatBonuses,
  normalizeTemporaryCombatStatBoosts,
  PERMANENT_COMBAT_STAT_BONUS_CAP,
  type TemporaryCombatStatBoosts,
} from "./combat-stats.js";

export const CONSUMABLE_IDS = [
  "health_potion",
  "mana_potion",
  "damage_elixir",
  "oblivion_draught",
  "invisibility_potion",
  "resurrection_potion",
  "evasion_tonic",
  "parrying_oil",
  "stoneskin_tonic",
  "arcane_ward_tonic",
  "precision_tonic",
  "evasion_manual",
  "parrying_manual",
  "physical_resistance_manual",
  "magical_resistance_manual",
  "critical_manual",
] as const;

export type ConsumableId = (typeof CONSUMABLE_IDS)[number];
export type ConsumableCurrency = "gold" | "crystals";

export interface ConsumableDefinition {
  id: ConsumableId;
  currency: ConsumableCurrency;
  price: number;
  effectValue: number;
  durationMs: number;
  combatStat?: {
    stat: CombatStatKey;
    mode: "temporary" | "permanent";
  };
}

export const CONSUMABLE_COOLDOWN_MS = 10_000;
export const RESURRECTION_DELAY_MS = 10_000;

/** The per-consumable session-inventory capacity an authored `changeItems` grant respects. A stack
 *  already at this ceiling is "full": the grant is dropped and the hero is told, the existing loot
 *  precedent for a pickup that cannot land. The merchant path predates events and does not enforce
 *  this — the cap is the event grant's own rule for this session-inventory slice. */
export const CONSUMABLE_MAX_STACK = 99;

export const CONSUMABLES: Readonly<Record<ConsumableId, ConsumableDefinition>> = {
  health_potion: {
    id: "health_potion",
    currency: "gold",
    price: 8,
    effectValue: 45,
    durationMs: 0,
  },
  mana_potion: {
    id: "mana_potion",
    currency: "gold",
    price: 8,
    effectValue: 45,
    durationMs: 0,
  },
  damage_elixir: {
    id: "damage_elixir",
    currency: "crystals",
    price: 3,
    effectValue: 0.25,
    durationMs: 15_000,
  },
  oblivion_draught: {
    id: "oblivion_draught",
    currency: "crystals",
    price: 2,
    effectValue: 0,
    durationMs: 8_000,
  },
  invisibility_potion: {
    id: "invisibility_potion",
    currency: "crystals",
    price: 4,
    effectValue: 0,
    durationMs: 8_000,
  },
  resurrection_potion: {
    id: "resurrection_potion",
    currency: "crystals",
    price: 6,
    effectValue: 0,
    durationMs: RESURRECTION_DELAY_MS,
  },
  evasion_tonic: {
    id: "evasion_tonic",
    currency: "gold",
    price: 24,
    effectValue: 0.08,
    durationMs: 60_000,
    combatStat: { stat: "dodgeChance", mode: "temporary" },
  },
  parrying_oil: {
    id: "parrying_oil",
    currency: "gold",
    price: 24,
    effectValue: 0.08,
    durationMs: 60_000,
    combatStat: { stat: "parryChance", mode: "temporary" },
  },
  stoneskin_tonic: {
    id: "stoneskin_tonic",
    currency: "gold",
    price: 28,
    effectValue: 0.1,
    durationMs: 60_000,
    combatStat: { stat: "physicalResistance", mode: "temporary" },
  },
  arcane_ward_tonic: {
    id: "arcane_ward_tonic",
    currency: "gold",
    price: 28,
    effectValue: 0.1,
    durationMs: 60_000,
    combatStat: { stat: "magicalResistance", mode: "temporary" },
  },
  precision_tonic: {
    id: "precision_tonic",
    currency: "gold",
    price: 28,
    effectValue: 0.1,
    durationMs: 60_000,
    combatStat: { stat: "criticalChance", mode: "temporary" },
  },
  evasion_manual: {
    id: "evasion_manual",
    currency: "crystals",
    price: 12,
    effectValue: 0.01,
    durationMs: 0,
    combatStat: { stat: "dodgeChance", mode: "permanent" },
  },
  parrying_manual: {
    id: "parrying_manual",
    currency: "crystals",
    price: 12,
    effectValue: 0.01,
    durationMs: 0,
    combatStat: { stat: "parryChance", mode: "permanent" },
  },
  physical_resistance_manual: {
    id: "physical_resistance_manual",
    currency: "crystals",
    price: 12,
    effectValue: 0.01,
    durationMs: 0,
    combatStat: { stat: "physicalResistance", mode: "permanent" },
  },
  magical_resistance_manual: {
    id: "magical_resistance_manual",
    currency: "crystals",
    price: 12,
    effectValue: 0.01,
    durationMs: 0,
    combatStat: { stat: "magicalResistance", mode: "permanent" },
  },
  critical_manual: {
    id: "critical_manual",
    currency: "crystals",
    price: 12,
    effectValue: 0.01,
    durationMs: 0,
    combatStat: { stat: "criticalChance", mode: "permanent" },
  },
};

export interface CombatStatConsumableApplication {
  applied: boolean;
  permanentBonuses: CombatStatBonuses;
  temporaryBoosts: TemporaryCombatStatBoosts;
}

export function applyCombatStatConsumable(
  item: ConsumableId,
  permanentBonuses: CombatStatBonuses,
  temporaryBoosts: TemporaryCombatStatBoosts,
  now: number,
): CombatStatConsumableApplication | null {
  const definition = CONSUMABLES[item];
  const effect = definition.combatStat;
  if (!effect) return null;
  const normalizedPermanent = normalizeCombatStatBonuses(permanentBonuses);
  const normalizedTemporary = normalizeTemporaryCombatStatBoosts(temporaryBoosts, now);
  if (effect.mode === "temporary") {
    return {
      applied: true,
      permanentBonuses: normalizedPermanent,
      temporaryBoosts: {
        ...normalizedTemporary,
        [effect.stat]: {
          bonus: definition.effectValue,
          until: now + definition.durationMs,
        },
      },
    };
  }

  const current = normalizedPermanent[effect.stat] ?? 0;
  if (current >= PERMANENT_COMBAT_STAT_BONUS_CAP) {
    return {
      applied: false,
      permanentBonuses: normalizedPermanent,
      temporaryBoosts: normalizedTemporary,
    };
  }
  return {
    applied: true,
    permanentBonuses: {
      ...normalizedPermanent,
      [effect.stat]: Math.min(
        PERMANENT_COMBAT_STAT_BONUS_CAP,
        Math.round((current + definition.effectValue) * 100) / 100,
      ),
    },
    temporaryBoosts: normalizedTemporary,
  };
}

export type ConsumableCounts = Record<ConsumableId, number>;

export function emptyConsumables(healthPotions = 0): ConsumableCounts {
  return {
    health_potion: Math.max(0, Math.floor(healthPotions)),
    mana_potion: 0,
    damage_elixir: 0,
    oblivion_draught: 0,
    invisibility_potion: 0,
    resurrection_potion: 0,
    evasion_tonic: 0,
    parrying_oil: 0,
    stoneskin_tonic: 0,
    arcane_ward_tonic: 0,
    precision_tonic: 0,
    evasion_manual: 0,
    parrying_manual: 0,
    physical_resistance_manual: 0,
    magical_resistance_manual: 0,
    critical_manual: 0,
  };
}

export function normalizeConsumables(
  value: Partial<ConsumableCounts> | undefined,
  healthPotions = 0,
): ConsumableCounts {
  const normalized = emptyConsumables(healthPotions);
  for (const id of CONSUMABLE_IDS) {
    const count = value?.[id];
    if (typeof count === "number" && Number.isFinite(count)) {
      normalized[id] = Math.max(0, Math.floor(count));
    }
  }
  normalized.health_potion = Math.max(normalized.health_potion, Math.max(0, healthPotions));
  return normalized;
}

export function isConsumableId(value: unknown): value is ConsumableId {
  return typeof value === "string" && (CONSUMABLE_IDS as readonly string[]).includes(value);
}
