import { normalizeDirection } from "../../shared/directional-combat.js";
import type { TerrainGeometry } from "../../shared/game.js";
import { resolveTerrain } from "../../shared/game.js";
import type { Input, Vec2 } from "../../shared/simulation.js";
import type { SpatialGrid } from "./spatial-grid.js";
import type { PlayerRuntime } from "./world-runtime.js";

export interface ChargeCandidate extends Vec2 {
  id: string;
  deadUntil: number;
}

/** Current held movement, not historical facing. Null means a mobility cast stays in place. */
export function heldMovementDirection(input: Input): Vec2 | null {
  const direction = {
    x: Number(input.right) - Number(input.left),
    y: Number(input.down) - Number(input.up),
  };
  if (direction.x === 0 && direction.y === 0) return null;
  return normalizeDirection(direction);
}

/** Selects a deterministic living target without ever accepting a client-provided entity id. */
export function nearestChargeTarget<T extends ChargeCandidate>(
  origin: Vec2,
  candidates: Iterable<T>,
  maxRange: number,
  now: number,
  isVisible: (candidate: T) => boolean,
): T | null {
  let nearest: T | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.deadUntil > now || !isVisible(candidate)) continue;
    const distance = Math.hypot(candidate.x - origin.x, candidate.y - origin.y);
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

/** Resolves mobility skills in short segments so they cannot phase through colliders. */
export function movePlayerInDirection(
  player: PlayerRuntime,
  direction: Vec2,
  distance: number,
  terrain: TerrainGeometry,
  grid: SpatialGrid<PlayerRuntime>,
): boolean {
  const length = Math.hypot(direction.x, direction.y);
  if (length === 0 || distance <= 0) return false;
  const unit = { x: direction.x / length, y: direction.y / length };
  let remaining = distance;
  let movedAny = false;
  while (remaining > 0) {
    const stepDistance = Math.min(12, remaining);
    const moved = resolveTerrain(
      player,
      { x: player.x + unit.x * stepDistance, y: player.y + unit.y * stepDistance },
      terrain,
    );
    if (moved.x === player.x && moved.y === player.y) break;
    const previousPosition = { x: player.x, y: player.y };
    player.x = moved.x;
    player.y = moved.y;
    grid.update(player, previousPosition);
    movedAny = true;
    remaining -= stepDistance;
  }
  if (movedAny) player.dirty = true;
  return movedAny;
}
