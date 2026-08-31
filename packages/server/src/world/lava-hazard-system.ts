import { maxHpForLevel } from "@lindocara/engine/game.js";
import { TICK_HZ } from "@lindocara/engine/simulation.js";
import { HERO_FOOTPRINT_OFFSET, type ZoneTerrain } from "@lindocara/engine/terrain-access.js";

import type { MonsterRuntime, PlayerRuntime } from "./world-runtime.js";

export const LAVA_DAMAGE_RATIO_PER_SECOND = 0.2;
const LAVA_SURFACE_TOLERANCE = 0.22;

export interface LavaHazardContext {
  exposureTicks: Map<string, number>;
  players: Iterable<PlayerRuntime>;
  monsters: Iterable<MonsterRuntime>;
  terrain: ZoneTerrain;
  damagePlayer(player: PlayerRuntime, amount: number): void;
  damageMonster(monster: MonsterRuntime, amount: number): void;
}

function immersedInLava(
  terrain: ZoneTerrain,
  position: { x: number; y: number; z: number },
): boolean {
  const surface = terrain.query.waterLevelAtElevation
    ? terrain.query.waterLevelAtElevation(position.x, position.z, position.y)
    : terrain.query.waterLevelAt(position.x, position.z);
  const liquid = terrain.query.liquidAtElevation
    ? terrain.query.liquidAtElevation(position.x, position.z, position.y)
    : terrain.query.liquidAt(position.x, position.z);
  return liquid === "lava" && Math.abs(position.y - surface) <= LAVA_SURFACE_TOLERANCE;
}

function advanceExposure(
  exposureTicks: Map<string, number>,
  active: Set<string>,
  key: string,
  damage: () => void,
): void {
  active.add(key);
  const ticks = (exposureTicks.get(key) ?? 0) + 1;
  if (ticks < TICK_HZ) {
    exposureTicks.set(key, ticks);
    return;
  }
  exposureTicks.set(key, ticks - TICK_HZ);
  damage();
}

/**
 * Applies one authoritative lava beat.
 *
 * Liquid membership comes from the room's real heightfield, never from client presentation flags.
 * Damage is paid once per full second of continuous immersion; an actor on another stacked storey
 * is safe because the elevation-aware query selects only the liquid at the actor's own level.
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
    const key = player.id;
    if (
      !immersedInLava(context.terrain, {
        x: player.x,
        y: player.y,
        z: player.z - HERO_FOOTPRINT_OFFSET,
      })
    ) {
      context.exposureTicks.delete(player.id);
      continue;
    }
    advanceExposure(context.exposureTicks, active, key, () =>
      context.damagePlayer(
        player,
        Math.max(1, Math.ceil(maxHpForLevel(player.level) * LAVA_DAMAGE_RATIO_PER_SECOND)),
      ),
    );
  }

  for (const monster of context.monsters) {
    const key = `monster:${monster.id}`;
    if (monster.hp <= 0 || monster.deadUntil > 0 || !immersedInLava(context.terrain, monster)) {
      context.exposureTicks.delete(key);
      continue;
    }
    advanceExposure(context.exposureTicks, active, key, () =>
      context.damageMonster(
        monster,
        Math.max(1, Math.ceil(monster.maxHp * LAVA_DAMAGE_RATIO_PER_SECOND)),
      ),
    );
  }

  for (const playerId of context.exposureTicks.keys()) {
    if (!active.has(playerId)) context.exposureTicks.delete(playerId);
  }
}
