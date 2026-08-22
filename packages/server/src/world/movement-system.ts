import { canReclaim } from "@lindocara/engine/death.js";
import { regenerateResource } from "@lindocara/engine/resources.js";
import { TICK_DT } from "@lindocara/engine/simulation.js";

import { type PlayerRuntime, toAttachment } from "./world-runtime.js";

/**
 * Generic over the socket key (`TSocket`) so both hosts can drive it: the legacy Durable Object
 * keys players by real workerd `WebSocket`s (the default), while the Alepha `$room` host
 * (`src/api/realtime/WorldRoom.ts`) keys them by connection-id string — the room abstraction never
 * exposes a raw socket. The system itself only ever treats the key as an opaque map key and
 * callback argument, except for the one attachment write below (see its cast).
 */
export interface MovementSystemContext<TSocket = WebSocket> {
  players: Map<TSocket, PlayerRuntime>;
  now: number;
  /** The room's lease heartbeat interval. Owned by `World`, which reads it once from `Env`. */
  presenceHeartbeatMs: number;
  writeAttachment: boolean;
  writeD1: boolean;
  waitUntil(promise: Promise<unknown>): void;
  renewPresence(player: PlayerRuntime): Promise<void>;
  reclaimCorpse(socket: TSocket, player: PlayerRuntime): void;
  collectLoot(socket: TSocket, player: PlayerRuntime): void;
  savePlayer(player: PlayerRuntime, socket: TSocket): Promise<boolean>;
}

/**
 * Every per-player duty the tick owes, **except moving anyone**.
 *
 * The movement branch retired here: the hero's movement rule (`stepHero`) runs on the client, which
 * reports the position it computed (`MoveMessage`), and `WorldRoom.dispatch` stores it as it
 * arrives rather than the tick recomputing one (see the S3 spec, decision 4). With it went the
 * command queue, the one-command-per-tick rule and `MAX_STARVED_TICKS`' repeat-the-last-intent
 * branch — there is no last intent to repeat when a client sends positions.
 *
 * What did NOT go, and is the whole reason this function still exists: class-resource regeneration,
 * the presence-lease heartbeat, corpse reclaim, loot collection, the attachment write and the dirty
 * flush. Each is on the same per-player beat as the movement it used to sit beside, and none of
 * them was ever about where a hero is.
 *
 * `onPlayerMoved` left with the movement branch: the choreography it carried (harvest cancellation,
 * `player-touch` detection, sacred passage, the Lumen gate) now runs in `applyReportedMove`
 * (`worldTick.ts`), where a client-owned hero's position actually changes.
 */
export function advancePlayers<TSocket>(context: MovementSystemContext<TSocket>): void {
  for (const [socket, player] of context.players) {
    if (!player.authorized) continue;
    const resourceBefore = player.resource?.current;
    regenerateResource(player.class, player.resource, TICK_DT);
    if (resourceBefore !== undefined && player.resource?.current !== resourceBefore) {
      player.dirty = true;
    }
    if (context.now >= player.nextPresenceHeartbeatAt) {
      player.nextPresenceHeartbeatAt = context.now + context.presenceHeartbeatMs;
      context.waitUntil(context.renewPresence(player));
    }

    if (canReclaim(player.life, player, player.corpse)) context.reclaimCorpse(socket, player);
    context.collectLoot(socket, player);
    if (context.writeAttachment && (player.dirty || player.resource)) {
      // Only the Durable Object host sets `writeAttachment` — its `TSocket` IS a workerd
      // WebSocket, the one key type carrying `serializeAttachment`. The Alepha room host keys by
      // connection-id string and always passes `writeAttachment: false` (rooms have no attachment
      // concept), so this narrowing is never reached with a non-socket key.
      (socket as unknown as { serializeAttachment(value: unknown): void }).serializeAttachment(
        toAttachment(player),
      );
    }
    if (context.writeD1 && player.dirty) {
      context.waitUntil(context.savePlayer(player, socket));
      player.dirty = false;
    }
  }
}
