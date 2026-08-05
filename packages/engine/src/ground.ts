/**
 * The ground plane, in tile units with the grid centre as origin — the vocabulary the whole game
 * moves to in this increment, and the counterpart of `simulation.ts`'s dying pixel `Vec2`.
 *
 * **The axis convention is the trap.** In the pixel world `x` and `y` were both ground axes and
 * there was no elevation at all. Here `x` and `z` are the ground and **`y` is elevation** — the
 * convention `HeroState` (`hd2d/hero-state.ts`) has always used and `TerrainQuery` answers in. A
 * `{x, y}` ground literal typechecks cleanly against `Vec2` and puts the world on its side; the
 * one-field-name difference between `GroundVector` and `Vec2` is the only reason a half-finished
 * conversion fails to compile instead of shipping.
 *
 * These types live here rather than beside the runtimes that use them because the server, the
 * wire and (from Phase B) the client all speak them, and a second structurally identical
 * declaration would compile today and drift tomorrow.
 */

import type { Vec2 } from "./simulation.js";

/**
 * A two-component quantity on the GROUND PLANE: a heading, a facing, a velocity, a navigation
 * waypoint. The ground axes are `x` and `z` — there is no ground `y` any more.
 */
export interface GroundVector {
  x: number;
  z: number;
}

/**
 * A world position in tile units with the grid centre as the origin: `x` and `z` are the two
 * GROUND axes and `y` is ELEVATION.
 *
 * **`y` is 0 for every entity at this point in the increment** — nothing leaves the ground until
 * jumping and gliding arrive in Phase B. It is not dead weight and must not be dropped as
 * "unused": the axis is carried now so that the world systems are converted once against the
 * final shape rather than twice.
 */
export interface WorldPosition extends GroundVector {
  y: number;
}

/**
 * Distance across the ground, ignoring elevation.
 *
 * Deliberately not `game.ts`'s `pointDistance`, which takes a `Vec2` and therefore measures a
 * converted entity's ground `x` against its ELEVATION `y` — silently, with no compiler error,
 * because `WorldPosition` is still structurally assignable to `Vec2`. Every distance a world
 * system asks about is a distance across the ground: aggro, leash, pickup, reclaim, visibility.
 * A future task that needs true 3D distance should add `spaceDistance` beside this rather than
 * quietly fold `y` in here.
 */
export function groundDistance(a: GroundVector, b: GroundVector): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** `groundDistance` against a bound, defensive about a non-finite or negative range. */
export function withinGroundRange(a: GroundVector, b: GroundVector, range: number): boolean {
  return Number.isFinite(range) && range >= 0 && groundDistance(a, b) <= range;
}

/**
 * The bridge to the modules that still speak the pixel `Vec2` — `simulation.ts`'s `step` and
 * `directional-combat.ts`'s facings and directions. In BOTH of those, `Vec2.y` is a GROUND axis:
 * neither has any notion of elevation, so `y` maps to `z` and nothing is reinterpreted.
 *
 * These two functions exist so the bridge is COUNTABLE — `grep -rn "groundOf\|planarOf"` is the
 * list of places still crossing it, and it must only ever shrink. Do not convert a ground quantity
 * by hand anywhere else; a new one is a `GroundVector` from the start.
 */
export function groundOf(vector: Vec2): GroundVector {
  return { x: vector.x, z: vector.y };
}

export function planarOf(vector: GroundVector): Vec2 {
  return { x: vector.x, y: vector.z };
}
