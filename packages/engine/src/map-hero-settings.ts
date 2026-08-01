import { CLASS_STATS, PLAYER_CLASSES, type PlayerClass } from "./game.js";
import { SKILL_SLOTS, type SkillSlot } from "./skills.js";

/** Bounds shared by the editor and the authoritative map parser. */
export const MAP_HERO_STAT_LIMITS = {
  attackBase: { min: 1, max: 500 },
  attackPerLevel: { min: 0, max: 100 },
  attackRange: { min: 16, max: 1_024 },
  movementSpeed: { min: 80, max: 520 },
  healBase: { min: 1, max: 500 },
  healPerLevel: { min: 0, max: 100 },
  healRange: { min: 16, max: 1_024 },
} as const;

export interface MapHeroClassStats {
  attackBase: number;
  attackPerLevel: number;
  attackRange: number;
  movementSpeed: number;
  /** Present only for the Priest, whose base heal is part of the class contract. */
  heal?: { base: number; perLevel: number; range: number };
}

export interface MapHeroClassSettings {
  stats: MapHeroClassStats;
  /** A disabled slot is rejected by the server even if the hero has unlocked it. */
  disabledSkills: SkillSlot[];
}

export interface MapHeroSettings {
  classes: Record<PlayerClass, MapHeroClassSettings>;
}

function defaultClassSettings(playerClass: PlayerClass): MapHeroClassSettings {
  const stats = CLASS_STATS[playerClass];
  return {
    stats: {
      attackBase: stats.attackBase,
      attackPerLevel: stats.attackPerLevel,
      attackRange: stats.attackRange,
      movementSpeed: stats.movementSpeed,
      ...(stats.heal
        ? {
            heal: { base: stats.heal.base, perLevel: stats.heal.perLevel, range: stats.heal.range },
          }
        : {}),
    },
    disabledSkills: [],
  };
}

/** A fresh object every time so editor drafts never mutate the code-owned defaults. */
export function defaultMapHeroSettings(): MapHeroSettings {
  return {
    classes: {
      warrior: defaultClassSettings("warrior"),
      ranger: defaultClassSettings("ranger"),
      priest: defaultClassSettings("priest"),
      rogue: defaultClassSettings("rogue"),
      peasant: defaultClassSettings("peasant"),
    },
  };
}

function boundedNumber(
  value: unknown,
  limits: { readonly min: number; readonly max: number },
): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= limits.min &&
    value <= limits.max
    ? value
    : null;
}

function parseClassSettings(value: unknown, playerClass: PlayerClass): MapHeroClassSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.stats !== "object" || record.stats === null) return null;
  const stats = record.stats as Record<string, unknown>;
  const attackBase = boundedNumber(stats.attackBase, MAP_HERO_STAT_LIMITS.attackBase);
  const attackPerLevel = boundedNumber(stats.attackPerLevel, MAP_HERO_STAT_LIMITS.attackPerLevel);
  const attackRange = boundedNumber(stats.attackRange, MAP_HERO_STAT_LIMITS.attackRange);
  const movementSpeed = boundedNumber(stats.movementSpeed, MAP_HERO_STAT_LIMITS.movementSpeed);
  if (
    attackBase === null ||
    attackPerLevel === null ||
    attackRange === null ||
    movementSpeed === null
  ) {
    return null;
  }

  let heal: MapHeroClassStats["heal"];
  if (playerClass === "priest") {
    if (typeof stats.heal !== "object" || stats.heal === null) return null;
    const rawHeal = stats.heal as Record<string, unknown>;
    const base = boundedNumber(rawHeal.base, MAP_HERO_STAT_LIMITS.healBase);
    const perLevel = boundedNumber(rawHeal.perLevel, MAP_HERO_STAT_LIMITS.healPerLevel);
    const range = boundedNumber(rawHeal.range, MAP_HERO_STAT_LIMITS.healRange);
    if (base === null || perLevel === null || range === null) return null;
    heal = { base, perLevel, range };
  }

  if (!Array.isArray(record.disabledSkills) || record.disabledSkills.length > SKILL_SLOTS.length) {
    return null;
  }
  const disabledSkills: SkillSlot[] = [];
  for (const slot of record.disabledSkills) {
    if (!SKILL_SLOTS.includes(slot as SkillSlot) || disabledSkills.includes(slot as SkillSlot)) {
      return null;
    }
    disabledSkills.push(slot as SkillSlot);
  }
  disabledSkills.sort((a, b) => a - b);

  return {
    stats: { attackBase, attackPerLevel, attackRange, movementSpeed, ...(heal ? { heal } : {}) },
    disabledSkills,
  };
}

/** Missing settings mean a legacy map and inherit current class defaults. */
export function parseMapHeroSettings(value: unknown): MapHeroSettings | null {
  if (value === undefined || value === null || value === "") return defaultMapHeroSettings();
  if (typeof value !== "object" || value === null) return null;
  const classes = (value as Record<string, unknown>).classes;
  if (typeof classes !== "object" || classes === null) return null;
  const record = classes as Record<string, unknown>;
  const parsed = {} as Record<PlayerClass, MapHeroClassSettings>;
  for (const playerClass of PLAYER_CLASSES) {
    // `peasant` was added after per-map hero rules had already shipped. A valid four-class row is
    // therefore legacy data, not corruption: preserve every authored profile and inject only the
    // new class default. Explicit null/malformed Peasant data still fails closed.
    if (playerClass === "peasant" && record.peasant === undefined) {
      parsed.peasant = defaultClassSettings("peasant");
      continue;
    }
    const settings = parseClassSettings(record[playerClass], playerClass);
    if (!settings) return null;
    parsed[playerClass] = settings;
  }
  return { classes: parsed };
}

export function mapHeroClassSettings(
  settings: MapHeroSettings | undefined,
  playerClass: PlayerClass,
): MapHeroClassSettings {
  return settings?.classes[playerClass] ?? defaultClassSettings(playerClass);
}

export function isMapSkillEnabled(
  settings: MapHeroSettings | undefined,
  playerClass: PlayerClass,
  slot: SkillSlot,
): boolean {
  return !mapHeroClassSettings(settings, playerClass).disabledSkills.includes(slot);
}

export function maxMapHeroMovementSpeed(settings: MapHeroSettings | undefined): number {
  return Math.max(
    ...PLAYER_CLASSES.map(
      (playerClass) => mapHeroClassSettings(settings, playerClass).stats.movementSpeed,
    ),
  );
}
