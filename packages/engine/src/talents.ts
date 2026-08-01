import type { PlayerClass } from "./game.js";
import type { HarvestProfile } from "./harvest.js";
import {
  isPeasantTalentEffect,
  PEASANT_TALENT_BALANCE,
  type PeasantBombPlan,
  type PeasantConstructionPlan,
  type PeasantHarvestPlan,
  type PeasantTalentEffect,
  resolvePeasantBombPlan,
  resolvePeasantConstructionPlan,
  resolvePeasantHarvestPlan,
} from "./peasant.js";
import { PEASANT_SUPPORT_SKILLS } from "./peasant-support.js";
import { ROGUE_BALANCE } from "./rogue.js";
import { isSkillUnlocked, type SkillDefinition, type SkillSlot, skillFor } from "./skills.js";

export type TalentEffect =
  | { kind: "power_multiplier"; value: number }
  | { kind: "range_multiplier"; value: number }
  | { kind: "distance_multiplier"; value: number }
  | { kind: "cooldown_multiplier"; value: number }
  | { kind: "guard_reduction"; value: number }
  | { kind: "perfect_parry"; windowMs: number }
  | { kind: "perfect_retaliation"; ratio: number }
  | { kind: "ally_guard"; radius: number; reduction: number }
  | {
      kind: "counter_offensive";
      maxStoredRatio: number;
      guardedChargeRatio: number;
      parryChargeRatio: number;
      allyChargeRatio: number;
      radius: number;
      knockbackDistance: number;
    }
  | {
      kind: "colossus_charge";
      throughPowerRatio: number;
      maxTargets: number;
    }
  | {
      kind: "seismic_impact";
      radius: number;
      powerRatio: number;
    }
  | { kind: "inexorable_breakthrough"; reactivationWindowMs: number }
  | {
      kind: "king_challenge";
      durationMs: number;
      reductionPerEnemy: number;
      maxReduction: number;
    }
  | {
      kind: "rallying_cry";
      durationMs: number;
      powerMultiplier: number;
    }
  | { kind: "war_banner"; durationMs: number }
  | { kind: "steel_tempest" }
  | {
      kind: "cyclone";
      ticks: number;
      intervalMs: number;
      powerRatio: number;
    }
  | {
      kind: "eye_of_the_storm";
      durationMs: number;
      pulseIntervalMs: number;
      pullDistance: number;
      slowRatio: number;
      slowDurationMs: number;
    }
  | { kind: "ricochet"; ratio: number; range: number }
  | { kind: "line_piercer"; bonusPerTarget: number; maxBonus: number }
  | { kind: "returning_arrow"; returnRangeMultiplier: number }
  | { kind: "extra_projectiles"; value: number }
  | {
      kind: "focused_volley";
      spreadMultiplier: number;
      decayPerHit: number;
      minimumPowerRatio: number;
    }
  | { kind: "triple_volley"; salvos: number; intervalMs: number }
  | { kind: "dash_invulnerability" }
  | { kind: "windstep" }
  | {
      kind: "retreat_shot";
      projectiles: number;
      spreadRadians: number;
      powerRatio: number;
      range: number;
    }
  | { kind: "afterimage"; durationMs: number; aggroRadius: number }
  | { kind: "execute"; threshold: number; multiplier: number }
  | {
      kind: "comet_arrow";
      directPowerRatio: number;
      radius: number;
      splashPowerRatio: number;
    }
  | { kind: "sworn_prey"; maximumHoldMs: number; turnRateRadians: number }
  | { kind: "chain_heal"; ratio: number; range: number }
  | { kind: "emergency_mend"; threshold: number; powerMultiplier: number }
  | {
      kind: "life_link";
      durationMs: number;
      range: number;
      ratio: number;
      chainRatio: number;
      emergencyRatio: number;
      maximumMirroredPower: number;
    }
  | { kind: "blink_heal"; value: number }
  | { kind: "luminous_transfiguration"; radius: number; power: number; powerPerLevel: number }
  | { kind: "sacred_passage"; width: number; power: number; powerPerLevel: number }
  | {
      kind: "lumen_gate";
      durationMs: number;
      transfigurationDurationMs: number;
      triggerRadius: number;
    }
  | { kind: "sanctuary"; ticks: number; intervalMs: number; tickPowerRatio: number }
  | { kind: "absolution"; cleanse: "poison" }
  | { kind: "soul_anchor"; durationMs: number }
  | {
      kind: "nova_judgment";
      damageMultiplier: number;
      healMultiplier: number;
      executeThreshold: number;
      executeMultiplier: number;
    }
  | {
      kind: "nova_mercy";
      damageMultiplier: number;
      healMultiplier: number;
      reviveNearest: boolean;
    }
  | { kind: "polarity_orb"; outwardMs: number; returnMs: number }
  | {
      kind: "rogue_executor";
      openingBonusRatio: number;
      killWindowMs: number;
      cooldownReductionRatio: number;
    }
  | { kind: "rogue_shadow_return"; windowMs: number }
  | { kind: "rogue_shadow_phase" }
  | {
      kind: "rogue_predator";
      openingBonusRatio: number;
      shivWindowMs: number;
      poisonPowerMultiplier: number;
    }
  | { kind: "rogue_smoke_screen"; protectionMs: number }
  | { kind: "rogue_silhouette"; durationMs: number; health: number }
  | { kind: "rogue_concentrated_venom"; maxStacks: number }
  | { kind: "rogue_rupture"; remainingDamageRatio: number; detonationMultiplier: number }
  | { kind: "rogue_contagion"; maximumTargets: number; range: number }
  | { kind: "rogue_dark_harvest"; cooldownReductionPerKillMs: number }
  | { kind: "rogue_thousand_cuts"; repeatPowerRatio: number }
  | { kind: "rogue_dance_master"; markDurationMs: number }
  | PeasantTalentEffect;

export type TalentLabel =
  | "root"
  | "power"
  | "range"
  | "distance"
  | "cooldown"
  | "guard_reduction"
  | "perfect_parry"
  | "perfect_retaliation"
  | "ally_guard"
  | "seismic_impact"
  | "king_challenge"
  | "rallying_cry"
  | "cyclone"
  | "ricochet"
  | "line_piercer"
  | "extra_projectiles"
  | "focused_volley"
  | "dash_invulnerability"
  | "retreat_shot"
  | "execute"
  | "comet_arrow"
  | "chain_heal"
  | "emergency_mend"
  | "blink_heal"
  | "sacred_passage"
  | "sanctuary"
  | "absolution"
  | "nova_judgment"
  | "nova_mercy"
  | "evolution"
  | "ultimate"
  | "mastery";

export interface TalentNode {
  id: string;
  class: PlayerClass;
  slot: SkillSlot;
  tier: 0 | 1 | 2 | 3 | 4;
  column: -1 | 0 | 1;
  label: TalentLabel;
  root: boolean;
  requires: readonly string[];
  requiresAll: boolean;
  /** Additional OR-set required after the ordinary prerequisite rule succeeds. */
  requiresOneOf?: readonly string[];
  effects: readonly TalentEffect[];
  /** Final evolutions sharing this stable key are mutually exclusive. */
  exclusiveGroup?: string;
  /** Stable presentation/gameplay discriminator inside an exclusive group. */
  variantId?: string;
}

interface UpgradeSeed {
  key: string;
  label: TalentLabel;
  effects: readonly TalentEffect[];
}

interface BranchOptions {
  /** Optional fifth-row point; every branch can add one without changing the generic model. */
  ultimate?: UpgradeSeed;
}

function branch(
  playerClass: PlayerClass,
  slot: SkillSlot,
  upgrades: readonly [UpgradeSeed, UpgradeSeed, UpgradeSeed, UpgradeSeed, UpgradeSeed?],
  options: BranchOptions = {},
): TalentNode[] {
  const skillId = skillFor(playerClass, slot).id;
  const rootId = `${playerClass}.${skillId}.root`;
  const firstId = `${playerClass}.${skillId}.${upgrades[0].key}`;
  const secondId = `${playerClass}.${skillId}.${upgrades[1].key}`;
  const thirdId = `${playerClass}.${skillId}.${upgrades[2].key}`;
  const evolutionGroup = `${playerClass}.${skillId}.evolution`;
  const evolutionA = upgrades[3];
  const evolutionB = upgrades[4];
  const evolutionAId = `${playerClass}.${skillId}.${evolutionA.key}`;
  const evolutionBId = evolutionB ? `${playerClass}.${skillId}.${evolutionB.key}` : evolutionAId;
  const evolutionRequirements = [firstId, secondId, thirdId];
  return [
    {
      id: rootId,
      class: playerClass,
      slot,
      tier: 0,
      column: 0,
      label: "root",
      root: true,
      requires: [],
      requiresAll: true,
      effects: [],
    },
    {
      id: firstId,
      class: playerClass,
      slot,
      tier: 1,
      column: -1,
      label: upgrades[0].label,
      root: false,
      requires: [rootId],
      requiresAll: true,
      effects: upgrades[0].effects,
    },
    {
      id: secondId,
      class: playerClass,
      slot,
      tier: 1,
      column: 1,
      label: upgrades[1].label,
      root: false,
      requires: [rootId],
      requiresAll: true,
      effects: upgrades[1].effects,
    },
    {
      id: thirdId,
      class: playerClass,
      slot,
      tier: 2,
      column: 0,
      label: upgrades[2].label,
      root: false,
      requires: [firstId, secondId],
      requiresAll: false,
      effects: upgrades[2].effects,
    },
    {
      id: evolutionAId,
      class: playerClass,
      slot,
      tier: 3,
      column: evolutionB ? -1 : 0,
      label: "evolution",
      root: false,
      requires: evolutionRequirements,
      requiresAll: true,
      effects: evolutionA.effects,
      exclusiveGroup: evolutionGroup,
      variantId: "a",
    },
    ...(evolutionB
      ? [
          {
            id: evolutionBId,
            class: playerClass,
            slot,
            tier: 3 as const,
            column: 1 as const,
            label: "evolution" as const,
            root: false,
            requires: evolutionRequirements,
            requiresAll: true,
            effects: evolutionB.effects,
            exclusiveGroup: evolutionGroup,
            variantId: "b",
          },
        ]
      : []),
    ...(options.ultimate
      ? [
          {
            id: `${playerClass}.${skillId}.${options.ultimate.key}`,
            class: playerClass,
            slot,
            tier: 4 as const,
            column: 0 as const,
            label: "ultimate" as const,
            root: false,
            requires: evolutionRequirements,
            requiresAll: true,
            requiresOneOf: [evolutionAId, evolutionBId],
            effects: options.ultimate.effects,
          },
        ]
      : []),
  ];
}

const power = (value = 0.12): TalentEffect => ({ kind: "power_multiplier", value });
const range = (value = 0.15): TalentEffect => ({ kind: "range_multiplier", value });
const distance = (value = 0.15): TalentEffect => ({ kind: "distance_multiplier", value });
const cooldown = (value = 0.12): TalentEffect => ({ kind: "cooldown_multiplier", value });

export const CLASS_TALENTS: Readonly<Record<PlayerClass, readonly TalentNode[]>> = {
  warrior: [
    ...branch(
      "warrior",
      2,
      [
        {
          key: "fortified",
          label: "guard_reduction",
          effects: [{ kind: "guard_reduction", value: 0.1 }],
        },
        {
          key: "perfect",
          label: "perfect_parry",
          effects: [{ kind: "perfect_parry", windowMs: 220 }],
        },
        { key: "readiness", label: "cooldown", effects: [cooldown(0.15)] },
        {
          key: "riposte",
          label: "perfect_retaliation",
          effects: [{ kind: "perfect_retaliation", ratio: 1 }],
        },
        {
          key: "rempart",
          label: "ally_guard",
          effects: [{ kind: "ally_guard", radius: 120, reduction: 0.25 }],
        },
      ],
      {
        ultimate: {
          key: "counter_offensive",
          label: "ultimate",
          effects: [
            {
              kind: "counter_offensive",
              maxStoredRatio: 0.75,
              guardedChargeRatio: 0.7,
              parryChargeRatio: 1.25,
              allyChargeRatio: 0.6,
              radius: 135,
              knockbackDistance: 72,
            },
          ],
        },
      },
    ),
    ...branch(
      "warrior",
      3,
      [
        { key: "impact", label: "power", effects: [power()] },
        { key: "onslaught", label: "range", effects: [range(), distance()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "mastery",
          label: "mastery",
          effects: [
            power(0.3),
            distance(0.2),
            { kind: "colossus_charge", throughPowerRatio: 0.7, maxTargets: 6 },
          ],
        },
        {
          key: "seismic_impact",
          label: "seismic_impact",
          effects: [
            range(-0.3),
            distance(-0.3),
            { kind: "seismic_impact", radius: 90, powerRatio: 0.55 },
          ],
        },
      ],
      {
        ultimate: {
          key: "inexorable_breakthrough",
          label: "ultimate",
          effects: [{ kind: "inexorable_breakthrough", reactivationWindowMs: 2_000 }],
        },
      },
    ),
    ...branch(
      "warrior",
      4,
      [
        { key: "reach", label: "range", effects: [range(0.2)] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        { key: "command", label: "mastery", effects: [range(0.15)] },
        {
          key: "mastery",
          label: "mastery",
          effects: [
            range(0.35),
            cooldown(0.15),
            {
              kind: "king_challenge",
              durationMs: 3_000,
              reductionPerEnemy: 0.04,
              maxReduction: 0.2,
            },
          ],
        },
        {
          key: "rallying_cry",
          label: "rallying_cry",
          effects: [
            {
              kind: "rallying_cry",
              durationMs: 4_500,
              powerMultiplier: 0.15,
            },
          ],
        },
      ],
      {
        ultimate: {
          key: "war_banner",
          label: "ultimate",
          effects: [{ kind: "war_banner", durationMs: 6_000 }],
        },
      },
    ),
    ...branch(
      "warrior",
      5,
      [
        { key: "force", label: "power", effects: [power()] },
        { key: "reach", label: "range", effects: [range()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "mastery",
          label: "mastery",
          effects: [power(0.35), range(0.1), { kind: "steel_tempest" }],
        },
        {
          key: "cyclone",
          label: "cyclone",
          effects: [{ kind: "cyclone", ticks: 4, intervalMs: 250, powerRatio: 0.32 }],
        },
      ],
      {
        ultimate: {
          key: "eye_of_the_storm",
          label: "ultimate",
          effects: [
            {
              kind: "eye_of_the_storm",
              durationMs: 3_000,
              pulseIntervalMs: 250,
              pullDistance: 18,
              slowRatio: 0.6,
              slowDurationMs: 6_000,
            },
          ],
        },
      },
    ),
  ],
  ranger: [
    ...branch(
      "ranger",
      2,
      [
        { key: "force", label: "power", effects: [power()] },
        { key: "reach", label: "range", effects: [range()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "ricochet",
          label: "ricochet",
          effects: [{ kind: "ricochet", ratio: 0.6, range: 160 }],
        },
        {
          key: "line_piercer",
          label: "line_piercer",
          effects: [{ kind: "line_piercer", bonusPerTarget: 0.15, maxBonus: 0.6 }],
        },
      ],
      {
        ultimate: {
          key: "returning_arrow",
          label: "ultimate",
          effects: [{ kind: "returning_arrow", returnRangeMultiplier: 1 }],
        },
      },
    ),
    ...branch(
      "ranger",
      3,
      [
        { key: "force", label: "power", effects: [power()] },
        { key: "reach", label: "range", effects: [range()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "mastery",
          label: "extra_projectiles",
          effects: [{ kind: "extra_projectiles", value: 4 }],
        },
        {
          key: "focused",
          label: "focused_volley",
          effects: [
            {
              kind: "focused_volley",
              spreadMultiplier: 0.28,
              decayPerHit: 0.22,
              minimumPowerRatio: 0.35,
            },
          ],
        },
      ],
      {
        ultimate: {
          key: "triple_volley",
          label: "ultimate",
          effects: [{ kind: "triple_volley", salvos: 3, intervalMs: 1_500 }],
        },
      },
    ),
    ...branch(
      "ranger",
      4,
      [
        { key: "distance", label: "distance", effects: [distance()] },
        {
          key: "evasion",
          label: "dash_invulnerability",
          effects: [{ kind: "dash_invulnerability" }],
        },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "mastery",
          label: "mastery",
          effects: [distance(0.3), cooldown(0.12), { kind: "windstep" }],
        },
        {
          key: "retreat_shot",
          label: "retreat_shot",
          effects: [
            {
              kind: "retreat_shot",
              projectiles: 3,
              spreadRadians: (22 * Math.PI) / 180,
              powerRatio: 0.45,
              range: 280,
            },
          ],
        },
      ],
      {
        ultimate: {
          key: "afterimage",
          label: "ultimate",
          effects: [{ kind: "afterimage", durationMs: 2_000, aggroRadius: 240 }],
        },
      },
    ),
    ...branch(
      "ranger",
      5,
      [
        { key: "force", label: "power", effects: [power()] },
        { key: "reach", label: "range", effects: [range()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "execute",
          label: "execute",
          effects: [{ kind: "execute", threshold: 0.35, multiplier: 0.35 }],
        },
        {
          key: "comet_arrow",
          label: "comet_arrow",
          effects: [
            {
              kind: "comet_arrow",
              directPowerRatio: 0.85,
              radius: 105,
              splashPowerRatio: 0.65,
            },
          ],
        },
      ],
      {
        ultimate: {
          key: "sworn_prey",
          label: "ultimate",
          effects: [{ kind: "sworn_prey", maximumHoldMs: 1_500, turnRateRadians: Math.PI / 24 }],
        },
      },
    ),
  ],
  priest: [
    ...branch(
      "priest",
      2,
      [
        { key: "grace", label: "power", effects: [power()] },
        { key: "reach", label: "range", effects: [range()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "chain",
          label: "chain_heal",
          effects: [{ kind: "chain_heal", ratio: 0.5, range: 140 }],
        },
        {
          key: "emergency",
          label: "emergency_mend",
          effects: [{ kind: "emergency_mend", threshold: 0.3, powerMultiplier: 0.75 }],
        },
      ],
      {
        ultimate: {
          key: "life_link",
          label: "ultimate",
          effects: [
            {
              kind: "life_link",
              durationMs: 5_000,
              range: 320,
              ratio: 0.3,
              chainRatio: 0.2,
              emergencyRatio: 0.45,
              maximumMirroredPower: 45,
            },
          ],
        },
      },
    ),
    ...branch(
      "priest",
      3,
      [
        { key: "distance", label: "distance", effects: [distance()] },
        { key: "renewal", label: "blink_heal", effects: [{ kind: "blink_heal", value: 20 }] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "mastery",
          label: "mastery",
          effects: [
            distance(0.3),
            cooldown(0.12),
            { kind: "luminous_transfiguration", radius: 95, power: 16, powerPerLevel: 1 },
          ],
        },
        {
          key: "sacred_passage",
          label: "sacred_passage",
          effects: [{ kind: "sacred_passage", width: 22, power: 18, powerPerLevel: 1 }],
        },
      ],
      {
        ultimate: {
          key: "lumen_gate",
          label: "ultimate",
          effects: [
            {
              kind: "lumen_gate",
              durationMs: 4_000,
              transfigurationDurationMs: 6_000,
              triggerRadius: 28,
            },
          ],
        },
      },
    ),
    ...branch(
      "priest",
      4,
      [
        { key: "grace", label: "power", effects: [power()] },
        { key: "reach", label: "range", effects: [range()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "mastery",
          label: "mastery",
          effects: [
            power(0.3),
            range(0.15),
            { kind: "sanctuary", ticks: 3, intervalMs: 1_000, tickPowerRatio: 0.35 },
          ],
        },
        {
          key: "absolution",
          label: "absolution",
          effects: [power(0.8), { kind: "absolution", cleanse: "poison" }],
        },
      ],
      {
        ultimate: {
          key: "soul_anchor",
          label: "ultimate",
          effects: [{ kind: "soul_anchor", durationMs: 4_000 }],
        },
      },
    ),
    ...branch(
      "priest",
      5,
      [
        { key: "radiance", label: "power", effects: [power()] },
        { key: "reach", label: "range", effects: [range()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "mastery",
          label: "nova_judgment",
          effects: [
            power(0.35),
            range(0.1),
            {
              kind: "nova_judgment",
              damageMultiplier: 1.4,
              healMultiplier: 0.6,
              executeThreshold: 0.3,
              executeMultiplier: 0.35,
            },
          ],
        },
        {
          key: "mercy",
          label: "nova_mercy",
          effects: [
            power(0.35),
            range(0.1),
            {
              kind: "nova_mercy",
              damageMultiplier: 0.6,
              healMultiplier: 1.4,
              reviveNearest: true,
            },
          ],
        },
      ],
      {
        ultimate: {
          key: "polarity_orb",
          label: "ultimate",
          effects: [{ kind: "polarity_orb", outwardMs: 900, returnMs: 900 }],
        },
      },
    ),
  ],
  rogue: [
    ...branch(
      "rogue",
      2,
      [
        { key: "ambush", label: "power", effects: [power()] },
        { key: "reach", label: "range", effects: [range()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "executor",
          label: "mastery",
          effects: [
            {
              kind: "rogue_executor",
              openingBonusRatio: ROGUE_BALANCE.opening.executorBonusRatio,
              killWindowMs: ROGUE_BALANCE.opening.executorKillWindowMs,
              cooldownReductionRatio: ROGUE_BALANCE.opening.executorCooldownReductionRatio,
            },
          ],
        },
        {
          key: "shadow_return",
          label: "mastery",
          effects: [
            {
              kind: "rogue_shadow_return",
              windowMs: ROGUE_BALANCE.shadowStep.returnWindowMs,
            },
          ],
        },
      ],
      {
        ultimate: {
          key: "veil_crossing",
          label: "ultimate",
          effects: [{ kind: "rogue_shadow_phase" }],
        },
      },
    ),
    ...branch(
      "rogue",
      3,
      [
        { key: "ambush", label: "power", effects: [power()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "mastery",
          label: "mastery",
          effects: [power(0.08), cooldown(0.08)],
        },
        {
          key: "predator",
          label: "mastery",
          effects: [
            {
              kind: "rogue_predator",
              openingBonusRatio: ROGUE_BALANCE.opening.predatorBonusRatio,
              shivWindowMs: ROGUE_BALANCE.vanish.predatorShivWindowMs,
              poisonPowerMultiplier: ROGUE_BALANCE.vanish.predatorPoisonPowerMultiplier,
            },
          ],
        },
        {
          key: "smoke_screen",
          label: "mastery",
          effects: [
            {
              kind: "rogue_smoke_screen",
              protectionMs: ROGUE_BALANCE.vanish.smokeProtectionMs,
            },
            cooldown(ROGUE_BALANCE.vanish.smokeCooldownReductionRatio),
          ],
        },
      ],
      {
        ultimate: {
          key: "left_silhouette",
          label: "ultimate",
          effects: [
            {
              kind: "rogue_silhouette",
              durationMs: ROGUE_BALANCE.vanish.silhouetteDurationMs,
              health: ROGUE_BALANCE.vanish.silhouetteHealth,
            },
          ],
        },
      },
    ),
    ...branch(
      "rogue",
      4,
      [
        { key: "force", label: "power", effects: [power()] },
        { key: "reach", label: "range", effects: [range()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "concentrated_venom",
          label: "mastery",
          effects: [
            {
              kind: "rogue_concentrated_venom",
              maxStacks: ROGUE_BALANCE.poisonedShiv.concentratedVenomMaxStacks,
            },
          ],
        },
        {
          key: "rupture",
          label: "mastery",
          effects: [
            {
              kind: "rogue_rupture",
              remainingDamageRatio: ROGUE_BALANCE.poisonedShiv.ruptureRemainingDamageRatio,
              detonationMultiplier: ROGUE_BALANCE.poisonedShiv.ruptureDetonationMultiplier,
            },
          ],
        },
      ],
      {
        ultimate: {
          key: "black_contagion",
          label: "ultimate",
          effects: [
            {
              kind: "rogue_contagion",
              maximumTargets: ROGUE_BALANCE.poisonedShiv.contagionTargets,
              range: ROGUE_BALANCE.poisonedShiv.contagionRange,
            },
          ],
        },
      },
    ),
    ...branch(
      "rogue",
      5,
      [
        { key: "force", label: "power", effects: [power()] },
        { key: "reach", label: "range", effects: [range()] },
        { key: "readiness", label: "cooldown", effects: [cooldown()] },
        {
          key: "dark_harvest",
          label: "mastery",
          effects: [
            {
              kind: "rogue_dark_harvest",
              cooldownReductionPerKillMs: ROGUE_BALANCE.shadowDance.darkHarvestCooldownReductionMs,
            },
          ],
        },
        {
          key: "thousand_cuts",
          label: "mastery",
          effects: [
            {
              kind: "rogue_thousand_cuts",
              repeatPowerRatio: ROGUE_BALANCE.shadowDance.thousandCutsPowerRatio,
            },
          ],
        },
      ],
      {
        ultimate: {
          key: "dance_master",
          label: "ultimate",
          effects: [
            {
              kind: "rogue_dance_master",
              markDurationMs: ROGUE_BALANCE.shadowDance.danceMasterMarkDurationMs,
            },
          ],
        },
      },
    ),
  ],
  peasant: [
    ...branch(
      "peasant",
      1,
      [
        {
          key: "bounty",
          label: "mastery",
          effects: [
            {
              kind: "peasant_harvest_yield",
              tool: "axe",
              bonusRatio: PEASANT_TALENT_BALANCE.woodcuttersSwing.earlyYieldBonusRatio,
            },
          ],
        },
        {
          key: "readiness",
          label: "cooldown",
          effects: [cooldown(PEASANT_TALENT_BALANCE.woodcuttersSwing.cooldownReductionRatio)],
        },
        {
          key: "reach",
          label: "range",
          effects: [range(PEASANT_TALENT_BALANCE.woodcuttersSwing.reachBonusRatio)],
        },
        {
          key: "clean_cut",
          label: "mastery",
          effects: [
            {
              kind: "peasant_harvest_yield",
              tool: "axe",
              bonusRatio: PEASANT_TALENT_BALANCE.woodcuttersSwing.cleanCut.yieldBonusRatio,
            },
            {
              kind: "peasant_harvest_efficiency",
              tool: "axe",
              hitsReduction: PEASANT_TALENT_BALANCE.woodcuttersSwing.cleanCut.hitsReduction,
              durationReductionRatio:
                PEASANT_TALENT_BALANCE.woodcuttersSwing.cleanCut.durationReductionRatio,
            },
          ],
        },
        {
          key: "sweeping_fell",
          label: "mastery",
          effects: [
            {
              kind: "peasant_harvest_area",
              tool: "axe",
              radius: PEASANT_TALENT_BALANCE.woodcuttersSwing.sweepingFell.radius,
              maximumTargets: PEASANT_TALENT_BALANCE.woodcuttersSwing.sweepingFell.maximumTargets,
            },
          ],
        },
      ],
      {
        ultimate: {
          key: "great_felling",
          label: "ultimate",
          effects: [
            {
              kind: "peasant_harvest_yield",
              tool: "axe",
              bonusRatio: PEASANT_TALENT_BALANCE.woodcuttersSwing.greatFelling.yieldBonusRatio,
            },
            {
              kind: "peasant_harvest_area",
              tool: "axe",
              radius: PEASANT_TALENT_BALANCE.woodcuttersSwing.greatFelling.radius,
              maximumTargets: PEASANT_TALENT_BALANCE.woodcuttersSwing.greatFelling.maximumTargets,
            },
          ],
        },
      },
    ),
    ...branch(
      "peasant",
      2,
      [
        {
          key: "ore_share",
          label: "mastery",
          effects: [
            {
              kind: "peasant_harvest_yield",
              tool: "pickaxe",
              bonusRatio: PEASANT_TALENT_BALANCE.prospectorsPick.earlyYieldBonusRatio,
            },
          ],
        },
        {
          key: "readiness",
          label: "cooldown",
          effects: [cooldown(PEASANT_TALENT_BALANCE.prospectorsPick.cooldownReductionRatio)],
        },
        {
          key: "force",
          label: "power",
          effects: [power(PEASANT_TALENT_BALANCE.prospectorsPick.powerBonusRatio)],
        },
        {
          key: "rich_vein",
          label: "mastery",
          effects: [
            {
              kind: "peasant_harvest_yield",
              tool: "pickaxe",
              bonusRatio: PEASANT_TALENT_BALANCE.prospectorsPick.richVein.yieldBonusRatio,
            },
            {
              kind: "peasant_rich_vein",
              ironFromStone: PEASANT_TALENT_BALANCE.prospectorsPick.richVein.ironFromStone,
              goldValueBonusRatio:
                PEASANT_TALENT_BALANCE.prospectorsPick.richVein.goldValueBonusRatio,
            },
          ],
        },
        {
          key: "fragmentation",
          label: "mastery",
          effects: [
            {
              kind: "peasant_harvest_efficiency",
              tool: "pickaxe",
              hitsReduction: PEASANT_TALENT_BALANCE.prospectorsPick.fragmentation.hitsReduction,
              durationReductionRatio:
                PEASANT_TALENT_BALANCE.prospectorsPick.fragmentation.durationReductionRatio,
            },
            {
              kind: "peasant_harvest_area",
              tool: "pickaxe",
              radius: PEASANT_TALENT_BALANCE.prospectorsPick.fragmentation.radius,
              maximumTargets: PEASANT_TALENT_BALANCE.prospectorsPick.fragmentation.maximumTargets,
            },
          ],
        },
      ],
      {
        ultimate: {
          key: "mother_lode",
          label: "ultimate",
          effects: [
            {
              kind: "peasant_harvest_yield",
              tool: "pickaxe",
              bonusRatio: PEASANT_TALENT_BALANCE.prospectorsPick.motherLode.yieldBonusRatio,
            },
            {
              kind: "peasant_rich_vein",
              ironFromStone: PEASANT_TALENT_BALANCE.prospectorsPick.motherLode.ironFromStone,
              goldValueBonusRatio:
                PEASANT_TALENT_BALANCE.prospectorsPick.motherLode.goldValueBonusRatio,
            },
            {
              kind: "peasant_harvest_area",
              tool: "pickaxe",
              radius: PEASANT_TALENT_BALANCE.prospectorsPick.motherLode.radius,
              maximumTargets: PEASANT_TALENT_BALANCE.prospectorsPick.motherLode.maximumTargets,
            },
          ],
        },
      },
    ),
    ...branch(
      "peasant",
      3,
      [
        {
          key: "meat_share",
          label: "mastery",
          effects: [
            {
              kind: "peasant_harvest_yield",
              tool: "knife",
              bonusRatio: PEASANT_TALENT_BALANCE.butchersCut.earlyYieldBonusRatio,
            },
          ],
        },
        {
          key: "readiness",
          label: "cooldown",
          effects: [cooldown(PEASANT_TALENT_BALANCE.butchersCut.cooldownReductionRatio)],
        },
        {
          key: "force",
          label: "power",
          effects: [power(PEASANT_TALENT_BALANCE.butchersCut.powerBonusRatio)],
        },
        {
          key: "preservation",
          label: "mastery",
          effects: [{ kind: "peasant_ration", ...PEASANT_TALENT_BALANCE.butchersCut.preservation }],
        },
        {
          key: "field_feast",
          label: "mastery",
          effects: [{ kind: "peasant_ration", ...PEASANT_TALENT_BALANCE.butchersCut.fieldFeast }],
        },
      ],
      {
        ultimate: {
          key: "grand_feast",
          label: "ultimate",
          effects: [{ kind: "peasant_ration", ...PEASANT_TALENT_BALANCE.butchersCut.grandFeast }],
        },
      },
    ),
    ...branch(
      "peasant",
      4,
      [
        {
          key: "reach",
          label: "range",
          effects: [range(PEASANT_TALENT_BALANCE.makeshiftCamp.reachBonusRatio)],
        },
        {
          key: "readiness",
          label: "cooldown",
          effects: [cooldown(PEASANT_TALENT_BALANCE.makeshiftCamp.cooldownReductionRatio)],
        },
        {
          key: "reinforcement",
          label: "mastery",
          effects: [
            {
              kind: "peasant_construction",
              ...PEASANT_TALENT_BALANCE.makeshiftCamp.reinforcement,
            },
          ],
        },
        {
          key: "stockade",
          label: "mastery",
          effects: [
            {
              kind: "peasant_construction",
              ...PEASANT_TALENT_BALANCE.makeshiftCamp.stockade,
            },
          ],
        },
        {
          key: "campfire",
          label: "mastery",
          effects: [
            {
              kind: "peasant_construction",
              ...PEASANT_TALENT_BALANCE.makeshiftCamp.campfire,
            },
          ],
        },
      ],
      {
        ultimate: {
          key: "complete_encampment",
          label: "ultimate",
          effects: [
            {
              kind: "peasant_construction",
              ...PEASANT_TALENT_BALANCE.makeshiftCamp.completeEncampment,
            },
          ],
        },
      },
    ),
    ...branch(
      "peasant",
      5,
      [
        {
          key: "force",
          label: "power",
          effects: [power(PEASANT_TALENT_BALANCE.homemadeBomb.powerBonusRatio)],
        },
        {
          key: "reach",
          label: "range",
          effects: [range(PEASANT_TALENT_BALANCE.homemadeBomb.reachBonusRatio)],
        },
        {
          key: "readiness",
          label: "cooldown",
          effects: [cooldown(PEASANT_TALENT_BALANCE.homemadeBomb.cooldownReductionRatio)],
        },
        {
          key: "shrapnel",
          label: "mastery",
          effects: [{ kind: "peasant_bomb", ...PEASANT_TALENT_BALANCE.homemadeBomb.shrapnel }],
        },
        {
          key: "concussion",
          label: "mastery",
          effects: [{ kind: "peasant_bomb", ...PEASANT_TALENT_BALANCE.homemadeBomb.concussion }],
        },
      ],
      {
        ultimate: {
          key: "powder_keg",
          label: "ultimate",
          effects: [{ kind: "peasant_bomb", ...PEASANT_TALENT_BALANCE.homemadeBomb.powderKeg }],
        },
      },
    ),
  ],
};

/** The skill slots that actually own a talent branch for this class, in display order. */
export function talentBranchSlots(playerClass: PlayerClass): readonly SkillSlot[] {
  return [...new Set(CLASS_TALENTS[playerClass].map((node) => node.slot))].sort(
    (left, right) => left - right,
  );
}

export interface TalentState {
  selected: string[];
  pointsSpent: number;
  pointsAvailable: number;
}

export type TalentUnlockResult =
  | { ok: true; selected: string[] }
  | {
      ok: false;
      reason:
        | "unknown"
        | "root"
        | "locked_skill"
        | "selected"
        | "exclusive"
        | "prerequisite"
        | "points";
    };

export function talentNode(playerClass: PlayerClass, id: string): TalentNode | undefined {
  return CLASS_TALENTS[playerClass].find((node) => node.id === id);
}

export function activeEvolutionVariant(
  playerClass: PlayerClass,
  selected: readonly string[],
  slot: SkillSlot,
): TalentNode | undefined {
  const selectedIds = new Set(selected);
  return CLASS_TALENTS[playerClass].find(
    (node) => node.slot === slot && node.tier === 3 && selectedIds.has(node.id),
  );
}

/** Compatibility name for callers that only need to know whether a final evolution is active. */
export const evolvedTalent = activeEvolutionVariant;

export function isTalentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Object.values(CLASS_TALENTS).some((nodes) => nodes.some((node) => node.id === value))
  );
}

export function conflictingExclusiveTalent(
  playerClass: PlayerClass,
  selected: ReadonlySet<string> | readonly string[],
  candidate: Pick<TalentNode, "id" | "exclusiveGroup">,
): TalentNode | undefined {
  if (!candidate.exclusiveGroup) return undefined;
  const selectedIds = selected instanceof Set ? selected : new Set(selected);
  return CLASS_TALENTS[playerClass].find(
    (node) =>
      node.id !== candidate.id &&
      node.exclusiveGroup === candidate.exclusiveGroup &&
      selectedIds.has(node.id),
  );
}

function prerequisitesMet(node: TalentNode, selected: ReadonlySet<string>, level: number): boolean {
  const active = (id: string) => {
    const prerequisite = talentNode(node.class, id);
    return Boolean(
      prerequisite &&
        (prerequisite.root
          ? isSkillUnlocked(level, prerequisite.slot)
          : selected.has(prerequisite.id)),
    );
  };
  const ordinaryRequirementsMet = node.requiresAll
    ? node.requires.every(active)
    : node.requires.some(active);
  return (
    ordinaryRequirementsMet && (node.requiresOneOf === undefined || node.requiresOneOf.some(active))
  );
}

export function normalizeTalentSelection(
  playerClass: PlayerClass,
  level: number,
  input: unknown,
): string[] {
  if (!Array.isArray(input)) return [];
  const requested = new Set(input.filter((id): id is string => typeof id === "string"));
  const selected = new Set<string>();
  for (const node of CLASS_TALENTS[playerClass]) {
    if (
      node.root ||
      !requested.has(node.id) ||
      selected.size >= Math.max(0, level) ||
      !isSkillUnlocked(level, node.slot) ||
      !prerequisitesMet(node, selected, level) ||
      conflictingExclusiveTalent(playerClass, selected, node) !== undefined
    )
      continue;
    selected.add(node.id);
  }
  return [...selected];
}

export function talentState(
  playerClass: PlayerClass,
  level: number,
  selected: readonly string[],
): TalentState {
  const normalized = normalizeTalentSelection(playerClass, level, selected);
  return {
    selected: normalized,
    pointsSpent: normalized.length,
    pointsAvailable: Math.max(0, level - normalized.length),
  };
}

export function unlockTalent(
  playerClass: PlayerClass,
  level: number,
  selectedInput: readonly string[],
  nodeId: string,
): TalentUnlockResult {
  const node = talentNode(playerClass, nodeId);
  if (!node) return { ok: false, reason: "unknown" };
  if (node.root) return { ok: false, reason: "root" };
  if (!isSkillUnlocked(level, node.slot)) return { ok: false, reason: "locked_skill" };
  const selected = new Set(normalizeTalentSelection(playerClass, level, selectedInput));
  if (selected.has(node.id)) return { ok: false, reason: "selected" };
  if (conflictingExclusiveTalent(playerClass, selected, node))
    return { ok: false, reason: "exclusive" };
  if (selected.size >= Math.max(0, level)) return { ok: false, reason: "points" };
  if (!prerequisitesMet(node, selected, level)) return { ok: false, reason: "prerequisite" };
  selected.add(node.id);
  return { ok: true, selected: [...selected] };
}

export function talentEffects(
  playerClass: PlayerClass,
  selected: readonly string[],
  slot?: SkillSlot,
): TalentEffect[] {
  const ids = new Set(selected);
  return CLASS_TALENTS[playerClass]
    .filter((node) => !node.root && ids.has(node.id) && (slot === undefined || node.slot === slot))
    .flatMap((node) => [...node.effects]);
}

/** Typed Peasant-only projection for the pure harvest/support plan resolvers. */
export function peasantTalentEffects(
  selected: readonly string[],
  slot?: SkillSlot,
): PeasantTalentEffect[] {
  return talentEffects("peasant", selected, slot).filter(isPeasantTalentEffect);
}

export function talentEffect<K extends TalentEffect["kind"]>(
  playerClass: PlayerClass,
  selected: readonly string[],
  kind: K,
  slot?: SkillSlot,
): Extract<TalentEffect, { kind: K }> | undefined {
  return talentEffects(playerClass, selected, slot).find(
    (effect): effect is Extract<TalentEffect, { kind: K }> => effect.kind === kind,
  );
}

export function skillWithTalents(
  playerClass: PlayerClass,
  selected: readonly string[],
  slot: SkillSlot,
): SkillDefinition {
  const skill = skillFor(playerClass, slot);
  // The four historical basic attacks intentionally have no talent branch. The Peasant's first
  // technique is both its basic tool swing and a full utility branch, so its modifiers must flow.
  if (slot === 1 && playerClass !== "peasant") return skill;
  const effects = talentEffects(playerClass, selected, slot);
  const sum = (
    kind:
      | "power_multiplier"
      | "range_multiplier"
      | "distance_multiplier"
      | "cooldown_multiplier"
      | "guard_reduction",
  ) => effects.reduce((total, effect) => total + (effect.kind === kind ? effect.value : 0), 0);
  const powerMultiplier = 1 + sum("power_multiplier");
  const rangeMultiplier = 1 + sum("range_multiplier");
  const distanceMultiplier = 1 + sum("distance_multiplier");
  const cooldownMultiplier = Math.max(0.45, 1 - sum("cooldown_multiplier"));
  return {
    ...skill,
    power: Math.round(skill.power * powerMultiplier),
    range: Math.round(skill.range * rangeMultiplier * 10) / 10,
    cooldownMs: Math.max(250, Math.round(skill.cooldownMs * cooldownMultiplier)),
    ...(skill.radius === undefined
      ? {}
      : { radius: Math.round(skill.radius * rangeMultiplier * 10) / 10 }),
    ...(skill.distance === undefined
      ? {}
      : { distance: Math.round(skill.distance * distanceMultiplier * 10) / 10 }),
    ...(skill.reduction === undefined
      ? {}
      : { reduction: Math.min(0.85, skill.reduction + sum("guard_reduction")) }),
    ...(skill.allyPower === undefined
      ? {}
      : { allyPower: Math.round(skill.allyPower * powerMultiplier) }),
  };
}

export interface PeasantHarvestTalentPlan {
  skill: SkillDefinition;
  harvest: PeasantHarvestPlan;
}

/** Complete tool plan: generic range/cooldown plus typed harvest outcomes from one selection. */
export function peasantHarvestTalentPlan(
  selected: readonly string[],
  slot: 1 | 2 | 3,
  profile: HarvestProfile,
): PeasantHarvestTalentPlan {
  return {
    skill: skillWithTalents("peasant", selected, slot),
    harvest: resolvePeasantHarvestPlan(profile, peasantTalentEffects(selected, slot)),
  };
}

export interface PeasantConstructionTalentPlan {
  skill: SkillDefinition;
  support: PeasantConstructionPlan;
}

export function peasantConstructionTalentPlan(
  selected: readonly string[],
): PeasantConstructionTalentPlan {
  const skill = skillWithTalents("peasant", selected, 4);
  const base = PEASANT_SUPPORT_SKILLS[4];
  return {
    skill,
    support: resolvePeasantConstructionPlan(peasantTalentEffects(selected, 4), {
      ...base,
      power: skill.power,
      radius: skill.radius ?? base.radius,
      durationMs: skill.durationMs ?? base.durationMs,
    }),
  };
}

export interface PeasantBombTalentPlan {
  skill: SkillDefinition;
  support: PeasantBombPlan;
}

export function peasantBombTalentPlan(selected: readonly string[]): PeasantBombTalentPlan {
  const skill = skillWithTalents("peasant", selected, 5);
  const base = PEASANT_SUPPORT_SKILLS[5];
  return {
    skill,
    support: resolvePeasantBombPlan(peasantTalentEffects(selected, 5), {
      ...base,
      power: skill.power,
      radius: skill.radius ?? base.radius,
      durationMs: skill.durationMs ?? base.durationMs,
    }),
  };
}
