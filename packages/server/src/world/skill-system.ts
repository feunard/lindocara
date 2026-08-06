import {
  movementDirectionFromInput,
  normalizeGround,
} from "@lindocara/engine/directional-combat.js";
import { type GroundVector, groundDistance } from "@lindocara/engine/ground.js";
import type { Input } from "@lindocara/engine/simulation.js";
import {
  BODY_RADIUS,
  groundUnder,
  resolveGroundMovement,
  type ZoneTerrain,
} from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { displacePlayer, type GroundIndexUpdate, type PlayerRuntime } from "./world-runtime.js";

export interface ChargeCandidate extends GroundVector {
  id: string;
  deadUntil: number;
}

/** Current held movement, not historical facing. Null means a mobility cast stays in place. */
export function heldMovementDirection(input: Input): GroundVector | null {
  const direction = movementDirectionFromInput(input);
  if (direction.x === 0 && direction.z === 0) return null;
  return normalizeGround(direction);
}

/** Selects a deterministic living target without ever accepting a client-provided entity id. */
export function nearestChargeTarget<T extends ChargeCandidate>(
  origin: GroundVector,
  candidates: Iterable<T>,
  maxRange: number,
  now: number,
  isVisible: (candidate: T) => boolean,
): T | null {
  let nearest: T | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.deadUntil > now || !isVisible(candidate)) continue;
    const distance = groundDistance(candidate, origin);
    if (distance > maxRange) continue;
    if (
      distance < nearestDistance ||
      (distance === nearestDistance &&
        nearest !== null &&
        candidate.id.localeCompare(nearest.id) < 0)
    ) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * How far one segment of a mobility skill advances before collision is consulted again. It was
 * 12 px; the tile-unit value is the same distance, and it must stay well under `BODY_RADIUS` so a
 * charge cannot step over an obstacle thinner than the body that is charging.
 */
const MOBILITY_SEGMENT = 12 / TILE_SIZE;

/**
 * Resolves a server-authored mobility displacement in short segments.
 *
 * One resolution, `resolveGroundMovement` — the same axis-separated resolver the walking hero uses,
 * grounded on where the body IS. A charge slides along a wall rather than sticking to it and,
 * because `MAX_STEP` is 0, cannot be used to climb a cliff.
 *
 * **The phasing arm is gone with its caller.** It existed for Pas de Lumen's held traversal, which
 * the CLIENT now performs (the S3 spec, decision 6): `createHeroController`'s `phase`
 * (`packages/client/src/game/hero-controller.ts`) is its successor, ignoring relief, water and
 * props exactly the same way and bounded by the same `clampToGrid`. Keeping an unreachable copy
 * here would read as the live rule to the next agent that opens this file.
 *
 * `player.y` is re-read from the ground under the body after every accepted segment: it is the
 * elevation axis, never a second ground axis.
 */
export function movePlayerInDirection(
  player: PlayerRuntime,
  direction: GroundVector,
  distance: number,
  terrain: ZoneTerrain,
  grid: GroundIndexUpdate<PlayerRuntime>,
): boolean {
  const length = Math.hypot(direction.x, direction.z);
  if (length === 0 || distance <= 0) return false;
  const unit = { x: direction.x / length, z: direction.z / length };
  let remaining = distance;
  let movedAny = false;
  while (remaining > 0) {
    const stepDistance = Math.min(MOBILITY_SEGMENT, remaining);
    const desired = {
      x: player.x + unit.x * stepDistance,
      z: player.z + unit.z * stepDistance,
    };
    const moved = resolveGroundMovement(
      terrain,
      player,
      desired,
      groundUnder(terrain, player.x, player.z, player.y),
      BODY_RADIUS,
    );
    if (moved.x === player.x && moved.z === player.z) break;
    const previousPosition = { x: player.x, z: player.z };
    // One segment, one stamp. The counter is monotone and only its final value is ever announced —
    // no snapshot leaves the room between two iterations of this loop — so a charge that resolves in
    // twelve segments costs the client exactly one adoption, of the point it actually stopped at.
    displacePlayer(player, {
      x: moved.x,
      y: groundUnder(terrain, moved.x, moved.z, player.y),
      z: moved.z,
    });
    grid.update(player, previousPosition);
    movedAny = true;
    remaining -= stepDistance;
  }
  return movedAny;
}
