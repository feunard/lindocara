import { canReclaim, speedForLife } from "../../shared/death.js";
import { orientationFromMovement } from "../../shared/directional-combat.js";
import { resolveTerrain } from "../../shared/game.js";
import { regenerateResource } from "../../shared/resources.js";
import { NO_INPUT, step, TICK_DT } from "../../shared/simulation.js";
import type { ZoneDefinition } from "../../shared/zones.js";
import type { SpatialGrid } from "./spatial-grid.js";
import { MAX_STARVED_TICKS, type PlayerRuntime, toAttachment } from "./world-runtime.js";

export interface MovementSystemContext {
  players: Map<WebSocket, PlayerRuntime>;
  playerGrid: SpatialGrid<PlayerRuntime>;
  zone: ZoneDefinition;
  now: number;
  /** The room's lease heartbeat interval. Owned by `World`, which reads it once from `Env`. */
  presenceHeartbeatMs: number;
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
    const resourceBefore = player.resource?.current;
    regenerateResource(player.class, player.resource, TICK_DT);
    if (resourceBefore !== undefined && player.resource?.current !== resourceBefore) {
      player.dirty = true;
    }
    if (context.now >= player.nextPresenceHeartbeatAt) {
      player.nextPresenceHeartbeatAt = context.now + context.presenceHeartbeatMs;
      context.waitUntil(context.renewPresence(player));
    }
    if (player.life !== "corpse") {
      const command = player.queue.shift();
      if (command) {
        player.lastInput = command.input;
        player.facing = orientationFromMovement(
          {
            x: Number(command.input.right) - Number(command.input.left),
            y: Number(command.input.down) - Number(command.input.up),
          },
          player.facing,
        );
        player.ack = command.seq;
        player.starvedTicks = 0;
      } else if (++player.starvedTicks > MAX_STARVED_TICKS) {
        player.lastInput = NO_INPUT;
      }

      const previousPosition = { x: player.x, y: player.y };
      let desired = step(
        player,
        player.lastInput,
        TICK_DT,
        speedForLife(player.life),
        context.zone.terrain,
      );
      const heldBlink =
        player.action?.skillId === "blink" &&
        player.action.channelMaxEndsAt !== undefined &&
        player.action.channelEndsAt === undefined
          ? player.action
          : null;
      const desiredDistance = Math.hypot(desired.x - player.x, desired.y - player.y);
      if (
        heldBlink &&
        heldBlink.mobilityDistance !== undefined &&
        desiredDistance > heldBlink.mobilityDistance
      ) {
        const ratio = heldBlink.mobilityDistance / Math.max(desiredDistance, Number.EPSILON);
        desired = {
          x: player.x + (desired.x - player.x) * ratio,
          y: player.y + (desired.y - player.y) * ratio,
        };
      }
      const moved = resolveTerrain(player, desired, context.zone.terrain);
      if (moved.x !== player.x || moved.y !== player.y) {
        const movementDistance = Math.hypot(moved.x - player.x, moved.y - player.y);
        player.x = moved.x;
        player.y = moved.y;
        context.playerGrid.update(player, previousPosition);
        player.dirty = true;
        const action = player.action;
        if (
          action?.skillId === "blink" &&
          action.channelMaxEndsAt !== undefined &&
          action.channelEndsAt === undefined
        ) {
          action.mobilityDistance = Math.max(0, (action.mobilityDistance ?? 0) - movementDistance);
          const directionLength = Math.hypot(
            Number(player.lastInput.right) - Number(player.lastInput.left),
            Number(player.lastInput.down) - Number(player.lastInput.up),
          );
          if (directionLength > 0) {
            action.direction = {
              x: (Number(player.lastInput.right) - Number(player.lastInput.left)) / directionLength,
              y: (Number(player.lastInput.down) - Number(player.lastInput.up)) / directionLength,
            };
          }
        }
      }
    }

    if (canReclaim(player.life, player, player.corpse)) context.reclaimCorpse(socket, player);
    context.collectLoot(socket, player);
    if (context.writeAttachment && (player.dirty || player.resource)) {
      socket.serializeAttachment(toAttachment(player));
    }
    if (context.writeD1 && player.dirty) {
      context.waitUntil(context.savePlayer(player, socket));
      player.dirty = false;
    }
  }
}
