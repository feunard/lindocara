import { applyDamage } from "../../shared/game.js";
import type { PlayerRuntime } from "./world-runtime.js";

export function guardedDamage(player: PlayerRuntime, damage: number, now: number) {
  const amount =
    player.guardUntil > now ? Math.max(1, Math.ceil(damage * (1 - player.guardReduction))) : damage;
  return { amount, result: applyDamage(player.hp, amount) };
}
