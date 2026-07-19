import { applyDamage } from "../../shared/game.js";
import type { PlayerRuntime } from "./world-runtime.js";

/** The cloud is intangible only after fade-out and before authoritative rematerialization. */
export function isLumenCloudInvulnerable(player: PlayerRuntime, now: number): boolean {
  const action = player.action;
  return Boolean(
    action?.skillId === "blink" &&
      action.channelMaxEndsAt !== undefined &&
      action.channelEndsAt === undefined &&
      now >= action.impactAt &&
      now < action.channelMaxEndsAt,
  );
}

/** Every authoritative damage path asks this single predicate before mutating HP. */
export function isPlayerInvulnerable(player: PlayerRuntime, now: number): boolean {
  return player.cheatInvulnerable || isLumenCloudInvulnerable(player, now);
}

export function guardedDamage(player: PlayerRuntime, damage: number) {
  const amount = player.guarding
    ? Math.max(1, Math.ceil(damage * (1 - player.guardReduction)))
    : damage;
  return { amount, result: applyDamage(player.hp, amount) };
}
