/**
 * The wire format between browser and Durable Object.
 *
 * Clients send intent, never position or outcomes. Movement input is sequenced so the
 * server can acknowledge exactly what it applied; actions are still just intent.
 */

import type { CharacterAppearance, Equipment, PrimaryColor } from "./character.js";
import type { CombatCooldownState } from "./cooldowns.js";
import type { LifeState } from "./death.js";
import type {
  Cemetery,
  MonsterKind,
  MonsterSpecies,
  NpcDefinition,
  PlayerClass,
  QuestChapter,
  QuestSite,
  Rect,
} from "./game.js";
import { isUuid } from "./identifiers.js";
import type { ChatChannel } from "./interest.js";
import { MAP_LAYERS, type MapElement, parseMapElements } from "./map-data.js";
import type { ClassResourceState } from "./resources.js";
import type { Input } from "./simulation.js";
import { isSkillSlot, type SkillSlot } from "./skills.js";
import { parseTileMap } from "./tilemap-codec.js";
import { tilesetById } from "./tilesets/tiny-swords.js";
import { isZoneId, type ZoneId } from "./zones.js";

/** One tick's worth of movement intent, stamped so the server can acknowledge it. */
export interface Command {
  seq: number;
  input: Input;
}

/** @deprecated Transitional alias for the original one-field appearance model. */
export type Appearance = PrimaryColor;
export type ItemKind = "potion" | "gold" | "crystal";
export type QuestStatus = "available" | "active" | "ready" | "completed";

export interface Inventory {
  potions: number;
  gold: number;
  crystals: number;
}

export interface QuestState {
  chapter?: QuestChapter;
  status: QuestStatus;
  progress: number;
  target: number;
  /** Unix milliseconds; present only while the ward run is active. */
  timerEndsAt?: number;
}

export interface PlayerSnapshot {
  id: string;
  nick: string;
  x: number;
  y: number;
  /** Highest movement command sequence the server has applied for this player. */
  ack: number;
  hp: number;
  maxHp: number;
  level: number;
  appearance: CharacterAppearance;
  class: PlayerClass;
  equipment: Equipment;
  /** Replaces the old `dead` boolean: death has three states, not two. */
  life: LifeState;
}

/** A body on the ground. Broadcast to everyone: the renderer draws it, a priest revives it. */
export interface CorpseSnapshot {
  /** The character id of whoever fell here. */
  id: string;
  nick: string;
  class: PlayerClass;
  appearance: CharacterAppearance;
  x: number;
  y: number;
}

export interface MonsterSnapshot {
  id: string;
  kind: MonsterKind;
  species: MonsterSpecies;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  navigationDebug?: NavigationDebugSnapshot;
}

export interface NavigationDebugSnapshot {
  state: import("./navigation.js").MonsterNavigationState;
  path: { x: number; y: number }[];
  destination: { x: number; y: number } | null;
  reason: string | null;
}

export interface GuardSnapshot {
  id: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  homeX: number;
  homeY: number;
  fighting: boolean;
}

export interface LootSnapshot {
  id: string;
  kind: ItemKind;
  amount: number;
  x: number;
  y: number;
}

export interface SelfState {
  xp: number;
  xpToNext: number;
  inventory: Inventory;
  quest: QuestState;
  life: LifeState;
  /** Where your body lies, so the HUD can point you at it. Null unless you are dead. */
  corpse: { x: number; y: number } | null;
  resource?: ClassResourceState;
  /** Unix milliseconds sampled with `cooldowns`, so clients never depend on wall-clock sync. */
  serverNow?: number;
  /** Absolute server deadlines, informational on the client and authoritative on the server. */
  cooldowns?: CombatCooldownState;
}

export interface PartyMemberState {
  id: string;
  nick: string;
  hp: number;
  maxHp: number;
  life: LifeState;
}

export interface PartyState {
  id: string;
  leaderId: string;
  members: PartyMemberState[];
}

export type CombatAnimation =
  | {
      t: "animation";
      actorKind: "player";
      actorId: string;
      action: "attack";
      x: number;
      y: number;
      targetX?: number;
      targetY?: number;
    }
  | {
      t: "animation";
      actorKind: "player";
      actorId: string;
      action: "skill";
      skillId: string;
      x: number;
      y: number;
    }
  | {
      t: "animation";
      actorKind: "monster";
      actorId: string;
      action: "attack";
      x: number;
      y: number;
    };

export interface WorldInfo {
  /** Names the room. It is no longer enough to find the terrain with: a map can live in D1, so the
   *  terrain travels below instead of being looked up. `zoneNameKey` is prose (an i18n key) and must
   *  never be reverse-matched back into a zone — this is the one field for identity. */
  zoneId: ZoneId;
  revision: number;
  zoneNameKey: string;
  /**
   * The terrain itself, one character per cell, already baked.
   *
   * The server bakes its map — ground plus everything solid standing on it — and ships the result.
   * The client decodes exactly these bytes and collides against them. That is deliberately stronger
   * than both sides deriving collision from a shared payload: there is only ever one baking, and it
   * happens on the authority. A client cannot disagree with a map it did not compute.
   */
  tiles: string[];
  /** What to draw on the ground. Scenery only — collision is already in `tiles` above. */
  elements: readonly MapElement[];
  /** Which tileset `layers` index into. */
  tilesetId: string;
  /**
   * Appearance only. Collision is already in `tiles` above — exactly the rule `elements` follows,
   * and the reason adding layers to the wire introduces no new invariant.
   */
  layers: readonly string[];
  width: number;
  height: number;
  playerSize: number;
  obstacles: Rect[];
  /** `null` on an authored map, which has no place monsters are forbidden to enter. */
  safeZone: Rect | null;
  questNpc: NpcDefinition;
  questNpcs: NpcDefinition[];
  questSites: QuestSite[];
  cemeteries: Cemetery[];
  portals: readonly { id: string; nameKey: string; x: number; y: number }[];
}

/** Sent by the browser. Actions contain intent only; every outcome is validated by the server. */
export type ClientMessage =
  | { t: "input"; seq: number; input: Input }
  | { t: "attack"; targetId: string }
  | { t: "interact" }
  | { t: "heal"; targetId: string }
  | { t: "release" }
  | { t: "skill"; slot: SkillSlot; targetId?: string }
  | { t: "use"; item: "potion" }
  | { t: "chat"; channel: ChatChannel; text: string }
  | { t: "party.create" }
  | { t: "party.invite"; playerId: string }
  | { t: "party.accept"; inviteId: string }
  | { t: "party.refuse"; inviteId: string }
  | { t: "party.leave" }
  | { t: "party.kick"; playerId: string }
  | { t: "party.dissolve" }
  | { t: "world.resync" }
  | { t: "navigation.debug"; enabled: boolean };

export type EventTone = "info" | "good" | "bad";

/**
 * Every event the server can emit. The server sends a code and params; the client owns the
 * localized template (`event.<code>` in `shared/i18n/`). No prose crosses the wire.
 */
export const EVENT_CODES = [
  "wake",
  "combat.too_far",
  "combat.blocked",
  "combat.hit",
  "combat.hurt",
  "monster.defeated",
  "level_up",
  "interact.nothing",
  "quest.accepted",
  "quest.progress",
  "quest.fulfilled",
  "quest.blessing",
  "quest.site_progress",
  "quest.site_wrong",
  "quest.run_started",
  "quest.run_expired",
  "quest.chapter_ready",
  "quest.site_harvested",
  "potion.used",
  "player.down",
  "loot.picked",
  "heal.cast",
  "heal.received",
  "heal.nobody",
  "heal.blocked",
  "death.fallen",
  "death.released",
  "death.reclaimed",
  "death.resurrected",
  "resurrect.cast",
  "resurrect.nobody",
  "resurrect.not_priest",
  "skill.cast",
  "skill.no_target",
  "skill.blocked",
  "skill.locked",
  "resource.insufficient",
  "party.created",
  "party.invited",
  "party.joined",
  "party.refused",
  "party.left",
  "party.kicked",
  "party.dissolved",
  "party.invalid",
  "party.forbidden",
  "party.full",
  "presence.replaced",
  "presence.lost",
  "room.full",
  "room.invalid_location",
  "zone.transition",
  "zone.transition_denied",
  "zone.transition_cooldown",
  "zone.transition_failed",
  "adventure.victory",
] as const;
export type EventCode = (typeof EVENT_CODES)[number];
export type EventParams = Record<string, string | number>;

export interface EntityDelta<T extends { id: string }> {
  upsert: T[];
  remove: string[];
}

export interface WorldView {
  players: PlayerSnapshot[];
  monsters: MonsterSnapshot[];
  guards: GuardSnapshot[];
  loot: LootSnapshot[];
  corpses: CorpseSnapshot[];
}

/** Sent by the Durable Object. */
export type ServerMessage =
  | {
      t: "welcome";
      tick: number;
      selfId: string;
      world: WorldInfo;
      players: PlayerSnapshot[];
      monsters: MonsterSnapshot[];
      guards: GuardSnapshot[];
      loot: LootSnapshot[];
      corpses: CorpseSnapshot[];
      self: SelfState;
    }
  | {
      t: "world.delta";
      tick: number;
      players: EntityDelta<PlayerSnapshot>;
      monsters: EntityDelta<MonsterSnapshot>;
      guards: EntityDelta<GuardSnapshot>;
      loot: EntityDelta<LootSnapshot>;
      corpses: EntityDelta<CorpseSnapshot>;
    }
  | ({ t: "world.resync"; tick: number } & WorldView)
  | { t: "world.resync_required" }
  | { t: "state"; self: SelfState }
  | { t: "chat"; channel: ChatChannel; from: string; text: string }
  | { t: "party.invite"; inviteId: string; fromId: string; from: string; expiresAt: number }
  | { t: "party.state"; party: PartyState | null }
  | CombatAnimation
  | { t: "event"; code: EventCode; params?: EventParams; tone: EventTone; x?: number; y?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTargetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function isEntityDelta(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.upsert) || !Array.isArray(value.remove))
    return false;
  return (
    value.upsert.every((entity) => isRecord(entity) && typeof entity.id === "string") &&
    value.remove.every((id) => typeof id === "string")
  );
}

function parseInput(value: unknown): Input | null {
  if (!isRecord(value)) return null;
  const { up, down, left, right } = value;
  if (
    typeof up !== "boolean" ||
    typeof down !== "boolean" ||
    typeof left !== "boolean" ||
    typeof right !== "boolean"
  ) {
    return null;
  }
  return { up, down, left, right };
}

/** Returns `null` for anything that is not a well-formed client message. */
export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== "string") return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.t !== "string") return null;
  if (value.t === "input") {
    const { seq } = value;
    if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 1) return null;
    const input = parseInput(value.input);
    return input === null ? null : { t: "input", seq, input };
  }
  if ((value.t === "attack" || value.t === "heal") && isTargetId(value.targetId))
    return { t: value.t, targetId: value.targetId };
  if (value.t === "interact" || value.t === "release") return { t: value.t };
  if (
    value.t === "skill" &&
    isSkillSlot(value.slot) &&
    (value.targetId === undefined || isTargetId(value.targetId))
  ) {
    return value.targetId === undefined
      ? { t: "skill", slot: value.slot }
      : { t: "skill", slot: value.slot, targetId: value.targetId };
  }
  if (value.t === "use" && value.item === "potion") return { t: "use", item: "potion" };
  if (value.t === "world.resync") return { t: "world.resync" };
  if (value.t === "navigation.debug" && typeof value.enabled === "boolean")
    return { t: "navigation.debug", enabled: value.enabled };
  if (value.t === "party.create" || value.t === "party.leave" || value.t === "party.dissolve")
    return { t: value.t };
  if ((value.t === "party.invite" || value.t === "party.kick") && isUuid(value.playerId))
    return { t: value.t, playerId: value.playerId };
  if ((value.t === "party.accept" || value.t === "party.refuse") && isUuid(value.inviteId))
    return { t: value.t, inviteId: value.inviteId };
  if (
    value.t === "chat" &&
    typeof value.text === "string" &&
    (value.channel === undefined || value.channel === "local" || value.channel === "party")
  ) {
    return { t: "chat", channel: value.channel === "party" ? "party" : "local", text: value.text };
  }
  return null;
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.t !== "string") return null;
    if (
      value.t === "welcome" &&
      Number.isSafeInteger(value.tick) &&
      typeof value.selfId === "string" &&
      isRecord(value.world) &&
      // A cached SPA build can be older than the server it talks to. If a future zone ever
      // reaches this client, drop the frame — like any other malformed message — rather than
      // hand an unrecognised zoneId to zoneDefinition() a frame later.
      isZoneId(value.world.zoneId) &&
      typeof value.world.revision === "number" &&
      Number.isSafeInteger(value.world.revision) &&
      value.world.revision >= 0 &&
      // The terrain arrives as data now, so it gets checked like data. `decodeTileMap` throws on a
      // ragged row or an unknown character — fine for a map read off disk at build time, fatal for
      // one arriving on a socket. Drop the frame instead of crashing the first paint.
      parseTileMap(value.world.tiles) !== null &&
      parseMapElements(value.world.elements) !== null &&
      // `layers` is appearance only — the same rule `elements` already follows — so validation only
      // needs to confirm the shape is well-formed, never re-derive collision from it.
      typeof value.world.tilesetId === "string" &&
      tilesetById(value.world.tilesetId) !== null &&
      Array.isArray(value.world.layers) &&
      value.world.layers.length === MAP_LAYERS &&
      value.world.layers.every((layer: unknown) => typeof layer === "string") &&
      Array.isArray(value.players) &&
      Array.isArray(value.monsters) &&
      Array.isArray(value.guards) &&
      Array.isArray(value.loot) &&
      Array.isArray(value.corpses) &&
      isRecord(value.self)
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "world.delta" &&
      Number.isSafeInteger(value.tick) &&
      isEntityDelta(value.players) &&
      isEntityDelta(value.monsters) &&
      isEntityDelta(value.guards) &&
      isEntityDelta(value.loot) &&
      isEntityDelta(value.corpses)
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "world.resync" &&
      Number.isSafeInteger(value.tick) &&
      Array.isArray(value.players) &&
      Array.isArray(value.monsters) &&
      Array.isArray(value.guards) &&
      Array.isArray(value.loot) &&
      Array.isArray(value.corpses)
    ) {
      return value as unknown as ServerMessage;
    }
    if (value.t === "world.resync_required") return { t: "world.resync_required" };
    if (value.t === "state" && isRecord(value.self)) return value as unknown as ServerMessage;
    if (
      value.t === "chat" &&
      (value.channel === "local" || value.channel === "party") &&
      typeof value.from === "string" &&
      typeof value.text === "string"
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "party.invite" &&
      typeof value.inviteId === "string" &&
      typeof value.fromId === "string" &&
      typeof value.from === "string" &&
      typeof value.expiresAt === "number"
    )
      return value as unknown as ServerMessage;
    if (value.t === "party.state" && (value.party === null || isRecord(value.party)))
      return value as unknown as ServerMessage;
    if (
      value.t === "animation" &&
      (value.actorKind === "player" || value.actorKind === "monster") &&
      isTargetId(value.actorId) &&
      (value.action === "attack" || (value.actorKind === "player" && value.action === "skill")) &&
      typeof value.x === "number" &&
      Number.isFinite(value.x) &&
      typeof value.y === "number" &&
      Number.isFinite(value.y) &&
      (value.action !== "skill" ||
        (typeof value.skillId === "string" &&
          value.skillId.length >= 1 &&
          value.skillId.length <= 64)) &&
      (value.actorKind !== "player" || value.action !== "attack"
        ? value.targetX === undefined && value.targetY === undefined
        : (value.targetX === undefined && value.targetY === undefined) ||
          (typeof value.targetX === "number" &&
            Number.isFinite(value.targetX) &&
            typeof value.targetY === "number" &&
            Number.isFinite(value.targetY)))
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "event" &&
      typeof value.code === "string" &&
      (EVENT_CODES as readonly string[]).includes(value.code) &&
      (value.params === undefined || isRecord(value.params)) &&
      (value.tone === "info" || value.tone === "good" || value.tone === "bad")
    ) {
      return value as unknown as ServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}
