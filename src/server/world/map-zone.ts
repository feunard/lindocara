/**
 * A stored map, as the thing a room can actually run.
 *
 * `World` was written against a `ZoneDefinition`: terrain, plus the content standing on it. A D1
 * map is only the terrain half — blocks and the scenery on them — so this fills in the rest as
 * empty rather than teaching `World` a second shape of world.
 *
 * The content systems are not gone. A map made in the editor has no monsters because nobody placed
 * any, not because monsters were deleted; when the palette grows, this is where they arrive.
 */

import { terrainFromMap } from "../../shared/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "../../shared/navigation.js";
import type { ZoneDefinition, ZoneLocation } from "../../shared/zones.js";
import type { StoredMap } from "../maps.js";

/** Rooms are small while a human is drawing them. Nothing here is built for a crowd yet. */
const MAP_MAX_PLAYERS = 16;

export function zoneFromMap(stored: StoredMap): ZoneDefinition {
  return {
    id: stored.id,
    // The name is the map's own, typed by whoever drew it — so it is not an i18n key and must not
    // be looked up as one. `World` passes this straight through to `zoneNameKey`; the client falls
    // back to printing an unknown key verbatim, which is exactly the map's name.
    nameKey: stored.name,
    type: "open_world",
    defaultInstanceId: "main",
    maxPlayers: MAP_MAX_PLAYERS,
    terrain: terrainFromMap(stored),
    quests: [],
    questSites: [],
    monsters: [],
    guards: [],
    portals: [],
    navigation: { ...DEFAULT_ZONE_NAVIGATION },
    elements: stored.elements,
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
