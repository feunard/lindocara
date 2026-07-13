import type { TerrainGeometry } from "../../shared/game.js";
import { hasLineOfSight, pointDistance, resolveTerrain, withinRange } from "../../shared/game.js";
import type { Vec2 } from "../../shared/simulation.js";
import type { SpatialGrid } from "./spatial-grid.js";
import type { MonsterRuntime, PlayerRuntime } from "./world-runtime.js";

export function nearestMonster(
  player: PlayerRuntime,
  monsters: readonly MonsterRuntime[],
  range: number,
  now: number,
  terrain: TerrainGeometry,
): MonsterRuntime | undefined {
  let target: MonsterRuntime | undefined;
  let distance = range;
  for (const monster of monsters) {
    if (monster.deadUntil > now || !withinRange(player, monster, range)) continue;
    if (!hasLineOfSight(player, monster, terrain.obstacles)) continue;
    const candidate = pointDistance(player, monster);
    if (candidate <= distance) {
      target = monster;
      distance = candidate;
    }
  }
  return target;
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
