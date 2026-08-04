/**
 * The world room's in-memory state container and its map-to-zone assembly — the Alepha-side port
 * of legacy `world/map-zone.ts` (`zoneFromMap`/`locationFromMap`) plus the room-runtime collections
 * `World` kept as private fields. Reimplemented against `MapService`'s `MapPayload` (layers arrive
 * RLE-encoded) instead of legacy `StoredMap` (layers already decoded); the geometry rules are the
 * shared engine's (`terrainFromMap`), so the two hosts cannot bake different collision.
 */

import {
  type AdventureRegistry,
  EMPTY_ADVENTURE_STATE,
  EMPTY_REGISTRY,
  type PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import { type AdventureAudioConfig, resolveMapAudio } from "@lindocara/engine/audio-catalog.js";
import {
  type ColliderIndex,
  emptyColliderIndex,
  flattenColliderIndex,
} from "@lindocara/engine/collider.js";
import type { Rect } from "@lindocara/engine/game.js";
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import { SPATIAL_CELL_SIZE } from "@lindocara/engine/interest.js";
import { MAP_LAYERS, terrainFromMap } from "@lindocara/engine/map-data.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import type { QuestEventReference } from "@lindocara/engine/quests.js";
import {
  emptyLayer,
  encodeTileLayer,
  parseTileLayer,
  type TileLayer,
} from "@lindocara/engine/tile-layer-codec.js";
import type { ZoneDefinition, ZoneLocation } from "@lindocara/engine/zones.js";
import type { DamageOverTimeRuntime } from "../../world/damage-over-time-system.js";
import { createEventRunRuntime, type EventRunRuntime } from "../../world/event-run-system.js";
import { pixelTerrainFromHeightfield } from "../../world/heightfield-pixel-bridge.js";
import { createNavigationRuntime, type NavigationRuntime } from "../../world/navigation-system.js";
import type { NpcMovementRuntime } from "../../world/npc-movement-system.js";
import type { PeasantHarvestJob } from "../../world/peasant-harvest-system.js";
import {
  createPeasantSupportRuntime,
  type PeasantSupportRuntime,
} from "../../world/peasant-support-system.js";
import type {
  LumenPortalRuntime,
  LumenTrailRuntime,
  PolarityOrbRuntime,
  SanctuaryRuntime,
} from "../../world/priest-variant-system.js";
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

/**
 * A standard quest conversation opened by the interact key near a quest-bound `action` event —
 * port of legacy `world.ts`'s `PendingQuestConversation`. One per hero at most; the id fences a
 * stale `quest.action` from an already-closed panel.
 */
export interface PendingQuestConversation {
  readonly id: string;
  readonly heroId: string;
  readonly target: QuestEventReference;
  readonly questIds: ReadonlySet<string>;
  resolved: boolean;
}

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
 * The appearance a heightfield room ships instead of the map's tile-space one: `MAP_LAYERS` empty
 * layers sized to the heightfield's own grid, so `isWorldInfo`'s per-layer
 * `parseTileLayer(layer, tiles.cols, tiles.rows)` check agrees with the baked `tiles` rather than
 * rejecting the welcome outright.
 */
function blankAppearance(size: number): { layers: string[] } {
  const encoded = encodeTileLayer(emptyLayer(size, size));
  return { layers: new Array<string>(MAP_LAYERS).fill(encoded) };
}

/**
 * A stored map (as the Alepha API round-trips it) into the `ZoneDefinition` the world systems run
 * on. Port of `zoneFromMap`; the RLE layer strings pass through verbatim as the zone's appearance
 * layers (legacy re-encoded its decoded layers — same bytes either way) and are decoded once here
 * for `terrainFromMap`'s collision bake — except on a heightfield map, whose appearance comes from
 * `blankAppearance` above so it cannot contradict the heightfield-baked `tiles`.
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
  const heightfield = payload.heightfield === null ? null : decodeMap(payload.heightfield);
  if (payload.heightfield !== null && heightfield === null) {
    // A stored heightfield that fails to decode must NOT silently fall back to the tile path: that
    // would be a corrupt map presenting as a working one, on a room whose collision then disagrees
    // with what the client is told to render. The room stays honestly heightfield-less instead.
    console.warn(
      JSON.stringify({ event: "map_heightfield_corrupt", mapId: payload.id, reason: "decode" }),
    );
  }
  // TILE→PIXEL BRIDGE — see packages/engine/src/hd2d/tile-pixel-bridge.ts
  const terrain =
    heightfield === null ? terrainFromMap(data) : pixelTerrainFromHeightfield(heightfield);
  // A heightfield room's APPEARANCE must not contradict its own collision, and the contradiction
  // is not cosmetic: `isWorldInfo` (`engine/protocol.ts`) validates every appearance collection
  // against `tiles.cols/rows`, so an authored 20x15 tile layer beside an 8x8 heightfield makes
  // `parseServerMessage` drop the whole `welcome` and the room becomes UNJOINABLE. The tile layers,
  // the authored elements and the authored events are all expressed in the other coordinate space,
  // so a heightfield room ships none of them: blank layers sized to its own grid, and nothing else.
  // Task 8 is what gives a heightfield its own decoration and events; until then, absent beats
  // misplaced.
  const appearance = heightfield === null ? null : blankAppearance(heightfield.size);
  return {
    id: payload.id,
    // The name is authored content rather than an i18n key. The client prints unknown keys
    // verbatim, which is exactly the map name and never "undefined".
    nameKey: payload.name,
    type: "open_world",
    defaultInstanceId: "main",
    maxPlayers: MAP_MAX_PLAYERS,
    terrain,
    quests: [],
    questSites: [],
    // Authored monsters are conditional event pages; nothing spawns in tranche α (Task 5).
    monsters: [],
    guards: [],
    portals: [],
    navigation: { ...DEFAULT_ZONE_NAVIGATION },
    elements: appearance === null ? payload.elements : [],
    markers: payload.markers,
    revision: payload.revision,
    tilesetId: payload.tilesetId,
    layers: appearance === null ? payload.layers : appearance.layers,
    events: appearance === null ? payload.events : [],
    audio: resolveMapAudio(adventureAudio, payload.audio),
    heroSettings: payload.heroSettings,
    // Only a heightfield the room actually baked its terrain from travels on: shipping a stored
    // string the server itself refused to decode would hand the client a map the two sides
    // disagree about.
    heightfield: heightfield === null ? null : payload.heightfield,
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
  /** Room-local camps, homemade bombs and in-flight material requests. */
  peasantSupport: PeasantSupportRuntime;
  /** Activated support spends whose durable settlement has not yet been acknowledged. */
  activatedSupportSpendIds: Set<string>;
  /** Serializes support sagas with room-level durable reconciliation. */
  supportSpendQueue: Promise<void>;
  /** Room-local priest sanctuaries (legacy `#sanctuaries`). */
  sanctuaries: SanctuaryRuntime[];
  lumenPortals: LumenPortalRuntime[];
  lumenTrails: LumenTrailRuntime[];
  polarityOrbs: PolarityOrbRuntime[];
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
  /** Static map/element collision, kept separate so dynamic harvest footprints can be rebuilt. */
  staticColliders: readonly Rect[];
  /** Immutable map/element index reused by provenance-aware line-of-sight checks. */
  staticColliderIndex: ColliderIndex;
  /** Current harvest-only collision projected from `activeEvents`. */
  harvestColliders: readonly Rect[];
  /** At most one server-timed harvest channel per hero. Movement/leave/transition removes it. */
  harvestJobs: Map<string, PeasantHarvestJob>;
  /** Autonomous NPC movement runtimes keyed by event id (Task 7 populates via reconcile). */
  npcMovement: Map<string, NpcMovementRuntime>;
  /** Which authored exit each hero currently occupies (legacy `#occupiedExitByPlayerId`). */
  occupiedExitByPlayerId: Map<string, string>;
  tick: number;
  /**
   * The party coordinator's read-only adventure-state snapshot plus the monotone version rooms use
   * to drop out-of-order pushes (Task 7). Pulled from `PartyRoom.getAdventureState` at state
   * creation (the hibernation-restore precedent: the coordinator's held copy, never D1 directly),
   * then kept fresh by `installAdventureState` pushes. The room NEVER mutates the state itself —
   * it is single-writer, owned by the coordinator.
   */
  adventureState: { state: PartyAdventureState; version: number };
  /** The adventure's switch/variable/quest registry, pulled beside the state snapshot. */
  adventureRegistry: AdventureRegistry;
  /** The room's live event runs: one-run-per-event lock, budgeted drain, buffered dialogue. */
  eventRuns: EventRunRuntime;
  /** Open standard quest panels, one per hero at most (legacy `#questConversations`). */
  questConversations: Map<string, PendingQuestConversation>;
  /**
   * A mutation batch whose coordinator push has not completed yet. Simulation keeps ticking while
   * this is set, but event runs pause so their next drain cannot seed its working copy from a
   * stale pre-mutation snapshot and replay non-idempotent `add` operations.
   */
  eventStateSync: Promise<void> | null;
  /** Per-hero item-mutation serialization (the potion decrement chain, legacy `#itemMutations`). */
  itemMutations: Map<string, Promise<number | null>>;
  /** (eventId, reason) pairs already logged for a refused authored teleport — warn once, never
   *  per tick (legacy `#teleportRefusalsLogged`). */
  teleportRefusalsLogged: Set<string>;
  /** (eventId, itemId, reason) triples for refused authored `changeItems` (legacy dedupe). */
  itemRefusalsLogged: Set<string>;
  /** (eventId, reason) pairs for refused authored `changeGold` (legacy dedupe). */
  goldRefusalsLogged: Set<string>;
  /** Latches an authored `endAdventure` so a `loop { endAdventure }` completes the party once. */
  adventureEndDispatched: boolean;
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
  const staticColliders = definition
    ? flattenColliderIndex(definition.terrain.colliders).map(([x, y, width, height]) => ({
        x,
        y,
        width,
        height,
      }))
    : [];
  const staticColliderIndex = definition?.terrain.colliders ?? emptyColliderIndex(1, 1);
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
    peasantSupport: createPeasantSupportRuntime(),
    activatedSupportSpendIds: new Set(),
    supportSpendQueue: Promise.resolve(),
    sanctuaries: [],
    lumenPortals: [],
    lumenTrails: [],
    polarityOrbs: [],
    damageOverTime: [],
    siteRespawnAt: new Map(),
    navigation: definition
      ? createNavigationRuntime(definition.terrain, definition.navigation)
      : null,
    heroPartyBroadcasts: new Map(),
    activeEvents: [],
    staticColliders,
    staticColliderIndex,
    harvestColliders: [],
    harvestJobs: new Map(),
    npcMovement: new Map(),
    occupiedExitByPlayerId: new Map(),
    tick: 0,
    adventureState: { state: EMPTY_ADVENTURE_STATE, version: 0 },
    adventureRegistry: EMPTY_REGISTRY,
    eventRuns: createEventRunRuntime(),
    questConversations: new Map(),
    eventStateSync: null,
    itemMutations: new Map(),
    teleportRefusalsLogged: new Set(),
    itemRefusalsLogged: new Set(),
    goldRefusalsLogged: new Set(),
    adventureEndDispatched: false,
    pendingSaves: new Map(),
  };
}
