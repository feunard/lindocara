import { ROGUE_BALANCE } from "@lindocara/engine/rogue.js";
import type { PlayerRuntime } from "./world-runtime.js";

/**
 * Grants one bounded Opening window. A second source replaces the first instead of stacking its
 * multiplier; this also makes refresh semantics explicit for every future Rogue evolution.
 */
export function grantRogueOpening(
  player: PlayerRuntime,
  source: NonNullable<PlayerRuntime["opening"]>["source"],
  now: number,
  bonusRatio = ROGUE_BALANCE.opening.bonusRatio,
): void {
  player.opening = {
    source,
    expiresAt: now + ROGUE_BALANCE.opening.durationMs,
    bonusRatio: Math.max(0, bonusRatio),
  };
  player.dirty = true;
}

/** Returns the live window without consuming it, clearing a stale runtime object on the way. */
export function activeRogueOpening(
  player: PlayerRuntime,
  now: number,
): NonNullable<PlayerRuntime["opening"]> | null {
  if (!player.opening) return null;
  if (player.opening.expiresAt > now) return player.opening;
  player.opening = null;
  player.dirty = true;
  return null;
}

/**
 * Consumes Opening only when the caller has already established a real authoritative hit. Merely
 * starting an attack, playing two dagger frames, or missing an arc never reaches this boundary.
 */
export function consumeRogueOpening(
  player: PlayerRuntime,
  now: number,
): NonNullable<PlayerRuntime["opening"]> | null {
  const opening = activeRogueOpening(player, now);
  if (!opening) return null;
  player.opening = null;
  player.dirty = true;
  return opening;
}

/** Tick cleanup keeps expired windows out of room memory; the client already owns the deadline. */
export function expireRogueOpening(player: PlayerRuntime, now: number): boolean {
  const hadOpening = player.opening !== null;
  activeRogueOpening(player, now);
  return hadOpening && player.opening === null;
}

/**
 * Rogue combat windows are deliberately session-local. This single reset boundary is reused by
 * death, disconnect and map transition so no caller can forget one of the related states.
 */
export function clearRogueTransientState(player: PlayerRuntime): void {
  player.opening = null;
  player.rogueStealthUntil = 0;
  player.rogueSmokeProtectionUntil = 0;
  player.roguePredatorShivUntil = 0;
  player.rogueShadowReturn = null;
}
