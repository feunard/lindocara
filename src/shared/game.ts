import { clampToWorld, PLAYER_SIZE, type Vec2, WORLD_HEIGHT, WORLD_WIDTH } from "./simulation.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NpcDefinition extends Vec2 {
  id: string;
  name: string;
  role: string;
}

export interface MonsterSpawn extends Vec2 {
  id: string;
  kind: "slime";
  name: string;
  patrolRadius: number;
}

export const OBSTACLES: readonly Rect[] = [
  { x: 250, y: 140, width: 160, height: 220 },
  { x: 250, y: 540, width: 160, height: 220 },
  { x: 720, y: 260, width: 160, height: 120 },
  { x: 720, y: 520, width: 160, height: 120 },
  { x: 1190, y: 140, width: 160, height: 220 },
  { x: 1190, y: 540, width: 160, height: 220 },
] as const;

export const SAFE_ZONE: Rect = { x: 650, y: 390, width: 300, height: 120 };
export const QUEST_NPC: NpcDefinition = {
  id: "warden",
  name: "Keeper Elowen",
  role: "The Gloamcap Oath",
  x: 786,
  y: 428,
};

export const MONSTER_SPAWNS: readonly MonsterSpawn[] = [
  { id: "slime-1", kind: "slime", name: "Gloamcap", x: 80, y: 90, patrolRadius: 110 },
  { id: "slime-2", kind: "slime", name: "Murkbud", x: 90, y: 760, patrolRadius: 100 },
  { id: "slime-3", kind: "slime", name: "Briar Ooze", x: 480, y: 430, patrolRadius: 90 },
  { id: "slime-4", kind: "slime", name: "Briar Ooze", x: 1060, y: 430, patrolRadius: 90 },
  { id: "slime-5", kind: "slime", name: "Murkbud", x: 1460, y: 90, patrolRadius: 100 },
  { id: "slime-6", kind: "slime", name: "Gloamcap", x: 1460, y: 760, patrolRadius: 110 },
] as const;

export const PLAYER_MAX_HP_BASE = 100;
export const PLAYER_HP_PER_LEVEL = 12;
export const PLAYER_ATTACK_BASE = 24;
export const PLAYER_ATTACK_PER_LEVEL = 3;
export const ATTACK_RANGE = 82;
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

export function spawnPosition(): Vec2 {
  return { x: WORLD_WIDTH / 2 - PLAYER_SIZE / 2, y: SAFE_ZONE.y + SAFE_ZONE.height / 2 };
}

export function maxHpForLevel(level: number): number {
  return PLAYER_MAX_HP_BASE + Math.max(0, level - 1) * PLAYER_HP_PER_LEVEL;
}

export function attackDamageForLevel(level: number): number {
  return PLAYER_ATTACK_BASE + Math.max(0, level - 1) * PLAYER_ATTACK_PER_LEVEL;
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

export function clampRestoredPosition(position: Vec2): Vec2 {
  const clamped = clampToWorld(position);
  return isWalkable(clamped) ? clamped : spawnPosition();
}
