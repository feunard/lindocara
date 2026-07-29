import type { PlayerRuntime } from "./world-runtime.js";

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
