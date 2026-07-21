/**
 * Death, as a state machine over pure functions.
 *
 * Dying does not move you. It leaves your body where you fell and freezes you over it. From
 * there the two exits are deliberate: a priest revives you in place, or you release your
 * spirit, appear at the nearest cemetery, and walk back to your own corpse.
 *
 *   "alive" ──(hp hits 0)──▶ "corpse" ──(a priest resurrects)──▶ "alive"
 *                                │
 *                                └──(you release)──▶ "ghost" ──(reach your corpse)──▶ "alive"
 *
 * There is no timer in here and no auto-release: a corpse waits indefinitely, which is the
 * only reason a priest's grace period means anything. Releasing is one-way — a priest cannot
 * resurrect a ghost — so the choice actually costs something.
 */

import { maxHpForLevel } from "./game.js";
import { PLAYER_SPEED, type Vec2 } from "./simulation.js";

export const LIFE_STATES = ["alive", "corpse", "ghost"] as const;
export type LifeState = (typeof LIFE_STATES)[number];

/** A ghost is brisk, not fast. The walk home should sting without being a commute. */
export const GHOST_SPEED_MULTIPLIER = 1.3;
export const GHOST_SPEED = PLAYER_SPEED * GHOST_SPEED_MULTIPLIER;

/**
 * Reclaiming is automatic within this radius, like loot. A corpse run that ends in one more
 * keypress ends in a keypress you forgot about.
 */
export const CORPSE_RECLAIM_RANGE = 44;

/** Coming back at full health is what makes the current death free. Both routes leave a mark. */
export const RESURRECT_HP_RATIO = 0.4;

/** A priest cannot chain-revive a wipe. */
export const RESURRECT_COOLDOWN_MS = 20_000;

export function isSpirit(life: LifeState): life is "corpse" | "ghost" {
  return life !== "alive";
}

export function isLifeState(value: unknown): value is LifeState {
  return typeof value === "string" && (LIFE_STATES as readonly string[]).includes(value);
}

/** The living walk; the dead do not move at all; ghosts hurry. Both sides derive speed here. */
export function speedForLife(life: LifeState): number {
  if (life === "ghost") return GHOST_SPEED;
  if (life === "corpse") return 0;
  return PLAYER_SPEED;
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

export function canReclaim(life: LifeState, position: Vec2, corpse: Vec2 | null): boolean {
  if (life !== "ghost" || corpse === null) return false;
  return Math.hypot(position.x - corpse.x, position.y - corpse.y) <= CORPSE_RECLAIM_RANGE;
}
