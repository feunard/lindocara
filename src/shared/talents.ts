import type { PlayerClass } from "./game.js";
import { isSkillUnlocked, type SkillDefinition, type SkillSlot, skillFor } from "./skills.js";

export type TalentEffect =
  | { kind: "power_multiplier"; value: number }
  | { kind: "range_multiplier"; value: number }
  | { kind: "distance_multiplier"; value: number }
  | { kind: "cooldown_multiplier"; value: number }
  | { kind: "guard_reduction"; value: number }
  | { kind: "perfect_parry"; windowMs: number }
  | { kind: "perfect_retaliation"; ratio: number }
  | { kind: "ricochet"; ratio: number; range: number }
  | { kind: "extra_projectiles"; value: number }
  | { kind: "dash_invulnerability" }
  | { kind: "execute"; threshold: number; multiplier: number }
  | { kind: "chain_heal"; ratio: number; range: number }
  | { kind: "blink_heal"; value: number };

export type TalentLabel =
  | "root"
  | "power"
  | "range"
  | "distance"
  | "cooldown"
  | "guard_reduction"
  | "perfect_parry"
  | "perfect_retaliation"
  | "ricochet"
  | "extra_projectiles"
  | "dash_invulnerability"
  | "execute"
  | "chain_heal"
  | "blink_heal"
  | "mastery";

export interface TalentNode {
  id: string;
  class: PlayerClass;
  slot: Exclude<SkillSlot, 1>;
  tier: 0 | 1 | 2 | 3;
  column: -1 | 0 | 1;
  label: TalentLabel;
  root: boolean;
  requires: readonly string[];
  requiresAll: boolean;
  effects: readonly TalentEffect[];
}

interface UpgradeSeed {
  key: string;
  label: TalentLabel;
  effects: readonly TalentEffect[];
}

function branch(
  playerClass: PlayerClass,
  slot: Exclude<SkillSlot, 1>,
  upgrades: readonly [UpgradeSeed, UpgradeSeed, UpgradeSeed, UpgradeSeed],
): TalentNode[] {
  const skillId = skillFor(playerClass, slot).id;
  const rootId = `${playerClass}.${skillId}.root`;
  const firstId = `${playerClass}.${skillId}.${upgrades[0].key}`;
  const secondId = `${playerClass}.${skillId}.${upgrades[1].key}`;
  const thirdId = `${playerClass}.${skillId}.${upgrades[2].key}`;
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
      id: `${playerClass}.${skillId}.${upgrades[3].key}`,
      class: playerClass,
      slot,
      tier: 3,
      column: 0,
      label: upgrades[3].label,
      root: false,
      requires: [firstId, secondId, thirdId],
      requiresAll: true,
      effects: upgrades[3].effects,
    },
  ];
}

const power = (value = 0.12): TalentEffect => ({ kind: "power_multiplier", value });
const range = (value = 0.15): TalentEffect => ({ kind: "range_multiplier", value });
const distance = (value = 0.15): TalentEffect => ({ kind: "distance_multiplier", value });
const cooldown = (value = 0.12): TalentEffect => ({ kind: "cooldown_multiplier", value });

export const CLASS_TALENTS: Readonly<Record<PlayerClass, readonly TalentNode[]>> = {
  warrior: [
    ...branch("warrior", 2, [
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
    ]),
    ...branch("warrior", 3, [
      { key: "impact", label: "power", effects: [power()] },
      { key: "onslaught", label: "range", effects: [range(), distance()] },
      { key: "readiness", label: "cooldown", effects: [cooldown()] },
      { key: "mastery", label: "mastery", effects: [power(0.2), distance(0.1)] },
    ]),
    ...branch("warrior", 4, [
      { key: "reach", label: "range", effects: [range(0.2)] },
      { key: "readiness", label: "cooldown", effects: [cooldown()] },
      { key: "command", label: "mastery", effects: [range(0.15)] },
      { key: "mastery", label: "mastery", effects: [range(0.2), cooldown(0.08)] },
    ]),
    ...branch("warrior", 5, [
      { key: "force", label: "power", effects: [power()] },
      { key: "reach", label: "range", effects: [range()] },
      { key: "readiness", label: "cooldown", effects: [cooldown()] },
      { key: "mastery", label: "mastery", effects: [power(0.22)] },
    ]),
  ],
  ranger: [
    ...branch("ranger", 2, [
      { key: "force", label: "power", effects: [power()] },
      { key: "reach", label: "range", effects: [range()] },
      { key: "readiness", label: "cooldown", effects: [cooldown()] },
      {
        key: "ricochet",
        label: "ricochet",
        effects: [{ kind: "ricochet", ratio: 0.6, range: 160 }],
      },
    ]),
    ...branch("ranger", 3, [
      { key: "force", label: "power", effects: [power()] },
      { key: "reach", label: "range", effects: [range()] },
      { key: "readiness", label: "cooldown", effects: [cooldown()] },
      {
        key: "mastery",
        label: "extra_projectiles",
        effects: [{ kind: "extra_projectiles", value: 2 }],
      },
    ]),
    ...branch("ranger", 4, [
      { key: "distance", label: "distance", effects: [distance()] },
      {
        key: "evasion",
        label: "dash_invulnerability",
        effects: [{ kind: "dash_invulnerability" }],
      },
      { key: "readiness", label: "cooldown", effects: [cooldown()] },
      { key: "mastery", label: "mastery", effects: [distance(0.2), cooldown(0.08)] },
    ]),
    ...branch("ranger", 5, [
      { key: "force", label: "power", effects: [power()] },
      { key: "reach", label: "range", effects: [range()] },
      { key: "readiness", label: "cooldown", effects: [cooldown()] },
      {
        key: "execute",
        label: "execute",
        effects: [{ kind: "execute", threshold: 0.35, multiplier: 0.35 }],
      },
    ]),
  ],
  priest: [
    ...branch("priest", 2, [
      { key: "grace", label: "power", effects: [power()] },
      { key: "reach", label: "range", effects: [range()] },
      { key: "readiness", label: "cooldown", effects: [cooldown()] },
      {
        key: "chain",
        label: "chain_heal",
        effects: [{ kind: "chain_heal", ratio: 0.5, range: 140 }],
      },
    ]),
    ...branch("priest", 3, [
      { key: "distance", label: "distance", effects: [distance()] },
      { key: "renewal", label: "blink_heal", effects: [{ kind: "blink_heal", value: 20 }] },
      { key: "readiness", label: "cooldown", effects: [cooldown()] },
      { key: "mastery", label: "mastery", effects: [distance(0.2), cooldown(0.08)] },
    ]),
    ...branch("priest", 4, [
      { key: "grace", label: "power", effects: [power()] },
      { key: "reach", label: "range", effects: [range()] },
      { key: "readiness", label: "cooldown", effects: [cooldown()] },
      { key: "mastery", label: "mastery", effects: [power(0.2)] },
    ]),
    ...branch("priest", 5, [
      { key: "radiance", label: "power", effects: [power()] },
      { key: "reach", label: "range", effects: [range()] },
      { key: "readiness", label: "cooldown", effects: [cooldown()] },
      { key: "mastery", label: "mastery", effects: [power(0.22)] },
    ]),
  ],
};

export interface TalentState {
  selected: string[];
  pointsSpent: number;
  pointsAvailable: number;
}

export type TalentUnlockResult =
  | { ok: true; selected: string[] }
  | {
      ok: false;
      reason: "unknown" | "root" | "locked_skill" | "selected" | "prerequisite" | "points";
    };

export function talentNode(playerClass: PlayerClass, id: string): TalentNode | undefined {
  return CLASS_TALENTS[playerClass].find((node) => node.id === id);
}

export function isTalentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Object.values(CLASS_TALENTS).some((nodes) => nodes.some((node) => node.id === value))
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
  return node.requiresAll ? node.requires.every(active) : node.requires.some(active);
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
      !prerequisitesMet(node, selected, level)
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
  if (slot === 1) return skill;
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
