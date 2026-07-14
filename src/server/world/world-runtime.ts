import {
  normalizeAppearance,
  normalizeEquipment,
  starterEquipmentFor,
} from "../../shared/character.js";
import type { CombatContribution, ThreatEntry } from "../../shared/cooperation.js";
import type { LifeState } from "../../shared/death.js";
import {
  clampRestoredPosition,
  type GuardDefinition,
  MONSTER_STATS,
  type MonsterKind,
  type MonsterSpawn,
  type MonsterSpecies,
  maxHpForLevel,
  spawnPosition,
} from "../../shared/game.js";
import { SPATIAL_CELL_SIZE } from "../../shared/interest.js";
import type { MonsterNavigationState } from "../../shared/navigation.js";
import type { Command, LootSnapshot, ServerMessage } from "../../shared/protocol.js";
import { type ClassResourceState, initialResource } from "../../shared/resources.js";
import { type Input, NO_INPUT, TICK_HZ, type Vec2 } from "../../shared/simulation.js";
import { createWorldCache, type WorldCache } from "../../shared/world-delta.js";
import type { ZoneDefinition, ZoneLocation } from "../../shared/zones.js";
import { PRESENCE_HEARTBEAT_MS } from "../character-presence.js";
import type { PlayerProfile, SaveableProfile } from "../profile.js";
import { SpatialGrid } from "./spatial-grid.js";

export const ATTACHMENT_EVERY_TICKS = TICK_HZ;
export const D1_SAVE_EVERY_TICKS = TICK_HZ * 5;
export const MAX_FRAME_BYTES = 2_048;
export const RATE_WINDOW_MS = 1_000;
export const RATE_MAX_MESSAGES = 35;
export const MAX_MALFORMED = 5;
export const CHAT_MAX_LENGTH = 160;
export const MAX_QUEUED_COMMANDS = 12;
export const MAX_STARVED_TICKS = 5;
export const RESYNC_COOLDOWN_MS = 1_000;

export interface Attachment extends Vec2 {
  id: string;
  nick: string;
  level?: number;
  xp?: number;
  hp?: number;
  appearance?: PlayerProfile["appearance"];
  class?: PlayerProfile["class"];
  equipment?: PlayerProfile["equipment"];
  inventory?: PlayerProfile["inventory"];
  quest?: PlayerProfile["quest"];
  life?: PlayerProfile["life"];
  corpse?: PlayerProfile["corpse"];
  ack?: number;
  lastSeq?: number;
  connectionId?: string;
  roomKey?: string;
  sessionEpoch?: number;
  zoneId?: string;
  instanceId?: string;
  wardRunExpiresAt?: number | null;
  resource?: ClassResourceState;
}

export interface PlayerInterest {
  players: Set<string>;
  monsters: Set<string>;
  loot: Set<string>;
}

export interface PlayerRuntime extends PlayerProfile {
  queue: Command[];
  lastInput: Input;
  ack: number;
  lastSeq: number;
  starvedTicks: number;
  dirty: boolean;
  lastAttackAt: number;
  lastHealAt: number;
  skillCooldowns: number[];
  guardUntil: number;
  guardReduction: number;
  lastResurrectAt: number;
  messageTimes: number[];
  malformedCount: number;
  facing: Vec2;
  connectionId: string;
  roomKey: string;
  authorized: boolean;
  disconnecting: boolean;
  transitioning: boolean;
  lastTransitionAt: number;
  lastResyncAt: number;
  /** Set when a resync was throttled so the tick loop can still deliver it once the cooldown lifts. */
  resyncQueued: boolean;
  nextPresenceHeartbeatAt: number;
  interest: PlayerInterest;
  network: WorldCache;
  resource?: ClassResourceState;
  navigationDebug: boolean;
}

export interface MonsterRuntime extends Vec2 {
  id: string;
  kind: MonsterKind;
  species: MonsterSpecies;
  spawnX: number;
  spawnY: number;
  patrolRadius: number;
  mayEnterSafeZone?: boolean;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  xp: number;
  lastAttackAt: number;
  deadUntil: number;
  vx: number;
  vy: number;
  threat: Map<string, ThreatEntry>;
  contributions: Map<string, CombatContribution>;
  rewardsGranted: boolean;
  navigation: MonsterNavigationRuntime;
}

export interface MonsterNavigationRuntime {
  state: MonsterNavigationState;
  path: Vec2[];
  pathIndex: number;
  destination: Vec2 | null;
  requestedDestination: Vec2 | null;
  targetId: string | null;
  requestId: number;
  requestPending: boolean;
  lastPathRequestAt: number;
  unreachableTargetId: string | null;
  unreachableUntil: number;
  abandonReason: string | null;
  directBlockedDestination: Vec2 | null;
}

export interface GuardRuntime extends Vec2 {
  id: string;
  homeX: number;
  homeY: number;
  patrolRadius: number;
  lastAttackAt: number;
  fightingUntil: number;
}

export interface GroundLoot extends LootSnapshot {
  expiresAt: number;
  ownerId?: string;
}

export interface PersistenceServices {
  save(player: PlayerRuntime, socket: WebSocket, force?: boolean): Promise<boolean>;
  rejectStaleSave(socket: WebSocket, player: PlayerRuntime): void;
}

export interface InternalWorldEvent {
  message: ServerMessage;
  position?: Vec2;
  recipient?: WebSocket;
}

export interface ActionResult {
  performed: boolean;
  dirty?: boolean;
}

export interface NetworkChange {
  tick: number;
  recipient: WebSocket;
  message: ServerMessage;
}

export interface RoomContext {
  location: ZoneLocation | null;
  players: Map<WebSocket, PlayerRuntime>;
  socketByPlayerId: Map<string, WebSocket>;
  monsters: MonsterRuntime[];
  guards: GuardRuntime[];
  loot: GroundLoot[];
  siteRespawnAt: Map<string, number>;
  playerGrid: SpatialGrid<PlayerRuntime>;
  monsterGrid: SpatialGrid<MonsterRuntime>;
  lootGrid: SpatialGrid<GroundLoot>;
  tick: number;
}

export function createRoomContext(): RoomContext {
  return {
    location: null,
    players: new Map(),
    socketByPlayerId: new Map(),
    monsters: [],
    guards: [],
    loot: [],
    siteRespawnAt: new Map(),
    playerGrid: new SpatialGrid<PlayerRuntime>(SPATIAL_CELL_SIZE),
    monsterGrid: new SpatialGrid<MonsterRuntime>(SPATIAL_CELL_SIZE),
    lootGrid: new SpatialGrid<GroundLoot>(SPATIAL_CELL_SIZE),
    tick: 0,
  };
}

export function zoneFromRoom(room: RoomContext): ZoneDefinition {
  if (!room.location) throw new Error("world was not initialized with a zone");
  return room.location.definition;
}

export function toProfile(player: PlayerRuntime): SaveableProfile {
  return {
    id: player.id,
    nick: player.nick,
    x: player.x,
    y: player.y,
    level: player.level,
    xp: player.xp,
    hp: player.hp,
    appearance: player.appearance,
    class: player.class,
    equipment: { ...player.equipment },
    inventory: { ...player.inventory },
    quest: { ...player.quest },
    zoneId: player.zoneId,
    instanceId: player.instanceId,
    sessionEpoch: player.sessionEpoch,
    wardRunExpiresAt: player.wardRunExpiresAt,
    life: player.life,
    corpse: player.corpse === null ? null : { ...player.corpse },
    ...(player.resource ? { resource: { ...player.resource } } : {}),
  };
}

export function toAttachment(player: PlayerRuntime): Attachment {
  return {
    ...toProfile(player),
    ...(player.resource ? { resource: { ...player.resource } } : {}),
    ack: player.ack,
    lastSeq: player.lastSeq,
    connectionId: player.connectionId,
    roomKey: player.roomKey,
  };
}

export function newPlayer(
  profile: PlayerProfile,
  connectionId: string,
  roomKey: string,
  ack = 0,
  lastSeq = 0,
  restoredResource?: ClassResourceState,
): PlayerRuntime {
  const resource = initialResource(profile.class);
  const persistedResource = restoredResource ?? profile.resource;
  if (
    resource &&
    persistedResource?.kind === resource.kind &&
    Number.isFinite(persistedResource.current)
  )
    resource.current = Math.max(0, Math.min(resource.max, persistedResource.current));
  return {
    ...profile,
    appearance: { ...profile.appearance },
    equipment: { ...profile.equipment },
    corpse: profile.corpse === null ? null : { ...profile.corpse },
    inventory: { ...profile.inventory },
    quest: { ...profile.quest },
    queue: [],
    lastInput: NO_INPUT,
    ack,
    lastSeq,
    starvedTicks: 0,
    dirty: false,
    lastAttackAt: 0,
    lastHealAt: 0,
    skillCooldowns: [0, 0, 0, 0, 0],
    guardUntil: 0,
    guardReduction: 0,
    lastResurrectAt: 0,
    messageTimes: [],
    malformedCount: 0,
    facing: { x: 1, y: 0 },
    connectionId,
    roomKey,
    authorized: true,
    disconnecting: false,
    transitioning: false,
    lastTransitionAt: 0,
    lastResyncAt: 0,
    resyncQueued: false,
    nextPresenceHeartbeatAt: Date.now() + PRESENCE_HEARTBEAT_MS,
    interest: { players: new Set(), monsters: new Set(), loot: new Set() },
    network: createWorldCache(),
    ...(resource ? { resource } : {}),
    navigationDebug: false,
  };
}

export function profileFromAttachment(attachment: Attachment): PlayerProfile {
  const level = attachment.level ?? 1;
  const playerClass = attachment.class ?? "warrior";
  return {
    id: attachment.id,
    nick: attachment.nick,
    ...clampRestoredPosition(attachment, attachment.id),
    level,
    xp: attachment.xp ?? 0,
    appearance: normalizeAppearance(attachment.appearance),
    class: playerClass,
    equipment: attachment.equipment
      ? normalizeEquipment(playerClass, attachment.equipment.mainHand, attachment.equipment.offHand)
      : starterEquipmentFor(playerClass),
    inventory: {
      potions: attachment.inventory?.potions ?? 2,
      gold: attachment.inventory?.gold ?? 0,
      crystals: attachment.inventory?.crystals ?? 0,
    },
    quest: {
      chapter: attachment.quest?.chapter ?? "three_offerings",
      status: attachment.quest?.status ?? "available",
      progress: attachment.quest?.progress ?? 0,
      target: attachment.quest?.target ?? 3,
    },
    hp: Math.min(maxHpForLevel(level), Math.max(1, attachment.hp ?? maxHpForLevel(level))),
    zoneId: attachment.zoneId ?? "verdant-reach",
    instanceId: attachment.instanceId ?? "main",
    sessionEpoch: attachment.sessionEpoch ?? 0,
    wardRunExpiresAt: attachment.wardRunExpiresAt ?? null,
    ...lifeFromAttachment(attachment),
  };
}

function lifeFromAttachment(attachment: Attachment): { life: LifeState; corpse: Vec2 | null } {
  const life = attachment.life ?? "alive";
  const corpse = attachment.corpse ?? null;
  if (life === "alive" || corpse === null) return { life: "alive", corpse: null };
  return { life, corpse: { ...corpse } };
}

export function positionFromAttachment(attachment: Attachment | null): Vec2 {
  return attachment === null ? spawnPosition() : clampRestoredPosition(attachment, attachment.id);
}

export function createMonsters(spawns: readonly MonsterSpawn[]): MonsterRuntime[] {
  return spawns.map((spawn) => {
    const stats = MONSTER_STATS[spawn.kind];
    return {
      ...spawn,
      spawnX: spawn.x,
      spawnY: spawn.y,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      damage: stats.damage,
      speed: stats.speed,
      xp: stats.xp,
      lastAttackAt: 0,
      deadUntil: 0,
      vx: 0,
      vy: 0,
      threat: new Map(),
      contributions: new Map(),
      rewardsGranted: false,
      navigation: {
        state: "idle",
        path: [],
        pathIndex: 0,
        destination: null,
        requestedDestination: null,
        targetId: null,
        requestId: 0,
        requestPending: false,
        lastPathRequestAt: 0,
        unreachableTargetId: null,
        unreachableUntil: 0,
        abandonReason: null,
        directBlockedDestination: null,
      },
    };
  });
}

export function createGuards(definitions: readonly GuardDefinition[]): GuardRuntime[] {
  return definitions.map((guard) => ({
    ...guard,
    homeX: guard.x,
    homeY: guard.y,
    lastAttackAt: 0,
    fightingUntil: 0,
  }));
}
