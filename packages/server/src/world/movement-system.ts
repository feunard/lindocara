import { canReclaim, speedForLife } from "@lindocara/engine/death.js";
import {
  facingFromInput,
  movementDirectionFromInput,
} from "@lindocara/engine/directional-combat.js";
import { groundDistance, groundOf, planarOf } from "@lindocara/engine/ground.js";
import { mapHeroClassSettings } from "@lindocara/engine/map-hero-settings.js";
import { regenerateResource } from "@lindocara/engine/resources.js";
import { NO_INPUT, step, TICK_DT } from "@lindocara/engine/simulation.js";
import type { ZoneDefinition } from "@lindocara/engine/zones.js";
import type { SpatialGrid } from "./spatial-grid.js";
import { groundUnder, resolveGroundMovement } from "./terrain-access.js";
import {
  type GroundVector,
  MAX_STARVED_TICKS,
  type PlayerRuntime,
  toAttachment,
} from "./world-runtime.js";

/**
 * Generic over the socket key (`TSocket`) so both hosts can drive it: the legacy Durable Object
 * keys players by real workerd `WebSocket`s (the default), while the Alepha `$room` host
 * (`src/api/realtime/WorldRoom.ts`) keys them by connection-id string — the room abstraction never
 * exposes a raw socket. The system itself only ever treats the key as an opaque map key and
 * callback argument, except for the one attachment write below (see its cast).
 */
export interface MovementSystemContext<TSocket = WebSocket> {
  players: Map<TSocket, PlayerRuntime>;
  playerGrid: SpatialGrid<PlayerRuntime>;
  zone: ZoneDefinition;
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
  /** Fired right after a player's authoritative position changed this tick, with where they were
   *  before. `World` uses it to detect a hero's box landing on a `player-touch` event's cell — a
   *  movement-edge check, not a per-tick scan. Absent for rooms that do not run events. */
  onPlayerMoved?(socket: TSocket, player: PlayerRuntime, previousPosition: GroundVector): void;
}

/** Applies at most one queued command per player and performs movement-adjacent maintenance. */
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
    if (player.life !== "corpse") {
      const command = player.queue.shift();
      if (command) {
        player.lastInput = command.input;
        player.facing = groundOf(facingFromInput(command.input, planarOf(player.facing)));
        player.ack = command.seq;
        player.starvedTicks = 0;
      } else if (++player.starvedTicks > MAX_STARVED_TICKS) {
        player.lastInput = NO_INPUT;
      }

      const terrain = context.zone.terrain;
      const previousPosition = { x: player.x, z: player.z };
      const shadowDanceLocked =
        player.class === "rogue" && player.rogueShadowDanceInvulnerableUntil > context.now;
      // `step` is still the movement rule, now fed tile-unit speeds and asked not to clamp; the
      // ramp slowdown it used to be wrapped in (`movementSpeedAt`) is gone with the tile grid that
      // carried the ramp kind — a heightfield has no ramps, it has cliffs and a jump.
      const stepped = shadowDanceLocked
        ? planarOf(player)
        : step(
            planarOf(player),
            player.lastInput,
            TICK_DT,
            speedForLife(
              player.life,
              player.class,
              mapHeroClassSettings(context.zone.heroSettings, player.class).stats.movementSpeed,
            ),
            null,
          );
      let desired: GroundVector = groundOf(stepped);
      const heldBlink =
        player.action?.skillId === "blink" &&
        player.action.channelMaxEndsAt !== undefined &&
        player.action.channelEndsAt === undefined
          ? player.action
          : null;
      const desiredDistance = groundDistance(desired, player);
      if (
        heldBlink &&
        heldBlink.mobilityDistance !== undefined &&
        desiredDistance > heldBlink.mobilityDistance
      ) {
        const ratio = heldBlink.mobilityDistance / Math.max(desiredDistance, Number.EPSILON);
        desired = {
          x: player.x + (desired.x - player.x) * ratio,
          z: player.z + (desired.z - player.z) * ratio,
        };
      }
      // Pas de Lumen ignores terrain for the whole held traversal — that is the skill. In the
      // pixel world `resolveTerrainForLumen` still clamped it to the world rectangle; here the
      // grid has no rectangle and the priest simply goes where the intent says. The safe landing
      // is still validated on rematerialisation, which is where it always was.
      const moved = heldBlink ? desired : resolveGroundMovement(terrain, previousPosition, desired);
      if (moved.x !== player.x || moved.z !== player.z) {
        const movementDistance = groundDistance(moved, player);
        player.x = moved.x;
        player.z = moved.z;
        player.y = groundUnder(terrain, moved.x, moved.z, player.y);
        context.playerGrid.update(player, previousPosition);
        context.onPlayerMoved?.(socket, player, previousPosition);
        player.dirty = true;
        const action = player.action;
        if (
          action?.skillId === "blink" &&
          action.channelMaxEndsAt !== undefined &&
          action.channelEndsAt === undefined
        ) {
          action.mobilityDistance = Math.max(0, (action.mobilityDistance ?? 0) - movementDistance);
          const movementDirection = groundOf(movementDirectionFromInput(player.lastInput));
          const directionLength = Math.hypot(movementDirection.x, movementDirection.z);
          if (directionLength > 0) {
            action.direction = {
              x: movementDirection.x / directionLength,
              z: movementDirection.z / directionLength,
            };
          }
        }
      }
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
