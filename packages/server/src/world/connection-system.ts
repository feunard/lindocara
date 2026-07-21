import type { SpatialGrid } from "./spatial-grid.js";
import { type PlayerRuntime, RATE_MAX_MESSAGES, RATE_WINDOW_MS } from "./world-runtime.js";

export function addPlayer(
  players: Map<WebSocket, PlayerRuntime>,
  socketsByPlayerId: Map<string, WebSocket>,
  grid: SpatialGrid<PlayerRuntime>,
  socket: WebSocket,
  player: PlayerRuntime,
): void {
  players.set(socket, player);
  socketsByPlayerId.set(player.id, socket);
  grid.insert(player);
}

export function removePlayer(
  players: Map<WebSocket, PlayerRuntime>,
  socketsByPlayerId: Map<string, WebSocket>,
  grid: SpatialGrid<PlayerRuntime>,
  socket: WebSocket,
  player: PlayerRuntime,
): void {
  players.delete(socket);
  if (socketsByPlayerId.get(player.id) === socket) socketsByPlayerId.delete(player.id);
  grid.remove(player.id);
}

export function isRateLimited(player: PlayerRuntime, now = Date.now()): boolean {
  player.messageTimes = player.messageTimes.filter((time) => now - time < RATE_WINDOW_MS);
  player.messageTimes.push(now);
  return player.messageTimes.length > RATE_MAX_MESSAGES;
}
