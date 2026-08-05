/**
 * Client-side prediction, as pure functions.
 *
 * The client moves its own square the instant a key is pressed, without waiting for the
 * server to agree. It records every command it sent. When a snapshot arrives, the server's
 * position is the truth — but that truth is stale by one round-trip, so it does not yet
 * account for the commands still in flight. Replaying those on top of it reproduces exactly
 * where the server *will* say the player is, which is where the client already drew them.
 *
 * This only works because the client and server run the same movement and terrain resolution
 * rules. That is the whole reason they live in `shared/`.
 */

import { type LifeState, speedForLife } from "./death.js";
import type { PlayerClass } from "./game.js";
import { groundOf, planarOf, type WorldPosition } from "./ground.js";
import type { Command } from "./protocol.js";
import { PLAYER_SPEED, step, TICK_DT } from "./simulation.js";
import {
  clampToGrid,
  groundUnder,
  resolveGroundMovement,
  type ZoneTerrain,
} from "./terrain-access.js";

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

/** A correction larger than this is a teleport, not a misprediction. Snap; do not glide.
 *  Tile units — the exact quotient of the former 96 px, so the threshold covers the same ground. */
export const SNAP_THRESHOLD = 96 / 64;

/** How long a small correction is smeared across, so it reads as drift rather than a pop. */
export const CORRECTION_SMOOTHING_MS = 100;

/** Discard commands the server has already applied; they are accounted for in its position. */
export function prunePending(pending: readonly Command[], ack: number): Command[] {
  return pending.filter((command) => command.seq > ack);
}

/**
 * `terrain` is required, not defaulted, on purpose: the one time it defaulted to Verdant Reach
 * (so a caller could "genuinely never leave it"), the only caller that ever relied on the
 * default was `client/game/net.ts` forgetting to pass it — silently, since a stray test with the
 * same gap kept compiling and passing. The welcome carries the room's own heightfield precisely so
 * a real caller can always bake the current room's `ZoneTerrain`; making it unrepresentable to
 * omit is what actually stops that mistake from shipping again.
 *
 * **This is the same three lines `movement-system.ts` runs on the server, through the same
 * functions**, which is the entire reason reconciliation converges: `step` for the intent,
 * `resolveGroundMovement` for the collision, `groundUnder` for the ground landed on. `clampToGrid`
 * replaces the resolution for a held Pas de Lumen, exactly as the server swaps it.
 *
 * `groundY` is read from where the body IS, never from under the destination — feeding the
 * candidate's own ground back in makes `canStand`'s ceiling test self-satisfying and predicts a
 * hero straight up a cliff the server will refuse (see `resolveGroundMovement`).
 */
export function predictStep(
  position: WorldPosition,
  command: Command,
  terrain: ZoneTerrain,
  speed: number = PLAYER_SPEED,
  lumenPhase = false,
): WorldPosition {
  const desired = groundOf(step(planarOf(position), command.input, TICK_DT, speed, null));
  const groundY = groundUnder(terrain, position.x, position.z, position.y);
  const moved = lumenPhase
    ? clampToGrid(terrain, desired)
    : resolveGroundMovement(terrain, position, desired, groundY);
  return { x: moved.x, y: groundUnder(terrain, moved.x, moved.z, position.y), z: moved.z };
}

/**
 * Where the player really is, given the server's last word and everything it has not seen yet.
 * Each pending command advanced the world by exactly one fixed tick, so replay uses TICK_DT.
 *
 * A ghost moves faster than the living, so replay has to know which you are — a replay at the
 * wrong speed is exactly the silent desync prediction exists to prevent. The server clears the
 * command queue on every life transition, so a batch of pending commands is never split across
 * two life states.
 */
export function reconcile(
  authoritative: WorldPosition,
  pending: readonly Command[],
  terrain: ZoneTerrain,
  life: LifeState = "alive",
  playerClass: PlayerClass = "warrior",
  movementSpeed?: number,
  lumenPhase = false,
): WorldPosition {
  const speed = speedForLife(life, playerClass, movementSpeed);
  let position: WorldPosition = authoritative;
  for (const command of pending) {
    position = predictStep(position, command, terrain, speed, lumenPhase);
  }
  return position;
}
