import { TICK_DT } from "./simulation.js";

export const NPC_MOVE_SPEED_MIN = 0;
export const NPC_MOVE_SPEED_MAX = 5;
export const NPC_MOVE_FREQUENCY_MIN = 0;
export const NPC_MOVE_FREQUENCY_MAX = 4;

/** Shared cadence rule for authoritative authored-event movement. */
export function npcMovementIntervalTicks(moveSpeed: number, moveFrequency: number): number {
  const speed = Math.max(NPC_MOVE_SPEED_MIN, Math.min(NPC_MOVE_SPEED_MAX, moveSpeed));
  const frequency = Math.max(
    NPC_MOVE_FREQUENCY_MIN,
    Math.min(NPC_MOVE_FREQUENCY_MAX, moveFrequency),
  );
  return Math.max(6, 34 - frequency * 6 - Math.max(0, speed - 3) * 2);
}

/**
 * Visual travel time for one authoritative cell step. One tick of rest preserves the authored
 * cadence at low frequency instead of making every NPC look permanently in motion.
 */
export function npcMovementDurationMs(moveSpeed: number, moveFrequency: number): number {
  return Math.max(
    TICK_DT * 3 * 1_000,
    (npcMovementIntervalTicks(moveSpeed, moveFrequency) - 1) * TICK_DT * 1_000,
  );
}

export interface NpcMovementTween {
  col: number;
  row: number;
  moving: boolean;
  progress: number;
}

/** Sample a renderer-only tween between two authoritative event cells. */
export function sampleNpcMovementTween(
  from: { col: number; row: number },
  to: { col: number; row: number },
  startedAt: number,
  durationMs: number,
  now: number,
): NpcMovementTween {
  const duration = Math.max(1, durationMs);
  const progress = Math.max(0, Math.min(1, (now - startedAt) / duration));
  return {
    col: from.col + (to.col - from.col) * progress,
    row: from.row + (to.row - from.row) * progress,
    moving: progress < 1 && (from.col !== to.col || from.row !== to.row),
    progress,
  };
}
