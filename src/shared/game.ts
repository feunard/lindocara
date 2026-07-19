import {
  clampToWorld,
  PLAYER_SIZE,
  type Vec2,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type WorldBounds,
} from "./simulation.js";
import {
  addAxisCrossings,
  isSolidKind,
  isWalkableBox,
  kindAtPoint,
  type TileMap,
} from "./tilemap.js";
import { VERDANT_REACH_TILES } from "./zones/verdant-reach-tiles.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Immutable geometry supplied by the active zone; defaults preserve Verdant Reach. */
export interface TerrainGeometry extends WorldBounds {
  obstacles: readonly Rect[];
  spawnPoints: readonly Vec2[];
  /**
   * Where monsters may not touch a player — Heartroot's walls, and nothing else.
   *
   * `null` means "this world has no such place", which is the truth for every authored map: a map
   * author has no way to declare one, and monsters there come only from spawns they placed. It is
   * deliberately not a degenerate rect. `inRect` is an overlap test, so "empty" is a property of
   * the *arithmetic* — a zero-size rect at the origin only fails to overlap because entities are
   * clamped to non-negative coordinates elsewhere. Absence must not depend on an invariant living
   * in another file; ask through `safeZoneShelters`.
   */
  safeZone: Rect | null;
  /** The collision truth — and, since Task 4, the line-of-sight truth too. `obstacles` survives
   *  only for the minimap, and goes away in a later slice. */
  tiles: TileMap;
}

export interface NpcDefinition extends Vec2 {
  id: string;
}

/** The stat tiers. Renamed onto the Tiny Swords Enemy Pack; the numbers below are unchanged. */
export type MonsterKind = "goblin" | "gnoll" | "skull" | "minotaur" | "troll";

export type MonsterSpecies =
  | "spear_goblin"
  | "torch_goblin"
  | "gnoll_marauder"
  | "skull_guard"
  | "skull_crusader"
  | "skull_warden"
  | "minotaur_brute"
  | "mire_troll"
  | "gate_troll";

/** One authored field (species) decides the stats row (kind). Markers store only the species. */
export const MONSTER_SPECIES_KIND: Record<MonsterSpecies, MonsterKind> = {
  spear_goblin: "goblin",
  torch_goblin: "goblin",
  gnoll_marauder: "gnoll",
  skull_guard: "skull",
  skull_crusader: "skull",
  skull_warden: "skull",
  minotaur_brute: "minotaur",
  mire_troll: "troll",
  gate_troll: "troll",
};

export function isMonsterSpecies(value: unknown): value is MonsterSpecies {
  return typeof value === "string" && value in MONSTER_SPECIES_KIND;
}

export interface MonsterSpawn extends Vec2 {
  id: string;
  kind: MonsterKind;
  species: MonsterSpecies;
  zone: "route" | "clearing" | "forest" | "farm" | "ruins" | "swamp" | "gate";
  patrolRadius: number;
  /** Border patrols may naturally cross the city boundary and be handled by guards. */
  mayEnterSafeZone?: boolean;
}

export type QuestChapter = "three_offerings" | "bone_choir" | "mire_runes" | "ward_run";
export type QuestSiteKind = "resource" | "rune" | "ward";

export interface QuestSite extends Vec2 {
  id: string;
  chapter: QuestChapter;
  kind: QuestSiteKind;
  order: number;
  art: "wood" | "gold" | "meat" | "rune" | "ward";
}

export interface QuestDefinition {
  id: QuestChapter;
  giver: NpcDefinition;
  target: number;
  rewardXp: number;
  rewardGold: number;
}

export interface GuardDefinition extends Vec2 {
  id: string;
  patrolRadius: number;
}

export type LandmarkKind =
  | "sacred_tree"
  | "building"
  | "farm"
  | "ruin"
  | "swamp_shrine"
  | "dungeon_gate"
  | "graveyard";

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
  x: 600,
  y: 760,
};

export const QUEST_DEFINITIONS: readonly QuestDefinition[] = [
  {
    id: "three_offerings",
    giver: QUEST_NPC,
    target: 3,
    rewardXp: 80,
    rewardGold: 12,
  },
  {
    id: "bone_choir",
    giver: { id: "archivist", x: 650, y: 520 },
    target: 5,
    rewardXp: 140,
    rewardGold: 24,
  },
  {
    id: "mire_runes",
    giver: { id: "reed_seer", x: 1050, y: 1120 },
    target: 4,
    rewardXp: 170,
    rewardGold: 30,
  },
  {
    id: "ward_run",
    giver: { id: "gatewatch", x: 1390, y: 1020 },
    target: 4,
    rewardXp: 260,
    rewardGold: 50,
  },
] as const;

export const QUEST_SITES: readonly QuestSite[] = [
  {
    id: "offering-heartwood",
    chapter: "three_offerings",
    kind: "resource",
    order: 0,
    art: "wood",
    x: 2150,
    y: 1510,
  },
  {
    id: "offering-provisions",
    chapter: "three_offerings",
    kind: "resource",
    order: 1,
    art: "meat",
    x: 2160,
    y: 2020,
  },
  {
    id: "offering-sun-ore",
    chapter: "three_offerings",
    kind: "resource",
    order: 2,
    art: "gold",
    x: 3290,
    y: 880,
  },
  { id: "rune-root", chapter: "mire_runes", kind: "rune", order: 1, art: "rune", x: 3160, y: 2200 },
  { id: "rune-moon", chapter: "mire_runes", kind: "rune", order: 3, art: "rune", x: 3470, y: 1830 },
  {
    id: "rune-flame",
    chapter: "mire_runes",
    kind: "rune",
    order: 0,
    art: "rune",
    x: 3760,
    y: 2240,
  },
  {
    id: "rune-crown",
    chapter: "mire_runes",
    kind: "rune",
    order: 2,
    art: "rune",
    x: 3960,
    y: 1730,
  },
  { id: "ward-gate", chapter: "ward_run", kind: "ward", order: 0, art: "ward", x: 4100, y: 1570 },
  { id: "ward-mire", chapter: "ward_run", kind: "ward", order: 1, art: "ward", x: 3760, y: 1910 },
  { id: "ward-ford", chapter: "ward_run", kind: "ward", order: 2, art: "ward", x: 2760, y: 1810 },
  { id: "ward-farm", chapter: "ward_run", kind: "ward", order: 3, art: "ward", x: 2240, y: 2180 },
] as const;

export const QUEST_CHAPTERS = QUEST_DEFINITIONS.map((quest) => quest.id);
export const QUEST_RUN_LIMIT_MS = 45_000;
export const QUEST_SITE_RESPAWN_MS = 15_000;

export function questDefinition(chapter: QuestChapter): QuestDefinition {
  const definition = QUEST_DEFINITIONS.find((quest) => quest.id === chapter);
  if (!definition) throw new Error(`Unknown quest chapter: ${chapter}`);
  return definition;
}

export function nextQuestChapter(chapter: QuestChapter): QuestChapter | null {
  const index = QUEST_CHAPTERS.indexOf(chapter);
  return QUEST_CHAPTERS[index + 1] ?? null;
}

/** The central civic plaza: broad, collision-free arrivals with 100px personal spacing. */
export const SPAWN_POINTS: readonly Vec2[] = Array.from({ length: 24 }, (_, index) => ({
  x: 720 + (index % 6) * 100,
  y: 580 + Math.floor(index / 6) * 100,
}));

export const CITY_GUARDS: readonly GuardDefinition[] = [
  { id: "guard-west", x: 430, y: 760, patrolRadius: 210 },
  { id: "guard-east", x: 1510, y: 950, patrolRadius: 210 },
  { id: "guard-north", x: 1040, y: 510, patrolRadius: 190 },
  { id: "guard-south", x: 1040, y: 1120, patrolRadius: 190 },
] as const;

export const GUARD_DETECTION_RANGE = 360;
export const GUARD_ATTACK_RANGE = 54;
export const GUARD_ATTACK_COOLDOWN_MS = 260;
export const GUARD_DAMAGE = 500;
export const GUARD_SPEED = 235;
export const GUARD_MAX_HP = 220;

export interface Cemetery extends Vec2 {
  id: string;
}

/**
 * Spirit anchors. Releasing puts your ghost at the one nearest your corpse, which is what
 * keeps the walk home in the fifteen-to-thirty-second range wherever on the map you fell.
 * Each sits on open ground just below its chapel — see the `graveyard` landmarks.
 */
export const CEMETERIES: readonly Cemetery[] = [
  { id: "hollowrest", x: 1040, y: 1990 },
  { id: "crossroads", x: 2040, y: 780 },
  { id: "gloamfield", x: 3700, y: 1280 },
];

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
    id: "founders-guildhall",
    kind: "building",
    x: 720,
    y: 900,
    width: 300,
    height: 190,
    collider: { x: 750, y: 940, width: 240, height: 125 },
  },
  {
    id: "heartroot-sanctuary",
    kind: "building",
    x: 1060,
    y: 900,
    width: 220,
    height: 200,
    collider: { x: 1085, y: 945, width: 170, height: 130 },
  },
  {
    id: "eastwatch-barracks",
    kind: "building",
    x: 1260,
    y: 650,
    width: 270,
    height: 210,
    collider: { x: 1290, y: 700, width: 215, height: 140 },
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
  // One chapel per cemetery. The collider is the chapel itself; the spirit anchor in
  // CEMETERIES sits on open ground below it, so a ghost never materialises inside a wall.
  {
    id: "hollowrest-chapel",
    kind: "graveyard",
    x: 960,
    y: 1815,
    width: 190,
    height: 160,
    collider: { x: 985, y: 1840, width: 140, height: 110 },
  },
  {
    id: "crossroads-chapel",
    kind: "graveyard",
    x: 1960,
    y: 605,
    width: 190,
    height: 160,
    collider: { x: 1985, y: 630, width: 140, height: 110 },
  },
  {
    id: "gloamfield-chapel",
    kind: "graveyard",
    x: 3620,
    y: 1105,
    width: 190,
    height: 160,
    collider: { x: 3645, y: 1130, width: 140, height: 110 },
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

export const VERDANT_REACH_TERRAIN: TerrainGeometry = {
  width: WORLD_WIDTH,
  height: WORLD_HEIGHT,
  obstacles: OBSTACLES,
  spawnPoints: SPAWN_POINTS,
  safeZone: SAFE_ZONE,
  tiles: VERDANT_REACH_TILES,
};

export const MONSTER_SPAWNS: readonly MonsterSpawn[] = [
  {
    id: "road-goblin-scout",
    kind: "goblin",
    species: "spear_goblin",
    zone: "route",
    x: 1870,
    y: 820,
    patrolRadius: 75,
  },
  {
    id: "road-goblin-raider",
    kind: "goblin",
    species: "torch_goblin",
    zone: "route",
    x: 2260,
    y: 820,
    patrolRadius: 85,
  },
  {
    id: "city-edge-prowler",
    kind: "goblin",
    species: "spear_goblin",
    zone: "route",
    x: 1580,
    y: 780,
    patrolRadius: 120,
    mayEnterSafeZone: true,
  },
  {
    id: "clearing-orc-1",
    kind: "gnoll",
    species: "gnoll_marauder",
    zone: "clearing",
    x: 1880,
    y: 390,
    patrolRadius: 95,
  },
  {
    id: "clearing-orc-2",
    kind: "gnoll",
    species: "gnoll_marauder",
    zone: "clearing",
    x: 2260,
    y: 590,
    patrolRadius: 105,
  },
  {
    id: "forest-goblin-1",
    kind: "goblin",
    species: "torch_goblin",
    zone: "forest",
    // Sits in the 3-tile-wide gap between the two south groves. Centred at x: 2000 (was 2020) so
    // the patrol ring's east edge stays clear of the fattened tile the coarsened grove wall
    // rounds out to — see the strict isWalkable assertion in game.test.ts.
    x: 2000,
    y: 1290,
    patrolRadius: 70,
  },
  {
    id: "forest-orc-1",
    kind: "gnoll",
    species: "gnoll_marauder",
    zone: "forest",
    x: 2320,
    y: 1610,
    patrolRadius: 70,
  },
  {
    id: "farm-goblin-1",
    kind: "goblin",
    species: "spear_goblin",
    zone: "farm",
    x: 1640,
    y: 1900,
    patrolRadius: 90,
  },
  {
    id: "farm-ogre-1",
    kind: "minotaur",
    species: "minotaur_brute",
    zone: "farm",
    x: 2350,
    y: 1900,
    patrolRadius: 100,
  },
  {
    id: "ruins-bone-guard",
    kind: "skull",
    species: "skull_guard",
    zone: "ruins",
    x: 3380,
    y: 420,
    patrolRadius: 100,
  },
  {
    id: "ruins-bone-crusader",
    kind: "skull",
    species: "skull_crusader",
    zone: "ruins",
    x: 3820,
    y: 820,
    patrolRadius: 95,
  },
  {
    id: "ruins-bone-warden",
    kind: "skull",
    species: "skull_warden",
    zone: "ruins",
    x: 3220,
    y: 1160,
    patrolRadius: 80,
  },
  {
    id: "swamp-troll-1",
    kind: "troll",
    species: "mire_troll",
    zone: "swamp",
    x: 3900,
    y: 2450,
    patrolRadius: 70,
  },
  {
    id: "swamp-troll-2",
    kind: "troll",
    species: "mire_troll",
    zone: "swamp",
    x: 3300,
    y: 2100,
    patrolRadius: 80,
  },
  {
    id: "gate-ogre",
    kind: "minotaur",
    species: "minotaur_brute",
    zone: "gate",
    x: 4070,
    y: 1100,
    patrolRadius: 85,
  },
  {
    id: "gate-troll",
    kind: "troll",
    species: "gate_troll",
    zone: "gate",
    // y: 870 (was 850) so the patrol ring's north edge clears the fattened tile below
    // gate-north-cliff — see the strict isWalkable assertion in game.test.ts.
    x: 4300,
    y: 870,
    patrolRadius: 95,
  },
] as const;

export interface MonsterStats {
  maxHp: number;
  damage: number;
  speed: number;
  xp: number;
}

export const MONSTER_STATS: Record<MonsterKind, MonsterStats> = {
  goblin: { maxHp: 48, damage: 7, speed: 105, xp: 28 },
  gnoll: { maxHp: 72, damage: 10, speed: 88, xp: 42 },
  minotaur: { maxHp: 110, damage: 14, speed: 65, xp: 62 },
  skull: { maxHp: 78, damage: 11, speed: 82, xp: 48 },
  troll: { maxHp: 145, damage: 16, speed: 60, xp: 78 },
};

export const PLAYER_MAX_HP_BASE = 100;
export const PLAYER_HP_PER_LEVEL = 12;

/** Slot-one attack cadence shared by all three class kits. */
export const ATTACK_COOLDOWN_MS = 650;
export const MONSTER_AGGRO_RANGE = 210;
export const MONSTER_ATTACK_RANGE = 42;
export const MONSTER_ATTACK_COOLDOWN_MS = 900;
export const MONSTER_RESPAWN_MS = 6_000;
export const INTERACTION_RANGE = 92;
export const LOOT_PICKUP_RANGE = 46;
/** How long a dropped stack waits on the ground before `loot-system` sweeps it away. */
export const LOOT_EXPIRY_MS = 30_000;
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

function centerOf(position: Vec2, size: number): Vec2 {
  return { x: position.x + size / 2, y: position.y + size / 2 };
}

/**
 * Line-of-sight consults the same tile grid `isWalkable` collides against — never `obstacles`,
 * the rectangles it was rasterised from. Reading anything else would let the two disagree: a shot
 * refused through a wall a player's own body could actually stand past, or allowed through one it
 * would collide with.
 *
 * The tile-based check does disagree with the old rectangle check, in both directions — checked
 * directly against all 37 `OBSTACLES` rects this session: none are erased outright (every rect
 * keeps at least one solid tile after rasterising), so "small colliders vanish" is not what is
 * happening. Classifying every tile by whether an `OBSTACLES` rect covers its centre: 43 tiles are
 * solid with no rect at their centre at all (a wall rasterised fatter than the rectangle it came
 * from), against only 15 non-solid tiles whose centre sits inside a rect (a thin collider rounded
 * away by the 50% threshold) — fattening outnumbers erosion roughly 3 to 1 by tile count. Sampling
 * position pairs (also this session, several sampling schemes) confirms both directions show up at
 * a percent-or-more scale, but which one dominates the pair count swings with *where* you sample —
 * an eroded tile can open a much larger fan of newly-visible pairs than a fattened one closes off,
 * so there is no single stable "X% stricter / Y% permissive" figure to put here; treat any such
 * number as an artifact of the sample, not a property of the map.
 *
 * This checks the two entities' *centers*, not their bodies (see `addAxisCrossings`'s doc for why
 * a fixed sampling stride isn't used). That is appropriate for deciding whether an
 * already-resolved directional combat shape has unobstructed contact, not whether a body could
 * walk the straight line between them. `isPathWalkable` is the box-sweeping counterpart used for
 * body movement.
 */
export function hasLineOfSight(
  from: Vec2,
  to: Vec2,
  tiles: TileMap = VERDANT_REACH_TILES,
  size: number = PLAYER_SIZE,
): boolean {
  const start = centerOf(from, size);
  const end = centerOf(to, size);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const crossings = [0, 1];
  addAxisCrossings(crossings, start.x, dx);
  addAxisCrossings(crossings, start.y, dy);
  crossings.sort((a, b) => a - b);
  for (let index = 0; index < crossings.length - 1; index++) {
    const entry = crossings[index];
    const exit = crossings[index + 1];
    if (entry === undefined || exit === undefined) continue;
    const midpoint = (entry + exit) / 2;
    const x = start.x + dx * midpoint;
    const y = start.y + dy * midpoint;
    if (isSolidKind(kindAtPoint(tiles, x, y))) return false;
  }
  return true;
}

export function applyDamage(currentHp: number, damage: number): { hp: number; killed: boolean } {
  const hp = Math.max(0, currentHp - Math.max(0, damage));
  return { hp, killed: hp === 0 };
}

export function inRect(position: Vec2, rect: Rect, size: number = PLAYER_SIZE): boolean {
  return rectsOverlap(entityBox(position, size), rect);
}

/**
 * "Is this position inside a place monsters are not allowed to touch?" — the single question every
 * caller of `terrain.safeZone` was really asking, asked once.
 */
export function safeZoneShelters(
  position: Vec2,
  geometry: TerrainGeometry,
  size: number = PLAYER_SIZE,
): boolean {
  return geometry.safeZone !== null && inRect(position, geometry.safeZone, size);
}

/**
 * The single collision entry point. `resolveTerrain`, `step`'s callers, the navigation grid,
 * monster movement and mobility skills all reach the world through this one function — which is
 * why moving it onto tiles converts the entire game at once, and why free continuous movement is
 * completely unaffected.
 */
export function isWalkable(
  position: Vec2,
  size: number = PLAYER_SIZE,
  geometry: TerrainGeometry = VERDANT_REACH_TERRAIN,
): boolean {
  return isWalkableBox(geometry.tiles, position, size);
}

/** Axis-separated collision resolution preserves wall sliding and never trusts the client. */
export function resolveTerrain(
  from: Vec2,
  desired: Vec2,
  geometry: TerrainGeometry = VERDANT_REACH_TERRAIN,
): Vec2 {
  const clamped = clampToWorld(desired, geometry);
  let x = from.x;
  let y = from.y;
  if (isWalkable({ x: clamped.x, y: from.y }, PLAYER_SIZE, geometry)) x = clamped.x;
  if (isWalkable({ x, y: clamped.y }, PLAYER_SIZE, geometry)) y = clamped.y;
  return { x, y };
}

/** A deterministic uint32 from a string seed. Used wherever cosmetic placement (spawn point pick,
 *  scattered decoration) must depend only on stable input, never on frame timing or draw order. */
export function hashSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function spawnPosition(seed = "", geometry: TerrainGeometry = VERDANT_REACH_TERRAIN): Vec2 {
  const index = seed.length === 0 ? 0 : hashSeed(seed) % geometry.spawnPoints.length;
  // Last resort for a geometry with no spawn points at all: the safe zone's corner if there is
  // one, otherwise the world's. `terrainFromMap` always supplies exactly one spawn point, so an
  // authored map never reaches either fallback.
  const position =
    geometry.spawnPoints[index] ??
    geometry.spawnPoints[0] ??
    (geometry.safeZone ? { x: geometry.safeZone.x, y: geometry.safeZone.y } : { x: 0, y: 0 });
  return { ...position };
}

/** Where a spirit released at `from` materialises. Straight-line nearest; there is no pathing. */
export function nearestCemetery(from: Vec2): Cemetery {
  let nearest = CEMETERIES[0] ?? { id: "hollowrest", ...spawnPosition() };
  let best = Number.POSITIVE_INFINITY;
  for (const cemetery of CEMETERIES) {
    const distance = pointDistance(from, cemetery);
    if (distance < best) {
      best = distance;
      nearest = cemetery;
    }
  }
  return nearest;
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
    attackRange: 225,
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

export function clampRestoredPosition(
  position: Vec2,
  fallbackSeed = "",
  geometry: TerrainGeometry = VERDANT_REACH_TERRAIN,
): Vec2 {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return spawnPosition(fallbackSeed, geometry);
  }
  const clamped = clampToWorld(position, geometry);
  return isWalkable(clamped, PLAYER_SIZE, geometry)
    ? clamped
    : spawnPosition(fallbackSeed, geometry);
}
