/**
 * The terrain junction: a stored heightfield becomes a room's `ZoneTerrain`, and every "can
 * something stand here" question becomes exactly one call to `canStand`.
 *
 * **It lives in `engine`, not in `server`, for the same reason `step()` does.** Task 4 wrote it
 * under `packages/server/src/world/` because only the server collided against anything; the client
 * predicts its own hero against the terrain the welcome carries, so both sides now ask this
 * question and there must be exactly one function answering it. Two hand-synchronised copies of a
 * collision rule is precisely the drift client-side prediction exists to expose. Nothing in here
 * touches the DOM, Workers or Node — it was already pure, which is why the move cost no
 * dependency.
 *
 * `canStand` mirrors `canEnter` (`./hd2d/hero-step.ts`), the rule `apps/lab` has
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

import { type SegmentImpact, segmentBoxEntry, sweptRectEntry } from "./directional-combat.js";
import type { GroundVector, WorldPosition } from "./ground.js";
import { createColliderIndex } from "./hd2d/collider-index.js";
import { type MapData, mapToQuerySource } from "./hd2d/map-data.js";
import { createTerrainQuery } from "./hd2d/terrain-query.js";
import { PLAYER_SIZE } from "./simulation.js";
import { TILE_SIZE } from "./tilemap.js";
import type { ZoneTerrain } from "./zones.js";

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
 *
 * `groundY` is the ground under the body NOW (see `resolveGroundMovement`), so the "is it stuck?"
 * test below can only ever fail on the disc's relief or on a prop — the centre clause is
 * necessarily satisfied where the body is already standing. That is not a weakness of the test,
 * it is what "stuck" means, and it is exactly the pair of conditions `canEnter`'s two hatches
 * examine (`hd2d/hero-step.ts:87-88`, `:93`).
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
 * The ground is CARRIED FORWARD along the walk, not re-read from under each sample: it starts at
 * `groundY` and drops to whatever the body just stepped onto. Re-reading it at each sample would
 * make `canStand`'s centre test self-satisfying (see `resolveGroundMovement`) and this function
 * would happily report a straight line up a cliff as walkable. Descending still works, because a
 * step down re-grounds the body at the lower tier before the next sample is tested.
 */
export function groundPathClear(
  terrain: ZoneTerrain,
  from: GroundVector,
  to: GroundVector,
  radius: number,
  groundY: number,
): boolean {
  let carried = groundY;
  return sampleSegment(from, to, Math.max(radius, 0.125), (x, z) => {
    if (!canStand(terrain, x, z, radius, carried)) return false;
    carried = groundUnder(terrain, x, z, carried);
    return true;
  });
}

/**
 * The heightfield successor of `sweptProjectileTerrainImpact` — the terrain question a projectile
 * asks, moved off the pixel `TileMap` and onto the relief plus the tile-unit collider index.
 *
 * **It is still a SWEEP, and that is the whole point.** A projectile travels up to
 * `speed * TICK_DT` in one tick — a Heartseeker covers nearly eleven tiles a second, half a tile a
 * tick — so an endpoint test, or a walk of samples along the path, would let it pass clean through
 * a one-cell cliff or a tree trunk narrower than its stride. Every candidate here is tested with
 * the exact slab entry `segmentBoxEntry`, the same routine the pixel version used and the same one
 * `segmentIntersectsRect` uses, so the earliest contact along the segment is found regardless of
 * how far the projectile moved.
 *
 * What blocks:
 *
 * - RELIEF above `ceiling` — the flight height, which is the shooter's own ground. A projectile
 *   fired on a plateau clears everything at or below that plateau and is stopped by anything
 *   higher; one fired below it is stopped by the plateau's face. This is `groundLineOfSight`'s
 *   rule, applied to a body with a radius.
 * - the map's sub-cell COLLIDERS — a tree's trunk, exactly as the pixel version consulted its own
 *   collider index.
 *
 * What does not: water and the ground off the grid. `heightAt` answers `null` for both, and both
 * are surfaces BELOW the shot rather than walls — an arrow flies over a lake, and one that leaves
 * the map dies of range, not of a wall at the edge.
 */
export function sweptGroundTerrainImpact(
  terrain: ZoneTerrain,
  from: GroundVector,
  to: GroundVector,
  radius: number,
  ceiling: number,
): SegmentImpact | null {
  if (!Number.isFinite(from.x) || !Number.isFinite(from.z)) return null;
  if (!Number.isFinite(to.x) || !Number.isFinite(to.z)) return null;
  if (!Number.isFinite(radius) || radius < 0) return null;

  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const half = terrain.size / 2;
  const toCell = (world: number) => Math.floor(world + half);
  const limit = ceiling + HEIGHT_EPSILON;

  const hits: SegmentImpact[] = [];
  const consider = (fraction: number | null, id: string) => {
    if (fraction === null) return;
    hits.push({
      fraction,
      point: { x: from.x + dx * fraction, z: from.z + dz * fraction },
      kind: "terrain",
      id,
    });
  };

  const minI = toCell(Math.min(from.x, to.x) - radius);
  const maxI = toCell(Math.max(from.x, to.x) + radius);
  const minJ = toCell(Math.min(from.z, to.z) - radius);
  const maxJ = toCell(Math.max(from.z, to.z) + radius);
  for (let j = minJ; j <= maxJ; j++) {
    for (let i = minI; i <= maxI; i++) {
      const [centreX, centreZ] = terrain.query.cellCenter(i, j);
      const surface = terrain.query.heightAt(centreX, centreZ);
      if (surface === null || surface <= limit) continue;
      consider(
        segmentBoxEntry(
          from.x,
          from.z,
          dx,
          dz,
          i - half - radius,
          j - half - radius,
          i + 1 - half + radius,
          j + 1 - half + radius,
        ),
        `${j}:${i}`,
      );
    }
  }

  const candidates = terrain.colliders.inBox(
    Math.min(from.x, to.x) - radius,
    Math.min(from.z, to.z) - radius,
    Math.max(from.x, to.x) + radius,
    Math.max(from.z, to.z) + radius,
  );
  for (let index = 0; index < candidates.length; index++) {
    const rect = candidates[index];
    if (!rect) continue;
    consider(sweptRectEntry(from, to, rect, radius), `c${index}`);
  }
  // Earliest contact wins; equal fractions fall back to the stable id so two cells met at exactly
  // the same instant resolve the same way on every tick and in every room.
  hits.sort((a, b) => a.fraction - b.fraction || a.id.localeCompare(b.id));
  return hits[0] ?? null;
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
 * **`groundY` is the ground under the body NOW, and passing the candidate's own ground instead is
 * a cliff-climbing bug that hides.** `canStand`'s centre test is `heightAt(candidate) > groundY +
 * MAX_STEP * levelHeight + ε`; feed it `heightAt(candidate)` as `groundY` and the comparison is
 * self-satisfying and can never fail, leaving only the disc test to refuse anything. That happens
 * to hold for a walking hero — one tick of travel (0.203 tiles) is shorter than the body's radius
 * (0.25), so the disc bites the cliff before the centre reaches it — and that is a coincidence of
 * two unrelated numbers, not a rule: a ghost moves 0.264 tiles a tick and climbs, and any
 * knockback of a quarter tile or more climbs deterministically. `canEnter` reads `state.groundY`
 * (`hd2d/hero-step.ts:71`,`:82`) for precisely this reason.
 *
 * Two differences from the pixel resolver, both deliberate:
 *
 * - the world-rectangle clamp is gone. A tile grid is centred on the origin, so a rectangle
 *   anchored at 0 would fence off its whole western and northern halves. `canStand` already
 *   refuses ground off the grid, and refuses the sea too, which the clamp never did.
 * - a body walks DOWN a tier freely (nothing on the server falls in this phase) and never UP:
 *   `MAX_STEP` is 0, and high ground is reached by jumping. Descending works because the caller
 *   re-reads `groundY` from under the body after each accepted move.
 */
export function resolveGroundMovement(
  terrain: ZoneTerrain,
  from: GroundVector,
  desired: GroundVector,
  groundY: number,
  radius = BODY_RADIUS,
): GroundVector {
  let x = from.x;
  let z = from.z;
  if (canStandOrEscape(terrain, from, desired.x, z, radius, groundY)) x = desired.x;
  if (canStandOrEscape(terrain, from, x, desired.z, radius, groundY)) z = desired.z;
  return { x, z };
}

/**
 * Keeps a point inside the grid without asking anything else of it — the tile-unit successor of
 * `resolveTerrainForLumen`'s `clampToWorld`, and the only bound a terrain-ignoring traversal still
 * has. Relief, water and props are deliberately not consulted; the grid's edge is, because off it
 * `heightAt` is `null` and there is no ground to come back to.
 */
export function clampToGrid(terrain: ZoneTerrain, point: GroundVector): GroundVector {
  const half = terrain.size / 2;
  const bound = (value: number) => Math.min(half - 1e-3, Math.max(-half, value));
  return { x: bound(point.x), z: bound(point.z) };
}

/**
 * The nearest cell centre a body could stand on — the tile-unit successor of
 * `engine/game.ts`'s `nearestLumenLanding`, used when a terrain-ignoring traversal (Pas de Lumen)
 * has to rematerialise somewhere real.
 *
 * `accepts` is the server's seam for live bodies (players, monsters, guards, NPCs), which the
 * terrain cannot know about, exactly as before. `groundY` is the level the body may land on:
 * `MAX_STEP` is 0, so a phased traversal cannot end on top of a plateau it could not have walked
 * onto — the skill crosses relief, it does not climb it.
 *
 * Cell CENTRES, not corners: a tile-unit position is a body's centre, and the pixel version's
 * `col * TILE_SIZE` was a top-left corner. Landing on a corner would put half the body in the
 * neighbouring cell.
 */
export function nearestStandableCell(
  terrain: ZoneTerrain,
  position: GroundVector,
  radius: number,
  groundY: number,
  accepts: (candidate: GroundVector) => boolean = () => true,
): WorldPosition | null {
  let nearest: WorldPosition | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let j = 0; j < terrain.size; j++) {
    for (let i = 0; i < terrain.size; i++) {
      const [x, z] = terrain.query.cellCenter(i, j);
      if (!canStand(terrain, x, z, radius, groundY)) continue;
      if (!accepts({ x, z })) continue;
      const distance = Math.hypot(position.x - x, position.z - z);
      if (distance >= bestDistance) continue;
      nearest = { x, y: groundUnder(terrain, x, z, groundY), z };
      bestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Where a hero enters a map: its first authored spawn if a body fits there, otherwise the standable
 * cell nearest to it (or, with no authored spawn at all, nearest the grid's centre).
 *
 * The fallback is not decoration. The wire-and-storage task resets every stored hero position to
 * `0,0,0`, and `0,0,0` is the grid CENTRE — which on an island heightfield is as likely to be open
 * sea as land. Without a search, `restoreStandablePosition` would hand back the unchecked spawn and
 * seat the hero in the water, looking correct to every test that only asserts a position came back.
 *
 * Each candidate is grounded on ITSELF, which would be a cliff-climbing bug in
 * `resolveGroundMovement` and is the right question here for the same reason
 * `restoreStandablePosition` grounds its own: nobody is stepping anywhere. The question is "could a
 * body be standing here", so the ground under it is by definition the ground it stands on, and only
 * the disc's relief and the props may refuse it.
 */
export function mapEntryPosition(terrain: ZoneTerrain, authored?: GroundVector): WorldPosition {
  const near: GroundVector = authored ?? { x: 0, z: 0 };
  const standable = (x: number, z: number) =>
    canStand(terrain, x, z, BODY_RADIUS, groundUnder(terrain, x, z));
  if (standable(near.x, near.z)) {
    return { x: near.x, y: groundUnder(terrain, near.x, near.z), z: near.z };
  }
  let nearest: WorldPosition | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let j = 0; j < terrain.size; j++) {
    for (let i = 0; i < terrain.size; i++) {
      const [x, z] = terrain.query.cellCenter(i, j);
      if (!standable(x, z)) continue;
      const distance = Math.hypot(near.x - x, near.z - z);
      if (distance >= bestDistance) continue;
      bestDistance = distance;
      nearest = { x, y: groundUnder(terrain, x, z), z };
    }
  }
  // A grid with nowhere at all to stand is a map that cannot be played; the authored point is then
  // the least arbitrary answer left, and it is wrong by construction rather than by oversight.
  return nearest ?? { x: near.x, y: 0, z: near.z };
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
 *
 * This one DOES ground the candidate on its own terrain, unlike `resolveGroundMovement`, and that
 * is the right question here rather than the bug it would be there: nobody is stepping anywhere.
 * The question is "is this a place a body could be standing", so the ground under it is by
 * definition the ground it stands on, and only the disc's relief and the props can refuse it.
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
