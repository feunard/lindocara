import { applyDamage } from "../../shared/game.js";
import { talentEffect } from "../../shared/talents.js";
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
  const dashInvulnerability = talentEffect(player.class, player.talents, "dash_invulnerability", 4);
  const dashing = Boolean(
    dashInvulnerability &&
      player.action?.skillId === "dash" &&
      now >= player.action.impactAt &&
      now < player.action.recoveryEndsAt,
  );
  return player.cheatInvulnerable || dashing || isLumenCloudInvulnerable(player, now);
}

export function guardedDamage(player: PlayerRuntime, damage: number, now = Date.now()) {
  const parry = talentEffect(player.class, player.talents, "perfect_parry", 2);
  const perfectParry = Boolean(
    player.guarding &&
      parry &&
      player.guardActivatedAt > 0 &&
      now >= player.guardActivatedAt &&
      now - player.guardActivatedAt <= parry.windowMs,
  );
  if (perfectParry) {
    const retaliation = talentEffect(player.class, player.talents, "perfect_retaliation", 2);
    return {
      amount: 0,
      result: applyDamage(player.hp, 0),
      parried: true,
      retaliationRatio: retaliation?.ratio ?? 0,
    };
  }
  const amount = player.guarding
    ? Math.max(1, Math.ceil(damage * (1 - player.guardReduction)))
    : damage;
  return { amount, result: applyDamage(player.hp, amount), parried: false, retaliationRatio: 0 };
}
