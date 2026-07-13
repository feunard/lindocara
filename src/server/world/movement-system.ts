import { canReclaim, speedForLife } from "../../shared/death.js";
import { resolveTerrain } from "../../shared/game.js";
import { regenerateResource } from "../../shared/resources.js";
import { NO_INPUT, step, TICK_DT } from "../../shared/simulation.js";
import type { ZoneDefinition } from "../../shared/zones.js";
import { PRESENCE_HEARTBEAT_MS } from "../character-presence.js";
import type { SpatialGrid } from "./spatial-grid.js";
import { MAX_STARVED_TICKS, type PlayerRuntime, toAttachment } from "./world-runtime.js";

export interface MovementSystemContext {
  players: Map<WebSocket, PlayerRuntime>;
  playerGrid: SpatialGrid<PlayerRuntime>;
  zone: ZoneDefinition;
  now: number;
  writeAttachment: boolean;
  writeD1: boolean;
  waitUntil(promise: Promise<unknown>): void;
  renewPresence(player: PlayerRuntime): Promise<void>;
  reclaimCorpse(socket: WebSocket, player: PlayerRuntime): void;
  collectLoot(socket: WebSocket, player: PlayerRuntime): void;
  savePlayer(player: PlayerRuntime, socket: WebSocket): Promise<boolean>;
}

/** Applies at most one queued command per player and performs movement-adjacent maintenance. */
export function advancePlayers(context: MovementSystemContext): void {
  for (const [socket, player] of context.players) {
    if (!player.authorized) continue;
    regenerateResource(player.class, player.resource, TICK_DT);
    if (context.now >= player.nextPresenceHeartbeatAt) {
      player.nextPresenceHeartbeatAt = context.now + PRESENCE_HEARTBEAT_MS;
      context.waitUntil(context.renewPresence(player));
    }
    if (player.life !== "corpse") {
      const command = player.queue.shift();
      if (command) {
        player.lastInput = command.input;
        const facingX = Number(command.input.right) - Number(command.input.left);
        const facingY = Number(command.input.down) - Number(command.input.up);
        if (facingX !== 0 || facingY !== 0) {
          const length = Math.hypot(facingX, facingY);
          player.facing = { x: facingX / length, y: facingY / length };
        }
        player.ack = command.seq;
        player.starvedTicks = 0;
      } else if (++player.starvedTicks > MAX_STARVED_TICKS) {
        player.lastInput = NO_INPUT;
      }

      const previousPosition = { x: player.x, y: player.y };
      const desired = step(
        player,
        player.lastInput,
        TICK_DT,
        speedForLife(player.life),
        context.zone.terrain,
      );
      const moved = resolveTerrain(player, desired, context.zone.terrain);
      if (moved.x !== player.x || moved.y !== player.y) {
        player.x = moved.x;
        player.y = moved.y;
        context.playerGrid.update(player, previousPosition);
        player.dirty = true;
      }
    }

    if (canReclaim(player.life, player, player.corpse)) context.reclaimCorpse(socket, player);
    context.collectLoot(socket, player);
    if (context.writeAttachment && player.dirty) socket.serializeAttachment(toAttachment(player));
    if (context.writeD1 && player.dirty) {
      context.waitUntil(context.savePlayer(player, socket));
      player.dirty = false;
    }
  }
}
