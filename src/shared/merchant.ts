import type { TerrainGeometry } from "./game.js";
import { PLAYER_SIZE, type Vec2 } from "./simulation.js";
import { isWalkableBox } from "./tilemap.js";

export interface MerchantDefinition extends Vec2 {
  id: "heartroot_merchant";
}

const OFFSETS: readonly Vec2[] = [
  { x: 96, y: 0 },
  { x: -96, y: 0 },
  { x: 0, y: 96 },
  { x: 0, y: -96 },
  { x: 128, y: 64 },
  { x: -128, y: 64 },
];

/** Every room gets one deterministic merchant near its first legal spawn, including authored maps. */
export function merchantForTerrain(terrain: TerrainGeometry): MerchantDefinition {
  const spawn = terrain.spawnPoints[0] ?? { x: PLAYER_SIZE * 2, y: PLAYER_SIZE * 2 };
  for (const offset of OFFSETS) {
    const candidate = { x: spawn.x + offset.x, y: spawn.y + offset.y };
    if (isWalkableBox(terrain.tiles, candidate, PLAYER_SIZE)) {
      return { id: "heartroot_merchant", ...candidate };
    }
  }
  return { id: "heartroot_merchant", x: spawn.x, y: spawn.y };
}
