import type { PlayerClass } from "./game.js";
import type { SkillSlot } from "./skills.js";

export type ClassResourceKind = "endurance" | "energy" | "mana";

export interface ClassResourceState {
  kind: ClassResourceKind;
  current: number;
  max: number;
}

interface ResourceRules {
  kind: ClassResourceKind;
  max: number;
  regenerationPerSecond: number;
  skillCosts: Readonly<Record<SkillSlot, number>>;
  damageDealtGeneration: number;
  damageTakenGeneration: number;
  usefulHealingGeneration: number;
}

export const CLASS_RESOURCE_RULES: Readonly<Record<PlayerClass, ResourceRules>> = {
  warrior: {
    kind: "endurance",
    max: 100,
    regenerationPerSecond: 10,
    skillCosts: { 1: 0, 2: 30, 3: 25, 4: 35, 5: 45 },
    damageDealtGeneration: 0.12,
    damageTakenGeneration: 0.2,
    usefulHealingGeneration: 0,
  },
  ranger: {
    kind: "energy",
    max: 100,
    regenerationPerSecond: 14,
    skillCosts: { 1: 0, 2: 20, 3: 30, 4: 25, 5: 40 },
    damageDealtGeneration: 0,
    damageTakenGeneration: 0,
    usefulHealingGeneration: 0,
  },
  priest: {
    kind: "mana",
    max: 100,
    regenerationPerSecond: 9,
    skillCosts: { 1: 0, 2: 18, 3: 25, 4: 32, 5: 45 },
    damageDealtGeneration: 0,
    damageTakenGeneration: 0,
    usefulHealingGeneration: 0.12,
  },
};

export function initialResource(playerClass: PlayerClass): ClassResourceState {
  const rules = CLASS_RESOURCE_RULES[playerClass];
  return { kind: rules.kind, current: rules.max, max: rules.max };
}

export function skillResourceCost(playerClass: PlayerClass, slot: SkillSlot): number {
  return CLASS_RESOURCE_RULES[playerClass].skillCosts[slot];
}

export function canSpendResource(state: ClassResourceState, cost: number): boolean {
  return Number.isFinite(cost) && cost >= 0 && state.current >= cost;
}

export function spendResource(state: ClassResourceState, cost: number): boolean {
  if (!canSpendResource(state, cost)) return false;
  state.current = Math.max(0, state.current - cost);
  return true;
}

export function regenerateResource(
  playerClass: PlayerClass,
  state: ClassResourceState,
  seconds: number,
): void {
  const gain = CLASS_RESOURCE_RULES[playerClass].regenerationPerSecond * Math.max(0, seconds);
  state.current = Math.min(state.max, state.current + gain);
}

export function generateResource(
  playerClass: PlayerClass,
  state: ClassResourceState,
  source: "damage_dealt" | "damage_taken" | "useful_healing",
  usefulAmount: number,
): void {
  const rules = CLASS_RESOURCE_RULES[playerClass];
  const factor =
    source === "damage_dealt"
      ? rules.damageDealtGeneration
      : source === "damage_taken"
        ? rules.damageTakenGeneration
        : rules.usefulHealingGeneration;
  state.current = Math.min(state.max, state.current + Math.max(0, usefulAmount) * factor);
}
