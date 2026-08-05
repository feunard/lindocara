import { canAct } from "@lindocara/engine/death.js";
import { LOOT_PICKUP_RANGE } from "@lindocara/engine/game.js";
import { groundDistance } from "@lindocara/engine/ground.js";
import type { ServerMessage } from "@lindocara/engine/protocol.js";
import type { SpatialGrid } from "./spatial-grid.js";
import type { GroundLoot, PlayerRuntime } from "./world-runtime.js";

/**
 * Generic over the socket key (`TSocket`), same contract as `MovementSystemContext`: the legacy
 * Durable Object addresses recipients by workerd `WebSocket` (the default), the Alepha room host
 * by connection-id string.
 */
export interface LootSystemContext<TSocket = WebSocket> {
  loot: GroundLoot[];
  lootGrid: SpatialGrid<GroundLoot>;
  send(socket: TSocket, message: ServerMessage): void;
  sendState(socket: TSocket, player: PlayerRuntime): void;
}

export function collectLoot<TSocket>(
  context: LootSystemContext<TSocket>,
  socket: TSocket,
  player: PlayerRuntime,
): void {
  if (!canAct(player.life)) return;
  for (let index = context.loot.length - 1; index >= 0; index--) {
    const item = context.loot[index];
    if (
      !item ||
      (item.ownerId !== undefined && item.ownerId !== player.id) ||
      // Pickup is a distance across the GROUND. This line read `pointDistance(player, item)`
      // until the runtimes gained three axes, at which point it silently began comparing the
      // hero's ground `x` against its own ELEVATION — no compiler error, no `.y` to grep for, and
      // a loot radius that quietly became meaningless. `groundDistance` is the only reason it
      // cannot happen again here.
      groundDistance(player, item) > LOOT_PICKUP_RANGE
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
