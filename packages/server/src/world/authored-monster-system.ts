/**
 * Projection of authored `monster` events into the authoritative monster simulation.
 *
 * The party coordinator owns state and the engine owns page selection. This module only derives
 * active definitions and reconciles them with room-owned runtimes; it owns no clock, socket,
 * persistence or mutable module state.
 */
import { activePageIndex, type PartyAdventureState } from "@lindocara/engine/adventure-state.js";
import { resolveMonsterAttackProfile } from "@lindocara/engine/combat-actions.js";
import { MONSTER_SPECIES_KIND, type MonsterSpawn } from "@lindocara/engine/game.js";
import { animalCarcassHarvestProfile } from "@lindocara/engine/harvest.js";
import {
  authoredCellCentreGround,
  authoredPatrolRadius,
  canFight,
  hostileOnPage,
  type MapEvent,
} from "@lindocara/engine/map-events.js";

import { createMonsters, type MonsterRuntime } from "./world-runtime.js";

const AUTHORED_MONSTER_PREFIX = "mon-";

export function authoredMonsterDefinition(
  event: MapEvent,
  gridSize: number,
  pageIndex = 0,
): MonsterSpawn | null {
  const fights = event.kind === "monster" || hostileOnPage(event, pageIndex);
  if (!fights || event.patrolRadius === null) return null;
  // A `monster` names its species; a character turned hostile by a page has none, because `species`
  // is validated only for monsters. `spear_goblin` is the tuning fallback the PARSER already uses
  // for an npc's combat characteristics (`defaultMonsterTuning(species ?? "spear_goblin")`), so
  // reading it here keeps the stats a hostile NPC fights with identical to the ones the editor
  // showed its author. Its LOOK still comes from the page, below, never from the species.
  const species = event.species ?? "spear_goblin";
  return {
    id: `${AUTHORED_MONSTER_PREFIX}${event.id}`,
    name: event.name,
    kind: MONSTER_SPECIES_KIND[species],
    species,
    zone: "route",
    ...authoredCellCentreGround(event, gridSize),
    patrolRadius: authoredPatrolRadius(event.patrolRadius),
    graphicAssetId: event.pages[pageIndex]?.graphicAssetId ?? null,
    ...(event.monsterAttackProfile ? { attackProfile: event.monsterAttackProfile } : {}),
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
    pursuitMode: event.monsterPursuitMode ?? "standard",
    acceleration: event.monsterAcceleration ?? 0,
    maxSpeed: event.monsterMaxSpeed ?? event.monsterSpeed ?? undefined,
    oneHitKill: event.monsterOneHitKill ?? false,
  };
}

export function activeAuthoredMonsterDefinitions(
  events: readonly MapEvent[],
  state: PartyAdventureState,
  gridSize: number,
): MonsterSpawn[] {
  // Monster events, plus every character a page has turned hostile. The second half is what lets a
  // dialogue start a fight: the wrong answer sets a switch, the switch selects a page, and this
  // derivation runs again the moment the party's state is installed.
  const candidates = events.filter((event) => event.kind === "monster" || canFight(event.kind));
  return candidates.flatMap((event) => {
    const pageIndex = activePageIndex(event, state);
    if (pageIndex === null) return [];
    if (event.kind !== "monster" && !hostileOnPage(event, pageIndex)) return [];
    if (
      (event.monsterRespawnMode ?? "timed") === "never" &&
      state.defeatedMonsters?.[event.id] === true
    ) {
      const profile = event.species ? animalCarcassHarvestProfile(event.species, "never", 0) : null;
      if (!profile || state.harvestNodes?.[event.id]?.depleted === true) return [];
    }
    const definition = authoredMonsterDefinition(event, gridSize, pageIndex);
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
      spawnZ: definition.z,
      patrolRadius: definition.patrolRadius,
      attackProfile: resolveMonsterAttackProfile(definition.species, definition.attackProfile),
      graphicAssetId: definition.graphicAssetId ?? null,
      respawnMode: definition.respawnMode ?? "timed",
      respawnDelayMs: definition.respawnDelayMs ?? existing.respawnDelayMs,
      pursuitMode: definition.pursuitMode ?? "standard",
      acceleration: definition.acceleration ?? 0,
      maxSpeed: Math.max(
        definition.speed ?? existing.baseSpeed,
        definition.maxSpeed ?? existing.maxSpeed,
      ),
      oneHitKill: definition.oneHitKill ?? false,
    };
  });
}
