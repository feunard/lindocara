export const CONSUMABLE_IDS = [
  "health_potion",
  "mana_potion",
  "damage_elixir",
  "oblivion_draught",
  "invisibility_potion",
  "resurrection_potion",
] as const;

export type ConsumableId = (typeof CONSUMABLE_IDS)[number];
export type ConsumableCurrency = "gold" | "crystals";

export interface ConsumableDefinition {
  id: ConsumableId;
  currency: ConsumableCurrency;
  price: number;
  effectValue: number;
  durationMs: number;
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
};

export type ConsumableCounts = Record<ConsumableId, number>;

export function emptyConsumables(healthPotions = 0): ConsumableCounts {
  return {
    health_potion: Math.max(0, Math.floor(healthPotions)),
    mana_potion: 0,
    damage_elixir: 0,
    oblivion_draught: 0,
    invisibility_potion: 0,
    resurrection_potion: 0,
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
