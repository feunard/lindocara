/**
 * A stored map, as the thing a room can actually run.
 *
 * `World` was written against a `ZoneDefinition`: terrain, plus the content standing on it. A D1
 * map supplies terrain, scenery and authored markers, which are adapted into the existing
 * `ZoneDefinition` shape rather than teaching `World` a second content model.
 */

import { MONSTER_SPECIES_KIND, type MonsterSpawn } from "../../shared/game.js";
import { EMPTY_MARKERS, terrainFromMap } from "../../shared/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "../../shared/navigation.js";
import { encodeTileLayer } from "../../shared/tile-layer-codec.js";
import { TILE_SIZE } from "../../shared/tilemap.js";
import type { ZoneDefinition, ZoneLocation } from "../../shared/zones.js";
import type { StoredMap } from "../maps.js";

/** Rooms are small while a human is drawing them. Nothing here is built for a crowd yet. */
const MAP_MAX_PLAYERS = 16;

export function zoneFromMap(stored: StoredMap): ZoneDefinition {
  const monsters: MonsterSpawn[] = (stored.markers ?? EMPTY_MARKERS).monsterSpawns.map(
    (marker, index) => ({
      // Entity ids cross the wire in authoritative snapshots and impact events. Keep the
      // deterministic id inside protocol.ts's wire-id alphabet (`[A-Za-z0-9_-]`): colons would
      // render correctly but make every authored-monster animation fail defensive parsing.
      id: `${stored.id}-monster-${index}-${marker.col}-${marker.row}`,
      kind: MONSTER_SPECIES_KIND[marker.species],
      species: marker.species,
      zone: "route",
      x: marker.col * TILE_SIZE + TILE_SIZE / 2,
      y: marker.row * TILE_SIZE + TILE_SIZE / 2,
      patrolRadius: marker.patrolRadius,
    }),
  );
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
