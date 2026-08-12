import { ATTACK_COOLDOWN_MS, type PlayerClass } from "./game.js";
import { PEASANT_SUPPORT_SKILLS } from "./peasant-support.js";
import { ROGUE_BALANCE } from "./rogue.js";
import { TILE_SIZE } from "./tilemap.js";

export const SKILL_SLOTS = [1, 2, 3, 4, 5] as const;
export type SkillSlot = (typeof SKILL_SLOTS)[number];

export type SkillEffect =
  | "attack"
  | "charge"
  | "dash"
  | "single_damage"
  | "area_damage"
  | "area_taunt"
  | "guard"
  | "single_heal"
  | "area_heal"
  | "area_buff"
  | "nova"
  | "teleport"
  | "shadow_step"
  | "stealth"
  | "shadow_dance"
  | "harvest"
  | "construction"
  | "homemade_bomb";

/**
 * `range`, `radius` and `distance` are TILE UNITS — the exact quotient of each former pixel value
 * by `TILE_SIZE`, written as the division so the balance a designer tuned in pixels stays legible.
 * The four rogue rows and the two peasant rows read their geometry from `ROGUE_BALANCE` and
 * `PEASANT_SUPPORT_SKILLS`, which are converted at their own definitions rather than divided here:
 * a range divided at a second site is how half a conversion hides.
 */
export interface SkillDefinition {
  id: string;
  slot: SkillSlot;
  effect: SkillEffect;
  cooldownMs: number;
  range: number;
  power: number;
  distance?: number;
  radius?: number;
  durationMs?: number;
  reduction?: number;
  allyPower?: number;
  icon: string;
}

export const CLASS_SKILLS: Readonly<Record<PlayerClass, readonly SkillDefinition[]>> = {
  warrior: [
    {
      id: "cleave",
      slot: 1,
      effect: "attack",
      cooldownMs: ATTACK_COOLDOWN_MS,
      range: 60 / TILE_SIZE,
      power: 0,
      icon: "⚔",
    },
    {
      id: "iron_guard",
      slot: 2,
      effect: "guard",
      cooldownMs: 8_000,
      range: 0 / TILE_SIZE,
      power: 0,
      reduction: 0.5,
      icon: "◆",
    },
    {
      id: "shield_bash",
      slot: 3,
      effect: "charge",
      cooldownMs: 3_200,
      range: 308 / TILE_SIZE,
      power: 24,
      distance: 300 / TILE_SIZE,
      icon: "◈",
    },
    {
      id: "battle_cry",
      slot: 4,
      effect: "area_taunt",
      cooldownMs: 5_500,
      range: 105 / TILE_SIZE,
      radius: 105 / TILE_SIZE,
      power: 0,
      icon: "※",
    },
    {
      id: "whirlwind",
      slot: 5,
      effect: "area_damage",
      cooldownMs: 8_000,
      range: 82 / TILE_SIZE,
      radius: 82 / TILE_SIZE,
      power: 36,
      icon: "◎",
    },
  ],
  ranger: [
    {
      id: "quick_shot",
      slot: 1,
      effect: "attack",
      cooldownMs: ATTACK_COOLDOWN_MS,
      range: 382.5 / TILE_SIZE,
      power: 0,
      icon: "➶",
    },
    {
      id: "piercing_arrow",
      slot: 2,
      effect: "single_damage",
      cooldownMs: 2_000,
      range: 405 / TILE_SIZE,
      power: 29,
      icon: "➵",
    },
    {
      id: "volley",
      slot: 3,
      effect: "area_damage",
      cooldownMs: 5_000,
      range: 324 / TILE_SIZE,
      radius: 324 / TILE_SIZE,
      power: 17,
      icon: "⌁",
    },
    {
      id: "dash",
      slot: 4,
      effect: "dash",
      cooldownMs: 7_000,
      range: 0 / TILE_SIZE,
      power: 0,
      distance: 189 / TILE_SIZE,
      icon: "◒",
    },
    {
      id: "heartseeker",
      slot: 5,
      effect: "single_damage",
      cooldownMs: 8_500,
      range: 517.5 / TILE_SIZE,
      power: 52,
      icon: "✦",
    },
  ],
  priest: [
    {
      id: "radiant_bolt",
      slot: 1,
      effect: "attack",
      cooldownMs: ATTACK_COOLDOWN_MS,
      range: 337.5 / TILE_SIZE,
      power: 0,
      icon: "✧",
    },
    {
      id: "mend",
      slot: 2,
      effect: "single_heal",
      cooldownMs: 1_500,
      range: 390 / TILE_SIZE,
      power: 35,
      allyPower: 35,
      icon: "✚",
    },
    {
      id: "blink",
      slot: 3,
      effect: "teleport",
      cooldownMs: 8_000,
      range: 0 / TILE_SIZE,
      power: 0,
      distance: 247.5 / TILE_SIZE,
      icon: "◇",
    },
    {
      id: "prayer",
      slot: 4,
      effect: "area_heal",
      cooldownMs: 6_000,
      range: 155 / TILE_SIZE,
      radius: 155 / TILE_SIZE,
      power: 22,
      icon: "❈",
    },
    {
      id: "divine_nova",
      slot: 5,
      effect: "nova",
      cooldownMs: 10_000,
      range: 120 / TILE_SIZE,
      radius: 120 / TILE_SIZE,
      power: 26,
      icon: "☼",
    },
  ],
  rogue: [
    {
      id: "dual_slash",
      slot: 1,
      effect: "attack",
      cooldownMs: ATTACK_COOLDOWN_MS,
      range: ROGUE_BALANCE.attack.range,
      power: 0,
      icon: "‡",
    },
    {
      id: "shadow_step",
      slot: 2,
      effect: "shadow_step",
      cooldownMs: ROGUE_BALANCE.shadowStep.cooldownMs,
      range: ROGUE_BALANCE.shadowStep.selectionRange,
      power: 0,
      icon: "◆",
    },
    {
      id: "vanish",
      slot: 3,
      effect: "stealth",
      cooldownMs: ROGUE_BALANCE.vanish.cooldownMs,
      range: 0 / TILE_SIZE,
      power: 0,
      durationMs: ROGUE_BALANCE.vanish.maximumDurationMs,
      icon: "◌",
    },
    {
      id: "poisoned_shiv",
      slot: 4,
      effect: "single_damage",
      cooldownMs: ROGUE_BALANCE.poisonedShiv.cooldownMs,
      range: ROGUE_BALANCE.poisonedShiv.range,
      power: ROGUE_BALANCE.poisonedShiv.directPower,
      icon: "♠",
    },
    {
      id: "shadow_dance",
      slot: 5,
      effect: "shadow_dance",
      cooldownMs: ROGUE_BALANCE.shadowDance.cooldownMs,
      range: ROGUE_BALANCE.shadowDance.selectionRange,
      power: ROGUE_BALANCE.shadowDance.powerPerHit,
      icon: "✦",
    },
  ],
  peasant: [
    {
      id: "woodcutters_swing",
      slot: 1,
      effect: "harvest",
      cooldownMs: 420,
      range: 54 / TILE_SIZE,
      power: 0,
      icon: "🪓",
    },
    {
      id: "prospectors_pick",
      slot: 2,
      effect: "area_buff",
      cooldownMs: 6_500,
      range: 144 / TILE_SIZE,
      radius: 144 / TILE_SIZE,
      durationMs: 6_000,
      power: 12,
      icon: "🐓",
    },
    {
      id: "butchers_cut",
      slot: 3,
      effect: "area_heal",
      cooldownMs: 4_800,
      range: 128 / TILE_SIZE,
      radius: 128 / TILE_SIZE,
      durationMs: 4_000,
      power: 18,
      icon: "🧺",
    },
    {
      id: "makeshift_camp",
      slot: 4,
      effect: "construction",
      cooldownMs: 12_000,
      range: 72 / TILE_SIZE,
      radius: PEASANT_SUPPORT_SKILLS[4].radius,
      durationMs: PEASANT_SUPPORT_SKILLS[4].durationMs,
      power: PEASANT_SUPPORT_SKILLS[4].power,
      icon: "⌂",
    },
    {
      id: "homemade_bomb",
      slot: 5,
      effect: "homemade_bomb",
      cooldownMs: 10_000,
      range: 300 / TILE_SIZE,
      radius: PEASANT_SUPPORT_SKILLS[5].radius,
      durationMs: PEASANT_SUPPORT_SKILLS[5].durationMs,
      power: PEASANT_SUPPORT_SKILLS[5].power,
      icon: "●",
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

export const SKILL_UNLOCK_LEVEL: Readonly<Record<SkillSlot, number>> = {
  1: 1,
  2: 3,
  3: 5,
  4: 7,
  5: 10,
};

export function isSkillUnlocked(level: number, slot: SkillSlot): boolean {
  return level >= SKILL_UNLOCK_LEVEL[slot];
}
