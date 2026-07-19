import {
  CITY_GUARDS,
  type GuardDefinition,
  MONSTER_SPAWNS,
  type MonsterSpawn,
  QUEST_DEFINITIONS,
  QUEST_SITES,
  type QuestDefinition,
  type QuestSite,
  type Rect,
  type TerrainGeometry,
  VERDANT_REACH_TERRAIN,
} from "./game.js";
import type { MapElement, MapMarkers } from "./map-data.js";
import type { MapEvent } from "./map-events.js";
import { DEFAULT_ZONE_NAVIGATION, type ZoneNavigationDefinition } from "./navigation.js";
import type { Vec2 } from "./simulation.js";
import { MMO_TEST_ZONE_TILES } from "./zones/mmo-test-zone-tiles.js";
import { SUNKEN_ISLES_TERRAIN } from "./zones/sunken-isles.js";

/**
 * A room's identity, and nothing more.
 *
 * This used to be a union of the zones compiled into the build, which was the same statement as
 * "every map that can exist is known at build time". A map is a D1 row now, so its id is a uuid
 * nobody can enumerate — the type has to be as open as the thing it names.
 *
 * What replaced the union's safety is not weaker, it is elsewhere: the terrain travels in the
 * welcome, so the client no longer looks a zone up in a table it compiled in and no longer needs
 * the id to be one of a known set. `zoneDefinition` still guards the legacy catalogue lookup.
 */
export type ZoneId = string;
export type ZoneKind = "open_world" | "town" | "dungeon";

export interface ZoneDefinition {
  id: ZoneId;
  nameKey: string;
  type: ZoneKind;
  defaultInstanceId: "main";
  maxPlayers: number;
  terrain: TerrainGeometry;
  quests: readonly QuestDefinition[];
  questSites: readonly QuestSite[];
  monsters: readonly MonsterSpawn[];
  guards: readonly GuardDefinition[];
  portals: readonly PortalDefinition[];
  navigation: ZoneNavigationDefinition;
  /** Scenery placed by the map editor. Undefined for every catalogue zone — none of them are D1 maps. */
  readonly elements?: readonly MapElement[];
  /** Functional authored anchors. They stay server-side; clients receive only visual state. */
  readonly markers?: MapMarkers;
  /**
   * Authored events, appearance-only — the third member of the `elements`/`layers` family, and it
   * carries the same rule: never a source of collision. Undefined for every catalogue zone. The
   * room evaluates each event's active page against the party's adventure-state snapshot and never
   * per tick; nothing here moves, triggers or executes a command this tranche.
   */
  readonly events?: readonly MapEvent[];
  /** Authored map cache identity. Catalogue zones use 0. */
  readonly revision?: number;
  /**
   * Which tileset `layers` index into, and the three run-length encoded appearance layers
   * themselves. Undefined for every catalogue zone — they predate layers and draw their terrain
   * straight out of `terrain.tiles` (see `zoneFromMap` for the D1 map path that populates both).
   * Appearance only, same as `elements`: never a second source of collision.
   */
  readonly tilesetId?: string;
  readonly layers?: readonly string[];
}

/** A server-owned exit. The browser can only ask to interact near it. */
export interface PortalDefinition extends Vec2 {
  id: string;
  nameKey: string;
  destination: {
    zoneId: ZoneId;
    instanceId: string;
    spawn: Vec2;
  };
}

export interface ZoneLocation {
  zoneId: ZoneId;
  instanceId: string;
  roomKey: string;
  definition: ZoneDefinition;
}

export const DEFAULT_ZONE_ID: ZoneId = "verdant-reach";
export const DEFAULT_INSTANCE_ID = "main";
export const INSTANCE_ID_MAX_LENGTH = 32;

const INSTANCE_ID_PATTERN = /^[a-z][a-z0-9-]{0,30}[a-z0-9]$/;

const TEST_ZONE_SPAWNS: readonly Vec2[] = [
  { x: 160, y: 160 },
  { x: 280, y: 160 },
  { x: 160, y: 280 },
] as const;

const TEST_ZONE_SAFE_ZONE: Rect = { x: 64, y: 64, width: 512, height: 352 };
export const TEST_ZONE_TERRAIN: TerrainGeometry = {
  width: 640,
  height: 480,
  obstacles: [{ x: 320, y: 180, width: 96, height: 128 }],
  spawnPoints: TEST_ZONE_SPAWNS,
  safeZone: TEST_ZONE_SAFE_ZONE,
  tiles: MMO_TEST_ZONE_TILES,
};

export const ZONES: Readonly<Record<ZoneId, ZoneDefinition>> = {
  "verdant-reach": {
    id: "verdant-reach",
    nameKey: "zone.verdant_reach.name",
    type: "open_world",
    defaultInstanceId: "main",
    maxPlayers: 48,
    terrain: VERDANT_REACH_TERRAIN,
    quests: QUEST_DEFINITIONS,
    questSites: QUEST_SITES,
    monsters: MONSTER_SPAWNS,
    guards: CITY_GUARDS,
    portals: [
      {
        id: "verdant-gate",
        nameKey: "portal.verdant_gate",
        x: 880,
        y: 450,
        destination: {
          zoneId: "mmo-test-zone",
          instanceId: "main",
          spawn: { x: 160, y: 160 },
        },
      },
      {
        id: "sunken-isles-gate",
        nameKey: "portal.sunken_isles_gate",
        // Verdant Reach's top-left: columns 0-1 are the boundary wall and rows 1-2 a treeline, so
        // the first open grass is around (128, 192). This sits clear of both, and clear of the
        // building at columns 12-15.
        x: 256,
        y: 320,
        destination: {
          zoneId: "sunken-isles",
          instanceId: "main",
          spawn: { x: 1050, y: 720 },
        },
      },
    ],
    navigation: { ...DEFAULT_ZONE_NAVIGATION },
  },
  "mmo-test-zone": {
    id: "mmo-test-zone",
    nameKey: "zone.mmo_test_zone.name",
    type: "town",
    defaultInstanceId: "main",
    maxPlayers: 2,
    terrain: TEST_ZONE_TERRAIN,
    quests: [],
    questSites: [],
    monsters: [],
    guards: [],
    portals: [
      {
        id: "test-return-gate",
        nameKey: "portal.test_return_gate",
        x: 160,
        y: 160,
        destination: {
          zoneId: "verdant-reach",
          instanceId: "main",
          spawn: { x: 784, y: 450 },
        },
      },
    ],
    navigation: { ...DEFAULT_ZONE_NAVIGATION, nodeBudgetPerTick: 96 },
  },
  "sunken-isles": {
    id: "sunken-isles",
    nameKey: "zone.sunken_isles.name",
    type: "open_world",
    defaultInstanceId: "main",
    maxPlayers: 16,
    terrain: SUNKEN_ISLES_TERRAIN,
    quests: [],
    questSites: [],
    monsters: [],
    guards: [],
    portals: [
      {
        id: "sunken-isles-return",
        nameKey: "portal.sunken_isles_return",
        x: 1180,
        y: 700,
        destination: {
          zoneId: "verdant-reach",
          instanceId: "main",
          // Clear of the outbound gate at (256, 320) by 140px. Arriving inside its
          // INTERACTION_RANGE (92) would make the two gates a revolving door.
          spawn: { x: 256, y: 460 },
        },
      },
    ],
    navigation: { ...DEFAULT_ZONE_NAVIGATION },
  },
};

/**
 * A room id is any non-empty string now, because a map's id is a uuid minted by D1.
 *
 * It deliberately no longer asks "is this one of the zones I compiled in?" — that question had an
 * answer only while every map was known at build time. A map the client has never heard of is the
 * normal case; the terrain arrives with it.
 */
export function isZoneId(value: unknown): value is ZoneId {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

/**
 * Whether this id names a compile-time catalogue zone. The hybrid routing rule hangs off this:
 * known ids resolve to the catalogue (content and all), anything else is a D1 map id.
 */
export function isKnownZone(value: unknown): value is ZoneId {
  return typeof value === "string" && Object.hasOwn(ZONES, value);
}

export function isValidInstanceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= INSTANCE_ID_MAX_LENGTH &&
    INSTANCE_ID_PATTERN.test(value)
  );
}

/**
 * `zoneId` is typed as `ZoneId`, but every caller reachable from the wire (the client's
 * `configureZone`/`bakeZoneTerrain`, driven by a welcome's `world.zoneId`) is really handing this
 * an arbitrary string once JSON has been through it. `ZONES[zoneId]` would then be `undefined`,
 * and every caller immediately reads `.terrain` off the result — a crash on the first frame, not
 * a controlled failure. Falling back to the default zone's definition keeps a stale client from
 * crashing on an id it cannot resolve. This is the same fallback `resolveZoneLocation` leans on:
 * an unknown id resolves (to the default definition) rather than being refused — only a
 * structurally invalid id (empty, oversize, non-string) is rejected, upstream, by `isZoneId`.
 */
export function zoneDefinition(zoneId: ZoneId): ZoneDefinition {
  const known = ZONES[zoneId] ?? ZONES[DEFAULT_ZONE_ID];
  // `ZONES` is a plain record and `ZoneId` is now any string, so the compiler is right that this
  // could be undefined — but DEFAULT_ZONE_ID indexes a literal in this very file. Throwing beats a
  // non-null assertion: if that ever stops being true it should say so, not crash somewhere else.
  if (!known) throw new Error(`no zone definition, not even the default (${DEFAULT_ZONE_ID})`);
  return known;
}

export function buildRoomKey(zoneId: ZoneId, instanceId: string): string {
  if (!isValidInstanceId(instanceId)) throw new Error("invalid instance id");
  return `${zoneId}:${instanceId}`;
}

export function parseRoomKey(roomKey: string): ZoneLocation | null {
  const separator = roomKey.indexOf(":");
  if (separator <= 0 || separator !== roomKey.lastIndexOf(":")) return null;
  return resolveZoneLocation(roomKey.slice(0, separator), roomKey.slice(separator + 1));
}

/** D1 owns location. Any structurally valid id resolves — an unknown one falls back to the default
 *  zone's definition via `zoneDefinition`, not to a refusal; only empty/oversize/non-string ids (and
 *  malformed instance ids) are rejected, by `isZoneId`/`isValidInstanceId`. */
export function resolveZoneLocation(zoneId: unknown, instanceId: unknown): ZoneLocation | null {
  if (!isZoneId(zoneId) || !isValidInstanceId(instanceId)) return null;
  return {
    zoneId,
    instanceId,
    roomKey: buildRoomKey(zoneId, instanceId),
    definition: zoneDefinition(zoneId),
  };
}
