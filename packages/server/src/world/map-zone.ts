/**
 * A stored map, as the thing a room can actually run.
 *
 * `World` was written against a `ZoneDefinition`: terrain, plus the content standing on it. A D1
 * map supplies terrain, scenery and authored markers, which are adapted into the existing
 * `ZoneDefinition` shape rather than teaching `World` a second content model.
 */

import { MONSTER_SPECIES_KIND, type MonsterSpawn } from "@lindocara/engine/game.js";
import { EMPTY_MARKERS, terrainFromMap } from "@lindocara/engine/map-data.js";
import { eventCellCentre, monsterEvents } from "@lindocara/engine/map-events.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import { encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import type { ZoneDefinition, ZoneLocation } from "@lindocara/engine/zones.js";
import type { StoredMap } from "../maps.js";

/** Rooms are small while a human is drawing them. Nothing here is built for a crowd yet. */
const MAP_MAX_PLAYERS = 16;

export function zoneFromMap(stored: StoredMap): ZoneDefinition {
  // UX wave #12: monster spawns are monster-kind EVENTS, not markers. A monster event carries a
  // validated `species` + `patrolRadius`; the defensive `?? "spear_goblin"`/`?? 0` never fires
  // (`eventsOf` drops a monster row missing either), it only keeps the types honest here.
  const monsters: MonsterSpawn[] = monsterEvents(stored.events).map((event) => {
    const species = event.species ?? "spear_goblin";
    const { x, y } = eventCellCentre(event);
    return {
      // Entity ids cross the wire in authoritative snapshots and impact events. The event uuid is
      // unique, stable and all hex+dashes, so `mon-<uuid>` (40 chars) stays inside protocol.ts's
      // wire-id alphabet AND under its 64-char cap — the map-id-prefixed form overran it.
      id: `mon-${event.id}`,
      kind: MONSTER_SPECIES_KIND[species],
      species,
      zone: "route" as const,
      x,
      y,
      patrolRadius: event.patrolRadius ?? 0,
    };
  });
  return {
    id: stored.id,
    // The name is the map's own, typed by whoever drew it — so it is not an i18n key and must not
    // be looked up as one. `World` passes this straight through to `zoneNameKey`; the client's `t()`
    // prints an unknown key verbatim, which is exactly the map's name (never "undefined").
    nameKey: stored.name,
    type: "open_world",
    defaultInstanceId: "main",
    maxPlayers: MAP_MAX_PLAYERS,
    terrain: terrainFromMap(stored),
    quests: [],
    questSites: [],
    monsters,
    guards: [],
    portals: [],
    navigation: { ...DEFAULT_ZONE_NAVIGATION },
    elements: stored.elements,
    markers: stored.markers ?? EMPTY_MARKERS,
    revision: stored.revision,
    tilesetId: stored.tilesetId,
    layers: stored.layers.map(encodeTileLayer),
    // Appearance-only, exactly like `elements` and `layers` above — never a second source of
    // collision. The room selects each event's active page against the party's adventure state.
    events: stored.events,
  };
}

export function locationFromMap(stored: StoredMap, instanceId: string): ZoneLocation {
  return {
    zoneId: stored.id,
    instanceId,
    roomKey: `${stored.id}:${instanceId}`,
    definition: zoneFromMap(stored),
  };
}
