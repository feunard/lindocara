/**
 * Projection of authored `monster` events into the authoritative monster simulation.
 *
 * The party coordinator owns state and the engine owns page selection. This module only derives
 * active definitions and reconciles them with room-owned runtimes; it owns no clock, socket,
 * persistence or mutable module state.
 */
import { activePageIndex, type PartyAdventureState } from "@lindocara/engine/adventure-state.js";
import { MONSTER_SPECIES_KIND, type MonsterSpawn } from "@lindocara/engine/game.js";
import { eventCellCentre, type MapEvent, monsterEvents } from "@lindocara/engine/map-events.js";
import { createMonsters, type MonsterRuntime } from "./world-runtime.js";

const AUTHORED_MONSTER_PREFIX = "mon-";

export function authoredMonsterDefinition(event: MapEvent): MonsterSpawn | null {
  if (event.kind !== "monster" || event.species === null || event.patrolRadius === null)
    return null;
  const species = event.species;
  return {
    id: `${AUTHORED_MONSTER_PREFIX}${event.id}`,
    name: event.name,
    kind: MONSTER_SPECIES_KIND[species],
    species,
    zone: "route",
    ...eventCellCentre(event),
    patrolRadius: event.patrolRadius,
    ...(event.monsterRank ? { rank: event.monsterRank } : {}),
    ...(event.monsterMaxHp === null || event.monsterMaxHp === undefined
      ? {}
      : { maxHp: event.monsterMaxHp }),
    ...(event.monsterDamage === null || event.monsterDamage === undefined
      ? {}
      : { damage: event.monsterDamage }),
    ...(event.monsterSpeed === null || event.monsterSpeed === undefined
      ? {}
      : { speed: event.monsterSpeed }),
    ...(event.monsterXp === null || event.monsterXp === undefined ? {} : { xp: event.monsterXp }),
    ...(event.monsterWeakness ? { weakness: event.monsterWeakness } : {}),
    ...(event.monsterWeaknessPercent === null || event.monsterWeaknessPercent === undefined
      ? {}
      : { weaknessPercent: event.monsterWeaknessPercent }),
    ...(event.monsterSpecialTechnique ? { specialTechnique: event.monsterSpecialTechnique } : {}),
    respawnMode: event.monsterRespawnMode ?? "timed",
    ...(event.monsterRespawnDelayMs === null || event.monsterRespawnDelayMs === undefined
      ? {}
      : { respawnDelayMs: event.monsterRespawnDelayMs }),
  };
}

export function activeAuthoredMonsterDefinitions(
  events: readonly MapEvent[],
  state: PartyAdventureState,
): MonsterSpawn[] {
  return monsterEvents(events).flatMap((event) => {
    if (activePageIndex(event, state) === null) return [];
    if (
      (event.monsterRespawnMode ?? "timed") === "never" &&
      state.defeatedMonsters?.[event.id] === true
    )
      return [];
    const definition = authoredMonsterDefinition(event);
    return definition ? [definition] : [];
  });
}

/**
 * Preserve combat state for encounters whose page remains active, create newly activated
 * encounters at full health, and remove encounters whose condition no longer holds.
 */
export function reconcileActiveMonsters(
  current: readonly MonsterRuntime[],
  definitions: readonly MonsterSpawn[],
): MonsterRuntime[] {
  const currentById = new Map(current.map((monster) => [monster.id, monster]));
  return definitions.map((definition) => {
    const existing = currentById.get(definition.id);
    if (!existing) return createMonsters([definition])[0] as MonsterRuntime;
    return {
      ...existing,
      name: definition.name ?? existing.name,
      spawnX: definition.x,
      spawnY: definition.y,
      patrolRadius: definition.patrolRadius,
      respawnMode: definition.respawnMode ?? "timed",
      respawnDelayMs: definition.respawnDelayMs ?? existing.respawnDelayMs,
    };
  });
}
