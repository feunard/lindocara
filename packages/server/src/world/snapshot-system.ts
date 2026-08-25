import type {
  AuthoredQuestMarker,
  AuthoredQuestTracker,
} from "@lindocara/engine/adventure-state.js";
import { type QuestChapter, xpForNextLevel } from "@lindocara/engine/game.js";
import type { PartyMaterials } from "@lindocara/engine/party-harvest-state.js";
import type {
  DisplacementStamp,
  MobilityGrant,
  SelfState,
  ServerMessage,
  WorldEventSnapshot,
  WorldView,
} from "@lindocara/engine/protocol.js";
import { talentState } from "@lindocara/engine/talents.js";
import {
  buildEventDelta,
  buildWorldDelta,
  replaceWorldCache,
  seedEventCache,
} from "@lindocara/engine/world-delta.js";

import { combatCooldownsFromPlayer, type PlayerRuntime } from "./world-runtime.js";

/**
 * Generic over the socket key (`TSocket`), same contract as `MovementSystemContext`: the legacy
 * Durable Object addresses recipients by workerd `WebSocket` (the default), the Alepha room host
 * by connection-id string. Sends only ever flow through the injected `SendMessage` callback, so
 * the key stays opaque to this system.
 */
export type SendMessage<TSocket = WebSocket> = (socket: TSocket, message: ServerMessage) => void;
export type ViewForPlayer = (player: PlayerRuntime) => WorldView;

/**
 * The displacement this hero's client is currently allowed to perform on itself (the S3 spec,
 * decision 6) — the only thing on this whole state a client answers by MOVING.
 *
 * It is derived from the live held action every time the state is built, never stored, which makes
 * the field's ABSENCE the withdrawal: the first state frame after the channel is released, capped
 * or cancelled simply has no grant in it, and no revoke message has to exist. A spent budget is not
 * a grant either — the tick ends the channel on the same beat (`worldTick.ts`) and a zero-distance
 * grant would only tell a client to phase by nothing.
 *
 * What is NOT here is the rest of the skill: the cooldown, the resource, the invulnerability window
 * and every effect were all spent server-side before this appeared, and stay there.
 */
function mobilityGrant(player: PlayerRuntime): MobilityGrant | undefined {
  const action = player.action;
  if (!action || action.channelMaxEndsAt === undefined || action.channelEndsAt !== undefined) {
    return undefined;
  }
  const distance = action.mobilityDistance;
  if (distance === undefined || distance <= 0) return undefined;
  return { actionId: action.id, distance, until: action.channelMaxEndsAt };
}

/**
 * The room's own copy of this hero's position, stamped with the displacement counter it belongs to.
 *
 * Building it IS the announcement, which is why the counter is marked here rather than at the send:
 * every `SelfState` this module produces is on its way to the hero that owns it, and
 * `announceDisplacements` (`worldTick.ts`) reads the gap to decide who is still owed one before the
 * next snapshot goes out.
 *
 * The CURRENT position is the right one to stamp, not a remembered landing: while a stamp is
 * unannounced the client's own frames are all being dropped, so nothing but another displacement can
 * have moved this hero since — and another displacement raises the stamp again.
 */
function displacementStamp(player: PlayerRuntime): DisplacementStamp {
  player.displacementAnnounced = player.displacement;
  return {
    seq: player.displacement,
    x: player.x,
    y: player.y,
    z: player.z,
    ...(player.displacementImpulse ? { impulse: { ...player.displacementImpulse } } : {}),
  };
}

export function selfState(
  player: PlayerRuntime,
  questTarget?: number,
  authoredQuests: readonly AuthoredQuestTracker[] = [],
  authoredQuestMarkers: readonly AuthoredQuestMarker[] = [],
  materials?: PartyMaterials,
): SelfState {
  const serverNow = Date.now();
  const mobility = mobilityGrant(player);
  const displacement = displacementStamp(player);
  const chapter = player.quest.chapter ?? "three_offerings";
  const timerEndsAt =
    chapter === "ward_run" && player.quest.status === "active" && player.wardRunExpiresAt !== null
      ? player.wardRunExpiresAt
      : undefined;
  return {
    xp: player.xp,
    xpToNext: xpForNextLevel(player.level),
    inventory: {
      ...player.inventory,
      ...(player.inventory.consumables ? { consumables: { ...player.inventory.consumables } } : {}),
    },
    quest: {
      ...player.quest,
      chapter,
      target: questTarget ?? player.quest.target,
      ...(timerEndsAt === undefined ? {} : { timerEndsAt }),
    },
    authoredQuests,
    authoredQuestMarkers,
    ...(materials ? { materials: { ...materials } } : {}),
    life: player.life,
    corpse: player.corpse === null ? null : { ...player.corpse },
    displacement,
    serverNow,
    cooldowns: combatCooldownsFromPlayer(player, serverNow),
    talents: talentState(player.class, player.level, player.talents),
    consumableCooldownUntil: player.consumableCooldownUntil,
    effects: {
      damageUntil: player.damageBoostUntil,
      forgottenUntil: player.forgottenUntil,
      invisibleUntil: player.invisibleUntil,
      resurrectionAt: player.resurrectionAt,
    },
    movementEffects: [...player.movementEffects.values()].filter(
      (effect) => effect.until > serverNow,
    ),
    ...(player.class === "rogue"
      ? {
          rogue: {
            openingUntil: player.opening?.expiresAt ?? 0,
            stealthUntil: player.rogueStealthUntil,
            smokeProtectionUntil: player.rogueSmokeProtectionUntil,
            shadowReturnUntil: player.rogueShadowReturn?.expiresAt ?? 0,
            danceMarksAvailableAt:
              player.rogueDanceMarks.length > 0
                ? Math.min(...player.rogueDanceMarks.map((mark) => mark.availableAt))
                : 0,
            danceMarksUntil: Math.max(0, ...player.rogueDanceMarks.map((mark) => mark.expiresAt)),
          },
        }
      : {}),
    ...(player.class === "ranger"
      ? { ranger: { afterimageUntil: player.rangerAfterimage?.expiresAt ?? 0 } }
      : {}),
    ...(player.resource ? { resource: { ...player.resource } } : {}),
    ...(mobility ? { mobility } : {}),
  };
}

export function sendState<TSocket>(
  socket: TSocket,
  player: PlayerRuntime,
  questTarget: number | undefined,
  send: SendMessage<TSocket>,
  authoredQuests: readonly AuthoredQuestTracker[] = [],
  authoredQuestMarkers: readonly AuthoredQuestMarker[] = [],
  materials?: PartyMaterials,
): void {
  send(socket, {
    t: "state",
    self: selfState(player, questTarget, authoredQuests, authoredQuestMarkers, materials),
  });
}

export function broadcastNetworkUpdates<TSocket>(
  players: Map<TSocket, PlayerRuntime>,
  tick: number,
  viewForPlayer: ViewForPlayer,
  send: SendMessage<TSocket>,
  activeEvents: readonly WorldEventSnapshot[],
): void {
  for (const [socket, player] of players) {
    if (!player.authorized) continue;
    const delta = buildWorldDelta(player.network, viewForPlayer(player));
    // Events are room-scoped — the same active set for every recipient — but the diff is still
    // per-recipient bookkeeping against that recipient's own baseline, so a client that joined
    // between two state changes is corrected independently of when it welcomed.
    const events = buildEventDelta(player.network, activeEvents);
    send(socket, { t: "world.delta", tick, ...delta, events });
  }
}

export function sendWorldResync<TSocket>(
  socket: TSocket,
  player: PlayerRuntime,
  tick: number,
  viewForPlayer: ViewForPlayer,
  send: SendMessage<TSocket>,
  activeEvents: readonly WorldEventSnapshot[],
): void {
  const view = viewForPlayer(player);
  replaceWorldCache(player.network, view);
  seedEventCache(player.network, activeEvents);
  send(socket, { t: "world.resync", tick, ...view, events: [...activeEvents] });
}

export function questTargetFor(
  chapter: QuestChapter,
  findTarget: (chapter: QuestChapter) => number | undefined,
): number | undefined {
  return findTarget(chapter);
}
