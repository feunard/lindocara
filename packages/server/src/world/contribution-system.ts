import type { MonsterRuntime } from "./world-runtime.js";

/** Atomically marks this in-memory monster death as rewarded within its authoritative room. */
export function beginRewardAttribution(monster: MonsterRuntime): boolean {
  if (monster.rewardsGranted) return false;
  monster.rewardsGranted = true;
  return true;
}

export function clearMonsterCombat(monster: MonsterRuntime): void {
  monster.threat.clear();
  monster.contributions.clear();
}

export function removePlayerCombatState(
  monsters: readonly MonsterRuntime[],
  playerId: string,
): void {
  for (const monster of monsters) {
    monster.threat.delete(playerId);
    monster.contributions.delete(playerId);
  }
}
