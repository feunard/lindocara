/**
 * The wire format between browser and Durable Object.
 *
 * Clients send intent, never position or outcomes. Movement input is sequenced so the
 * server can acknowledge exactly what it applied; actions are still just intent.
 */

import type { AuthoredQuestTracker } from "./adventure-state.js";
import {
  type CharacterAppearance,
  type Equipment,
  isValidAppearance,
  MAIN_HAND_ITEMS,
  OFF_HAND_ITEMS,
  type PrimaryColor,
} from "./character.js";
import {
  CONSUMABLE_IDS,
  type ConsumableCounts,
  type ConsumableId,
  isConsumableId,
} from "./consumables.js";
import type { CombatCooldownState } from "./cooldowns.js";
import { isLifeState, type LifeState } from "./death.js";
import { COMMAND_TEXT_MAX, MAX_CHOICE_OPTIONS } from "./event-commands.js";
import {
  type Cemetery,
  isMonsterSpecies,
  isValidClass,
  MONSTER_SPECIES_KIND,
  type MonsterKind,
  type MonsterSpecies,
  type NpcDefinition,
  type PlayerClass,
  QUEST_CHAPTERS,
  type QuestChapter,
  type QuestSite,
  type Rect,
} from "./game.js";
import { isUuid } from "./identifiers.js";
import type { ChatChannel } from "./interest.js";
import { MAP_LAYERS, MAX_MAP_ELEMENTS, type MapElement, parseMapElements } from "./map-data.js";
import type { MerchantDefinition } from "./merchant.js";
import type { ClassResourceState } from "./resources.js";
import type { Input, Vec2 } from "./simulation.js";
import { isSkillSlot, type SkillSlot } from "./skills.js";
import { isTalentId, type TalentState } from "./talents.js";
import { parseTileLayer } from "./tile-layer-codec.js";
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
  /** Authored party quests. Optional while rolling across an older server/client pair. */
  authoredQuests?: readonly AuthoredQuestTracker[];
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
 * `tiles` and `colliders`, exactly the rule `elements` and `layers` follow, so nothing here is ever
 * read for walkability, movement, interaction or command execution. A client must never derive
 * collision from this list either — that would be a third, disagreeing bake. `graphicAssetId` is
 * the active page's catalogue graphic (`null` is the authored blank tile); `onTop` chooses whether
 * it draws above the actors (a treetop) or in the ground decor pass. One event owns exactly one
 * cell (`col`/`row`).
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
  /**
   * The second half of baked collision truth: sub-cell rectangles in world pixels, `[x, y, w, h]`.
   *
   * This does NOT weaken the appearance-only rule below. Collision is still baked server-side and
   * shipped as collision; it simply needs two structures now, because a tile grid cannot express a
   * tree trunk. `elements` remains appearance. A client that derived colliders from `elements`
   * would be a second, disagreeing bake — exactly the desync the baked contract exists to prevent.
   */
  colliders: readonly (readonly [number, number, number, number])[];
  /**
   * What to draw on the ground. Appearance only — collision is already in `tiles` and `colliders`
   * above, the same rule `layers` and `events` below follow.
   *
   * A tree blocks its trunk, not its cell, so its solidity cannot be expressed in the tile grid at
   * all — that is what `colliders` is for. A client deriving colliders from THIS list instead would
   * be a second, disagreeing bake of the same rectangles the server already baked into `colliders`.
   */
  elements: readonly MapElement[];
  /** Which tileset `layers` index into. */
  tilesetId: string;
  /**
   * Appearance only. Collision is already in `tiles` and `colliders` above — exactly the rule
   * `elements` follows, and the reason adding layers to the wire introduces no new invariant.
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
  | { t: "navigation.debug"; enabled: boolean }
  // The two dialogue intents (spec Decision 4). Both are cheap intents (the connection window cost
  // class): `event.advance` turns the say page; `event.choose` picks an option. `runId` names the run
  // the panel belongs to; `index` is a wire-bounded option index the server RE-VALIDATES against the
  // live pending offer regardless — client input is never an authoritative outcome.
  | { t: "event.advance"; runId: string }
  | { t: "event.choose"; runId: string; index: number };

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
  "item.full",
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
  | { t: "event"; code: EventCode; params?: EventParams; tone: EventTone; x?: number; y?: number }
  // The three dialogue beats pushed to the run's TRIGGERER only (spec Decision 4: dialogue is a
  // per-player panel). `text`/`name`/`prompt`/`options` are AUTHORED PROSE — see `isAuthoredText`:
  // the one sanctioned exception to codes-not-sentences, because the author wrote it and no dictionary
  // can hold it. Every field is still size-capped and defensively parsed like any other wire data.
  | { t: "event.say"; runId: string; text: string; name?: string }
  | { t: "event.choices"; runId: string; prompt: string; options: string[] }
  | { t: "event.close"; runId: string };

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

/**
 * Authored prose off the wire (a `say`/`choices` field). This is the one sanctioned exception to
 * codes-not-sentences (spec Decision 4): the text is the AUTHOR's own data, which no dictionary can
 * hold, so it crosses as data rather than an i18n code — while every chrome string around the panel
 * stays i18n-governed. It is still untrusted input: bounded by `COMMAND_TEXT_MAX`, the exact cap the
 * command parser (`event-commands.ts`) enforces on the same field, so the wire and the store agree.
 */
function isAuthoredText(value: unknown): value is string {
  return typeof value === "string" && value.length <= COMMAND_TEXT_MAX;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isBoundedString(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || value.length > 0);
}

function isPosition(value: unknown): value is Vec2 {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isRect(value: unknown): value is Rect {
  return (
    isRecord(value) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0
  );
}

function isEquipment(value: unknown): value is Equipment {
  return (
    isRecord(value) &&
    typeof value.mainHand === "string" &&
    (MAIN_HAND_ITEMS as readonly string[]).includes(value.mainHand) &&
    (value.offHand === null ||
      (typeof value.offHand === "string" &&
        (OFF_HAND_ITEMS as readonly string[]).includes(value.offHand)))
  );
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
    isBoundedString(value.nick, 32) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isNonNegativeInteger(value.ack) &&
    isFiniteNumber(value.hp) &&
    value.hp >= 0 &&
    isFiniteNumber(value.maxHp) &&
    value.maxHp > 0 &&
    value.hp <= value.maxHp &&
    Number.isSafeInteger(value.level) &&
    (value.level as number) >= 1 &&
    isValidAppearance(value.appearance) &&
    isValidClass(value.class) &&
    isEquipment(value.equipment) &&
    isLifeState(value.life) &&
    isDirection(value.facing) &&
    (value.guarding === undefined || typeof value.guarding === "boolean") &&
    (value.invisible === undefined || typeof value.invisible === "boolean") &&
    (value.action === null || isActionSnapshot(value.action))
  );
}

function isMonsterSnapshot(value: unknown): value is MonsterSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isMonsterSpecies(value.species) &&
    value.kind === MONSTER_SPECIES_KIND[value.species] &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.hp) &&
    value.hp >= 0 &&
    isFiniteNumber(value.maxHp) &&
    value.maxHp > 0 &&
    value.hp <= value.maxHp &&
    typeof value.dead === "boolean" &&
    isDirection(value.facing) &&
    (value.navigationDebug === undefined || isNavigationDebug(value.navigationDebug)) &&
    (value.action === null || isActionSnapshot(value.action))
  );
}

function isNavigationDebug(value: unknown): value is NavigationDebugSnapshot {
  const states = ["idle", "patrol", "chase", "return", "waiting_path", "unreachable"];
  return (
    isRecord(value) &&
    typeof value.state === "string" &&
    states.includes(value.state) &&
    Array.isArray(value.path) &&
    value.path.length <= 10_000 &&
    value.path.every(isPosition) &&
    (value.destination === null || isPosition(value.destination)) &&
    (value.reason === null || isBoundedString(value.reason, 256, true))
  );
}

function isGuardSnapshot(value: unknown): value is GuardSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.hp) &&
    value.hp >= 0 &&
    isFiniteNumber(value.maxHp) &&
    value.maxHp > 0 &&
    value.hp <= value.maxHp &&
    isFiniteNumber(value.homeX) &&
    isFiniteNumber(value.homeY) &&
    typeof value.fighting === "boolean"
  );
}

function isLootSnapshot(value: unknown): value is LootSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    (value.kind === "potion" || value.kind === "gold" || value.kind === "crystal") &&
    Number.isSafeInteger(value.amount) &&
    (value.amount as number) > 0 &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
  );
}

function isCorpseSnapshot(value: unknown): value is CorpseSnapshot {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isBoundedString(value.nick, 32) &&
    isValidClass(value.class) &&
    isValidAppearance(value.appearance) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y)
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

function isInventory(value: unknown): value is Inventory {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.potions) ||
    !isNonNegativeInteger(value.gold) ||
    !isNonNegativeInteger(value.crystals)
  ) {
    return false;
  }
  if (value.consumables === undefined) return true;
  const consumables = value.consumables;
  return (
    isRecord(consumables) && CONSUMABLE_IDS.every((id) => isNonNegativeInteger(consumables[id]))
  );
}

function isQuestState(value: unknown): value is QuestState {
  return (
    isRecord(value) &&
    (value.chapter === undefined ||
      (typeof value.chapter === "string" &&
        (QUEST_CHAPTERS as readonly string[]).includes(value.chapter))) &&
    (value.status === "available" ||
      value.status === "active" ||
      value.status === "ready" ||
      value.status === "completed") &&
    isNonNegativeInteger(value.progress) &&
    isNonNegativeInteger(value.target) &&
    (value.timerEndsAt === undefined ||
      (isFiniteNumber(value.timerEndsAt) && value.timerEndsAt >= 0))
  );
}

function isSelfState(value: unknown): value is SelfState {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.xp) ||
    !isNonNegativeInteger(value.xpToNext) ||
    !isInventory(value.inventory) ||
    !isQuestState(value.quest) ||
    !isLifeState(value.life) ||
    !(value.corpse === null || isPosition(value.corpse))
  ) {
    return false;
  }
  if (value.life === "alive" ? value.corpse !== null : value.corpse === null) return false;
  if (
    value.authoredQuests !== undefined &&
    (!Array.isArray(value.authoredQuests) ||
      value.authoredQuests.length > 64 ||
      !value.authoredQuests.every(
        (quest) =>
          isRecord(quest) &&
          typeof quest.id === "string" &&
          isBoundedString(quest.title, 64) &&
          isBoundedString(quest.description, 240, true) &&
          (quest.status === "active" || quest.status === "ready" || quest.status === "completed") &&
          Array.isArray(quest.objectives) &&
          quest.objectives.length <= 8 &&
          quest.objectives.every(
            (objective) =>
              isRecord(objective) &&
              typeof objective.id === "string" &&
              isBoundedString(objective.label, 96, true) &&
              isNonNegativeInteger(objective.progress) &&
              isNonNegativeInteger(objective.target) &&
              objective.target > 0,
          ),
      ))
  ) {
    return false;
  }
  if (
    value.resource !== undefined &&
    (!isRecord(value.resource) ||
      (value.resource.kind !== "endurance" &&
        value.resource.kind !== "energy" &&
        value.resource.kind !== "mana") ||
      !isFiniteNumber(value.resource.current) ||
      value.resource.current < 0 ||
      !isFiniteNumber(value.resource.max) ||
      value.resource.max <= 0 ||
      value.resource.current > value.resource.max)
  ) {
    return false;
  }
  if (value.serverNow !== undefined && !isFiniteNumber(value.serverNow)) return false;
  if (value.consumableCooldownUntil !== undefined && !isFiniteNumber(value.consumableCooldownUntil))
    return false;
  if (value.cooldowns !== undefined) {
    const cooldowns = value.cooldowns;
    if (
      !isRecord(cooldowns) ||
      !isFiniteNumber(cooldowns.attackUntil) ||
      !isFiniteNumber(cooldowns.healUntil) ||
      !Array.isArray(cooldowns.skillCooldowns) ||
      cooldowns.skillCooldowns.length !== 5 ||
      !cooldowns.skillCooldowns.every(isFiniteNumber) ||
      !isFiniteNumber(cooldowns.guardUntil) ||
      !isFiniteNumber(cooldowns.resurrectUntil)
    ) {
      return false;
    }
  }
  if (value.talents !== undefined) {
    const talents = value.talents;
    if (
      !isRecord(talents) ||
      !Array.isArray(talents.selected) ||
      talents.selected.length > 64 ||
      !talents.selected.every(isTalentId) ||
      !isNonNegativeInteger(talents.pointsSpent) ||
      !isNonNegativeInteger(talents.pointsAvailable)
    ) {
      return false;
    }
  }
  if (value.effects !== undefined) {
    const effects = value.effects;
    if (
      !isRecord(effects) ||
      !isFiniteNumber(effects.damageUntil) ||
      !isFiniteNumber(effects.forgottenUntil) ||
      !isFiniteNumber(effects.invisibleUntil) ||
      !isFiniteNumber(effects.resurrectionAt)
    ) {
      return false;
    }
  }
  return true;
}

function isPartyState(value: unknown): value is PartyState {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    (value.leaderId === "" || isWireId(value.leaderId)) &&
    Array.isArray(value.members) &&
    value.members.length <= 4 &&
    value.members.every(
      (member) =>
        isRecord(member) &&
        isWireId(member.id) &&
        isBoundedString(member.nick, 32) &&
        isFiniteNumber(member.hp) &&
        member.hp >= 0 &&
        isFiniteNumber(member.maxHp) &&
        member.maxHp > 0 &&
        member.hp <= member.maxHp &&
        isLifeState(member.life),
    )
  );
}

function isNpc(value: unknown): value is NpcDefinition {
  return (
    isRecord(value) && isWireId(value.id) && isFiniteNumber(value.x) && isFiniteNumber(value.y)
  );
}

function isQuestSite(value: unknown): value is QuestSite {
  return (
    isRecord(value) &&
    isWireId(value.id) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    typeof value.chapter === "string" &&
    (QUEST_CHAPTERS as readonly string[]).includes(value.chapter) &&
    (value.kind === "resource" || value.kind === "rune" || value.kind === "ward") &&
    isNonNegativeInteger(value.order) &&
    (value.art === "wood" ||
      value.art === "gold" ||
      value.art === "meat" ||
      value.art === "rune" ||
      value.art === "ward")
  );
}

/** Defensively parses the wire's flat `[x, y, w, h]` tuples into `Rect`s, the same discipline as
 *  every other wire structure: malformed input returns `null`, it never throws, and a payload
 *  larger than a map could legitimately hold is rejected outright. */
export function parseWorldColliders(value: unknown): Rect[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_MAP_ELEMENTS) return null;
  const parsed: Rect[] = [];
  for (const raw of value) {
    if (!Array.isArray(raw) || raw.length !== 4) return null;
    const [x, y, width, height] = raw;
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return null;
    }
    parsed.push({
      x: x as number,
      y: y as number,
      width: width as number,
      height: height as number,
    });
  }
  return parsed;
}

function isWorldInfo(value: unknown): value is WorldInfo {
  if (!isRecord(value) || !isZoneId(value.zoneId) || !isNonNegativeInteger(value.revision)) {
    return false;
  }
  const tiles = parseTileMap(value.tiles);
  if (!tiles || parseMapElements(value.elements, tiles.cols, tiles.rows) === null) return false;
  if (parseWorldColliders(value.colliders) === null) return false;
  return (
    isBoundedString(value.zoneNameKey, 128) &&
    typeof value.tilesetId === "string" &&
    tilesetById(value.tilesetId) !== null &&
    Array.isArray(value.layers) &&
    value.layers.length === MAP_LAYERS &&
    value.layers.every((layer) => parseTileLayer(layer, tiles.cols, tiles.rows) !== null) &&
    Array.isArray(value.events) &&
    value.events.every(
      (event) => isWorldEventSnapshot(event) && event.col < tiles.cols && event.row < tiles.rows,
    ) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0 &&
    isFiniteNumber(value.playerSize) &&
    value.playerSize > 0 &&
    Array.isArray(value.obstacles) &&
    value.obstacles.every(isRect) &&
    (value.safeZone === null || isRect(value.safeZone)) &&
    isNpc(value.questNpc) &&
    Array.isArray(value.questNpcs) &&
    value.questNpcs.every(isNpc) &&
    Array.isArray(value.questSites) &&
    value.questSites.every(isQuestSite) &&
    Array.isArray(value.cemeteries) &&
    value.cemeteries.every(isNpc) &&
    Array.isArray(value.portals) &&
    value.portals.every(
      (portal) =>
        isRecord(portal) &&
        isWireId(portal.id) &&
        isBoundedString(portal.nameKey, 128) &&
        isFiniteNumber(portal.x) &&
        isFiniteNumber(portal.y),
    ) &&
    (value.merchant === null ||
      (isRecord(value.merchant) &&
        value.merchant.id === "heartroot_merchant" &&
        isFiniteNumber(value.merchant.x) &&
        isFiniteNumber(value.merchant.y)))
  );
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
  if (value.t === "world.resync" && hasOnlyKeys(value, ["t"])) return { t: "world.resync" };
  if (
    value.t === "navigation.debug" &&
    typeof value.enabled === "boolean" &&
    hasOnlyKeys(value, ["t", "enabled"])
  )
    return { t: "navigation.debug", enabled: value.enabled };
  if (value.t === "event.advance" && isWireId(value.runId) && hasOnlyKeys(value, ["t", "runId"]))
    return { t: "event.advance", runId: value.runId };
  if (
    value.t === "event.choose" &&
    isWireId(value.runId) &&
    // A wire-level sanity bound only; the server re-validates the index against the live pending
    // offer (`resumeWithChoice` range-checks it) so a well-formed-but-wrong index is still dropped.
    typeof value.index === "number" &&
    Number.isSafeInteger(value.index) &&
    value.index >= 0 &&
    value.index < MAX_CHOICE_OPTIONS &&
    hasOnlyKeys(value, ["t", "runId", "index"])
  ) {
    return { t: "event.choose", runId: value.runId, index: value.index };
  }
  if (
    (value.t === "party.create" || value.t === "party.leave" || value.t === "party.dissolve") &&
    hasOnlyKeys(value, ["t"])
  )
    return { t: value.t };
  if (
    (value.t === "party.invite" || value.t === "party.kick") &&
    isUuid(value.playerId) &&
    hasOnlyKeys(value, ["t", "playerId"])
  )
    return { t: value.t, playerId: value.playerId };
  if (
    (value.t === "party.accept" || value.t === "party.refuse") &&
    isUuid(value.inviteId) &&
    hasOnlyKeys(value, ["t", "inviteId"])
  )
    return { t: value.t, inviteId: value.inviteId };
  if (
    value.t === "chat" &&
    typeof value.text === "string" &&
    value.text.length <= 160 &&
    (value.channel === undefined || value.channel === "local" || value.channel === "party") &&
    hasOnlyKeys(value, ["t", "channel", "text"])
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
      isNonNegativeInteger(value.tick) &&
      isWireId(value.selfId) &&
      isRecord(value.world) &&
      isWorldInfo(value.world) &&
      // A cached SPA build can be older than the server it talks to. If a future zone ever
      // reaches this client, drop the frame — like any other malformed message — rather than
      // hand an unrecognised zoneId to zoneDefinition() a frame later.
      isZoneId(value.world.zoneId) &&
      typeof value.world.revision === "number" &&
      Number.isSafeInteger(value.world.revision) &&
      value.world.revision >= 0 &&
      // The terrain arrives as data now, so it gets checked like data. `decodeTileMap` throws on a
      // ragged row or an unknown character — fine for a map read off disk at build time, fatal for
      // one arriving on a socket. Drop the frame instead of crashing the first paint. `isWorldInfo`
      // above already parses `tiles` and bounds-checks `elements` against it (it needs the same
      // cols/rows to do that), so there is nothing left to re-check here.
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
      value.players.some((player) => player.id === value.selfId) &&
      Array.isArray(value.monsters) &&
      value.monsters.every(isMonsterSnapshot) &&
      Array.isArray(value.guards) &&
      value.guards.every(isGuardSnapshot) &&
      Array.isArray(value.loot) &&
      value.loot.every(isLootSnapshot) &&
      Array.isArray(value.corpses) &&
      value.corpses.every(isCorpseSnapshot) &&
      Array.isArray(value.projectiles) &&
      value.projectiles.every(isProjectileSnapshot) &&
      isSelfState(value.self)
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "world.delta" &&
      isNonNegativeInteger(value.tick) &&
      isEntityDelta(value.players, isPlayerSnapshot) &&
      isEntityDelta(value.monsters, isMonsterSnapshot) &&
      isEntityDelta(value.guards, isGuardSnapshot) &&
      isEntityDelta(value.loot, isLootSnapshot) &&
      isEntityDelta(value.corpses, isCorpseSnapshot) &&
      isEntityDelta(value.projectiles, isProjectileSnapshot) &&
      isEntityDelta(value.events, isWorldEventSnapshot)
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "world.resync" &&
      isNonNegativeInteger(value.tick) &&
      Array.isArray(value.players) &&
      value.players.every(isPlayerSnapshot) &&
      Array.isArray(value.monsters) &&
      value.monsters.every(isMonsterSnapshot) &&
      Array.isArray(value.guards) &&
      value.guards.every(isGuardSnapshot) &&
      Array.isArray(value.loot) &&
      value.loot.every(isLootSnapshot) &&
      Array.isArray(value.corpses) &&
      value.corpses.every(isCorpseSnapshot) &&
      Array.isArray(value.projectiles) &&
      value.projectiles.every(isProjectileSnapshot) &&
      Array.isArray(value.events) &&
      value.events.every(isWorldEventSnapshot)
    ) {
      return value as unknown as ServerMessage;
    }
    if (value.t === "world.resync_required" && hasOnlyKeys(value, ["t"]))
      return { t: "world.resync_required" };
    if (value.t === "state" && isSelfState(value.self)) return value as unknown as ServerMessage;
    if (
      value.t === "chat" &&
      (value.channel === "local" || value.channel === "party") &&
      isBoundedString(value.from, 32) &&
      isBoundedString(value.text, 500)
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "party.invite" &&
      isUuid(value.inviteId) &&
      isUuid(value.fromId) &&
      isBoundedString(value.from, 32) &&
      isFiniteNumber(value.expiresAt)
    )
      return value as unknown as ServerMessage;
    if (value.t === "party.state" && (value.party === null || isPartyState(value.party)))
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
      (value.params === undefined ||
        (isRecord(value.params) &&
          Object.keys(value.params).length <= 32 &&
          Object.entries(value.params).every(
            ([key, parameter]) =>
              key.length <= 64 &&
              ((typeof parameter === "string" && parameter.length <= 256) ||
                isFiniteNumber(parameter)),
          ))) &&
      (value.tone === "info" || value.tone === "good" || value.tone === "bad") &&
      (value.x === undefined || isFiniteNumber(value.x)) &&
      (value.y === undefined || isFiniteNumber(value.y))
    ) {
      return value as unknown as ServerMessage;
    }
    // The dialogue beats. Authored prose (`text`/`name`/`prompt`/`options`) is bounded and parsed as
    // the sanctioned data exception (see `isAuthoredText`); `runId` is a wire id; `name` is optional.
    if (
      value.t === "event.say" &&
      isWireId(value.runId) &&
      isAuthoredText(value.text) &&
      (value.name === undefined || isAuthoredText(value.name))
    ) {
      return value as unknown as ServerMessage;
    }
    if (
      value.t === "event.choices" &&
      isWireId(value.runId) &&
      isAuthoredText(value.prompt) &&
      Array.isArray(value.options) &&
      value.options.length >= 1 &&
      value.options.length <= MAX_CHOICE_OPTIONS &&
      value.options.every(isAuthoredText)
    ) {
      return value as unknown as ServerMessage;
    }
    if (value.t === "event.close" && isWireId(value.runId)) {
      return value as unknown as ServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}
