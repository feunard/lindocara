import {
  normalizeAppearance,
  normalizeEquipment,
  type PrimaryColor,
  starterEquipmentFor,
} from "@lindocara/engine/character.js";
import {
  CONSUMABLE_COOLDOWN_MS,
  CONSUMABLES,
  normalizeConsumables,
} from "@lindocara/engine/consumables.js";
import { type CombatCooldownState, normalizeCombatCooldowns } from "@lindocara/engine/cooldowns.js";
import type { CombatContribution, ThreatEntry } from "@lindocara/engine/cooperation.js";
import { type LifeState, RESURRECT_COOLDOWN_MS } from "@lindocara/engine/death.js";
import {
  ATTACK_COOLDOWN_MS,
  CLASS_STATS,
  clampRestoredPosition,
  defaultMonsterTuning,
  GUARD_MAX_HP,
  type GuardDefinition,
  MONSTER_RESPAWN_MS,
  type MonsterKind,
  type MonsterRank,
  type MonsterRespawnMode,
  type MonsterSpawn,
  type MonsterSpecialTechnique,
  type MonsterSpecies,
  type MonsterWeakness,
  maxHpForLevel,
  spawnPosition,
  type TerrainGeometry,
} from "@lindocara/engine/game.js";
import { SPATIAL_CELL_SIZE } from "@lindocara/engine/interest.js";
import type { MonsterNavigationState } from "@lindocara/engine/navigation.js";
import type {
  CombatActionKind,
  Command,
  LootSnapshot,
  ProjectileKind,
  ServerMessage,
} from "@lindocara/engine/protocol.js";
import { type ClassResourceState, initialResource } from "@lindocara/engine/resources.js";
import { type Input, NO_INPUT, TICK_HZ, type Vec2 } from "@lindocara/engine/simulation.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { normalizeTalentSelection } from "@lindocara/engine/talents.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { createWorldCache, type WorldCache } from "@lindocara/engine/world-delta.js";
import type { ZoneDefinition, ZoneLocation } from "@lindocara/engine/zones.js";
import type { PlayerProfile, SaveableProfile } from "../profile-types.js";
import { SpatialGrid } from "./spatial-grid.js";

/**
 * Copied verbatim from `../character-presence.ts`'s `PRESENCE_HEARTBEAT_MS` rather than imported:
 * that module imports `cloudflare:workers` (it defines a Durable Object), and this file is now also
 * loaded by the Node-hosted Alepha realtime rooms (`src/api/realtime/`), where that specifier does
 * not resolve. Every world system must stay platform-free the way `@lindocara/engine` is. The value
 * only seeds `newPlayer`'s first heartbeat; the room re-arms it against its own configured clock
 * (`World.#addPlayer`), so a drift here would cost one early heartbeat, never correctness — but if
 * the legacy constant ever changes, re-copy it by hand.
 */
const PRESENCE_HEARTBEAT_MS = 10_000;

/**
 * The appearance-only projection of an authored event whose active page currently holds — the
 * third member of the `elements`/`layers` family, carrying the same rule: never a source of
 * collision, movement or command execution. The room re-derives this list only when the party's
 * adventure-state snapshot changes or a hero joins, never per tick. Task 4 puts exactly this shape
 * on the wire; this tranche only holds it in the room.
 */
export interface ActiveWorldEvent {
  id: string;
  col: number;
  row: number;
  graphicAssetId: EditorAssetId | null;
  graphicTint?: number;
  onTop: boolean;
  moveSpeed: number;
  moveFrequency: number;
  moveAnimation: boolean;
  directionFixed: boolean;
}

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
  talents?: PlayerProfile["talents"];
  ack?: number;
  lastSeq?: number;
  connectionId?: string;
  roomKey?: string;
  sessionEpoch?: number;
  zoneId?: string;
  instanceId?: string;
  wardRunExpiresAt?: number | null;
  resource?: ClassResourceState;
  cooldowns?: CombatCooldownState;
  identityKind?: "character" | "hero";
  partyId?: string | null;
  consumableCooldownUntil?: number;
  damageBoostUntil?: number;
  forgottenUntil?: number;
  invisibleUntil?: number;
  resurrectionAt?: number;
}

export interface PlayerInterest {
  players: Set<string>;
  monsters: Set<string>;
  loot: Set<string>;
}

export interface CombatActionRuntime {
  id: string;
  kind: CombatActionKind;
  skillId?: string;
  slot?: number;
  direction: Vec2;
  startedAt: number;
  impactAt: number;
  recoveryEndsAt: number;
  /** Set only after a held action is released or reaches an authoritative bound. */
  channelEndsAt?: number;
  /** Hard server deadline used when the release intent is lost. Never sent to the client. */
  channelMaxEndsAt?: number;
  /** Recovery appended when a held action finishes. Never sent to the client. */
  channelRecoveryMs?: number;
  resolved: boolean;
  /** Remaining collision-resolved travel budget for a held mobility action. */
  mobilityDistance?: number;
  /** Server-only per-cast set preventing Sacred Passage from healing one ally more than once. */
  sacredPassageHealedIds?: Set<string>;
  /** Fully server-authored Shadow Step target and collision-validated landing. */
  rogueShadowStep?: {
    targetId: string;
    destination: Vec2;
    /** Frozen from the selected Tier 4 talent when the server accepts this cast. */
    phaseThroughObstacles: boolean;
  };
  /** Free second leg of Percée inexorable; the first collision target is excluded. */
  warriorChargeFollowup?: { excludedTargetId: string };
  /** Frozen server-selected target for Proie jurée. */
  rangerSwornPreyTargetId?: string;
  /** Frozen departure point for Porte de Lumen. */
  priestLumenOrigin?: Vec2;
}

export interface WarriorCycloneRuntime {
  actionId: string;
  nextTickAt: number;
  ticksRemaining: number;
  intervalMs: number;
  radius: number;
  power: number;
}

export interface WarriorChargeFollowupRuntime {
  excludedTargetId: string;
  expiresAt: number;
}

export interface WarriorVortexRuntime extends Vec2 {
  expiresAt: number;
  nextPulseAt: number;
  pulseIntervalMs: number;
  radius: number;
  pullDistance: number;
  slowRatio: number;
  slowDurationMs: number;
  followsOwner: boolean;
}

export interface RangerVolleySalvoRuntime {
  actionId: string;
  animationAt: number;
  impactAt: number;
  recoveryEndsAt: number;
  animationSent: boolean;
  fired: boolean;
}

export interface RangerVolleySequenceRuntime {
  direction: Vec2;
  salvos: RangerVolleySalvoRuntime[];
}

export interface RangerAfterimageRuntime extends Vec2 {
  expiresAt: number;
}

export interface RogueSilhouetteRuntime extends Vec2 {
  expiresAt: number;
  hp: number;
}

export interface RogueDanceMarkRuntime {
  targetId: string;
  expiresAt: number;
}

export interface PriestLifeLinkRuntime {
  targetId: string;
  expiresAt: number;
  range: number;
  ratio: number;
  maximumMirroredPower: number;
}

export interface PriestSoulAnchorRuntime extends Vec2 {
  ownerId: string;
  expiresAt: number;
  cleansePoison: boolean;
}

export type RogueOpeningSource = "shadow_step" | "vanish";

export interface RogueOpeningRuntime {
  source: RogueOpeningSource;
  expiresAt: number;
  bonusRatio: number;
  /** Optional target-specific execution bookkeeping added by the final Shadow Step evolution. */
  executionTargetId?: string;
}

export interface RogueShadowReturnRuntime extends Vec2 {
  expiresAt: number;
}

export interface RogueExecutionRuntime {
  targetId: string;
  expiresAt: number;
}

export type CleanseableNegativeEffect = "poison";

export interface NegativeEffectRuntime {
  kind: CleanseableNegativeEffect;
  sourceId: string;
  expiresAt: number;
}

export type ProjectileTargetFilter = "monsters" | "wounded_allies";

export interface ProjectileRuntime extends Vec2 {
  id: string;
  actionId: string;
  ownerId: string;
  ownerPartyId: string | null;
  color: PrimaryColor;
  roomKey: string;
  kind: ProjectileKind;
  targetFilter: ProjectileTargetFilter;
  direction: Vec2;
  speed: number;
  radius: number;
  rangeRemaining: number;
  power: number;
  pierceRemaining: number;
  hitEntityIds: Set<string>;
  spawnedAt: number;
  expiresAt: number;
  sourceSkillId: string;
  basic: boolean;
  /** Volley projectiles from one cast share this set so one monster receives its power once. */
  activationHitEntityIds?: Set<string>;
  /** Focused Volley arrows share per-target hit counts for bounded diminishing impacts. */
  activationHitCounts?: Map<string, number>;
  /** Bounded server-only bounce budget for talented projectiles. */
  ricochetRemaining: number;
  /** Piercing Arrow's return leg keeps the original hit set. */
  returningToOwner?: boolean;
  returnRange?: number;
  returnPierce?: number;
  /** Heartseeker guidance turns gradually; terrain and interception still decide the hit. */
  homingTargetId?: string;
  homingTurnRateRadians?: number;
}

export interface PlayerRuntime extends PlayerProfile {
  identityKind: "character" | "hero";
  partyId: string | null;
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
  guarding: boolean;
  guardReduction: number;
  guardActivatedAt: number;
  /** Room-local King's Challenge mitigation. Never serialized or persisted. */
  challengeReductionUntil: number;
  challengeReduction: number;
  /** Room-local Rallying Cry power buff. Multiple warriors refresh one bounded value. */
  rallyPowerUntil: number;
  rallyPowerMultiplier: number;
  /** Server tick-driven Cyclone sequence. No autonomous timers are created per cast. */
  warriorCyclone: WarriorCycloneRuntime | null;
  /** Room-local ultimate windows and reservoirs. Never serialized or persisted. */
  warriorChargeFollowup: WarriorChargeFollowupRuntime | null;
  warriorCounterReserve: number;
  warriorBannerChallengeUntil: number;
  warriorBannerChallengeReduction: number;
  warriorBannerPower: Map<string, { multiplier: number; expiresAt: number }>;
  warriorVortex: WarriorVortexRuntime | null;
  rangerVolleySequence: RangerVolleySequenceRuntime | null;
  rangerAfterimage: RangerAfterimageRuntime | null;
  priestLifeLinks: PriestLifeLinkRuntime[];
  priestSoulAnchor: PriestSoulAnchorRuntime | null;
  /** Server-only Rogue windows. They are reset on every runtime/session boundary. */
  opening: RogueOpeningRuntime | null;
  rogueStealthUntil: number;
  rogueSmokeProtectionUntil: number;
  roguePredatorShivUntil: number;
  rogueShadowDanceInvulnerableUntil: number;
  rogueShadowReturn: RogueShadowReturnRuntime | null;
  rogueExecution: RogueExecutionRuntime | null;
  rogueSilhouette: RogueSilhouetteRuntime | null;
  rogueDanceMarks: RogueDanceMarkRuntime[];
  /** Deliberately limited cleanse surface; currently only poison is compatible. */
  negativeEffects: Map<CleanseableNegativeEffect, NegativeEffectRuntime>;
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
  /** Local test flag. Never serialized or persisted; reconnecting always disables it. */
  cheatInvulnerable: boolean;
  talents: string[];
  action: CombatActionRuntime | null;
  consumableCooldownUntil: number;
  damageBoostUntil: number;
  forgottenUntil: number;
  invisibleUntil: number;
  resurrectionAt: number;
  /**
   * The counter of the shop this hero currently has open, in world pixels — the cell of the `openShop`
   * event that served them. Room-local and never persisted: a shop is a conversation, not a state.
   *
   * The buy path measures against THIS rather than a room-global merchant, which is what lets a map
   * carry several traders and what stops a hero buying from across the map after walking away.
   */
  shopAnchor: Vec2 | null;
}

export interface MonsterRuntime extends Vec2 {
  id: string;
  name: string;
  kind: MonsterKind;
  species: MonsterSpecies;
  rank: MonsterRank;
  spawnX: number;
  spawnY: number;
  patrolRadius: number;
  mayEnterSafeZone?: boolean;
  hp: number;
  maxHp: number;
  damage: number;
  speed: number;
  /** Temporary movement penalty; reset on respawn and never serialized. */
  slowUntil: number;
  slowMultiplier: number;
  revealedUntil: number;
  xp: number;
  weakness: MonsterWeakness;
  weaknessPercent: number;
  specialTechnique: MonsterSpecialTechnique;
  respawnMode: MonsterRespawnMode;
  respawnDelayMs: number;
  nextSpecialAt: number;
  lastAttackAt: number;
  deadUntil: number;
  vx: number;
  vy: number;
  threat: Map<string, ThreatEntry>;
  contributions: Map<string, CombatContribution>;
  rewardsGranted: boolean;
  navigation: MonsterNavigationRuntime;
  facing: Vec2;
  action: CombatActionRuntime | null;
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
  hp: number;
  maxHp: number;
  homeX: number;
  homeY: number;
  patrolRadius: number;
  lastAttackAt: number;
  fightingUntil: number;
  graphicAssetId: EditorAssetId | null;
  graphicTint: number;
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
    inventory: {
      ...player.inventory,
      consumables: normalizeConsumables(player.inventory.consumables, player.inventory.potions),
    },
    quest: { ...player.quest },
    zoneId: player.zoneId,
    instanceId: player.instanceId,
    sessionEpoch: player.sessionEpoch,
    wardRunExpiresAt: player.wardRunExpiresAt,
    life: player.life,
    corpse: player.corpse === null ? null : { ...player.corpse },
    talents: [...player.talents],
    cooldowns: combatCooldownsFromPlayer(player),
    consumableCooldownUntil: player.consumableCooldownUntil,
    damageBoostUntil: player.damageBoostUntil,
    forgottenUntil: player.forgottenUntil,
    invisibleUntil: player.invisibleUntil,
    resurrectionAt: player.resurrectionAt,
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
    identityKind: player.identityKind,
    partyId: player.partyId,
    consumableCooldownUntil: player.consumableCooldownUntil,
    damageBoostUntil: player.damageBoostUntil,
    forgottenUntil: player.forgottenUntil,
    invisibleUntil: player.invisibleUntil,
    resurrectionAt: player.resurrectionAt,
  };
}

export function newPlayer(
  profile: PlayerProfile,
  connectionId: string,
  roomKey: string,
  ack = 0,
  lastSeq = 0,
  restoredResource?: ClassResourceState,
  restoredCooldowns?: CombatCooldownState,
  now = Date.now(),
): PlayerRuntime {
  const resource = initialResource(profile.class);
  const persistedResource = restoredResource ?? profile.resource;
  if (
    resource &&
    persistedResource?.kind === resource.kind &&
    Number.isFinite(persistedResource.current)
  )
    resource.current = Math.max(0, Math.min(resource.max, persistedResource.current));
  const persistedCooldowns = normalizeCombatCooldowns(profile.cooldowns, now);
  const presenceCooldowns = normalizeCombatCooldowns(restoredCooldowns, now);
  const cooldowns: CombatCooldownState = {
    attackUntil: Math.max(persistedCooldowns.attackUntil, presenceCooldowns.attackUntil),
    healUntil: Math.max(persistedCooldowns.healUntil, presenceCooldowns.healUntil),
    skillCooldowns: persistedCooldowns.skillCooldowns.map((deadline, index) =>
      Math.max(deadline, presenceCooldowns.skillCooldowns[index] ?? 0),
    ),
    guardUntil: 0,
    resurrectUntil: Math.max(persistedCooldowns.resurrectUntil, presenceCooldowns.resurrectUntil),
  };
  // A fresh session never arrives mid-purchase: a shop is opened by talking to its keeper.
  const shopAnchor = null;
  const healCooldownMs = CLASS_STATS[profile.class].heal?.cooldownMs ?? 0;
  const guardReduction =
    CLASS_SKILLS[profile.class].find((skill) => skill.effect === "guard")?.reduction ?? 0;
  return {
    ...profile,
    shopAnchor,
    appearance: { ...profile.appearance },
    equipment: { ...profile.equipment },
    corpse: profile.corpse === null ? null : { ...profile.corpse },
    inventory: {
      ...profile.inventory,
      consumables: normalizeConsumables(profile.inventory.consumables, profile.inventory.potions),
    },
    quest: { ...profile.quest },
    queue: [],
    lastInput: NO_INPUT,
    ack,
    lastSeq,
    starvedTicks: 0,
    dirty: false,
    lastAttackAt: cooldowns.attackUntil === 0 ? 0 : cooldowns.attackUntil - ATTACK_COOLDOWN_MS,
    lastHealAt: cooldowns.healUntil === 0 ? 0 : cooldowns.healUntil - healCooldownMs,
    skillCooldowns: [...cooldowns.skillCooldowns],
    // Iron Guard is now a session-local toggle. A reconnect always returns in neutral posture.
    guardUntil: 0,
    guarding: false,
    guardReduction,
    guardActivatedAt: 0,
    challengeReductionUntil: 0,
    challengeReduction: 0,
    rallyPowerUntil: 0,
    rallyPowerMultiplier: 0,
    warriorCyclone: null,
    warriorChargeFollowup: null,
    warriorCounterReserve: 0,
    warriorBannerChallengeUntil: 0,
    warriorBannerChallengeReduction: 0,
    warriorBannerPower: new Map(),
    warriorVortex: null,
    rangerVolleySequence: null,
    rangerAfterimage: null,
    priestLifeLinks: [],
    priestSoulAnchor: null,
    opening: null,
    rogueStealthUntil: 0,
    rogueSmokeProtectionUntil: 0,
    roguePredatorShivUntil: 0,
    rogueShadowDanceInvulnerableUntil: 0,
    rogueShadowReturn: null,
    rogueExecution: null,
    rogueSilhouette: null,
    rogueDanceMarks: [],
    negativeEffects: new Map(),
    lastResurrectAt:
      cooldowns.resurrectUntil === 0 ? 0 : cooldowns.resurrectUntil - RESURRECT_COOLDOWN_MS,
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
    cheatInvulnerable: false,
    talents: normalizeTalentSelection(profile.class, profile.level, profile.talents),
    action: null,
    identityKind: "character",
    partyId: null,
    consumableCooldownUntil: boundedFutureDeadline(
      profile.consumableCooldownUntil,
      now,
      CONSUMABLE_COOLDOWN_MS,
    ),
    damageBoostUntil: boundedFutureDeadline(
      profile.damageBoostUntil,
      now,
      CONSUMABLES.damage_elixir.durationMs,
    ),
    forgottenUntil: boundedFutureDeadline(
      profile.forgottenUntil,
      now,
      CONSUMABLES.oblivion_draught.durationMs,
    ),
    invisibleUntil: boundedFutureDeadline(
      profile.invisibleUntil,
      now,
      CONSUMABLES.invisibility_potion.durationMs,
    ),
    resurrectionAt: boundedResurrectionAt(profile.resurrectionAt, now),
  };
}

function boundedFutureDeadline(value: unknown, now: number, maximumAheadMs: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= now) return 0;
  return value <= now + maximumAheadMs ? value : 0;
}

function boundedResurrectionAt(value: unknown, now: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  if (value <= now) return now;
  return value <= now + CONSUMABLES.resurrection_potion.durationMs ? value : 0;
}

export function combatCooldownsFromPlayer(
  player: PlayerRuntime,
  now = Date.now(),
): CombatCooldownState {
  const healCooldownMs = CLASS_STATS[player.class].heal?.cooldownMs ?? 0;
  return normalizeCombatCooldowns(
    {
      attackUntil: player.lastAttackAt + ATTACK_COOLDOWN_MS,
      healUntil: player.lastHealAt + healCooldownMs,
      skillCooldowns: player.skillCooldowns,
      guardUntil: 0,
      resurrectUntil: player.lastResurrectAt + RESURRECT_COOLDOWN_MS,
    },
    now,
  );
}

export function profileFromAttachment(
  attachment: Attachment,
  terrain?: TerrainGeometry,
): PlayerProfile {
  const level = attachment.level ?? 1;
  const playerClass = attachment.class ?? "warrior";
  return {
    id: attachment.id,
    nick: attachment.nick,
    ...clampRestoredPosition(attachment, attachment.id, terrain),
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
      consumables: normalizeConsumables(
        attachment.inventory?.consumables,
        attachment.inventory?.potions ?? 2,
      ),
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
    talents: normalizeTalentSelection(playerClass, level, attachment.talents),
    ...(attachment.cooldowns ? { cooldowns: attachment.cooldowns } : {}),
    consumableCooldownUntil: attachment.consumableCooldownUntil ?? 0,
    damageBoostUntil: attachment.damageBoostUntil ?? 0,
    forgottenUntil: attachment.forgottenUntil ?? 0,
    invisibleUntil: attachment.invisibleUntil ?? 0,
    resurrectionAt: attachment.resurrectionAt ?? 0,
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
    const defaults = defaultMonsterTuning(spawn.species);
    const tuning = {
      ...defaults,
      ...(spawn.rank ? { rank: spawn.rank } : {}),
      ...(spawn.maxHp === undefined ? {} : { maxHp: spawn.maxHp }),
      ...(spawn.damage === undefined ? {} : { damage: spawn.damage }),
      ...(spawn.speed === undefined ? {} : { speed: spawn.speed }),
      ...(spawn.xp === undefined ? {} : { xp: spawn.xp }),
      ...(spawn.weakness ? { weakness: spawn.weakness } : {}),
      ...(spawn.weaknessPercent === undefined ? {} : { weaknessPercent: spawn.weaknessPercent }),
      ...(spawn.specialTechnique ? { specialTechnique: spawn.specialTechnique } : {}),
    };
    return {
      ...spawn,
      name: spawn.name ?? "",
      rank: tuning.rank,
      spawnX: spawn.x,
      spawnY: spawn.y,
      hp: tuning.maxHp,
      maxHp: tuning.maxHp,
      damage: tuning.damage,
      speed: tuning.speed,
      slowUntil: 0,
      slowMultiplier: 1,
      revealedUntil: 0,
      xp: tuning.xp,
      weakness: tuning.weakness,
      weaknessPercent: tuning.weaknessPercent,
      specialTechnique: tuning.specialTechnique,
      respawnMode: spawn.respawnMode ?? "timed",
      respawnDelayMs: spawn.respawnDelayMs ?? MONSTER_RESPAWN_MS,
      nextSpecialAt: 0,
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
      facing: { x: 1, y: 0 },
      action: null,
    };
  });
}

export function createGuards(definitions: readonly GuardDefinition[]): GuardRuntime[] {
  return definitions.map((guard) => ({
    ...guard,
    hp: GUARD_MAX_HP,
    maxHp: GUARD_MAX_HP,
    homeX: guard.x,
    homeY: guard.y,
    lastAttackAt: 0,
    fightingUntil: 0,
    graphicAssetId: guard.graphicAssetId ?? null,
    graphicTint: guard.graphicTint ?? 0xffffff,
  }));
}
