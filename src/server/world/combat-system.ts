import type { TerrainGeometry } from "../../shared/game.js";
import { applyDamage, hasLineOfSight, pointDistance, withinRange } from "../../shared/game.js";
import type { MonsterRuntime, PlayerRuntime } from "./world-runtime.js";

export interface TargetSelection<T> {
  target: T | undefined;
  blockedInRange: boolean;
}

export function selectAttackTarget(
  player: PlayerRuntime,
  monsters: readonly MonsterRuntime[],
  range: number,
  now: number,
  terrain: TerrainGeometry,
): TargetSelection<MonsterRuntime> {
  let target: MonsterRuntime | undefined;
  let distance = range;
  let blockedInRange = false;
  for (const monster of monsters) {
    if (monster.deadUntil > now) continue;
    const candidate = pointDistance(player, monster);
    if (!withinRange(player, monster, range)) continue;
    if (!hasLineOfSight(player, monster, terrain.tiles)) {
      blockedInRange = true;
      continue;
    }
    if (candidate <= distance) {
      target = monster;
      distance = candidate;
    }
  }
  return { target, blockedInRange };
}

export function guardedDamage(player: PlayerRuntime, damage: number, now: number) {
  const amount =
    player.guardUntil > now ? Math.max(1, Math.ceil(damage * (1 - player.guardReduction))) : damage;
  return { amount, result: applyDamage(player.hp, amount) };
}
