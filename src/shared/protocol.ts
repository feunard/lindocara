/**
 * The wire format between browser and Durable Object.
 *
 * Clients send intent, never position or outcomes. Movement input is sequenced so the
 * server can acknowledge exactly what it applied; actions are still just intent.
 */

import type { CharacterAppearance, Equipment, PrimaryColor } from "./character.js";
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
import type { ChatChannel } from "./interest.js";
import type { Input } from "./simulation.js";
import { isSkillSlot, type SkillSlot } from "./skills.js";

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
}

export interface GuardSnapshot {
  id: string;
  x: number;
  y: number;
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
}

export interface WorldInfo {
  zoneNameKey: string;
  width: number;
  height: number;
  playerSize: number;
  obstacles: Rect[];
  safeZone: Rect;
  questNpc: NpcDefinition;
  questNpcs: NpcDefinition[];
  questSites: QuestSite[];
  cemeteries: Cemetery[];
  portals: readonly { id: string; nameKey: string; x: number; y: number }[];
}

/** Sent by the browser. Actions contain intent only; every outcome is validated by the server. */
export type ClientMessage =
  | { t: "input"; seq: number; input: Input }
  | { t: "attack" }
  | { t: "interact" }
  | { t: "heal" }
  | { t: "release" }
  | { t: "skill"; slot: SkillSlot }
  | { t: "use"; item: "potion" }
  | { t: "chat"; channel: ChatChannel; text: string }
  | { t: "world.resync" };

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
  "presence.replaced",
  "presence.lost",
  "room.full",
  "room.invalid_location",
  "zone.transition",
  "zone.transition_denied",
  "zone.transition_cooldown",
  "zone.transition_failed",
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
  | { t: "event"; code: EventCode; params?: EventParams; tone: EventTone; x?: number; y?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  if (value.t === "attack" || value.t === "interact" || value.t === "heal" || value.t === "release")
    return { t: value.t };
  if (value.t === "skill" && isSkillSlot(value.slot)) return { t: "skill", slot: value.slot };
  if (value.t === "use" && value.item === "potion") return { t: "use", item: "potion" };
  if (value.t === "world.resync") return { t: "world.resync" };
  if (
    value.t === "chat" &&
    typeof value.text === "string" &&
    (value.channel === undefined || value.channel === "local")
  ) {
    return { t: "chat", channel: "local", text: value.text };
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
      value.channel === "local" &&
      typeof value.from === "string" &&
      typeof value.text === "string"
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
