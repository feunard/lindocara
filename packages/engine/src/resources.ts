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

export const CLASS_RESOURCE_RULES: Readonly<Partial<Record<PlayerClass, ResourceRules>>> = {
  priest: {
    kind: "mana",
    max: 100,
    regenerationPerSecond: 4,
    skillCosts: { 1: 0, 2: 18, 3: 25, 4: 32, 5: 45 },
    damageDealtGeneration: 0,
    damageTakenGeneration: 0,
    usefulHealingGeneration: 0,
  },
};

export function initialResource(playerClass: PlayerClass): ClassResourceState | undefined {
  const rules = CLASS_RESOURCE_RULES[playerClass];
  if (!rules) return undefined;
  return { kind: rules.kind, current: rules.max, max: rules.max };
}

export function skillResourceCost(playerClass: PlayerClass, slot: SkillSlot): number {
  return CLASS_RESOURCE_RULES[playerClass]?.skillCosts[slot] ?? 0;
}

export function canSpendResource(state: ClassResourceState | undefined, cost: number): boolean {
  return (
    Number.isFinite(cost) &&
    cost >= 0 &&
    (cost === 0 || (state !== undefined && state.current >= cost))
  );
}

export function spendResource(state: ClassResourceState | undefined, cost: number): boolean {
  if (!canSpendResource(state, cost)) return false;
  if (!state || cost === 0) return true;
  state.current = Math.max(0, state.current - cost);
  return true;
}

export function regenerateResource(
  playerClass: PlayerClass,
  state: ClassResourceState | undefined,
  seconds: number,
): void {
  const rules = CLASS_RESOURCE_RULES[playerClass];
  if (!rules || !state || state.kind !== rules.kind) return;
  const gain = rules.regenerationPerSecond * Math.max(0, seconds);
  state.current = Math.min(state.max, state.current + gain);
}

export function generateResource(
  playerClass: PlayerClass,
  state: ClassResourceState | undefined,
  source: "damage_dealt" | "damage_taken" | "useful_healing",
  usefulAmount: number,
): void {
  const rules = CLASS_RESOURCE_RULES[playerClass];
  if (!rules || !state || state.kind !== rules.kind) return;
  const factor =
    source === "damage_dealt"
      ? rules.damageDealtGeneration
      : source === "damage_taken"
        ? rules.damageTakenGeneration
        : rules.usefulHealingGeneration;
  state.current = Math.min(state.max, state.current + Math.max(0, usefulAmount) * factor);
}
