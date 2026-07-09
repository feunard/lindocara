/**
 * Client-side prediction, as pure functions.
 *
 * The client moves its own square the instant a key is pressed, without waiting for the
 * server to agree. It records every command it sent. When a snapshot arrives, the server's
 * position is the truth — but that truth is stale by one round-trip, so it does not yet
 * account for the commands still in flight. Replaying those on top of it reproduces exactly
 * where the server *will* say the player is, which is where the client already drew them.
 *
 * This only works because `step()` here is byte-for-byte the same function the Durable Object
 * runs. That is the whole reason it lives in `shared/`.
 */

import type { Command } from "./protocol.js";
import { step, TICK_DT, type Vec2 } from "./simulation.js";

/**
 * A frame can be arbitrarily long — a backgrounded tab resumes with a multi-second delta.
 * Without a ceiling the client would emit hundreds of commands at once, overrun the server's
 * queue, and desync. Cap the catch-up at five ticks.
 */
export const MAX_ACCUMULATED_SECONDS = 5 * TICK_DT;

/**
 * If this many commands go unacknowledged the server is not applying them — a flood, a stall,
 * a dropped connection. Replaying an ever-growing list would drift further from truth every
 * frame, so the client gives up predicting and snaps to the server.
 */
export const MAX_PENDING_COMMANDS = 40;

/** A correction larger than this is a teleport, not a misprediction. Snap; do not glide. */
export const SNAP_THRESHOLD_PX = 96;

/** How long a small correction is smeared across, so it reads as drift rather than a pop. */
export const CORRECTION_SMOOTHING_MS = 100;

/** Discard commands the server has already applied; they are accounted for in its position. */
export function prunePending(pending: readonly Command[], ack: number): Command[] {
  return pending.filter((command) => command.seq > ack);
}

/**
 * Where the player really is, given the server's last word and everything it has not seen yet.
 * Each pending command advanced the world by exactly one fixed tick, so replay uses TICK_DT.
 */
export function reconcile(authoritative: Vec2, pending: readonly Command[]): Vec2 {
  let position: Vec2 = authoritative;
  for (const command of pending) {
    position = step(position, command.input, TICK_DT);
  }
  return position;
}
