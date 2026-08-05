/**
 * The server's terrain junction: a stored heightfield becomes the room's `ZoneTerrain`, and every
 * "can something stand here" question in the world systems becomes exactly one call to `canStand`.
 *
 * `canStand` mirrors `canEnter` (`packages/engine/src/hd2d/hero-step.ts`), the rule `apps/lab` has
 * been running at 60 Hz, restricted to what the server simulates in this increment: a GROUNDED body
 * that neither swims, jumps nor walks indoors. What it keeps from `canEnter` is what a naive port
 * drops:
 *
 * - the DISC test. Relief is tested with `maxHeightAround` over the body's radius, never `heightAt`
 *   at its centre — a body is a volume that moves, and a centre-point test lets it sink half of
 *   itself into a cliff before anything stops it.
 * - water as a SURFACE at `waterLevel`, not as a wall. That is what `maxHeightAround` already
 *   answers for a water cell, and it is what lets a body stand on a shore: treat water as an
 *   obstacle inside the disc and every coastline becomes a fence one body-radius deep.
 *
 * The one place it deliberately differs from `canEnter`: water under the CENTRE is refused. Nothing
 * the server simulates swims in this increment, so a foot may not land in the sea — `canEnter`
 * allows it only because the hero it serves flips to swimming on the next line.
 *
 * Two things `canEnter` has that are NOT here, both because they need the mover's CURRENT position
 * and this function is deliberately positional:
 *
 * - the escape hatches ("already overlapping something too tall / already inside a prop, so allow
 *   moving anyway"). Without them a body that spawns or falls inside geometry is cemented in place.
 *   A caller that can be in that state must test its own position too and let the move through when
 *   the destination is no worse — that is the caller's rule, not the terrain's.
 * - the swimming and airborne ceilings. They belong to a mover with a vertical state; nothing on
 *   the server has one yet.
 *
 * `canEnter`'s footprint offset (`empreinte`, the collision disc sitting under the sprite's body)
 * is likewise the caller's: this function takes the point to test, not a point to adjust.
 */

import type { GroundVector, WorldPosition } from "@lindocara/engine/ground.js";
import { createColliderIndex } from "@lindocara/engine/hd2d/collider-index.js";
import { type MapData, mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import { PLAYER_SIZE } from "@lindocara/engine/simulation.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { ZoneTerrain } from "@lindocara/engine/zones.js";

export type { ZoneTerrain };

/**
 * The collision disc every server-simulated body is tested with, in tile units: half of the pixel
 * world's 32 px square body. A disc rather than a box because that is what `TerrainQuery` and
 * `ColliderIndex` answer for, and because a rotating box would have made the two disagree.
 *
 * One radius for players, monsters, guards and NPCs, exactly as `PLAYER_SIZE` was one size for all
 * four. `MONSTER_BODY_HITBOX` is a COMBAT body, not a navigation one, and stays out of this.
 */
export const BODY_RADIUS = PLAYER_SIZE / 2 / TILE_SIZE;

/**
 * Levels a grounded body may climb by walking, as a multiple of `levelHeight`. **Zero**, and that
 * is the game's rule rather than an unfinished value (see the spec): there is no grounded climbing
 * at all — high ground is reached by jumping. `apps/lab` runs the same 0, which is why its plateaus
 * need a jump.
 */
export const MAX_STEP = 0;

/**
 * Floating-point slack on every height comparison, carried over from `canEnter`. A body standing on
 * a cell is at exactly that cell's height in exact arithmetic and a hair above or below it in
 * practice; without the slack, walking along flat ground refuses itself at random.
 */
const HEIGHT_EPSILON = 1e-3;

/**
 * The highest ground a body standing on `groundY` may step onto. One expression rather than three:
 * `canStand`, `canStandOrEscape` and every caller asking "could this body reach that ground" must
 * agree, and `MAX_STEP * levelHeight + epsilon` written out at each site is three places to get a
 * sign or an epsilon wrong.
 */
export function standingCeiling(terrain: ZoneTerrain, groundY: number): number {
  return groundY + MAX_STEP * terrain.levelHeight + HEIGHT_EPSILON;
}

/**
 * The room's collision, built from the map's decoded heightfield. The query and the collider index
 * are the two halves `canStand` consults; the three scalars travel with them because the query
 * answers in world units and a caller comparing heights needs to know what a level is worth.
 */
export function zoneTerrainFromHeightfield(map: MapData): ZoneTerrain {
  const colliders = createColliderIndex();
  for (const rect of map.colliders) colliders.add(rect);
  return {
    query: createTerrainQuery(mapToQuerySource(map)),
    colliders,
    size: map.size,
    levelHeight: map.levelHeight,
    waterLevel: map.waterLevel,
  };
}

/**
 * Can a body of radius `radius`, whose last ground was at height `groundY`, stand at `(x, z)`?
 *
 * `x`/`z` are the GROUND axes and `groundY` is elevation — the axis convention this increment
 * turns on. Everything is tile units, grid centre as origin.
 */
export function canStand(
  terrain: ZoneTerrain,
  x: number,
  z: number,
  radius: number,
  groundY: number,
): boolean {
  const surface = terrain.query.heightAt(x, z);
  // `null` is water or off the grid. Neither is ground a server-simulated body may stand on.
  if (surface === null) return false;

  const ceiling = standingCeiling(terrain, groundY);
  // The ground under the CENTRE decides where a foot lands, and it is a hard rule in `canEnter`
  // too: relax it and a body climbs a cliff by leaning into it.
  if (surface > ceiling) return false;
  // Then the body's whole footprint, so a cliff stops it at its edge rather than at its middle.
  if (terrain.query.maxHeightAround(x, z, radius) > ceiling) return false;

  return !terrain.colliders.blocked(x, z, radius);
}

/**
 * The ground a body standing at `(x, z)` is on. `heightAt` is the whole answer; the fallback is
 * only for a body that is over water or off the grid, where there is no ground to read and the
 * elevation it already carries is the least wrong thing to keep.
 *
 * Every caller that moves a grounded body reads this BEFORE testing a destination, so `groundY` is
 * the ground actually underfoot rather than a value carried from wherever the body last was. That
 * is what "monsters read `heightAt` for the ground under them" means in practice, and it is also
 * what stops a body whose elevation drifted from being refused every move it makes.
 */
export function groundUnder(terrain: ZoneTerrain, x: number, z: number, fallback = 0): number {
  return terrain.query.heightAt(x, z) ?? fallback;
}

/**
 * `canStand`, plus the escape hatch its docblock hands to the caller.
 *
 * `canStand` is deliberately positional and therefore has no way to notice that the body is
 * ALREADY overlapping geometry — restored inside a plateau's disc, dropped there by a mobility
 * skill, or left there by a terrain edit. With no hatch such a body is refused every destination
 * in every direction and is cemented in place forever, with no diagnostic: it simply stops moving.
 * `canEnter` (`hd2d/hero-step.ts:87-88` and `:93`) carries exactly this, and this is its
 * server-side counterpart, written once for the three systems that move bodies rather than pasted
 * into each.
 *
 * The rule is "no worse, and never into the sea": a stuck body may move to a destination whose
 * relief is no higher than the relief it is already inside, and may leave a prop it is inside, but
 * may never step off the grid or into water — that would trade being stuck for drowning.
 */
export function canStandOrEscape(
  terrain: ZoneTerrain,
  from: GroundVector,
  x: number,
  z: number,
  radius: number,
  groundY: number,
): boolean {
  if (canStand(terrain, x, z, radius, groundY)) return true;
  // Not stuck: an ordinary refusal, which is the whole point of collision.
  if (canStand(terrain, from.x, from.z, radius, groundY)) return false;
  if (terrain.query.heightAt(x, z) === null) return false;
  const reliefHere = terrain.query.maxHeightAround(from.x, from.z, radius);
  const reliefThere = terrain.query.maxHeightAround(x, z, radius);
  if (reliefThere > reliefHere + HEIGHT_EPSILON) return false;
  return (
    !terrain.colliders.blocked(x, z, radius) || terrain.colliders.blocked(from.x, from.z, radius)
  );
}

/**
 * Samples along a segment, endpoints included, at a stride fine enough that no cell between them
 * is skipped. `count` is bounded so a caller cannot turn a long segment into an unbounded loop —
 * a tick budget is not a suggestion.
 */
function sampleSegment(
  from: GroundVector,
  to: GroundVector,
  stride: number,
  visit: (x: number, z: number) => boolean,
): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const steps = Math.min(512, Math.max(1, Math.ceil(length / Math.max(stride, 1e-3))));
  for (let index = 0; index <= steps; index++) {
    const ratio = index / steps;
    if (!visit(from.x + dx * ratio, from.z + dz * ratio)) return false;
  }
  return true;
}

/**
 * Can a strike or a shot reach from `from` to `to` — the heightfield's replacement for the pixel
 * `hasLineOfSight`, which asked the tile grid whether the centre-to-centre segment crossed a solid
 * cell.
 *
 * Relief is what blocks: a plateau standing between the two ends. Water does NOT block, because a
 * water cell is a surface below the shooter, not a wall — the same reading `canStand` takes. Props
 * do not block either, exactly as the pixel version consulted `tiles` and never `colliders`: an
 * arrow may pass over a tree's trunk collider.
 *
 * The ceiling is the HIGHER of the two ends' ground, so a monster on a plateau can strike down at
 * a hero below it and vice versa; only ground higher than both interrupts.
 */
export function groundLineOfSight(
  terrain: ZoneTerrain,
  from: GroundVector,
  to: GroundVector,
): boolean {
  const ceiling =
    Math.max(groundUnder(terrain, from.x, from.z), groundUnder(terrain, to.x, to.z)) +
    HEIGHT_EPSILON;
  return sampleSegment(from, to, 0.5, (x, z) => {
    const surface = terrain.query.heightAt(x, z);
    return surface === null || surface <= ceiling;
  });
}

/**
 * Can a body of `radius` walk the straight line from `from` to `to` without collision refusing it
 * anywhere along the way — the heightfield's replacement for `isPathWalkable`.
 *
 * Deliberately NOT `groundLineOfSight`, and for the reason `monster-system.ts` already records:
 * that check reads the two ends' centres and is right for deciding whether an already-resolved
 * attack shape has contact, and wrong for deciding whether a BODY can walk between them. A body
 * can clip a corner over a stretch too short for its centre line to ever cross it, and a monster
 * that keeps re-deciding "clear" near that corner ping-pongs there forever.
 *
 * `groundY` is re-read at every sample rather than carried from the start: a straight walk down a
 * slope of level tiers is legal even though `maxStep` is 0, because each step down re-grounds the
 * body. Carrying the start's `groundY` the whole way would refuse it.
 */
export function groundPathClear(
  terrain: ZoneTerrain,
  from: GroundVector,
  to: GroundVector,
  radius: number,
): boolean {
  return sampleSegment(from, to, Math.max(radius, 0.125), (x, z) =>
    canStand(terrain, x, z, radius, groundUnder(terrain, x, z)),
  );
}

/**
 * Axis-separated collision resolution, in tile units — the successor of `engine/game.ts`'s
 * `resolveTerrain`, and its behaviour rather than a fresh idea. Shared by every system that walks
 * a body across the ground: heroes, monsters, guards.
 *
 * The axis separation IS the wall slide: a body moving diagonally into a wall is refused on the
 * blocked axis and keeps the other, so it slides along the wall instead of stopping dead against
 * it. `stepHero` resolves the two axes one at a time for exactly the same reason
 * (`hd2d/hero-step.ts:242-247`); losing it here would be an invisible feel regression, because
 * nothing would fail — movement would simply turn sticky.
 *
 * Two differences from the pixel resolver, both deliberate:
 *
 * - the world-rectangle clamp is gone. A tile grid is centred on the origin, so a rectangle
 *   anchored at 0 would fence off its whole western and northern halves. `canStand` already
 *   refuses ground off the grid, and refuses the sea too, which the clamp never did.
 * - `groundY` is read from under the CANDIDATE point rather than carried from the start, so a body
 *   walks DOWN a tier freely (nothing on the server falls in this phase) and never UP: `MAX_STEP`
 *   is 0, and high ground is reached by jumping.
 */
export function resolveGroundMovement(
  terrain: ZoneTerrain,
  from: GroundVector,
  desired: GroundVector,
  radius = BODY_RADIUS,
): GroundVector {
  let x = from.x;
  let z = from.z;
  if (canStandOrEscape(terrain, from, desired.x, z, radius, groundUnder(terrain, desired.x, z))) {
    x = desired.x;
  }
  if (canStandOrEscape(terrain, from, x, desired.z, radius, groundUnder(terrain, x, desired.z))) {
    z = desired.z;
  }
  return { x, z };
}

/**
 * Where a body restored from storage actually enters the world — the tile-unit successor of
 * `clampRestoredPosition`, which lived in `engine/game.ts` because it needed a pixel
 * `TerrainGeometry` and a `spawnPoints` list. It lives here instead because the two things it now
 * needs are `canStand` and the map's authored spawn, and only the server has either.
 *
 * This is the FIRST line of defence against a cemented body, and the cheap one: a stored position
 * that is no longer standable — the map was re-authored, a plateau grew over it, the row predates
 * the units — never becomes a live hero at all. The escape hatch in `canStandOrEscape` is the
 * second line, for the body that gets there some other way.
 *
 * All three axes travel: the returned `y` is the ground the body lands on, never a value dropped
 * on the floor because `WorldPosition` happened to satisfy a two-axis type.
 */
export function restoreStandablePosition(
  terrain: ZoneTerrain | undefined,
  position: WorldPosition,
  spawn: GroundVector,
  radius = BODY_RADIUS,
): WorldPosition {
  const finite =
    Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
  if (!terrain) {
    // No room geometry to check against (the caller has none yet). Keep a finite position as it
    // is and fall back to the spawn otherwise; there is nothing here to validate it with.
    return finite ? { x: position.x, y: position.y, z: position.z } : { ...spawn, y: 0 };
  }
  if (
    finite &&
    canStand(terrain, position.x, position.z, radius, groundUnder(terrain, position.x, position.z))
  ) {
    return { x: position.x, y: groundUnder(terrain, position.x, position.z), z: position.z };
  }
  return { x: spawn.x, y: groundUnder(terrain, spawn.x, spawn.z), z: spawn.z };
}
