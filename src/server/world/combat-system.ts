import type { TerrainGeometry } from "../../shared/game.js";
import { applyDamage, hasLineOfSight, withinRange } from "../../shared/game.js";
import type { MonsterRuntime, PlayerRuntime } from "./world-runtime.js";

export interface TargetSelection<T> {
  target: T | undefined;
  blockedInRange: boolean;
}

export function resolveAttackTarget(
  player: PlayerRuntime,
  monsters: readonly MonsterRuntime[],
  targetId: string,
  range: number,
  now: number,
  terrain: TerrainGeometry,
): TargetSelection<MonsterRuntime> {
  const target = monsters.find((monster) => monster.id === targetId && monster.deadUntil <= now);
  if (!target || !withinRange(player, target, range)) {
    return { target: undefined, blockedInRange: false };
  }
  if (!hasLineOfSight(player, target, terrain.tiles)) {
    return { target: undefined, blockedInRange: true };
  }
  return { target, blockedInRange: false };
}

export function guardedDamage(player: PlayerRuntime, damage: number, now: number) {
  const amount =
    player.guardUntil > now ? Math.max(1, Math.ceil(damage * (1 - player.guardReduction))) : damage;
  return { amount, result: applyDamage(player.hp, amount) };
}
