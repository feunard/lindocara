import {
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
import type { Vec2 } from "./simulation.js";

export type ZoneId = "verdant-reach" | "mmo-test-zone";
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
  portals: readonly PortalDefinition[];
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
const TEST_ZONE_TERRAIN: TerrainGeometry = {
  width: 640,
  height: 480,
  obstacles: [{ x: 320, y: 180, width: 96, height: 128 }],
  spawnPoints: TEST_ZONE_SPAWNS,
  safeZone: TEST_ZONE_SAFE_ZONE,
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
    ],
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
  },
};

export function isZoneId(value: unknown): value is ZoneId {
  return typeof value === "string" && Object.hasOwn(ZONES, value);
}

export function isValidInstanceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= INSTANCE_ID_MAX_LENGTH &&
    INSTANCE_ID_PATTERN.test(value)
  );
}

export function zoneDefinition(zoneId: ZoneId): ZoneDefinition {
  return ZONES[zoneId];
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

/** D1 owns location. Invalid legacy/corrupt values are rejected rather than silently rerouted. */
export function resolveZoneLocation(zoneId: unknown, instanceId: unknown): ZoneLocation | null {
  if (!isZoneId(zoneId) || !isValidInstanceId(instanceId)) return null;
  return {
    zoneId,
    instanceId,
    roomKey: buildRoomKey(zoneId, instanceId),
    definition: zoneDefinition(zoneId),
  };
}
