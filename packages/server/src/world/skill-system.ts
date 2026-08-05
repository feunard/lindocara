import {
  movementDirectionFromInput,
  normalizeGround,
} from "@lindocara/engine/directional-combat.js";
import { type GroundVector, groundDistance } from "@lindocara/engine/ground.js";
import type { Input } from "@lindocara/engine/simulation.js";
import {
  BODY_RADIUS,
  clampToGrid,
  groundUnder,
  resolveGroundMovement,
  type ZoneTerrain,
} from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { GroundIndexUpdate, PlayerRuntime } from "./world-runtime.js";

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
 * Resolves mobility skills in short segments; Pas de Lumen deliberately phases when allowed.
 *
 * The two resolutions are genuinely different questions, which is why they are not one call with a
 * flag any more:
 *
 * - the ordinary one is `resolveGroundMovement`, the same axis-separated resolver the walking hero
 *   uses, grounded on where the body IS. A charge slides along a wall rather than sticking to it,
 *   and — because `MAX_STEP` is 0 — cannot be used to climb a cliff.
 * - the phasing one (Pas de Lumen) ignores relief, water and props by design and is bounded only
 *   by the grid's edge, which is what `clampToGrid` is. Off the grid `heightAt` is `null` and there
 *   is no ground to rematerialise onto at all.
 *
 * `player.y` is re-read from the ground under the body after every accepted segment, exactly as
 * `movement-system.ts` does: it is the elevation axis, never a second ground axis.
 */
export function movePlayerInDirection(
  player: PlayerRuntime,
  direction: GroundVector,
  distance: number,
  terrain: ZoneTerrain,
  grid: GroundIndexUpdate<PlayerRuntime>,
  allowWater = false,
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
    const moved = allowWater
      ? clampToGrid(terrain, desired)
      : resolveGroundMovement(
          terrain,
          player,
          desired,
          groundUnder(terrain, player.x, player.z, player.y),
          BODY_RADIUS,
        );
    if (moved.x === player.x && moved.z === player.z) break;
    const previousPosition = { x: player.x, z: player.z };
    player.x = moved.x;
    player.z = moved.z;
    player.y = groundUnder(terrain, player.x, player.z, player.y);
    grid.update(player, previousPosition);
    movedAny = true;
    remaining -= stepDistance;
  }
  if (movedAny) player.dirty = true;
  return movedAny;
}
