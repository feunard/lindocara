import { maxHpForLevel } from "@lindocara/engine/game.js";
import { TICK_HZ } from "@lindocara/engine/simulation.js";
import { HERO_FOOTPRINT_OFFSET, type ZoneTerrain } from "@lindocara/engine/terrain-access.js";

import type { PlayerRuntime } from "./world-runtime.js";

export const LAVA_DAMAGE_RATIO_PER_SECOND = 0.2;
const LAVA_SURFACE_TOLERANCE = 0.22;

export interface LavaHazardContext {
  exposureTicks: Map<string, number>;
  players: Iterable<PlayerRuntime>;
  terrain: ZoneTerrain;
  damage(player: PlayerRuntime, amount: number): void;
}

/**
 * Applies one authoritative lava beat.
 *
 * Liquid membership comes from the room's real heightfield, never from the client-reported
 * `swimming` presentation flag. Damage is paid once per full second of continuous immersion; a
 * bridge or ceiling above lava is safe because its reported elevation is not on the liquid surface.
 */
export function advanceLavaHazard(context: LavaHazardContext): void {
  const active = new Set<string>();
  for (const player of context.players) {
    if (
      !player.authorized ||
      player.transitioning ||
      player.disconnecting ||
      player.life !== "alive"
    ) {
      context.exposureTicks.delete(player.id);
      continue;
    }
    const footprintZ = player.z - HERO_FOOTPRINT_OFFSET;
    const surface = context.terrain.query.waterLevelAt(player.x, footprintZ);
    const immersed =
      context.terrain.query.liquidAt(player.x, footprintZ) === "lava" &&
      Math.abs(player.y - surface) <= LAVA_SURFACE_TOLERANCE;
    if (!immersed) {
      context.exposureTicks.delete(player.id);
      continue;
    }

    active.add(player.id);
    const ticks = (context.exposureTicks.get(player.id) ?? 0) + 1;
    if (ticks < TICK_HZ) {
      context.exposureTicks.set(player.id, ticks);
      continue;
    }
    context.exposureTicks.set(player.id, ticks - TICK_HZ);
    context.damage(
      player,
      Math.max(1, Math.ceil(maxHpForLevel(player.level) * LAVA_DAMAGE_RATIO_PER_SECOND)),
    );
  }

  for (const playerId of context.exposureTicks.keys()) {
    if (!active.has(playerId)) context.exposureTicks.delete(playerId);
  }
}
