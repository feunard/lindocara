/**
 * The wire format between browser and Durable Object.
 *
 * Clients send intent, never position or outcomes. Movement input is sequenced so the
 * server can acknowledge exactly what it applied; actions are still just intent.
 */

import type { CharacterAppearance, Equipment, PrimaryColor } from "./character.js";
import type { MonsterSpecies, NpcDefinition, PlayerClass, Rect } from "./game.js";
import type { Input } from "./simulation.js";

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
  status: QuestStatus;
  progress: number;
  target: number;
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
  dead: boolean;
}

export interface MonsterSnapshot {
  id: string;
  kind: "slime";
  species: MonsterSpecies;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dead: boolean;
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
}

export interface WorldInfo {
  width: number;
  height: number;
  playerSize: number;
  obstacles: Rect[];
  safeZone: Rect;
  questNpc: NpcDefinition;
}

/** Sent by the browser. Actions contain intent only; every outcome is validated by the server. */
export type ClientMessage =
  | { t: "input"; seq: number; input: Input }
  | { t: "attack" }
  | { t: "interact" }
  | { t: "heal" }
  | { t: "use"; item: "potion" }
  | { t: "chat"; text: string };

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
  "potion.used",
  "player.down",
  "respawn",
  "loot.picked",
  "heal.cast",
  "heal.received",
  "heal.nobody",
  "heal.blocked",
] as const;
export type EventCode = (typeof EVENT_CODES)[number];
export type EventParams = Record<string, string | number>;

/** Sent by the Durable Object. */
export type ServerMessage =
  | {
      t: "welcome";
      selfId: string;
      world: WorldInfo;
      players: PlayerSnapshot[];
      monsters: MonsterSnapshot[];
      loot: LootSnapshot[];
      self: SelfState;
    }
  | {
      t: "snapshot";
      tick: number;
      players: PlayerSnapshot[];
      monsters: MonsterSnapshot[];
      loot: LootSnapshot[];
    }
  | { t: "state"; self: SelfState }
  | { t: "chat"; from: string; text: string }
  | { t: "event"; code: EventCode; params?: EventParams; tone: EventTone; x?: number; y?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  if (value.t === "attack" || value.t === "interact" || value.t === "heal") return { t: value.t };
  if (value.t === "use" && value.item === "potion") return { t: "use", item: "potion" };
  if (value.t === "chat" && typeof value.text === "string") return { t: "chat", text: value.text };
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
      typeof value.selfId === "string" &&
      isRecord(value.world) &&
      Array.isArray(value.players) &&
      Array.isArray(value.monsters) &&
      Array.isArray(value.loot) &&
      isRecord(value.self)
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "snapshot" &&
      typeof value.tick === "number" &&
      Array.isArray(value.players) &&
      Array.isArray(value.monsters) &&
      Array.isArray(value.loot)
    ) {
      return value as unknown as ServerMessage;
    }
    if (value.t === "state" && isRecord(value.self)) return value as unknown as ServerMessage;
    if (value.t === "chat" && typeof value.from === "string" && typeof value.text === "string") {
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
