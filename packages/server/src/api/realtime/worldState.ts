/**
 * The world room's in-memory state container and its map-to-zone assembly — the Alepha-side port
 * of legacy `world/map-zone.ts` (`zoneFromMap`/`locationFromMap`) plus the room-runtime collections
 * `World` kept as private fields. Reimplemented against `MapService`'s `MapPayload` instead of
 * legacy `StoredMap`; the geometry comes from the map's own heightfield through
 * `zoneTerrainFromHeightfield` (`@lindocara/engine/terrain-access.ts`), the single place a stored map becomes
 * collision, so no two hosts can bake different terrain from the same row.
 */

import {
  type AdventureRegistry,
  EMPTY_ADVENTURE_STATE,
  EMPTY_REGISTRY,
  type PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import { type AdventureAudioConfig, resolveMapAudio } from "@lindocara/engine/audio-catalog.js";
import {
  destroyedBuildingAssetId,
  isStandingBuildingAsset,
  type ZoneBuildingDefinition,
} from "@lindocara/engine/buildings.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import { isNativeHarvestAsset } from "@lindocara/engine/harvest-presets.js";
import { authoredElementGroundPoint } from "@lindocara/engine/hd2d/authored-map.js";
import {
  type ColliderIndex,
  type ColliderRect,
  createColliderIndex,
} from "@lindocara/engine/hd2d/collider-index.js";
import { decodeMap, encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import { SPATIAL_CELL_SIZE } from "@lindocara/engine/interest.js";
import { elementWorldCollider, MAP_LAYERS } from "@lindocara/engine/map-data.js";
import { authoredCellCentreGround, seaGuardianEvents } from "@lindocara/engine/map-events.js";
import { nativeHarvestEvents } from "@lindocara/engine/native-harvest.js";
import { DEFAULT_ZONE_NAVIGATION } from "@lindocara/engine/navigation.js";
import type { QuestEventReference } from "@lindocara/engine/quests.js";
import { seaGuardianRuntimeId } from "@lindocara/engine/sea-guardian.js";
import { zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { emptyLayer, encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { ZoneDefinition, ZoneLocation } from "@lindocara/engine/zones.js";
import { type BuildingRuntime, createBuildings } from "../../world/building-system.js";
import type { DamageOverTimeRuntime } from "../../world/damage-over-time-system.js";
import { createEventRunRuntime, type EventRunRuntime } from "../../world/event-run-system.js";
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
import {
  createSeaGuardianRuntime,
  type SeaGuardianRuntime,
} from "../../world/sea-guardian-system.js";
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
 * `parseTileLayer(layer, size, size)` check agrees with the heightfield the same welcome carries
 * rather than rejecting the frame outright — and a rejected `welcome` is an unjoinable room, not a
 * mis-drawn one.
 */
function blankAppearance(size: number): { layers: string[] } {
  const encoded = encodeTileLayer(emptyLayer(size, size));
  return { layers: new Array<string>(MAP_LAYERS).fill(encoded) };
}

/**
 * Maps compiled before native resources existed may still contain their scenery and collider in the
 * stored heightfield. Strip only the exact authored resource placements while assembling the room;
 * the live event projection then owns intact/depleted visuals and collision. Custom heightfield
 * terrain, unrelated props and colliders remain byte-for-byte equivalent.
 */
function withoutStaticNativeResources(
  heightfield: NonNullable<ReturnType<typeof decodeMap>>,
  payload: MapPayload,
): NonNullable<ReturnType<typeof decodeMap>> {
  const resourceElements = payload.elements.filter((element) =>
    isNativeHarvestAsset(element.assetId),
  );
  if (resourceElements.length === 0) return heightfield;
  const resourceAssets = new Set<string>(resourceElements.map((element) => element.assetId));
  const staleColliders = resourceElements.flatMap((element) => {
    const rect = elementWorldCollider(element);
    return rect
      ? [
          {
            x: rect.x / TILE_SIZE - heightfield.size / 2,
            z: rect.y / TILE_SIZE - heightfield.size / 2,
            w: rect.width / TILE_SIZE,
            h: rect.height / TILE_SIZE,
          },
        ]
      : [];
  });
  const sameCollider = (
    left: { x: number; z: number; w: number; h: number },
    right: { x: number; z: number; w: number; h: number },
  ) =>
    Math.abs(left.x - right.x) < 1e-6 &&
    Math.abs(left.z - right.z) < 1e-6 &&
    Math.abs(left.w - right.w) < 1e-6 &&
    Math.abs(left.h - right.h) < 1e-6;
  return {
    ...heightfield,
    elements: heightfield.elements.filter((element) => !resourceAssets.has(element.assetId)),
    colliders: heightfield.colliders.filter(
      (collider) => !staleColliders.some((stale) => sameCollider(collider, stale)),
    ),
  };
}

/** Buildings are live scenery. Keep their compiled collider, but let room state own their visual. */
function withoutStaticBuildingVisuals(
  heightfield: NonNullable<ReturnType<typeof decodeMap>>,
  payload: MapPayload,
): NonNullable<ReturnType<typeof decodeMap>> {
  const placements = payload.elements
    .filter((element) => isStandingBuildingAsset(element.assetId))
    .map((element) => ({
      assetId: element.assetId,
      ...authoredElementGroundPoint(element, heightfield.size),
    }));
  if (placements.length === 0) return heightfield;
  return {
    ...heightfield,
    elements: heightfield.elements.filter(
      (element) =>
        !placements.some(
          (placement) =>
            placement.assetId === element.assetId &&
            Math.abs(placement.x - element.x) < 1e-6 &&
            Math.abs(placement.z - element.z) < 1e-6,
        ),
    ),
  };
}

function authoredBuildings(payload: MapPayload, size: number): ZoneBuildingDefinition[] {
  return payload.elements.flatMap((element) => {
    if (!element.id || !element.building || !isStandingBuildingAsset(element.assetId)) return [];
    const destroyedAssetId = destroyedBuildingAssetId(element.assetId);
    const rect = elementWorldCollider(element);
    if (!destroyedAssetId || !rect) return [];
    return [
      {
        id: element.id,
        ...authoredElementGroundPoint(element, size),
        standingAssetId: element.assetId,
        destroyedAssetId,
        destructible: element.building.destructible,
        maxHp: element.building.maxHp,
        collider: {
          x: rect.x / TILE_SIZE - size / 2,
          z: rect.y / TILE_SIZE - size / 2,
          w: rect.width / TILE_SIZE,
          h: rect.height / TILE_SIZE,
        },
      },
    ];
  });
}

/**
 * A stored map (as the Alepha API round-trips it) into the `ZoneDefinition` the world systems run
 * on. Port of `zoneFromMap`, with its terrain rebuilt: collision is the map's own heightfield,
 * queried in tile units with the grid centre as origin, and the tile path that used to bake it
 * (`terrainFromMap` over the decoded RLE layers, then the pixel bridge) is gone.
 *
 * **A map with no usable heightfield can no longer produce a zone at all**, and this throws naming
 * it rather than falling back. There is nothing left to fall back TO — the pixel geometry every
 * system collided against does not exist anymore — so a fallback would mean a room whose collision
 * is empty, silently. `WorldRoom.createState` catches this into a `location: null` state, which is
 * already the shape a map that cannot load takes: every join is refused 4007, with the close-code
 * vocabulary intact. The five authored adventures are tile maps and are parked in `scripts/legacy/`
 * for exactly this reason.
 */
export function zoneFromMapPayload(
  payload: MapPayload,
  adventureAudio: AdventureAudioConfig,
): ZoneDefinition {
  const decodedHeightfield = payload.heightfield === null ? null : decodeMap(payload.heightfield);
  const heightfield = decodedHeightfield
    ? withoutStaticBuildingVisuals(
        withoutStaticNativeResources(decodedHeightfield, payload),
        payload,
      )
    : null;
  if (heightfield === null) {
    // Absent and corrupt are distinguished in the message because they need different answers: one
    // map was never given a heightfield, the other has one the server refuses to parse — and a
    // corrupt one must never present as a working map on a room whose collision disagrees with what
    // the client is told to render.
    const reason = payload.heightfield === null ? "absent" : "failed to decode";
    throw new Error(`map ${payload.id} has no usable heightfield (${reason})`);
  }
  const events = [
    ...payload.events,
    ...nativeHarvestEvents(payload.elements, payload.events.length + 1),
  ];
  if (
    events.some(
      (event) =>
        event.col < 0 ||
        event.row < 0 ||
        event.col >= heightfield.size ||
        event.row >= heightfield.size,
    )
  ) {
    throw new Error(`map ${payload.id} has an authored event outside its heightfield`);
  }
  for (const guardianEvent of seaGuardianEvents(events)) {
    if (heightfield.levels[guardianEvent.row * heightfield.size + guardianEvent.col] !== null) {
      throw new Error(`map ${payload.id} has a sea guardian outside water`);
    }
  }
  const terrain = zoneTerrainFromHeightfield(heightfield);
  // A heightfield room's APPEARANCE must not contradict its own collision, and the contradiction
  // is not cosmetic: `isWorldInfo` (`engine/protocol.ts`) validates every appearance collection
  // against `tiles.cols/rows`, so an authored 20x15 tile layer beside an 8x8 heightfield makes
  // `parseServerMessage` drop the whole `welcome` and the room becomes UNJOINABLE. The tile layers,
  // and authored elements are expressed in the old pixel coordinate space, so a heightfield room
  // ships blank layers sized to its own grid. Events use authored cells and the heightfield compiler
  // preserves those cell coordinates inside a square grid, so their full executable definitions can
  // be loaded from the map row without contradicting terrain collision.
  const appearance = blankAppearance(heightfield.size);
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
    // Authored monsters are conditional event pages reconciled into the runtime collection.
    monsters: [],
    guards: [],
    portals: [],
    navigation: { ...DEFAULT_ZONE_NAVIGATION },
    elements: [],
    buildings: authoredBuildings(payload, heightfield.size),
    markers: payload.markers,
    // Straight from the heightfield: the tile map's own `spawn` is authored in the other
    // coordinate space and means nothing here.
    spawns: heightfield.spawns,
    revision: payload.revision,
    tilesetId: payload.tilesetId,
    layers: appearance.layers,
    events,
    audio: resolveMapAudio(adventureAudio, payload.audio),
    heroSettings: payload.heroSettings,
    dayNightCycle: payload.dayNightCycle,
    fixedLighting: payload.fixedLighting,
    // The heightfield the room actually baked its terrain from — reaching this line at all means it
    // decoded, so the string and the collision the two sides run cannot disagree.
    heightfield: encodeMap(heightfield),
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
  /** Room-local damage state for authored building scenery. */
  buildings: BuildingRuntime[];
  /** The untargetable sea barrier; inactive unless a `sea-guardian` event anchors it in water. */
  seaGuardian: SeaGuardianRuntime;
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
  /** Authored events whose page currently holds, reconciled whenever adventure state changes. */
  activeEvents: readonly ActiveWorldEvent[];
  /** Static map/element collision, kept separate so dynamic harvest footprints can be rebuilt. In
   *  tile units, grid centre as origin — the heightfield's own authored rects. */
  staticColliders: readonly ColliderRect[];
  /** Immutable map/element index reused by provenance-aware line-of-sight checks. */
  staticColliderIndex: ColliderIndex;
  /** Current harvest-only collision projected from `activeEvents`. */
  harvestColliders: readonly ColliderRect[];
  /** At most one server-timed harvest channel per hero. Movement/leave/transition removes it. */
  harvestJobs: Map<string, PeasantHarvestJob>;
  /** Autonomous NPC movement runtimes keyed by event id (Task 7 populates via reconcile). */
  npcMovement: Map<string, NpcMovementRuntime>;
  /** Which authored exit each hero currently occupies (legacy `#occupiedExitByPlayerId`). */
  occupiedExitByPlayerId: Map<string, string>;
  /** Last sampled position of each moving event actor. `event-touch` fires only when that actor,
   * not a hero approaching an idle event, creates a fresh contact edge. */
  eventTouchActorPositions: Map<string, GroundVector>;
  /** Current `eventId:heroId` contact pairs, retained across ticks to suppress held-contact repeats. */
  eventTouchContacts: Set<string>;
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
  // The heightfield's collider index already holds its rects as a flat list, so there is nothing to
  // flatten out of buckets the way the pixel index needed: the two collections are the same rects,
  // one indexed for disc queries and one enumerable for the harvest rebuild.
  const staticColliders: readonly ColliderRect[] = definition
    ? [...definition.terrain.colliders.all]
    : [];
  const staticColliderIndex = definition?.terrain.colliders ?? createColliderIndex();
  const heightfield = definition?.heightfield ? decodeMap(definition.heightfield) : null;
  const guardianAnchors = heightfield
    ? seaGuardianEvents(definition?.events ?? []).map((event) => ({
        id: seaGuardianRuntimeId(event.id),
        ...authoredCellCentreGround(event, heightfield.size),
      }))
    : [];
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
    buildings: createBuildings(definition?.buildings),
    seaGuardian: createSeaGuardianRuntime(heightfield, guardianAnchors),
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
    eventTouchActorPositions: new Map(),
    eventTouchContacts: new Set(),
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
