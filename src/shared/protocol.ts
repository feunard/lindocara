/**
 * The wire format between browser and Durable Object.
 *
 * Clients send intent, never position or outcomes. Movement input is sequenced so the
 * server can acknowledge exactly what it applied; actions are still just intent.
 */

import type { CharacterAppearance, Equipment, PrimaryColor } from "./character.js";
import { type ConsumableCounts, type ConsumableId, isConsumableId } from "./consumables.js";
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
import type { MerchantDefinition } from "./merchant.js";
import type { ClassResourceState } from "./resources.js";
import type { Input, Vec2 } from "./simulation.js";
import { isSkillSlot, type SkillSlot } from "./skills.js";
import { isTalentId, type TalentState } from "./talents.js";
import { parseTileMap } from "./tilemap-codec.js";
import { tilesetById } from "./tilesets/tiny-swords.js";
import { isEditorAssetId } from "./tiny-swords-catalog.js";
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
  /** Session inventory for party heroes. Optional while older welcomes remain in flight. */
  consumables?: ConsumableCounts;
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
  /** Last non-zero movement accepted by the authority. Standing still preserves this direction. */
  facing: Vec2;
  /** True while the warrior has deliberately toggled Iron Guard on. */
  guarding?: boolean;
  /** True while enemies cannot perceive this player. */
  invisible?: boolean;
  /** Present while anticipation, impact or recovery is still relevant to remote rendering. */
  action: CombatActionSnapshot | null;
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
  facing: Vec2;
  action: CombatActionSnapshot | null;
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
  /** Present on current servers; optional so an in-flight older welcome remains readable. */
  talents?: TalentState;
  /** Absolute server deadline shared by every consumable. */
  consumableCooldownUntil?: number;
  effects?: {
    damageUntil: number;
    forgottenUntil: number;
    invisibleUntil: number;
    resurrectionAt: number;
  };
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

export type CombatActionKind = "basic" | "skill" | "monster_attack";

export interface CombatActionSnapshot {
  id: string;
  kind: CombatActionKind;
  skillId?: string;
  direction: Vec2;
  startedAt: number;
  impactAt: number;
  recoveryEndsAt: number;
  /** Present once a held action has been released or has reached its authoritative bound. */
  channelEndsAt?: number;
  resolved: boolean;
}

export const PROJECTILE_KINDS = [
  "arrow",
  "piercing_arrow",
  "volley_arrow",
  "heartseeker",
  "radiant_bolt",
  "healing_light",
] as const;
export type ProjectileKind = (typeof PROJECTILE_KINDS)[number];

/** Strictly visual projectile state. Damage, healing and target filters never cross the wire. */
export interface ProjectileSnapshot {
  id: string;
  actionId: string;
  ownerId: string;
  /** Visual-only Tiny Swords faction, frozen when the authoritative projectile is spawned. */
  color: PrimaryColor;
  kind: ProjectileKind;
  x: number;
  y: number;
  direction: Vec2;
  radius: number;
  spawnedAt: number;
  expiresAt: number;
}

export interface CombatAnimation {
  t: "animation";
  actionId: string;
  actorKind: "player" | "monster";
  actorId: string;
  action: "attack" | "skill";
  skillId?: string;
  /** Server-authored: this cast owns at least one active talent for its skill slot. */
  talented?: true;
  /** Server-authored: the branch's named final technique is active for this cast. */
  evolved?: true;
  direction: Vec2;
  startedAt: number;
  impactAt: number;
  recoveryEndsAt: number;
}

/**
 * The active page of an authored map event, projected to its appearance for the wire — the third
 * member of the `elements`/`layers` family. **Appearance only:** collision is already baked into
 * `tiles`, exactly the rule `elements` and `layers` follow, so nothing here is ever read for
 * walkability, movement, interaction or command execution. `graphicAssetId` is the active page's
 * catalogue graphic (`null` is the authored blank tile); `onTop` chooses whether it draws above the
 * actors (a treetop) or in the ground decor pass. One event owns exactly one cell (`col`/`row`).
 */
export interface WorldEventSnapshot {
  id: string;
  col: number;
  row: number;
  graphicAssetId: string | null;
  onTop: boolean;
}

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
  /**
   * The authored events whose active page currently holds, appearance only — the same rule
   * `elements`/`layers` above follow, never a source of collision. Page selection is server-side
   * (spec Decision 3/4); the client only draws what it is told is active.
   */
  events: readonly WorldEventSnapshot[];
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
  /** Reserved for an explicitly authored merchant; default and authored maps currently send null. */
  merchant: MerchantDefinition | null;
}

/** Sent by the browser. Actions contain intent only; every outcome is validated by the server. */
export type ClientMessage =
  | { t: "input"; seq: number; input: Input }
  | { t: "attack" }
  | { t: "interact" }
  | { t: "release" }
  | { t: "skill"; slot: SkillSlot }
  | { t: "skill.release"; slot: SkillSlot }
  | { t: "talent.unlock"; nodeId: string }
  | { t: "talent.reset" }
  | { t: "use"; item: "potion" }
  | { t: "item.use"; item: ConsumableId }
  | { t: "merchant.buy"; item: ConsumableId }
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
  "item.used",
  "item.cooldown",
  "item.invalid",
  "item.resurrected",
  "merchant.purchased",
  "merchant.insufficient",
  "player.down",
  "loot.picked",
  "heal.cast",
  "heal.received",
  "death.fallen",
  "death.released",
  "death.reclaimed",
  "death.resurrected",
  "resurrect.cast",
  "resurrect.nobody",
  "resurrect.not_priest",
  "skill.cast",
  "skill.blocked",
  "skill.locked",
  "resource.insufficient",
  "talent.unlocked",
  "talent.reset",
  "talent.invalid",
  "talent.perfect_parry",
  "cheat.disabled",
  "cheat.help",
  "cheat.unknown",
  "cheat.level",
  "cheat.nodead_on",
  "cheat.nodead_off",
  "cheat.heal",
  "cheat.hurt",
  "cheat.resource",
  "cheat.resource_none",
  "cheat.cooldowns",
  "cheat.loot",
  "cheat.death",
  "cheat.ghost",
  "cheat.revive",
  "cheat.reset",
  "cheat.where",
  "cheat.alive_only",
  "cheat.already_alive",
  "cheat.already_ghost",
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
  projectiles: ProjectileSnapshot[];
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
      projectiles: ProjectileSnapshot[];
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
      projectiles: EntityDelta<ProjectileSnapshot>;
      /** Room-scoped, never interest-filtered: every recipient sees the same events. Upserts a
       *  changed/new active page, removes an event that went dormant. Appearance only. */
      events: EntityDelta<WorldEventSnapshot>;
    }
  | ({ t: "world.resync"; tick: number; events: WorldEventSnapshot[] } & WorldView)
  | { t: "world.resync_required" }
  | { t: "state"; self: SelfState }
  | { t: "chat"; channel: ChatChannel; from: string; text: string }
  | { t: "party.invite"; inviteId: string; fromId: string; from: string; expiresAt: number }
  | { t: "party.state"; party: PartyState | null }
  | { t: "merchant.open" }
  | CombatAnimation
  | { t: "event"; code: EventCode; params?: EventParams; tone: EventTone; x?: number; y?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isWireId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDirection(value: unknown): value is Vec2 {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) return false;
  const length = Math.hypot(value.x, value.y);
  return length >= 0.999 && length <= 1.001;
}

function isActionSnapshot(value: unknown): value is CombatActionSnapshot {
  if (value === null) return false;
  if (
    !isRecord(value) ||
    !isWireId(value.id) ||
    (value.kind !== "basic" && value.kind !== "skill" && value.kind !== "monster_attack") ||
    !isDirection(value.direction) ||
    !isFiniteNumber(value.startedAt) ||
    !isFiniteNumber(value.impactAt) ||
    !isFiniteNumber(value.recoveryEndsAt) ||
    value.startedAt > value.impactAt ||
    value.impactAt > value.recoveryEndsAt ||
    (value.channelEndsAt !== undefined &&
      (!isFiniteNumber(value.channelEndsAt) ||
        value.channelEndsAt < value.impactAt ||
        value.channelEndsAt > value.recoveryEndsAt)) ||
    typeof value.resolved !== "boolean"
  ) {
    return false;
  }
  return (
    ((value.kind === "skill" || value.kind === "basic") &&
      typeof value.skillId === "string" &&
      value.skillId.length >= 1 &&
      value.skillId.length <= 64) ||
    (value.kind === "monster_attack" && value.skillId === undefined)
  );
}

function isPlayerSnapshot(value: unknown): value is PlayerSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isDirection(value.facing) &&
    (value.guarding === undefined || typeof value.guarding === "boolean") &&
    (value.action === null || isActionSnapshot(value.action))
  );
}

function isMonsterSnapshot(value: unknown): value is MonsterSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isDirection(value.facing) &&
    (value.action === null || isActionSnapshot(value.action))
  );
}

function isProjectileSnapshot(value: unknown): value is ProjectileSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isWireId(value.actionId) &&
    isWireId(value.ownerId) &&
    (value.color === "azure" ||
      value.color === "ember" ||
      value.color === "moss" ||
      value.color === "violet") &&
    typeof value.kind === "string" &&
    (PROJECTILE_KINDS as readonly string[]).includes(value.kind) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isDirection(value.direction) &&
    isFiniteNumber(value.radius) &&
    value.radius > 0 &&
    isFiniteNumber(value.spawnedAt) &&
    isFiniteNumber(value.expiresAt) &&
    value.spawnedAt <= value.expiresAt
  );
}

function isBasicEntity(value: unknown): value is { id: string } {
  return isRecord(value) && isWireId(value.id);
}

/** Same table-driven discipline as the snapshots above: every field is checked, and a malformed
 *  one drops the whole frame. `graphicAssetId` must be `null` or a real catalogue id — appearance
 *  only, so an unknown asset id is not something the renderer should ever be handed. */
function isWorldEventSnapshot(value: unknown): value is WorldEventSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    Number.isSafeInteger(value.col) &&
    (value.col as number) >= 0 &&
    Number.isSafeInteger(value.row) &&
    (value.row as number) >= 0 &&
    (value.graphicAssetId === null || isEditorAssetId(value.graphicAssetId)) &&
    typeof value.onTop === "boolean"
  );
}

function isEntityDelta<T extends { id: string }>(
  value: unknown,
  validate: (entity: unknown) => entity is T,
): boolean {
  if (!isRecord(value) || !Array.isArray(value.upsert) || !Array.isArray(value.remove))
    return false;
  return value.upsert.every(validate) && value.remove.every((id) => isWireId(id));
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
  if (value.t === "attack" && hasOnlyKeys(value, ["t"])) return { t: "attack" };
  if ((value.t === "interact" || value.t === "release") && hasOnlyKeys(value, ["t"]))
    return { t: value.t };
  if (value.t === "skill" && isSkillSlot(value.slot) && hasOnlyKeys(value, ["t", "slot"])) {
    return { t: "skill", slot: value.slot };
  }
  if (value.t === "skill.release" && isSkillSlot(value.slot) && hasOnlyKeys(value, ["t", "slot"])) {
    return { t: "skill.release", slot: value.slot };
  }
  if (
    value.t === "talent.unlock" &&
    isTalentId(value.nodeId) &&
    hasOnlyKeys(value, ["t", "nodeId"])
  ) {
    return { t: "talent.unlock", nodeId: value.nodeId };
  }
  if (value.t === "talent.reset" && hasOnlyKeys(value, ["t"])) return { t: "talent.reset" };
  if (value.t === "use" && value.item === "potion" && hasOnlyKeys(value, ["t", "item"]))
    return { t: "use", item: "potion" };
  if (
    (value.t === "item.use" || value.t === "merchant.buy") &&
    isConsumableId(value.item) &&
    hasOnlyKeys(value, ["t", "item"])
  ) {
    return { t: value.t, item: value.item };
  }
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
      // Events ride inside `world` (the `elements`/`layers` family), validated the same way:
      // appearance only, every field checked, a bad graphic id drops the frame.
      Array.isArray(value.world.events) &&
      value.world.events.every(isWorldEventSnapshot) &&
      Array.isArray(value.players) &&
      value.players.every(isPlayerSnapshot) &&
      Array.isArray(value.monsters) &&
      value.monsters.every(isMonsterSnapshot) &&
      Array.isArray(value.guards) &&
      value.guards.every(isBasicEntity) &&
      Array.isArray(value.loot) &&
      value.loot.every(isBasicEntity) &&
      Array.isArray(value.corpses) &&
      value.corpses.every(isBasicEntity) &&
      Array.isArray(value.projectiles) &&
      value.projectiles.every(isProjectileSnapshot) &&
      isRecord(value.self)
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "world.delta" &&
      Number.isSafeInteger(value.tick) &&
      isEntityDelta(value.players, isPlayerSnapshot) &&
      isEntityDelta(value.monsters, isMonsterSnapshot) &&
      isEntityDelta(value.guards, isBasicEntity) &&
      isEntityDelta(value.loot, isBasicEntity) &&
      isEntityDelta(value.corpses, isBasicEntity) &&
      isEntityDelta(value.projectiles, isProjectileSnapshot) &&
      isEntityDelta(value.events, isWorldEventSnapshot)
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "world.resync" &&
      Number.isSafeInteger(value.tick) &&
      Array.isArray(value.players) &&
      value.players.every(isPlayerSnapshot) &&
      Array.isArray(value.monsters) &&
      value.monsters.every(isMonsterSnapshot) &&
      Array.isArray(value.guards) &&
      value.guards.every(isBasicEntity) &&
      Array.isArray(value.loot) &&
      value.loot.every(isBasicEntity) &&
      Array.isArray(value.corpses) &&
      value.corpses.every(isBasicEntity) &&
      Array.isArray(value.projectiles) &&
      value.projectiles.every(isProjectileSnapshot) &&
      Array.isArray(value.events) &&
      value.events.every(isWorldEventSnapshot)
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
    if (value.t === "merchant.open" && hasOnlyKeys(value, ["t"])) return { t: "merchant.open" };
    if (
      value.t === "animation" &&
      (value.actorKind === "player" || value.actorKind === "monster") &&
      isWireId(value.actionId) &&
      isWireId(value.actorId) &&
      (value.action === "attack" || (value.actorKind === "player" && value.action === "skill")) &&
      isDirection(value.direction) &&
      isFiniteNumber(value.startedAt) &&
      isFiniteNumber(value.impactAt) &&
      isFiniteNumber(value.recoveryEndsAt) &&
      value.startedAt <= value.impactAt &&
      value.impactAt <= value.recoveryEndsAt &&
      (value.talented === undefined || value.talented === true) &&
      (value.evolved === undefined || value.evolved === true) &&
      ((value.actorKind === "monster" &&
        value.action === "attack" &&
        value.skillId === undefined) ||
        (value.actorKind === "player" &&
          typeof value.skillId === "string" &&
          value.skillId.length >= 1 &&
          value.skillId.length <= 64))
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
