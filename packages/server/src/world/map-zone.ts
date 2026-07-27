/**
 * A stored map, as the thing a room can actually run.
 *
 * `World` was written against a `ZoneDefinition`: terrain, plus the content standing on it. A D1
 * map supplies terrain, scenery and authored events, which are adapted into the existing
 * `ZoneDefinition` shape rather than teaching `World` a second content model.
 */

import { EMPTY_MARKERS, terrainFromMap } from "@lindocara/engine/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import { encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import type { ZoneDefinition, ZoneLocation } from "@lindocara/engine/zones.js";
import type { StoredMap } from "../maps.js";

/** Rooms are small while a human is drawing them. Nothing here is built for a crowd yet. */
const MAP_MAX_PLAYERS = 16;

export function zoneFromMap(stored: StoredMap): ZoneDefinition {
  return {
    id: stored.id,
    // The name is authored content rather than an i18n key. The client prints unknown keys verbatim,
    // which is exactly the map name and never "undefined".
    nameKey: stored.name,
    type: "open_world",
    defaultInstanceId: "main",
    maxPlayers: MAP_MAX_PLAYERS,
    terrain: terrainFromMap(stored),
    quests: [],
    questSites: [],
    // Authored monsters are conditional event pages. World projects them against party state and
    // reconciles the authoritative collection; catalogue zones still use this static field.
    monsters: [],
    guards: [],
    portals: [],
    navigation: { ...DEFAULT_ZONE_NAVIGATION },
    elements: stored.elements,
    markers: stored.markers ?? EMPTY_MARKERS,
    revision: stored.revision,
    tilesetId: stored.tilesetId,
    layers: stored.layers.map(encodeTileLayer),
    // Appearance-only, exactly like `elements` and `layers` above: never a second collision source.
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
