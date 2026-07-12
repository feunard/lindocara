import type { PlayerClass } from "../../shared/game.js";
import { CLASS_SKILLS } from "../../shared/skills.js";

const ROOT = "/assets/lindocara/audio/sfx";

export interface SampleSpec {
  src: string;
  volume: number;
  playbackRate?: number;
}

/** Per-sample gain before the user SFX slider — kept low so combat stays comfortable. */
export const COMBAT_SAMPLES = {
  "warrior.cleave": { src: `${ROOT}/warrior-cleave.ogg`, volume: 0.2 },
  "warrior.iron_guard": { src: `${ROOT}/warrior-guard.ogg`, volume: 0.18 },
  "warrior.shield_bash": { src: `${ROOT}/warrior-charge.ogg`, volume: 0.21 },
  "warrior.battle_cry": { src: `${ROOT}/warrior-battle-cry.ogg`, volume: 0.19 },
  "warrior.whirlwind": { src: `${ROOT}/warrior-whirlwind.ogg`, volume: 0.2 },
  "warrior.impact": { src: `${ROOT}/warrior-impact.ogg`, volume: 0.19 },
  "warrior.charge_impact": { src: `${ROOT}/warrior-charge-impact.ogg`, volume: 0.22 },
  "ranger.quick_shot": { src: `${ROOT}/ranger-quick-shot.ogg`, volume: 0.2 },
  "ranger.piercing_arrow": {
    src: `${ROOT}/ranger-quick-shot.ogg`,
    volume: 0.22,
    playbackRate: 1.16,
  },
  "ranger.volley": { src: `${ROOT}/ranger-volley.ogg`, volume: 0.19 },
  "ranger.dash": { src: `${ROOT}/ranger-dash.ogg`, volume: 0.17 },
  "ranger.heartseeker": {
    src: `${ROOT}/ranger-quick-shot.ogg`,
    volume: 0.22,
    playbackRate: 0.88,
  },
  "ranger.impact": { src: `${ROOT}/ranger-impact.ogg`, volume: 0.19 },
  "priest.radiant_bolt": { src: `${ROOT}/priest-cast.ogg`, volume: 0.17 },
  "priest.mend": { src: `${ROOT}/priest-heal.ogg`, volume: 0.18 },
  "priest.blink": { src: `${ROOT}/priest-blink.ogg`, volume: 0.16 },
  "priest.prayer": { src: `${ROOT}/priest-prayer.ogg`, volume: 0.15 },
  "priest.divine_nova": { src: `${ROOT}/priest-nova.ogg`, volume: 0.18 },
  "priest.impact": { src: `${ROOT}/priest-impact.ogg`, volume: 0.17 },
  "priest.heal_received": {
    src: `${ROOT}/priest-heal-received.ogg`,
    volume: 0.14,
    playbackRate: 1.08,
  },
} as const satisfies Record<string, SampleSpec>;

export type CombatSampleKey = keyof typeof COMBAT_SAMPLES;

export const UI_SAMPLES = {
  hit: { src: `${ROOT}/ui-hit.ogg`, volume: 0.15 },
  loot: { src: `${ROOT}/ui-loot.ogg`, volume: 0.16 },
  levelUp: { src: `${ROOT}/ui-level-up.ogg`, volume: 0.17 },
  interact: { src: `${ROOT}/ui-interact.ogg`, volume: 0.14 },
  death: { src: `${ROOT}/ui-death.ogg`, volume: 0.17 },
  chat: { src: `${ROOT}/ui-chat.ogg`, volume: 0.1 },
} as const satisfies Record<string, SampleSpec>;

export type UiSampleKey = keyof typeof UI_SAMPLES;

const SKILL_CAST_KEY: Partial<Record<string, CombatSampleKey>> = {
  cleave: "warrior.cleave",
  iron_guard: "warrior.iron_guard",
  shield_bash: "warrior.shield_bash",
  battle_cry: "warrior.battle_cry",
  whirlwind: "warrior.whirlwind",
  quick_shot: "ranger.quick_shot",
  piercing_arrow: "ranger.piercing_arrow",
  volley: "ranger.volley",
  dash: "ranger.dash",
  heartseeker: "ranger.heartseeker",
  radiant_bolt: "priest.radiant_bolt",
  mend: "priest.mend",
  blink: "priest.blink",
  prayer: "priest.prayer",
  divine_nova: "priest.divine_nova",
};

const IMPACT_KEY: Record<PlayerClass, CombatSampleKey> = {
  warrior: "warrior.impact",
  ranger: "ranger.impact",
  priest: "priest.impact",
};

export function castSampleForSkill(skillId: string): CombatSampleKey | undefined {
  return SKILL_CAST_KEY[skillId];
}

export function impactSampleForClass(playerClass: PlayerClass): CombatSampleKey {
  return IMPACT_KEY[playerClass];
}

export function basicAttackSample(playerClass: PlayerClass): CombatSampleKey {
  const skill = CLASS_SKILLS[playerClass][0];
  if (!skill) return IMPACT_KEY[playerClass];
  return castSampleForSkill(skill.id) ?? IMPACT_KEY[playerClass];
}

export function uniqueSampleSources(): string[] {
  return [
    ...new Set([
      ...Object.values(COMBAT_SAMPLES).map((sample) => sample.src),
      ...Object.values(UI_SAMPLES).map((sample) => sample.src),
    ]),
  ];
}
