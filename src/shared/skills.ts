import type { PlayerClass } from "./game.js";

export const SKILL_SLOTS = [1, 2, 3, 4, 5] as const;
export type SkillSlot = (typeof SKILL_SLOTS)[number];

export type SkillEffect =
  | "attack"
  | "single_damage"
  | "area_damage"
  | "guard"
  | "single_heal"
  | "area_heal"
  | "nova";

export interface SkillDefinition {
  id: string;
  slot: SkillSlot;
  effect: SkillEffect;
  cooldownMs: number;
  range: number;
  power: number;
  radius?: number;
  durationMs?: number;
  reduction?: number;
  icon: string;
}

export const CLASS_SKILLS: Readonly<Record<PlayerClass, readonly SkillDefinition[]>> = {
  warrior: [
    { id: "cleave", slot: 1, effect: "attack", cooldownMs: 650, range: 60, power: 0, icon: "⚔" },
    {
      id: "iron_guard",
      slot: 2,
      effect: "guard",
      cooldownMs: 8_000,
      range: 0,
      power: 0,
      durationMs: 3_500,
      reduction: 0.5,
      icon: "◆",
    },
    {
      id: "shield_bash",
      slot: 3,
      effect: "single_damage",
      cooldownMs: 2_400,
      range: 68,
      power: 24,
      icon: "◈",
    },
    {
      id: "battle_cry",
      slot: 4,
      effect: "area_damage",
      cooldownMs: 5_500,
      range: 105,
      radius: 105,
      power: 16,
      icon: "※",
    },
    {
      id: "whirlwind",
      slot: 5,
      effect: "area_damage",
      cooldownMs: 8_000,
      range: 82,
      radius: 82,
      power: 36,
      icon: "◎",
    },
  ],
  ranger: [
    {
      id: "quick_shot",
      slot: 1,
      effect: "attack",
      cooldownMs: 650,
      range: 170,
      power: 0,
      icon: "➶",
    },
    {
      id: "piercing_arrow",
      slot: 2,
      effect: "single_damage",
      cooldownMs: 2_000,
      range: 200,
      power: 29,
      icon: "➵",
    },
    {
      id: "volley",
      slot: 3,
      effect: "area_damage",
      cooldownMs: 5_000,
      range: 160,
      radius: 160,
      power: 17,
      icon: "⌁",
    },
    {
      id: "sidestep",
      slot: 4,
      effect: "guard",
      cooldownMs: 7_000,
      range: 0,
      power: 0,
      durationMs: 2_500,
      reduction: 0.65,
      icon: "◒",
    },
    {
      id: "heartseeker",
      slot: 5,
      effect: "single_damage",
      cooldownMs: 8_500,
      range: 230,
      power: 52,
      icon: "✦",
    },
  ],
  priest: [
    {
      id: "radiant_bolt",
      slot: 1,
      effect: "attack",
      cooldownMs: 650,
      range: 100,
      power: 0,
      icon: "✧",
    },
    {
      id: "mend",
      slot: 2,
      effect: "single_heal",
      cooldownMs: 1_500,
      range: 130,
      power: 35,
      icon: "✚",
    },
    {
      id: "sanctuary",
      slot: 3,
      effect: "guard",
      cooldownMs: 8_000,
      range: 0,
      power: 0,
      durationMs: 4_000,
      reduction: 0.4,
      icon: "◇",
    },
    {
      id: "prayer",
      slot: 4,
      effect: "area_heal",
      cooldownMs: 6_000,
      range: 155,
      radius: 155,
      power: 22,
      icon: "❈",
    },
    {
      id: "divine_nova",
      slot: 5,
      effect: "nova",
      cooldownMs: 10_000,
      range: 120,
      radius: 120,
      power: 26,
      icon: "☼",
    },
  ],
};

export function skillFor(playerClass: PlayerClass, slot: SkillSlot): SkillDefinition {
  const skill = CLASS_SKILLS[playerClass][slot - 1];
  if (!skill) throw new Error(`Missing skill ${playerClass}:${slot}`);
  return skill;
}

export function isSkillSlot(value: unknown): value is SkillSlot {
  return typeof value === "number" && (SKILL_SLOTS as readonly number[]).includes(value);
}
