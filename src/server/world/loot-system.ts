import { canAct } from "../../shared/death.js";
import { LOOT_PICKUP_RANGE, pointDistance } from "../../shared/game.js";
import type { ServerMessage } from "../../shared/protocol.js";
import type { SpatialGrid } from "./spatial-grid.js";
import type { GroundLoot, PlayerRuntime } from "./world-runtime.js";

export interface LootSystemContext {
  loot: GroundLoot[];
  lootGrid: SpatialGrid<GroundLoot>;
  send(socket: WebSocket, message: ServerMessage): void;
  sendState(socket: WebSocket, player: PlayerRuntime): void;
}

export function collectLoot(
  context: LootSystemContext,
  socket: WebSocket,
  player: PlayerRuntime,
): void {
  if (!canAct(player.life)) return;
  for (let index = context.loot.length - 1; index >= 0; index--) {
    const item = context.loot[index];
    if (
      !item ||
      (item.ownerId !== undefined && item.ownerId !== player.id) ||
      pointDistance(player, item) > LOOT_PICKUP_RANGE
    )
      continue;
    if (item.kind === "potion") player.inventory.potions += item.amount;
    if (item.kind === "gold") player.inventory.gold += item.amount;
    if (item.kind === "crystal") player.inventory.crystals += item.amount;
    context.loot.splice(index, 1);
    context.lootGrid.remove(item.id);
    player.dirty = true;
    context.send(socket, {
      t: "event",
      code: "loot.picked",
      params: { amount: item.amount, kind: item.kind },
      tone: "good",
    });
    context.sendState(socket, player);
  }
}

export function processExpiredLoot(
  loot: GroundLoot[],
  grid: SpatialGrid<GroundLoot>,
  now: number,
): void {
  for (let index = loot.length - 1; index >= 0; index--) {
    const item = loot[index];
    if (!item || item.expiresAt > now) continue;
    loot.splice(index, 1);
    grid.remove(item.id);
  }
}
