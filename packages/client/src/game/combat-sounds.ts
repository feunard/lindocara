import type { ConsumableId } from "@lindocara/engine/consumables.js";
import type { PlayerClass } from "@lindocara/engine/game.js";
import type { HarvestResourceKind } from "@lindocara/engine/harvest.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import type { MonsterImpactSound } from "@lindocara/renderer/combat-art.js";

const ROOT = "/assets/lindocara/audio/sfx";

export interface SampleSpec {
  src: string;
  volume: number;
  playbackRate?: number;
}

/** Per-sample gain before the user SFX slider — kept low so combat stays comfortable. */
export const COMBAT_SAMPLES = {
  "warrior.cleave": { src: `${ROOT}/warrior-cleave.wav`, volume: 0.2 },
  "warrior.iron_guard": { src: `${ROOT}/warrior-iron-guard.wav`, volume: 0.18 },
  "warrior.shield_bash": { src: `${ROOT}/warrior-shield-bash.wav`, volume: 0.21 },
  "warrior.battle_cry": { src: `${ROOT}/warrior-battle-cry.wav`, volume: 0.19 },
  "warrior.whirlwind": { src: `${ROOT}/warrior-whirlwind.wav`, volume: 0.2 },
  "warrior.impact": { src: `${ROOT}/warrior-impact.ogg`, volume: 0.19 },
  "warrior.charge_impact": { src: `${ROOT}/warrior-charge-impact.ogg`, volume: 0.22 },
  "ranger.quick_shot": { src: `${ROOT}/ranger-quick-shot.wav`, volume: 0.2 },
  "ranger.piercing_arrow": { src: `${ROOT}/ranger-piercing-arrow.wav`, volume: 0.22 },
  "ranger.volley": { src: `${ROOT}/ranger-volley.wav`, volume: 0.19 },
  "ranger.dash": { src: `${ROOT}/ranger-dash.wav`, volume: 0.17 },
  "ranger.heartseeker": { src: `${ROOT}/ranger-heartseeker.wav`, volume: 0.22 },
  "ranger.impact": { src: `${ROOT}/ranger-impact.ogg`, volume: 0.19 },
  "priest.radiant_bolt": { src: `${ROOT}/priest-radiant-bolt.wav`, volume: 0.17 },
  "priest.mend": { src: `${ROOT}/priest-mend.wav`, volume: 0.18 },
  "priest.blink": { src: `${ROOT}/priest-blink.wav`, volume: 0.16 },
  "priest.prayer": { src: `${ROOT}/priest-prayer.wav`, volume: 0.15 },
  "priest.divine_nova": { src: `${ROOT}/priest-divine-nova.wav`, volume: 0.18 },
  "priest.impact": { src: `${ROOT}/priest-impact.ogg`, volume: 0.17 },
  "priest.heal_received": {
    src: `${ROOT}/priest-heal-received.ogg`,
    volume: 0.14,
    playbackRate: 1.08,
  },
  "rogue.dual_slash": { src: `${ROOT}/rogue-dual-slash.wav`, volume: 0.2 },
  "rogue.shadow_step": { src: `${ROOT}/rogue-shadow-step.wav`, volume: 0.18 },
  "rogue.vanish": { src: `${ROOT}/rogue-vanish.wav`, volume: 0.16 },
  "rogue.poisoned_shiv": { src: `${ROOT}/rogue-poisoned-shiv.wav`, volume: 0.19 },
  "rogue.shadow_dance": { src: `${ROOT}/rogue-shadow-dance.wav`, volume: 0.2 },
  "peasant.woodcutters_swing": { src: `${ROOT}/peasant-woodcutters-swing.wav`, volume: 0.19 },
  "peasant.prospectors_pick": { src: `${ROOT}/peasant-prospectors-pick.wav`, volume: 0.24 },
  "peasant.butchers_cut": { src: `${ROOT}/peasant-butchers-cut.wav`, volume: 0.2 },
  "peasant.makeshift_camp": { src: `${ROOT}/peasant-makeshift-camp.wav`, volume: 0.19 },
  "peasant.homemade_bomb": { src: `${ROOT}/peasant-homemade-bomb.wav`, volume: 0.22 },
  "harvest.wood": { src: `${ROOT}/harvest-wood.wav`, volume: 0.2 },
  "harvest.stone": { src: `${ROOT}/harvest-stone.wav`, volume: 0.2 },
  "harvest.gold": { src: `${ROOT}/harvest-gold.wav`, volume: 0.21 },
  "harvest.meat": { src: `${ROOT}/harvest-meat.wav`, volume: 0.18 },
  "consumable.health_potion": { src: `${ROOT}/consumable-health-potion.wav`, volume: 0.18 },
  "consumable.mana_potion": { src: `${ROOT}/consumable-mana-potion.wav`, volume: 0.18 },
  "consumable.damage_elixir": { src: `${ROOT}/consumable-damage-elixir.wav`, volume: 0.2 },
  "consumable.oblivion_draught": {
    src: `${ROOT}/consumable-oblivion-draught.wav`,
    volume: 0.18,
  },
  "consumable.invisibility_potion": {
    src: `${ROOT}/consumable-invisibility-potion.wav`,
    volume: 0.18,
  },
  "consumable.resurrection_potion": {
    src: `${ROOT}/consumable-resurrection-potion.wav`,
    volume: 0.21,
  },
  "monster.attack": {
    src: `${ROOT}/warrior-cleave.ogg`,
    volume: 0.12,
    playbackRate: 0.82,
  },
  "monster.impact_weapon": { src: `${ROOT}/warrior-impact.ogg`, volume: 0.15 },
  "monster.impact_magic": { src: `${ROOT}/priest-impact.ogg`, volume: 0.16, playbackRate: 0.9 },
  "monster.impact_fire": {
    src: `${ROOT}/warrior-whirlwind.ogg`,
    volume: 0.17,
    playbackRate: 0.82,
  },
  "monster.impact_heavy": {
    src: `${ROOT}/warrior-charge-impact.ogg`,
    volume: 0.2,
    playbackRate: 0.74,
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
  dual_slash: "rogue.dual_slash",
  shadow_step: "rogue.shadow_step",
  vanish: "rogue.vanish",
  poisoned_shiv: "rogue.poisoned_shiv",
  shadow_dance: "rogue.shadow_dance",
  woodcutters_swing: "peasant.woodcutters_swing",
  prospectors_pick: "peasant.prospectors_pick",
  butchers_cut: "peasant.butchers_cut",
  makeshift_camp: "peasant.makeshift_camp",
  homemade_bomb: "peasant.homemade_bomb",
};

const HARVEST_KEY: Record<HarvestResourceKind, CombatSampleKey> = {
  wood: "harvest.wood",
  stone: "harvest.stone",
  gold: "harvest.gold",
  meat: "harvest.meat",
};

const CONSUMABLE_KEY: Record<ConsumableId, CombatSampleKey> = {
  health_potion: "consumable.health_potion",
  mana_potion: "consumable.mana_potion",
  damage_elixir: "consumable.damage_elixir",
  oblivion_draught: "consumable.oblivion_draught",
  invisibility_potion: "consumable.invisibility_potion",
  resurrection_potion: "consumable.resurrection_potion",
};

const IMPACT_KEY: Record<PlayerClass, CombatSampleKey> = {
  warrior: "warrior.impact",
  ranger: "ranger.impact",
  priest: "priest.impact",
  // The bundled pack has no Rogue audio; reuse the short melee impact without adding an asset.
  rogue: "warrior.impact",
  // Harvest tools get their resource-specific cue on cast; impacts stay short and unobtrusive.
  peasant: "warrior.impact",
};

export function castSampleForSkill(
  skillId: string,
  peasantResource?: HarvestResourceKind,
): CombatSampleKey | undefined {
  if (skillId === "woodcutters_swing" && peasantResource) return HARVEST_KEY[peasantResource];
  return SKILL_CAST_KEY[skillId];
}

export function consumeSample(item: ConsumableId): CombatSampleKey {
  return CONSUMABLE_KEY[item];
}

export function impactSampleForClass(playerClass: PlayerClass): CombatSampleKey {
  return IMPACT_KEY[playerClass];
}

export function monsterImpactSample(kind: MonsterImpactSound): CombatSampleKey {
  return `monster.impact_${kind}`;
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
