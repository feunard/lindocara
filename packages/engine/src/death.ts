/**
 * Death, as a state machine over pure functions.
 *
 * Dying does not move you. It leaves your body where you fell and freezes you over it. A priest
 * may still revive that body in place. The ghost/corpse-run branch remains represented here for
 * persisted compatibility, but the current server release policy bypasses it and revives the hero
 * directly at the map entry point.
 *
 *   "alive" ──(hp hits 0)──▶ "corpse" ──(priest revive)──────────▶ "alive"
 *                                └──────(current release policy)──▶ "alive" at map entry
 *
 *   persisted "ghost" ──(reach corpse; compatibility only)───────▶ "alive"
 *
 * There is no timer in here and no auto-release: a corpse waits indefinitely until a priest revive
 * or the server's explicit release policy resolves it.
 */

import { CLASS_STATS, maxHpForLevel, type PlayerClass } from "./game.js";
import { type GroundVector, groundDistance } from "./ground.js";

export const LIFE_STATES = ["alive", "corpse", "ghost"] as const;
export type LifeState = (typeof LIFE_STATES)[number];

/** A ghost is brisk, not fast. The walk home should sting without being a commute. */
export const GHOST_SPEED_MULTIPLIER = 1.3;
/** Measured against the Warrior baseline, which is where the default walking speed lives now that
 *  `simulation.ts`'s `PLAYER_SPEED` retired with `step()`. */
export const GHOST_SPEED = CLASS_STATS.warrior.movementSpeed * GHOST_SPEED_MULTIPLIER;

/**
 * Reclaiming is automatic within this radius, like loot. A corpse run that ends in one more
 * keypress ends in a keypress you forgot about.
 */
export const CORPSE_RECLAIM_RANGE = 44 / 64;

/** Coming back at full health is what makes the current death free. Both routes leave a mark. */
export const RESURRECT_HP_RATIO = 0.4;

/** A priest cannot chain-revive a wipe. */
export const RESURRECT_COOLDOWN_MS = 20_000;

/** Monsters forget a revived hero long enough for them to leave the body and recover control. */
export const REVIVE_AGGRO_GRACE_MS = 5_000;

export function isSpirit(life: LifeState): life is "corpse" | "ghost" {
  return life !== "alive";
}

export function isLifeState(value: unknown): value is LifeState {
  return typeof value === "string" && (LIFE_STATES as readonly string[]).includes(value);
}

/** The living walk; the dead do not move at all; ghosts hurry. Both sides derive speed here. */
export function speedForLife(
  life: LifeState,
  playerClass: PlayerClass = "warrior",
  movementSpeed = CLASS_STATS[playerClass].movementSpeed,
): number {
  if (life === "ghost") return GHOST_SPEED;
  if (life === "corpse") return 0;
  return movementSpeed;
}

/** A corpse is inert and a ghost is intent-inert: only movement and chat survive. */
export function canAct(life: LifeState): boolean {
  return life === "alive";
}

export function canMove(life: LifeState): boolean {
  return life !== "corpse";
}

/** Both routes back to life land on the same fraction, so neither is a shortcut. */
export function resurrectHp(level: number): number {
  return Math.max(1, Math.round(maxHpForLevel(level) * RESURRECT_HP_RATIO));
}

/** A priest may only revive a body that is still lying there. Once released, that exit closes. */
export function canBeResurrected(life: LifeState): boolean {
  return life === "corpse";
}

/**
 * The reclaim check measures across the GROUND. A `Vec2` here would have compiled and silently
 * compared the ghost's ground `x` against its own elevation, so the parameter is a `GroundVector`
 * on purpose — a body that is exactly above its corpse has not reached it.
 */
export function canReclaim(
  life: LifeState,
  position: GroundVector,
  corpse: GroundVector | null,
): boolean {
  if (life !== "ghost" || corpse === null) return false;
  return groundDistance(position, corpse) <= CORPSE_RECLAIM_RANGE;
}
