import type { SpatialGrid } from "./spatial-grid.js";
import { type PlayerRuntime, RATE_MAX_MESSAGES, RATE_WINDOW_MS } from "./world-runtime.js";

/**
 * Generic over the socket key (`TSocket`), same contract as `MovementSystemContext`: the legacy
 * Durable Object keys players by workerd `WebSocket` (the default), the Alepha room host by
 * connection-id string. The key is only ever a map key here.
 */
export function addPlayer<TSocket>(
  players: Map<TSocket, PlayerRuntime>,
  socketsByPlayerId: Map<string, TSocket>,
  grid: SpatialGrid<PlayerRuntime>,
  socket: TSocket,
  player: PlayerRuntime,
): void {
  players.set(socket, player);
  socketsByPlayerId.set(player.id, socket);
  grid.insert(player);
}

export function removePlayer<TSocket>(
  players: Map<TSocket, PlayerRuntime>,
  socketsByPlayerId: Map<string, TSocket>,
  grid: SpatialGrid<PlayerRuntime>,
  socket: TSocket,
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
