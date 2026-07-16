import { type QuestChapter, xpForNextLevel } from "../../shared/game.js";
import type { SelfState, ServerMessage, WorldView } from "../../shared/protocol.js";
import { buildWorldDelta, replaceWorldCache } from "../../shared/world-delta.js";
import { combatCooldownsFromPlayer, type PlayerRuntime } from "./world-runtime.js";

export type SendMessage = (socket: WebSocket, message: ServerMessage) => void;
export type ViewForPlayer = (player: PlayerRuntime) => WorldView;

export function selfState(player: PlayerRuntime, questTarget?: number): SelfState {
  const serverNow = Date.now();
  const chapter = player.quest.chapter ?? "three_offerings";
  const timerEndsAt =
    chapter === "ward_run" && player.quest.status === "active" && player.wardRunExpiresAt !== null
      ? player.wardRunExpiresAt
      : undefined;
  return {
    xp: player.xp,
    xpToNext: xpForNextLevel(player.level),
    inventory: { ...player.inventory },
    quest: {
      ...player.quest,
      chapter,
      target: questTarget ?? player.quest.target,
      ...(timerEndsAt === undefined ? {} : { timerEndsAt }),
    },
    life: player.life,
    corpse: player.corpse === null ? null : { ...player.corpse },
    serverNow,
    cooldowns: combatCooldownsFromPlayer(player, serverNow),
    ...(player.resource ? { resource: { ...player.resource } } : {}),
  };
}

export function sendState(
  socket: WebSocket,
  player: PlayerRuntime,
  questTarget: number | undefined,
  send: SendMessage,
): void {
  send(socket, { t: "state", self: selfState(player, questTarget) });
}

export function broadcastNetworkUpdates(
  players: Map<WebSocket, PlayerRuntime>,
  tick: number,
  viewForPlayer: ViewForPlayer,
  send: SendMessage,
): void {
  for (const [socket, player] of players) {
    if (!player.authorized) continue;
    const delta = buildWorldDelta(player.network, viewForPlayer(player));
    send(socket, { t: "world.delta", tick, ...delta });
  }
}

export function sendWorldResync(
  socket: WebSocket,
  player: PlayerRuntime,
  tick: number,
  viewForPlayer: ViewForPlayer,
  send: SendMessage,
): void {
  const view = viewForPlayer(player);
  replaceWorldCache(player.network, view);
  send(socket, { t: "world.resync", tick, ...view });
}

export function questTargetFor(
  chapter: QuestChapter,
  findTarget: (chapter: QuestChapter) => number | undefined,
): number | undefined {
  return findTarget(chapter);
}
