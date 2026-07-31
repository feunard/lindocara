import type {
  AuthoredQuestMarker,
  AuthoredQuestTracker,
} from "@lindocara/engine/adventure-state.js";
import { type QuestChapter, xpForNextLevel } from "@lindocara/engine/game.js";
import type {
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

export function selfState(
  player: PlayerRuntime,
  questTarget?: number,
  authoredQuests: readonly AuthoredQuestTracker[] = [],
  authoredQuestMarkers: readonly AuthoredQuestMarker[] = [],
): SelfState {
  const serverNow = Date.now();
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
    life: player.life,
    corpse: player.corpse === null ? null : { ...player.corpse },
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
    ...(player.class === "rogue"
      ? {
          rogue: {
            openingUntil: player.opening?.expiresAt ?? 0,
            stealthUntil: player.rogueStealthUntil,
            smokeProtectionUntil: player.rogueSmokeProtectionUntil,
            shadowReturnUntil: player.rogueShadowReturn?.expiresAt ?? 0,
            danceMarksUntil: Math.max(0, ...player.rogueDanceMarks.map((mark) => mark.expiresAt)),
          },
        }
      : {}),
    ...(player.class === "ranger"
      ? { ranger: { afterimageUntil: player.rangerAfterimage?.expiresAt ?? 0 } }
      : {}),
    ...(player.resource ? { resource: { ...player.resource } } : {}),
  };
}

export function sendState<TSocket>(
  socket: TSocket,
  player: PlayerRuntime,
  questTarget: number | undefined,
  send: SendMessage<TSocket>,
  authoredQuests: readonly AuthoredQuestTracker[] = [],
  authoredQuestMarkers: readonly AuthoredQuestMarker[] = [],
): void {
  send(socket, {
    t: "state",
    self: selfState(player, questTarget, authoredQuests, authoredQuestMarkers),
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
