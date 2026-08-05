import { xpForNextLevel } from "./game.js";
import { roundGroundLength } from "./ground.js";
import {
  HARVEST_PROFILE_LIMITS,
  type HarvestProfile,
  type HarvestResourceKind,
  type HarvestTool,
} from "./harvest.js";
import { PARTY_MATERIAL_TYPES, type PartyMaterialAmounts } from "./party-harvest-state.js";
import { PEASANT_SUPPORT_SKILLS, type PeasantSupportSkillConfig } from "./peasant-support.js";
import { TILE_SIZE } from "./tilemap.js";

export type PeasantTalentEffect =
  | { kind: "peasant_harvest_yield"; tool: HarvestTool; bonusRatio: number }
  | {
      kind: "peasant_harvest_efficiency";
      tool: HarvestTool;
      hitsReduction: number;
      durationReductionRatio: number;
    }
  | {
      kind: "peasant_harvest_area";
      tool: HarvestTool;
      radius: number;
      maximumTargets: number;
    }
  | {
      kind: "peasant_rich_vein";
      ironFromStone: number;
      goldValueBonusRatio: number;
    }
  | {
      kind: "peasant_ration";
      healingBonusRatio: number;
      extraPortions: number;
      radius: number;
      buffDurationMs: number;
      powerBonusRatio: number;
    }
  | {
      kind: "peasant_construction";
      durabilityBonusRatio: number;
      durationBonusMs: number;
      radius: number;
      powerBonusRatio: number;
      protectionRatio: number;
      slowRatio: number;
      costReductionRatio: number;
    }
  | {
      kind: "peasant_bomb";
      powerBonusRatio: number;
      radiusBonusRatio: number;
      fragments: number;
      fragmentPowerRatio: number;
      slowRatio: number;
      slowDurationMs: number;
      knockbackDistance: number;
      costReductionRatio: number;
    };

export const PEASANT_TALENT_EFFECT_KINDS = [
  "peasant_harvest_yield",
  "peasant_harvest_efficiency",
  "peasant_harvest_area",
  "peasant_rich_vein",
  "peasant_ration",
  "peasant_construction",
  "peasant_bomb",
] as const satisfies readonly PeasantTalentEffect["kind"][];

/**
 * Experience earned when one authoritative harvest node is exhausted. Basis points keep the
 * resource ordering explicit while scaling each reward with the hero's current level threshold.
 */
export const PEASANT_HARVEST_EXPERIENCE_BASIS_POINTS = {
  wood: 300,
  stone: 400,
  iron: 600,
  gold: 800,
  meat: 500,
} as const satisfies Readonly<Record<HarvestResourceKind, number>>;

export function peasantHarvestExperience(resource: HarvestResourceKind, level: number): number {
  const safeLevel = Number.isSafeInteger(level) && level > 0 ? level : 1;
  return Math.max(
    1,
    Math.min(
      Number.MAX_SAFE_INTEGER,
      Math.round(
        (xpForNextLevel(safeLevel) * PEASANT_HARVEST_EXPERIENCE_BASIS_POINTS[resource]) / 10_000,
      ),
    ),
  );
}

/**
 * All Peasant tuning used by the talent data and its pure resolution helpers. Runtime systems may
 * consume the resulting plans later; this module never mutates authority or persisted state.
 */
export const PEASANT_TALENT_BALANCE = {
  woodcuttersSwing: {
    earlyYieldBonusRatio: 0.2,
    cooldownReductionRatio: 0.12,
    reachBonusRatio: 0.12,
    cleanCut: {
      yieldBonusRatio: 0.25,
      hitsReduction: 1,
      durationReductionRatio: 0.15,
    },
    sweepingFell: { radius: 84 / TILE_SIZE, maximumTargets: 3 },
    greatFelling: { yieldBonusRatio: 0.4, radius: 128 / TILE_SIZE, maximumTargets: 6 },
  },
  prospectorsPick: {
    earlyYieldBonusRatio: 0.2,
    cooldownReductionRatio: 0.12,
    powerBonusRatio: 0.15,
    richVein: { yieldBonusRatio: 0.3, ironFromStone: 1, goldValueBonusRatio: 0.2 },
    fragmentation: {
      hitsReduction: 1,
      durationReductionRatio: 0.15,
      radius: 72 / TILE_SIZE,
      maximumTargets: 3,
    },
    motherLode: {
      yieldBonusRatio: 0.4,
      ironFromStone: 2,
      goldValueBonusRatio: 0.3,
      radius: 110 / TILE_SIZE,
      maximumTargets: 5,
    },
  },
  butchersCut: {
    earlyYieldBonusRatio: 0.25,
    cooldownReductionRatio: 0.12,
    powerBonusRatio: 0.12,
    preservation: {
      healingBonusRatio: 0.4,
      extraPortions: 1,
      radius: 0 / TILE_SIZE,
      buffDurationMs: 0,
      powerBonusRatio: 0,
    },
    fieldFeast: {
      healingBonusRatio: 0,
      extraPortions: 0,
      radius: 120 / TILE_SIZE,
      buffDurationMs: 6_000,
      powerBonusRatio: 0.1,
    },
    grandFeast: {
      healingBonusRatio: 0.75,
      extraPortions: 3,
      radius: 180 / TILE_SIZE,
      buffDurationMs: 10_000,
      powerBonusRatio: 0.15,
    },
  },
  makeshiftCamp: {
    reachBonusRatio: 0.2,
    cooldownReductionRatio: 0.15,
    reinforcement: {
      durabilityBonusRatio: 0.25,
      durationBonusMs: 3_000,
      radius: 0 / TILE_SIZE,
      powerBonusRatio: 0,
      protectionRatio: 0,
      slowRatio: 0,
      costReductionRatio: 0,
    },
    stockade: {
      durabilityBonusRatio: 0.75,
      durationBonusMs: 5_000,
      radius: 96 / TILE_SIZE,
      powerBonusRatio: 0,
      protectionRatio: 0.15,
      slowRatio: 0.2,
      costReductionRatio: 0.25,
    },
    campfire: {
      durabilityBonusRatio: 0.25,
      durationBonusMs: 5_000,
      radius: 120 / TILE_SIZE,
      powerBonusRatio: 0.5,
      protectionRatio: 0.08,
      slowRatio: 0,
      costReductionRatio: 0,
    },
    completeEncampment: {
      durabilityBonusRatio: 1,
      durationBonusMs: 10_000,
      radius: 144 / TILE_SIZE,
      powerBonusRatio: 0.5,
      protectionRatio: 0.1,
      slowRatio: 0.2,
      costReductionRatio: 0.5,
    },
  },
  homemadeBomb: {
    powerBonusRatio: 0.12,
    reachBonusRatio: 0.12,
    cooldownReductionRatio: 0.12,
    shrapnel: {
      powerBonusRatio: 0,
      radiusBonusRatio: 0.1,
      fragments: 4,
      fragmentPowerRatio: 0.25,
      slowRatio: 0,
      slowDurationMs: 0,
      knockbackDistance: 0 / TILE_SIZE,
      costReductionRatio: 0,
    },
    concussion: {
      powerBonusRatio: -0.1,
      radiusBonusRatio: 0.2,
      fragments: 0,
      fragmentPowerRatio: 0,
      slowRatio: 0.35,
      slowDurationMs: 3_000,
      knockbackDistance: 48 / TILE_SIZE,
      costReductionRatio: 0,
    },
    powderKeg: {
      powerBonusRatio: 0.35,
      radiusBonusRatio: 0.35,
      fragments: 6,
      fragmentPowerRatio: 0.3,
      slowRatio: 0.25,
      slowDurationMs: 3_000,
      knockbackDistance: 36 / TILE_SIZE,
      costReductionRatio: 0.5,
    },
  },
  rationBase: {
    healing: 12,
    portions: 1,
  },
} as const;

export function isPeasantTalentEffect(effect: { kind: string }): effect is PeasantTalentEffect {
  return (PEASANT_TALENT_EFFECT_KINDS as readonly string[]).includes(effect.kind);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export interface PeasantHarvestPlan {
  resource: HarvestProfile["resource"];
  tool: HarvestTool;
  yieldAmount: number;
  goldValue: number;
  primaryMaterialReward: PartyMaterialAmounts;
  bonusMaterialReward: PartyMaterialAmounts;
  /** Single reward object suitable for one authoritative party-stock transition. */
  materialReward: PartyMaterialAmounts;
  hitsRequired: number;
  harvestDurationMs: number;
  areaRadius: number;
  maximumTargets: number;
}

function primaryMaterialReward(
  resource: HarvestProfile["resource"],
  amount: number,
): PartyMaterialAmounts {
  if (resource === "gold" || amount <= 0) return {};
  return { [resource]: amount } satisfies PartyMaterialAmounts;
}

/** Merge primary and talent rewards before the authority performs its single durable credit. */
export function mergePeasantMaterialRewards(
  ...rewards: readonly PartyMaterialAmounts[]
): PartyMaterialAmounts {
  const merged: PartyMaterialAmounts = {};
  for (const type of PARTY_MATERIAL_TYPES) {
    const amount = rewards.reduce((total, reward) => total + (reward[type] ?? 0), 0);
    if (amount > 0) merged[type] = amount;
  }
  return merged;
}

/** Resolve trusted talent data against one authored profile without changing either input. */
export function resolvePeasantHarvestPlan(
  profile: HarvestProfile,
  effects: readonly PeasantTalentEffect[],
): PeasantHarvestPlan {
  let yieldBonusRatio = 0;
  let hitsReduction = 0;
  let durationReductionRatio = 0;
  let areaRadius = 0;
  let maximumTargets = 1;
  let ironFromStone = 0;
  let goldValueBonusRatio = 0;

  for (const effect of effects) {
    if (effect.kind === "peasant_harvest_yield" && effect.tool === profile.tool) {
      yieldBonusRatio += effect.bonusRatio;
    } else if (effect.kind === "peasant_harvest_efficiency" && effect.tool === profile.tool) {
      hitsReduction += effect.hitsReduction;
      durationReductionRatio += effect.durationReductionRatio;
    } else if (effect.kind === "peasant_harvest_area" && effect.tool === profile.tool) {
      areaRadius = Math.max(areaRadius, effect.radius);
      maximumTargets = Math.max(maximumTargets, effect.maximumTargets);
    } else if (effect.kind === "peasant_rich_vein" && profile.tool === "pickaxe") {
      ironFromStone += effect.ironFromStone;
      goldValueBonusRatio += effect.goldValueBonusRatio;
    }
  }

  const rewardMultiplier = Math.max(0, 1 + yieldBonusRatio);
  const yieldAmount =
    profile.resource === "gold" ? 0 : Math.ceil(profile.yieldAmount * rewardMultiplier);
  const primaryReward = primaryMaterialReward(profile.resource, yieldAmount);
  const bonusReward: PartyMaterialAmounts =
    profile.resource === "stone" && ironFromStone > 0
      ? { iron: Math.max(0, Math.floor(ironFromStone)) }
      : {};
  return {
    resource: profile.resource,
    tool: profile.tool,
    yieldAmount,
    goldValue:
      profile.resource === "gold"
        ? Math.min(
            HARVEST_PROFILE_LIMITS.goldValue.max,
            Math.ceil(profile.goldValue * Math.max(0, rewardMultiplier + goldValueBonusRatio)),
          )
        : 0,
    primaryMaterialReward: primaryReward,
    bonusMaterialReward: bonusReward,
    materialReward: mergePeasantMaterialRewards(primaryReward, bonusReward),
    hitsRequired: Math.max(1, profile.hitsRequired - Math.max(0, Math.floor(hitsReduction))),
    harvestDurationMs: Math.max(
      0,
      Math.round(profile.harvestDurationMs * (1 - clamp(durationReductionRatio, 0, 0.75))),
    ),
    areaRadius: Math.max(0, areaRadius),
    maximumTargets: Math.max(1, Math.floor(maximumTargets)),
  };
}

export interface PeasantRationPlan {
  healing: number;
  portions: number;
  radius: number;
  buffDurationMs: number;
  powerBonusRatio: number;
}

export function resolvePeasantRationPlan(
  effects: readonly PeasantTalentEffect[],
): PeasantRationPlan {
  let healingBonusRatio = 0;
  let extraPortions = 0;
  let radius = 0;
  let buffDurationMs = 0;
  let powerBonusRatio = 0;
  for (const effect of effects) {
    if (effect.kind !== "peasant_ration") continue;
    healingBonusRatio += effect.healingBonusRatio;
    extraPortions += effect.extraPortions;
    radius = Math.max(radius, effect.radius);
    buffDurationMs = Math.max(buffDurationMs, effect.buffDurationMs);
    powerBonusRatio += effect.powerBonusRatio;
  }
  return {
    healing: Math.ceil(PEASANT_TALENT_BALANCE.rationBase.healing * (1 + healingBonusRatio)),
    portions: Math.max(1, PEASANT_TALENT_BALANCE.rationBase.portions + extraPortions),
    radius: Math.max(0, radius),
    buffDurationMs: Math.max(0, buffDurationMs),
    powerBonusRatio: Math.max(0, powerBonusRatio),
  };
}

export interface PeasantConstructionPlan {
  id: "makeshift_camp";
  cost: PartyMaterialAmounts;
  power: number;
  durabilityMultiplier: number;
  durationMs: number;
  radius: number;
  protectionRatio: number;
  slowRatio: number;
  costMultiplier: number;
}

export function resolvePeasantMaterialCost(
  cost: Readonly<PartyMaterialAmounts>,
  reductionRatio: number,
): PartyMaterialAmounts {
  const multiplier = Math.max(0.5, 1 - Math.max(0, reductionRatio));
  const resolved: PartyMaterialAmounts = {};
  for (const type of PARTY_MATERIAL_TYPES) {
    const amount = cost[type] ?? 0;
    if (amount > 0) resolved[type] = Math.max(1, Math.ceil(amount * multiplier));
  }
  return resolved;
}

type PeasantSupportBase = Pick<
  PeasantSupportSkillConfig,
  "id" | "cost" | "power" | "radius" | "durationMs"
>;

export function resolvePeasantConstructionPlan(
  effects: readonly PeasantTalentEffect[],
  base: PeasantSupportBase = PEASANT_SUPPORT_SKILLS[4],
): PeasantConstructionPlan {
  let durabilityBonusRatio = 0;
  let durationBonusMs = 0;
  let radius = base.radius;
  let powerBonusRatio = 0;
  let protectionRatio = 0;
  let slowRatio = 0;
  let costReductionRatio = 0;
  for (const effect of effects) {
    if (effect.kind !== "peasant_construction") continue;
    durabilityBonusRatio += effect.durabilityBonusRatio;
    durationBonusMs += effect.durationBonusMs;
    radius = Math.max(radius, effect.radius);
    powerBonusRatio += effect.powerBonusRatio;
    protectionRatio += effect.protectionRatio;
    slowRatio += effect.slowRatio;
    costReductionRatio += effect.costReductionRatio;
  }
  if (base.id !== "makeshift_camp") throw new Error("Expected the makeshift camp support base");
  const costMultiplier = Math.max(0.5, 1 - costReductionRatio);
  return {
    id: "makeshift_camp",
    cost: resolvePeasantMaterialCost(base.cost, costReductionRatio),
    power: Math.round(base.power * Math.max(0, 1 + powerBonusRatio)),
    durabilityMultiplier: Math.max(1, 1 + durabilityBonusRatio),
    durationMs: Math.max(0, base.durationMs + durationBonusMs),
    radius,
    protectionRatio: clamp(protectionRatio, 0, 0.5),
    slowRatio: clamp(slowRatio, 0, 0.75),
    costMultiplier,
  };
}

export interface PeasantBombPlan {
  id: "homemade_bomb";
  cost: PartyMaterialAmounts;
  power: number;
  radius: number;
  fragments: number;
  fragmentPowerRatio: number;
  slowRatio: number;
  slowDurationMs: number;
  knockbackDistance: number;
  fuseDurationMs: number;
  costMultiplier: number;
}

export function resolvePeasantBombPlan(
  effects: readonly PeasantTalentEffect[],
  base: PeasantSupportBase = PEASANT_SUPPORT_SKILLS[5],
): PeasantBombPlan {
  let powerBonusRatio = 0;
  let radiusBonusRatio = 0;
  let fragments = 0;
  let fragmentPowerRatio = 0;
  let slowRatio = 0;
  let slowDurationMs = 0;
  let knockbackDistance = 0;
  let costReductionRatio = 0;
  for (const effect of effects) {
    if (effect.kind !== "peasant_bomb") continue;
    powerBonusRatio += effect.powerBonusRatio;
    radiusBonusRatio += effect.radiusBonusRatio;
    fragments = Math.max(fragments, effect.fragments);
    fragmentPowerRatio = Math.max(fragmentPowerRatio, effect.fragmentPowerRatio);
    slowRatio += effect.slowRatio;
    slowDurationMs = Math.max(slowDurationMs, effect.slowDurationMs);
    knockbackDistance = Math.max(knockbackDistance, effect.knockbackDistance);
    costReductionRatio += effect.costReductionRatio;
  }
  if (base.id !== "homemade_bomb") throw new Error("Expected the homemade bomb support base");
  const safePower = Number.isFinite(base.power) ? Math.max(0, base.power) : 0;
  const safeRadius = Number.isFinite(base.radius) ? Math.max(0, base.radius) : 0;
  const costMultiplier = Math.max(0.5, 1 - costReductionRatio);
  return {
    id: "homemade_bomb",
    cost: resolvePeasantMaterialCost(base.cost, costReductionRatio),
    power: Math.round(safePower * Math.max(0, 1 + powerBonusRatio)),
    radius: roundGroundLength(safeRadius * Math.max(0, 1 + radiusBonusRatio)),
    fragments: Math.max(0, Math.floor(fragments)),
    fragmentPowerRatio: Math.max(0, fragmentPowerRatio),
    slowRatio: clamp(slowRatio, 0, 0.75),
    slowDurationMs: Math.max(0, slowDurationMs),
    knockbackDistance: Math.max(0, knockbackDistance),
    fuseDurationMs: Math.max(0, base.durationMs),
    costMultiplier,
  };
}
