/**
 * The world room's in-memory state container and its map-to-zone assembly — the Alepha-side port
 * of legacy `world/map-zone.ts` (`zoneFromMap`/`locationFromMap`) plus the room-runtime collections
 * `World` kept as private fields. Reimplemented against `MapService`'s `MapPayload` (layers arrive
 * RLE-encoded) instead of legacy `StoredMap` (layers already decoded); the geometry rules are the
 * shared engine's (`terrainFromMap`), so the two hosts cannot bake different collision.
 */

import type { PartyAdventureState } from "@lindocara/engine/adventure-state.js";
import { type AdventureAudioConfig, resolveMapAudio } from "@lindocara/engine/audio-catalog.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import { SPATIAL_CELL_SIZE } from "@lindocara/engine/interest.js";
import { MAP_LAYERS, terrainFromMap } from "@lindocara/engine/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import { parseTileLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import type { ZoneDefinition, ZoneLocation } from "@lindocara/engine/zones.js";
import type { DamageOverTimeRuntime } from "../../world/damage-over-time-system.js";
import { createNavigationRuntime, type NavigationRuntime } from "../../world/navigation-system.js";
import type { NpcMovementRuntime } from "../../world/npc-movement-system.js";
import type { SanctuaryRuntime } from "../../world/priest-variant-system.js";
import { SpatialGrid } from "../../world/spatial-grid.js";
import {
  type ActiveWorldEvent,
  createGuards,
  createMonsters,
  type GroundLoot,
  type GuardRuntime,
  type MonsterRuntime,
  type PlayerRuntime,
  type ProjectileRuntime,
} from "../../world/world-runtime.js";
import type { MapPayload } from "../services/MapService.ts";

/**
 * Copied from legacy `world/map-zone.ts`'s `MAP_MAX_PLAYERS` (a module-local const there, so it
 * cannot be imported): rooms are small while a human is drawing them.
 */
const MAP_MAX_PLAYERS = 16;

/** `partyId:mapId`, both server-minted uuids — the only roomId shape a world room accepts. */
export interface ParsedWorldRoomId {
  partyId: string;
  mapId: string;
}

export function parseWorldRoomId(roomId: string): ParsedWorldRoomId | null {
  const separator = roomId.indexOf(":");
  if (separator === -1) return null;
  const partyId = roomId.slice(0, separator);
  const mapId = roomId.slice(separator + 1);
  if (!isUuid(partyId) || !isUuid(mapId)) return null;
  return { partyId, mapId };
}

/**
 * A stored map (as the Alepha API round-trips it) into the `ZoneDefinition` the world systems run
 * on. Port of `zoneFromMap`; the RLE layer strings pass through verbatim as the zone's appearance
 * layers (legacy re-encoded its decoded layers — same bytes either way) and are decoded once here
 * for `terrainFromMap`'s collision bake.
 */
export function zoneFromMapPayload(
  payload: MapPayload,
  adventureAudio: AdventureAudioConfig,
): ZoneDefinition {
  const layers: TileLayer[] = [];
  for (let index = 0; index < MAP_LAYERS; index += 1) {
    const layer = parseTileLayer(payload.layers[index], payload.cols, payload.rows);
    if (layer === null) throw new Error(`map ${payload.id} layer ${index} failed to decode`);
    layers.push(layer);
  }
  const data = {
    tilesetId: payload.tilesetId,
    cols: payload.cols,
    rows: payload.rows,
    layers,
    elements: payload.elements,
    spawn: payload.spawn,
    markers: payload.markers,
  };
  return {
    id: payload.id,
    // The name is authored content rather than an i18n key. The client prints unknown keys
    // verbatim, which is exactly the map name and never "undefined".
    nameKey: payload.name,
    type: "open_world",
    defaultInstanceId: "main",
    maxPlayers: MAP_MAX_PLAYERS,
    terrain: terrainFromMap(data),
    quests: [],
    questSites: [],
    // Authored monsters are conditional event pages; nothing spawns in tranche α (Task 5).
    monsters: [],
    guards: [],
    portals: [],
    navigation: { ...DEFAULT_ZONE_NAVIGATION },
    elements: payload.elements,
    markers: payload.markers,
    revision: payload.revision,
    tilesetId: payload.tilesetId,
    layers: payload.layers,
    events: payload.events,
    audio: resolveMapAudio(adventureAudio, payload.audio),
  };
}

/** Port of `locationFromMap`, except the room key is the party-scoped `partyId:mapId` this room is
 *  actually addressed by (the legacy hero flow injected the same key through its headers). */
export function locationFromMapPayload(
  payload: MapPayload,
  roomKey: string,
  adventureAudio: AdventureAudioConfig,
): ZoneLocation {
  return {
    zoneId: payload.id,
    instanceId: "main",
    roomKey,
    definition: zoneFromMapPayload(payload, adventureAudio),
  };
}

/**
 * Everything one live world room owns, created by the `$room` state factory on first join and
 * discarded when the room empties (the legacy empty-room reset). Players are keyed by Alepha
 * connection id — the room abstraction never exposes a raw socket.
 */
export interface WorldRoomState {
  partyId: string;
  mapId: string;
  /** The roomId, `partyId:mapId` — every admitted player's `roomKey`. */
  roomKey: string;
  /** `null` when the roomId is malformed or names no loadable map; every join is then refused. */
  location: ZoneLocation | null;
  players: Map<string, PlayerRuntime>;
  connectionIdByHeroId: Map<string, string>;
  playerGrid: SpatialGrid<PlayerRuntime>;
  monsterGrid: SpatialGrid<MonsterRuntime>;
  lootGrid: SpatialGrid<GroundLoot>;
  /** Seeded from the zone definition at state creation (the legacy `#configure` path). Authored
   *  maps carry no zone-level spawns — their monsters/guards arrive as event-page reconciliation
   *  in Task 7 — but the seeding path is the same one, so Task 7 only adds the reconcile calls. */
  monsters: MonsterRuntime[];
  guards: GuardRuntime[];
  loot: GroundLoot[];
  projectiles: ProjectileRuntime[];
  /** Room-local priest sanctuaries (legacy `#sanctuaries`). */
  sanctuaries: SanctuaryRuntime[];
  /** Room-local damage-over-time stacks (legacy `#damageOverTime`). */
  damageOverTime: DamageOverTimeRuntime[];
  /** Quest resource-site respawn deadlines (legacy `#siteRespawnAt`). */
  siteRespawnAt: Map<string, number>;
  /** A* runtime for this room's terrain; `null` exactly when `location` is. */
  navigation: NavigationRuntime | null;
  /** Last hero-party-state payload actually broadcast, per party (legacy `#heroPartyBroadcasts`). */
  heroPartyBroadcasts: Map<string, string>;
  /** Authored events whose page currently holds. Always empty until Task 7 evaluates pages. */
  activeEvents: readonly ActiveWorldEvent[];
  /** Autonomous NPC movement runtimes keyed by event id (Task 7 populates via reconcile). */
  npcMovement: Map<string, NpcMovementRuntime>;
  /** Which authored exit each hero currently occupies (legacy `#occupiedExitByPlayerId`). */
  occupiedExitByPlayerId: Map<string, string>;
  tick: number;
  /** The party coordinator's read-only snapshot — stub storage until Task 7 evaluates it. */
  adventureState: { state: PartyAdventureState | null; version: number };
  /**
   * Per-hero save serialization, keyed by heroId — port of legacy `persistence-system.ts`'s
   * `pendingSaves` (there, a `World`-instance field; here, per-room state, since a hero belongs to
   * exactly one room's `players` map at a time). A new save chains after whatever save is already
   * in flight for the same hero rather than racing it, so the periodic dirty-flush beat and a
   * forced `onLeave` save (or two periodic beats back to back) can never land out of order — see
   * `WorldRoom.queueHeroSave`, the only writer/reader of this map.
   */
  pendingSaves: Map<string, Promise<unknown>>;
}

export function createWorldRoomState(
  roomKey: string,
  parsed: ParsedWorldRoomId | null,
  location: ZoneLocation | null,
): WorldRoomState {
  // Zone-runtime init, the port of legacy `#configure`: bake the navigation grid and seed the
  // zone's authored monsters/guards into runtime collections. `$room` discards this state when the
  // room empties, which reproduces the legacy empty-room reset (temporary monsters/loot reset).
  const definition = location?.definition ?? null;
  const monsters = definition ? createMonsters(definition.monsters) : [];
  const guards = definition ? createGuards(definition.guards) : [];
  const monsterGrid = new SpatialGrid<MonsterRuntime>(SPATIAL_CELL_SIZE);
  for (const monster of monsters) monsterGrid.insert(monster);
  return {
    partyId: parsed?.partyId ?? "",
    mapId: parsed?.mapId ?? "",
    roomKey,
    location,
    players: new Map(),
    connectionIdByHeroId: new Map(),
    playerGrid: new SpatialGrid<PlayerRuntime>(SPATIAL_CELL_SIZE),
    monsterGrid,
    lootGrid: new SpatialGrid<GroundLoot>(SPATIAL_CELL_SIZE),
    monsters,
    guards,
    loot: [],
    projectiles: [],
    sanctuaries: [],
    damageOverTime: [],
    siteRespawnAt: new Map(),
    navigation: definition
      ? createNavigationRuntime(definition.terrain, definition.navigation)
      : null,
    heroPartyBroadcasts: new Map(),
    activeEvents: [],
    npcMovement: new Map(),
    occupiedExitByPlayerId: new Map(),
    tick: 0,
    adventureState: { state: null, version: -1 },
    pendingSaves: new Map(),
  };
}
