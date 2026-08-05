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

import { createColliderIndex } from "@lindocara/engine/hd2d/collider-index.js";
import { type MapData, mapToQuerySource } from "@lindocara/engine/hd2d/map-data.js";
import { createTerrainQuery } from "@lindocara/engine/hd2d/terrain-query.js";
import type { ZoneTerrain } from "@lindocara/engine/zones.js";

export type { ZoneTerrain };

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

  const ceiling = groundY + MAX_STEP * terrain.levelHeight + HEIGHT_EPSILON;
  // The ground under the CENTRE decides where a foot lands, and it is a hard rule in `canEnter`
  // too: relax it and a body climbs a cliff by leaning into it.
  if (surface > ceiling) return false;
  // Then the body's whole footprint, so a cliff stops it at its edge rather than at its middle.
  if (terrain.query.maxHeightAround(x, z, radius) > ceiling) return false;

  return !terrain.colliders.blocked(x, z, radius);
}
