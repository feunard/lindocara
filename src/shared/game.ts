import { clampToWorld, PLAYER_SIZE, type Vec2, WORLD_HEIGHT, WORLD_WIDTH } from "./simulation.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NpcDefinition extends Vec2 {
  id: string;
}

export type MonsterSpecies =
  | "gloamcap"
  | "murkbud"
  | "briar_ooze"
  | "relic_ooze"
  | "mire_murkbud"
  | "vault_gloamcap";

export interface MonsterSpawn extends Vec2 {
  id: string;
  kind: "slime";
  species: MonsterSpecies;
  zone: "route" | "clearing" | "forest" | "farm" | "ruins" | "swamp" | "gate";
  patrolRadius: number;
}

export type LandmarkKind =
  | "sacred_tree"
  | "building"
  | "farm"
  | "ruin"
  | "swamp_shrine"
  | "dungeon_gate";

export interface WorldLandmark extends Vec2 {
  id: string;
  kind: LandmarkKind;
  width: number;
  height: number;
  collider?: Rect;
}

export type TerrainBlockerKind = "forest" | "water" | "cliff";

export interface TerrainBlocker {
  id: string;
  kind: TerrainBlockerKind;
  rect: Rect;
}

export const WORLD_BOUNDARY_DEPTH = 96;

export const SAFE_ZONE: Rect = { x: 360, y: 260, width: 1200, height: 920 };
export const QUEST_NPC: NpcDefinition = {
  id: "warden",
  x: 590,
  y: 790,
};

/** A broad plaza grid prevents new arrivals and respawns from forming one unreadable stack. */
export const SPAWN_POINTS: readonly Vec2[] = Array.from({ length: 48 }, (_, index) => ({
  x: 720 + (index % 8) * 104,
  y: 500 + Math.floor(index / 8) * 112,
}));

export const BOUNDARY_OBSTACLES: readonly Rect[] = [
  { x: 0, y: 0, width: WORLD_WIDTH, height: WORLD_BOUNDARY_DEPTH },
  {
    x: 0,
    y: WORLD_HEIGHT - WORLD_BOUNDARY_DEPTH,
    width: WORLD_WIDTH,
    height: WORLD_BOUNDARY_DEPTH,
  },
  { x: 0, y: 0, width: WORLD_BOUNDARY_DEPTH, height: WORLD_HEIGHT },
  {
    x: WORLD_WIDTH - WORLD_BOUNDARY_DEPTH,
    y: 0,
    width: WORLD_BOUNDARY_DEPTH,
    height: WORLD_HEIGHT,
  },
] as const;

export const WORLD_LANDMARKS: readonly WorldLandmark[] = [
  {
    id: "heartroot-tree",
    kind: "sacred_tree",
    x: 430,
    y: 390,
    width: 240,
    height: 330,
    collider: { x: 520, y: 635, width: 62, height: 72 },
  },
  {
    id: "crossing-hall",
    kind: "building",
    x: 760,
    y: 280,
    width: 300,
    height: 190,
    collider: { x: 780, y: 310, width: 260, height: 140 },
  },
  {
    id: "lantern-house",
    kind: "building",
    x: 1110,
    y: 300,
    width: 250,
    height: 180,
    collider: { x: 1130, y: 330, width: 210, height: 130 },
  },
  {
    id: "wayfarer-rest",
    kind: "building",
    x: 390,
    y: 830,
    width: 240,
    height: 210,
    collider: { x: 420, y: 880, width: 190, height: 140 },
  },
  {
    id: "bramblewick-farm",
    kind: "farm",
    x: 1740,
    y: 1740,
    width: 440,
    height: 320,
    collider: { x: 1800, y: 1800, width: 260, height: 170 },
  },
  {
    id: "sunken-choir-ruins",
    kind: "ruin",
    x: 3260,
    y: 480,
    width: 480,
    height: 420,
    collider: { x: 3440, y: 660, width: 120, height: 100 },
  },
  {
    id: "mirewatch-shrine",
    kind: "swamp_shrine",
    x: 3540,
    y: 2050,
    width: 260,
    height: 260,
    collider: { x: 3630, y: 2150, width: 80, height: 90 },
  },
  {
    id: "gloamvault-gate",
    kind: "dungeon_gate",
    x: 4300,
    y: 1030,
    width: 360,
    height: 430,
    collider: { x: 4390, y: 1080, width: 190, height: 150 },
  },
] as const;

export const TERRAIN_BLOCKERS: readonly TerrainBlocker[] = [
  {
    id: "heartroot-north-canopy",
    kind: "forest",
    rect: { x: 96, y: 96, width: 1220, height: 120 },
  },
  {
    id: "clearing-north-canopy",
    kind: "forest",
    rect: { x: 1520, y: 96, width: 1000, height: 180 },
  },
  {
    id: "clearing-south-grove-west",
    kind: "forest",
    rect: { x: 1560, y: 1100, width: 340, height: 360 },
  },
  {
    id: "clearing-south-grove-east",
    kind: "forest",
    rect: { x: 2140, y: 1100, width: 380, height: 360 },
  },
  {
    id: "farm-westwood",
    kind: "forest",
    rect: { x: 96, y: 1280, width: 1250, height: 560 },
  },
  {
    id: "farm-southwood",
    kind: "forest",
    rect: { x: 1450, y: 2360, width: 1030, height: 244 },
  },
  {
    id: "ruins-west-grove",
    kind: "forest",
    rect: { x: 2700, y: 980, width: 360, height: 440 },
  },
  {
    id: "ruins-south-grove",
    kind: "forest",
    rect: { x: 3060, y: 1320, width: 760, height: 260 },
  },
  {
    id: "marsh-west-grove",
    kind: "forest",
    rect: { x: 2700, y: 1980, width: 320, height: 624 },
  },
  {
    id: "marsh-east-grove",
    kind: "forest",
    rect: { x: 4040, y: 1840, width: 160, height: 764 },
  },
  {
    id: "river-north-deepwater",
    kind: "water",
    rect: { x: 2520, y: 96, width: 180, height: 620 },
  },
  {
    id: "river-middle-deepwater",
    kind: "water",
    rect: { x: 2520, y: 924, width: 180, height: 780 },
  },
  {
    id: "river-south-deepwater",
    kind: "water",
    rect: { x: 2520, y: 1904, width: 180, height: 700 },
  },
  {
    id: "mire-pool-west",
    kind: "water",
    rect: { x: 3040, y: 1810, width: 260, height: 160 },
  },
  {
    id: "mire-pool-center",
    kind: "water",
    rect: { x: 3350, y: 2330, width: 310, height: 170 },
  },
  {
    id: "mire-pool-east",
    kind: "water",
    rect: { x: 3820, y: 1930, width: 220, height: 210 },
  },
  {
    id: "ruins-northern-cliff",
    kind: "cliff",
    rect: { x: 2700, y: 96, width: 1500, height: 180 },
  },
  {
    id: "gate-north-cliff",
    kind: "cliff",
    rect: { x: 4000, y: 500, width: 704, height: 240 },
  },
  {
    id: "gate-south-cliff",
    kind: "cliff",
    rect: { x: 4200, y: 1800, width: 504, height: 804 },
  },
] as const;

/** Every visual hard blocker feeds the one collision list shared by server and prediction. */
export const OBSTACLES: readonly Rect[] = [
  ...BOUNDARY_OBSTACLES,
  ...TERRAIN_BLOCKERS.map((blocker) => blocker.rect),
  ...WORLD_LANDMARKS.flatMap((landmark) =>
    landmark.collider === undefined ? [] : [landmark.collider],
  ),
];

export const MONSTER_SPAWNS: readonly MonsterSpawn[] = [
  {
    id: "road-gloamcap",
    kind: "slime",
    species: "gloamcap",
    zone: "route",
    x: 1870,
    y: 820,
    patrolRadius: 75,
  },
  {
    id: "road-murkbud",
    kind: "slime",
    species: "murkbud",
    zone: "route",
    x: 2260,
    y: 820,
    patrolRadius: 85,
  },
  {
    id: "clearing-briar-1",
    kind: "slime",
    species: "briar_ooze",
    zone: "clearing",
    x: 1880,
    y: 390,
    patrolRadius: 95,
  },
  {
    id: "clearing-briar-2",
    kind: "slime",
    species: "briar_ooze",
    zone: "clearing",
    x: 2260,
    y: 590,
    patrolRadius: 105,
  },
  {
    id: "forest-gloamcap-1",
    kind: "slime",
    species: "gloamcap",
    zone: "forest",
    x: 2020,
    y: 1290,
    patrolRadius: 70,
  },
  {
    id: "forest-gloamcap-2",
    kind: "slime",
    species: "gloamcap",
    zone: "forest",
    x: 2320,
    y: 1610,
    patrolRadius: 70,
  },
  {
    id: "farm-murkbud-1",
    kind: "slime",
    species: "murkbud",
    zone: "farm",
    x: 1640,
    y: 1900,
    patrolRadius: 90,
  },
  {
    id: "farm-murkbud-2",
    kind: "slime",
    species: "murkbud",
    zone: "farm",
    x: 2240,
    y: 2100,
    patrolRadius: 100,
  },
  {
    id: "ruins-ooze-1",
    kind: "slime",
    species: "relic_ooze",
    zone: "ruins",
    x: 3140,
    y: 620,
    patrolRadius: 100,
  },
  {
    id: "ruins-ooze-2",
    kind: "slime",
    species: "relic_ooze",
    zone: "ruins",
    x: 3740,
    y: 900,
    patrolRadius: 95,
  },
  {
    id: "swamp-murkbud-1",
    kind: "slime",
    species: "mire_murkbud",
    zone: "swamp",
    x: 3140,
    y: 2100,
    patrolRadius: 85,
  },
  {
    id: "swamp-murkbud-2",
    kind: "slime",
    species: "mire_murkbud",
    zone: "swamp",
    x: 3600,
    y: 1860,
    patrolRadius: 80,
  },
  {
    id: "gate-gloamcap-1",
    kind: "slime",
    species: "vault_gloamcap",
    zone: "gate",
    x: 4080,
    y: 1120,
    patrolRadius: 85,
  },
  {
    id: "gate-gloamcap-2",
    kind: "slime",
    species: "vault_gloamcap",
    zone: "gate",
    x: 4230,
    y: 1580,
    patrolRadius: 95,
  },
] as const;

export const PLAYER_MAX_HP_BASE = 100;
export const PLAYER_HP_PER_LEVEL = 12;

export const ATTACK_COOLDOWN_MS = 550;
export const MONSTER_MAX_HP = 64;
export const MONSTER_DAMAGE = 9;
export const MONSTER_SPEED = 85;
export const MONSTER_AGGRO_RANGE = 210;
export const MONSTER_ATTACK_RANGE = 42;
export const MONSTER_ATTACK_COOLDOWN_MS = 900;
export const MONSTER_RESPAWN_MS = 6_000;
export const MONSTER_XP = 35;
export const PLAYER_RESPAWN_MS = 2_500;
export const INTERACTION_RANGE = 92;
export const LOOT_PICKUP_RANGE = 46;
export const QUEST_KILL_TARGET = 3;

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function entityBox(position: Vec2, size: number = PLAYER_SIZE): Rect {
  return { x: position.x, y: position.y, width: size, height: size };
}

export function pointDistance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function withinRange(a: Vec2, b: Vec2, range: number): boolean {
  return Number.isFinite(range) && range >= 0 && pointDistance(a, b) <= range;
}

export function applyDamage(currentHp: number, damage: number): { hp: number; killed: boolean } {
  const hp = Math.max(0, currentHp - Math.max(0, damage));
  return { hp, killed: hp === 0 };
}

export function inRect(position: Vec2, rect: Rect, size: number = PLAYER_SIZE): boolean {
  return rectsOverlap(entityBox(position, size), rect);
}

export function isWalkable(position: Vec2, size: number = PLAYER_SIZE): boolean {
  if (
    position.x < 0 ||
    position.y < 0 ||
    position.x + size > WORLD_WIDTH ||
    position.y + size > WORLD_HEIGHT
  ) {
    return false;
  }
  return !OBSTACLES.some((obstacle) => rectsOverlap(entityBox(position, size), obstacle));
}

/** Axis-separated collision resolution preserves wall sliding and never trusts the client. */
export function resolveTerrain(from: Vec2, desired: Vec2): Vec2 {
  const clamped = clampToWorld(desired);
  let x = from.x;
  let y = from.y;
  if (isWalkable({ x: clamped.x, y: from.y })) x = clamped.x;
  if (isWalkable({ x, y: clamped.y })) y = clamped.y;
  return { x, y };
}

function hashSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function spawnPosition(seed = ""): Vec2 {
  const index = seed.length === 0 ? 0 : hashSeed(seed) % SPAWN_POINTS.length;
  const position = SPAWN_POINTS[index] ?? SPAWN_POINTS[0] ?? { x: SAFE_ZONE.x, y: SAFE_ZONE.y };
  return { ...position };
}

export function maxHpForLevel(level: number): number {
  return PLAYER_MAX_HP_BASE + Math.max(0, level - 1) * PLAYER_HP_PER_LEVEL;
}

// Class system: character types with distinct balance profiles.

export type PlayerClass = "warrior" | "ranger" | "priest";

export const PLAYER_CLASSES: readonly PlayerClass[] = ["warrior", "ranger", "priest"];

export interface ClassStats {
  attackBase: number;
  attackPerLevel: number;
  attackRange: number;
  heal?: { base: number; perLevel: number; range: number; cooldownMs: number };
}

export const CLASS_STATS: Record<PlayerClass, ClassStats> = {
  warrior: { attackBase: 30, attackPerLevel: 4, attackRange: 60 },
  ranger: { attackBase: 16, attackPerLevel: 2, attackRange: 170 },
  priest: {
    attackBase: 14,
    attackPerLevel: 2,
    attackRange: 100,
    heal: { base: 35, perLevel: 3, range: 130, cooldownMs: 1_500 },
  },
};

export function attackDamageFor(playerClass: PlayerClass, level: number): number {
  return (
    CLASS_STATS[playerClass].attackBase +
    Math.max(0, level - 1) * CLASS_STATS[playerClass].attackPerLevel
  );
}

export function healAmountFor(level: number): number {
  const heal = CLASS_STATS.priest.heal;
  if (!heal) {
    throw new Error("healAmountFor: priest heal stats missing");
  }
  return heal.base + Math.max(0, level - 1) * heal.perLevel;
}

export function isValidClass(value: unknown): value is PlayerClass {
  return typeof value === "string" && PLAYER_CLASSES.includes(value as PlayerClass);
}

export function xpForNextLevel(level: number): number {
  return 100 + Math.max(0, level - 1) * 60;
}

export function applyExperience(
  level: number,
  xp: number,
  gained: number,
): { level: number; xp: number; levelsGained: number } {
  let nextLevel = Math.max(1, level);
  let nextXp = Math.max(0, xp) + Math.max(0, gained);
  let levelsGained = 0;
  while (nextXp >= xpForNextLevel(nextLevel)) {
    nextXp -= xpForNextLevel(nextLevel);
    nextLevel += 1;
    levelsGained += 1;
  }
  return { level: nextLevel, xp: nextXp, levelsGained };
}

export function clampRestoredPosition(position: Vec2, fallbackSeed = ""): Vec2 {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return spawnPosition(fallbackSeed);
  }
  const clamped = clampToWorld(position);
  return isWalkable(clamped) ? clamped : spawnPosition(fallbackSeed);
}
