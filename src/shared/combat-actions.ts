import type { MonsterSpecies, PlayerClass } from "./game.js";
import type { ProjectileKind } from "./protocol.js";

export type DirectionalActionShape =
  | "arc"
  | "guard"
  | "charge"
  | "area_damage"
  | "projectile"
  | "volley"
  | "dash"
  | "heal_projectile"
  | "teleport"
  | "area_heal"
  | "nova";

export interface ProjectileActionDefinition {
  kind: ProjectileKind;
  speed: number;
  radius: number;
  /** Number of entity contacts allowed after the first one. */
  pierce: number;
  count?: number;
  /** Total angular width of a fan, in radians. */
  spreadRadians?: number;
}

export interface PlayerActionDefinition {
  skillId: string;
  shape: DirectionalActionShape;
  /** Delay from accepted intent to the active frame (or projectile spawn frame). */
  anticipationMs: number;
  /** Time after the active frame during which another action cannot start. */
  recoveryMs: number;
  halfAngleRadians?: number;
  hitboxRadius?: number;
  projectile?: ProjectileActionDefinition;
}

export interface MonsterActionDefinition {
  anticipationMs: number;
  recoveryMs: number;
  range: number;
  hitboxRadius: number;
}

export const MAX_PROJECTILES_PER_PLAYER = 12;
export const MAX_PROJECTILES_PER_ROOM = 48;
export const MAX_PROJECTILE_LIFETIME_MS = 2_500;
export const MAX_PROJECTILE_RANGE = 400;

/**
 * Timings are gameplay data because the authority resolves only at the active frame. Projectile
 * actions use that frame to spawn their projectile; the later collision is its real impact.
 */
export const PLAYER_ACTIONS: Readonly<Record<PlayerClass, readonly PlayerActionDefinition[]>> = {
  warrior: [
    {
      skillId: "cleave",
      shape: "arc",
      anticipationMs: 110,
      recoveryMs: 215,
      halfAngleRadians: (65 * Math.PI) / 180,
      hitboxRadius: 15,
    },
    { skillId: "iron_guard", shape: "guard", anticipationMs: 180, recoveryMs: 420 },
    {
      skillId: "shield_bash",
      shape: "charge",
      anticipationMs: 180,
      recoveryMs: 480,
      hitboxRadius: 18,
    },
    { skillId: "battle_cry", shape: "area_damage", anticipationMs: 300, recoveryMs: 500 },
    { skillId: "whirlwind", shape: "area_damage", anticipationMs: 320, recoveryMs: 600 },
  ],
  ranger: [
    {
      skillId: "quick_shot",
      shape: "projectile",
      anticipationMs: 130,
      recoveryMs: 195,
      projectile: { kind: "arrow", speed: 540, radius: 5, pierce: 0 },
    },
    {
      skillId: "piercing_arrow",
      shape: "projectile",
      anticipationMs: 300,
      recoveryMs: 500,
      projectile: { kind: "piercing_arrow", speed: 600, radius: 7, pierce: 7 },
    },
    {
      skillId: "volley",
      shape: "volley",
      anticipationMs: 360,
      recoveryMs: 640,
      projectile: {
        kind: "volley_arrow",
        speed: 480,
        radius: 5,
        pierce: 0,
        count: 5,
        spreadRadians: (36 * Math.PI) / 180,
      },
    },
    { skillId: "dash", shape: "dash", anticipationMs: 120, recoveryMs: 380 },
    {
      skillId: "heartseeker",
      shape: "projectile",
      anticipationMs: 360,
      recoveryMs: 700,
      projectile: { kind: "heartseeker", speed: 700, radius: 9, pierce: 0 },
    },
  ],
  priest: [
    {
      skillId: "radiant_bolt",
      shape: "projectile",
      anticipationMs: 140,
      recoveryMs: 185,
      projectile: { kind: "radiant_bolt", speed: 480, radius: 8, pierce: 0 },
    },
    {
      skillId: "mend",
      shape: "heal_projectile",
      anticipationMs: 240,
      recoveryMs: 600,
      projectile: { kind: "healing_light", speed: 360, radius: 11, pierce: 0 },
    },
    { skillId: "blink", shape: "teleport", anticipationMs: 180, recoveryMs: 420 },
    { skillId: "prayer", shape: "area_heal", anticipationMs: 320, recoveryMs: 640 },
    { skillId: "divine_nova", shape: "nova", anticipationMs: 400, recoveryMs: 700 },
  ],
};

export function actionForClassSlot(playerClass: PlayerClass, slot: number): PlayerActionDefinition {
  const action = PLAYER_ACTIONS[playerClass][slot - 1];
  if (!action) throw new Error(`Missing action ${playerClass}:${slot}`);
  return action;
}

const STANDARD_MONSTER_ACTION: MonsterActionDefinition = {
  anticipationMs: 450,
  recoveryMs: 500,
  range: 42,
  hitboxRadius: 18,
};

export const MONSTER_ACTIONS: Readonly<Record<MonsterSpecies, MonsterActionDefinition>> = {
  spear_goblin: { ...STANDARD_MONSTER_ACTION, anticipationMs: 420, hitboxRadius: 14 },
  torch_goblin: { ...STANDARD_MONSTER_ACTION, anticipationMs: 460, hitboxRadius: 16 },
  gnoll_marauder: { ...STANDARD_MONSTER_ACTION, anticipationMs: 480, range: 46 },
  skull_guard: { ...STANDARD_MONSTER_ACTION, anticipationMs: 440 },
  skull_crusader: { ...STANDARD_MONSTER_ACTION, anticipationMs: 500, range: 48 },
  skull_warden: { ...STANDARD_MONSTER_ACTION, anticipationMs: 520, range: 50 },
  minotaur_brute: {
    ...STANDARD_MONSTER_ACTION,
    anticipationMs: 600,
    recoveryMs: 650,
    range: 56,
    hitboxRadius: 24,
  },
  mire_troll: {
    ...STANDARD_MONSTER_ACTION,
    anticipationMs: 650,
    recoveryMs: 700,
    range: 58,
    hitboxRadius: 25,
  },
  gate_troll: {
    ...STANDARD_MONSTER_ACTION,
    anticipationMs: 650,
    recoveryMs: 700,
    range: 58,
    hitboxRadius: 25,
  },
};
