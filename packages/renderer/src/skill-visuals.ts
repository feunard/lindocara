/**
 * Presentation-only vocabulary for every playable skill.
 *
 * The server still owns contacts, movement grants, healing and every other outcome. These profiles
 * only turn an already accepted animation/impact into HD-2D geometry. Keeping the table explicit is
 * intentional: adding a skill without giving it a visual identity must fail the coverage test.
 */
export type SkillCastShape =
  | "slash"
  | "guard"
  | "charge"
  | "wave"
  | "spin"
  | "projectile"
  | "fan"
  | "heal"
  | "blink"
  | "stealth"
  | "harvest"
  | "construct"
  | "bomb";

export interface SkillVisualDefinition {
  cast: SkillCastShape;
  color: number;
  accent: number;
  reach: number;
  width: number;
  impactRadius: number;
  impactDurationMs: number;
}

export const SKILL_VISUALS = {
  cleave: {
    cast: "slash",
    color: 0xffb45d,
    accent: 0xffe0a1,
    reach: 0.95,
    width: 0.11,
    impactRadius: 0.58,
    impactDurationMs: 420,
  },
  iron_guard: {
    cast: "guard",
    color: 0xffd66b,
    accent: 0xfff0b0,
    reach: 0,
    width: 0.12,
    impactRadius: 0.82,
    impactDurationMs: 620,
  },
  shield_bash: {
    cast: "charge",
    color: 0xffc14f,
    accent: 0xffef9a,
    reach: 1.35,
    width: 0.24,
    impactRadius: 0.92,
    impactDurationMs: 500,
  },
  battle_cry: {
    cast: "wave",
    color: 0xff8f3f,
    accent: 0xffcf68,
    reach: 0,
    width: 0.16,
    impactRadius: 1.65,
    impactDurationMs: 720,
  },
  whirlwind: {
    cast: "spin",
    color: 0xffdf72,
    accent: 0xfff5c3,
    reach: 1.25,
    width: 0.14,
    impactRadius: 1.3,
    impactDurationMs: 680,
  },
  quick_shot: {
    cast: "projectile",
    color: 0x7edb84,
    accent: 0xc6f5ac,
    reach: 0.78,
    width: 0.07,
    impactRadius: 0.48,
    impactDurationMs: 360,
  },
  piercing_arrow: {
    cast: "projectile",
    color: 0x5dd9ff,
    accent: 0xc7f5ff,
    reach: 1.2,
    width: 0.1,
    impactRadius: 0.7,
    impactDurationMs: 460,
  },
  volley: {
    cast: "fan",
    color: 0xffcf58,
    accent: 0xffefad,
    reach: 1.15,
    width: 0.065,
    impactRadius: 1.1,
    impactDurationMs: 560,
  },
  dash: {
    cast: "charge",
    color: 0x6ad9ff,
    accent: 0xd0f7ff,
    reach: 1.3,
    width: 0.16,
    impactRadius: 0.68,
    impactDurationMs: 430,
  },
  heartseeker: {
    cast: "projectile",
    color: 0xff416c,
    accent: 0xffa0b5,
    reach: 1.55,
    width: 0.16,
    impactRadius: 1.05,
    impactDurationMs: 620,
  },
  radiant_bolt: {
    cast: "projectile",
    color: 0xffe995,
    accent: 0xfff8cf,
    reach: 0.92,
    width: 0.11,
    impactRadius: 0.62,
    impactDurationMs: 460,
  },
  mend: {
    cast: "heal",
    color: 0x62e68f,
    accent: 0xd1ffe0,
    reach: 0,
    width: 0.12,
    impactRadius: 0.78,
    impactDurationMs: 680,
  },
  blink: {
    cast: "blink",
    color: 0xb48cff,
    accent: 0xf0ddff,
    reach: 1.15,
    width: 0.09,
    impactRadius: 0.9,
    impactDurationMs: 560,
  },
  prayer: {
    cast: "heal",
    color: 0x8ff0ad,
    accent: 0xfff1ae,
    reach: 0,
    width: 0.14,
    impactRadius: 1.25,
    impactDurationMs: 760,
  },
  divine_nova: {
    cast: "wave",
    color: 0xc88cff,
    accent: 0xffe7a8,
    reach: 0,
    width: 0.2,
    impactRadius: 1.85,
    impactDurationMs: 900,
  },
  dual_slash: {
    cast: "slash",
    color: 0xa875ff,
    accent: 0xe3d0ff,
    reach: 0.82,
    width: 0.09,
    impactRadius: 0.55,
    impactDurationMs: 390,
  },
  shadow_step: {
    cast: "blink",
    color: 0x8050c8,
    accent: 0xc8a8ff,
    reach: 1.2,
    width: 0.08,
    impactRadius: 0.72,
    impactDurationMs: 470,
  },
  vanish: {
    cast: "stealth",
    color: 0x5f3a96,
    accent: 0xb995ff,
    reach: 0,
    width: 0.1,
    impactRadius: 1.05,
    impactDurationMs: 740,
  },
  poisoned_shiv: {
    cast: "slash",
    color: 0x62e68f,
    accent: 0xc7ff8f,
    reach: 0.72,
    width: 0.1,
    impactRadius: 0.68,
    impactDurationMs: 560,
  },
  shadow_dance: {
    cast: "spin",
    color: 0x8f55d9,
    accent: 0xd9bbff,
    reach: 1.1,
    width: 0.085,
    impactRadius: 0.8,
    impactDurationMs: 520,
  },
  woodcutters_swing: {
    cast: "harvest",
    color: 0xb7834b,
    accent: 0x9fe08a,
    reach: 0.72,
    width: 0.13,
    impactRadius: 0.5,
    impactDurationMs: 380,
  },
  prospectors_pick: {
    cast: "harvest",
    color: 0x9ab5c8,
    accent: 0xe1f2ff,
    reach: 0.68,
    width: 0.12,
    impactRadius: 0.5,
    impactDurationMs: 420,
  },
  butchers_cut: {
    cast: "slash",
    color: 0xd96b57,
    accent: 0xffc39c,
    reach: 0.68,
    width: 0.11,
    impactRadius: 0.52,
    impactDurationMs: 400,
  },
  makeshift_camp: {
    cast: "construct",
    color: 0xc6a66a,
    accent: 0xffdda0,
    reach: 0,
    width: 0.14,
    impactRadius: 1.15,
    impactDurationMs: 820,
  },
  homemade_bomb: {
    cast: "bomb",
    color: 0xff8d4a,
    accent: 0xffd36b,
    reach: 0.78,
    width: 0.12,
    impactRadius: 1.25,
    impactDurationMs: 720,
  },
} as const satisfies Readonly<Record<string, SkillVisualDefinition>>;

export function skillVisual(skillId: string): SkillVisualDefinition | null {
  return (SKILL_VISUALS as Readonly<Record<string, SkillVisualDefinition>>)[skillId] ?? null;
}
