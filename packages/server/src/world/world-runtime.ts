import {
  normalizeAppearance,
  normalizeEquipment,
  type PrimaryColor,
  starterEquipmentFor,
} from "@lindocara/engine/character.js";
import { resolveMonsterAttackProfile } from "@lindocara/engine/combat-actions.js";
import {
  CONSUMABLE_COOLDOWN_MS,
  CONSUMABLES,
  normalizeConsumables,
} from "@lindocara/engine/consumables.js";
import { type CombatCooldownState, normalizeCombatCooldowns } from "@lindocara/engine/cooldowns.js";
import type { CombatContribution, ThreatEntry } from "@lindocara/engine/cooperation.js";
import { type LifeState, RESURRECT_COOLDOWN_MS } from "@lindocara/engine/death.js";
import {
  CLASS_STATS,
  defaultMonsterTuning,
  GUARD_MAX_HP,
  type GuardDefinition,
  MONSTER_RESPAWN_MS,
  type MonsterAttackProfile,
  type MonsterKind,
  type MonsterPursuitMode,
  type MonsterRank,
  type MonsterRespawnMode,
  type MonsterSpawn,
  type MonsterSpecialTechnique,
  type MonsterSpecies,
  type MonsterWeakness,
  maxHpForLevel,
} from "@lindocara/engine/game.js";
import type { GroundVector, WorldPosition } from "@lindocara/engine/ground.js";
import type { HarvestTool, PeasantCarryKind } from "@lindocara/engine/harvest.js";
import { SPATIAL_CELL_SIZE } from "@lindocara/engine/interest.js";
import type {
  ActiveMovementEffect,
  MovementEffectKind,
} from "@lindocara/engine/movement-effects.js";
import type { MonsterNavigationState } from "@lindocara/engine/navigation.js";
import type {
  CombatActionKind,
  LootSnapshot,
  ProjectileKind,
  ServerMessage,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import { type ClassResourceState, initialResource } from "@lindocara/engine/resources.js";
import { TICK_HZ } from "@lindocara/engine/simulation.js";
import { CLASS_SKILLS } from "@lindocara/engine/skills.js";
import { normalizeTalentSelection, skillWithTalents } from "@lindocara/engine/talents.js";
import { restoreStandablePosition, type ZoneTerrain } from "@lindocara/engine/terrain-access.js";
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

function attackCooldownMs(
  playerClass: PlayerProfile["class"],
  talents: PlayerProfile["talents"] = [],
): number {
  return skillWithTalents(playerClass, talents, 1).cooldownMs;
}

/**
 * The server-selected projection of an authored event whose active page currently holds. Graphic
 * fields remain appearance-only; an explicit harvest lifecycle may additionally carry its current
 * authoritative collider. Ordinary page evaluation runs on state changes and joins, while the
 * narrow harvest lifecycle projection refreshes timed respawns from the tick.
 */
export interface ActiveWorldEvent extends WorldEventSnapshot {
  graphicAssetId: EditorAssetId | null;
}

export const ATTACHMENT_EVERY_TICKS = TICK_HZ;
export const D1_SAVE_EVERY_TICKS = TICK_HZ * 5;
export const MAX_FRAME_BYTES = 2_048;
export const RATE_WINDOW_MS = 1_000;
export const RATE_MAX_MESSAGES = 35;
export const MAX_MALFORMED = 5;
export const CHAT_MAX_LENGTH = 160;
export const RESYNC_COOLDOWN_MS = 1_000;

/**
 * The ground-plane vocabulary now lives in `@lindocara/engine/ground.js`, beside the
 * `groundDistance` helper that measures in it: the server, the wire and (from Phase B) the client
 * all speak it, and one declaration is what keeps two of them from drifting. Re-exported here so
 * every world system keeps importing it from the module that owns the runtimes.
 */
export type { GroundVector, WorldPosition };

export interface Attachment extends WorldPosition {
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

/**
 * The two capabilities the world systems actually need from the room's spatial index, on the
 * GROUND plane.
 *
 * They are declared as capabilities rather than as `SpatialGrid<T>` because the grid is still
 * planar-pixel — `SpatialEntity extends Vec2`, so it indexes a converted entity's ground `x`
 * against its ELEVATION `y` — and converting it is Task 6's. Naming what is used keeps each
 * system's own contract correct in tile units today, lets a ground-correct index satisfy it with
 * no further change, and leaves the mismatch loud at the ONE place that composes the two (the
 * room) instead of scattered through the systems.
 */
export interface GroundIndexQuery<T> {
  queryRadius(position: GroundVector, radius: number): T[];
}

export interface GroundIndexUpdate<T> {
  update(entity: T, previousPosition: GroundVector): void;
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
  /** Frozen contextual tool for a Peasant basic attack. */
  peasantTool?: HarvestTool;
  slot?: number;
  direction: GroundVector;
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
    destination: WorldPosition;
    /** Frozen from the selected Tier 4 talent when the server accepts this cast. */
    phaseThroughObstacles: boolean;
  };
  /** Free second leg of Percée inexorable; the first collision target is excluded. */
  warriorChargeFollowup?: { excludedTargetId: string };
  /** Frozen server-selected target for Proie jurée. */
  rangerSwornPreyTargetId?: string;
  /** Frozen departure point for safe rematerialisation and Porte de Lumen. */
  priestLumenOrigin?: WorldPosition;
  /** Server-owned persistent Sacred Passage trail extended by each authoritative movement step. */
  priestLumenTrailId?: string;
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

export interface WarriorVortexRuntime extends WorldPosition {
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
  direction: GroundVector;
  salvos: RangerVolleySalvoRuntime[];
}

export interface RangerAfterimageRuntime extends WorldPosition {
  expiresAt: number;
}

export interface RogueSilhouetteRuntime extends WorldPosition {
  expiresAt: number;
  hp: number;
}

export interface RogueDanceMarkRuntime {
  targetId: string;
  availableAt: number;
  expiresAt: number;
}

export interface PriestLifeLinkRuntime {
  targetId: string;
  expiresAt: number;
  range: number;
  ratio: number;
  maximumMirroredPower: number;
}

export interface PriestSoulAnchorRuntime extends WorldPosition {
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

export interface RogueShadowReturnRuntime extends WorldPosition {
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

export type ProjectileTargetFilter = "monsters" | "wounded_allies" | "players_and_guards";

export interface ProjectileRuntime extends WorldPosition {
  id: string;
  actionId: string;
  ownerId: string;
  ownerPartyId: string | null;
  color: PrimaryColor;
  roomKey: string;
  kind: ProjectileKind;
  targetFilter: ProjectileTargetFilter;
  direction: GroundVector;
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

/**
 * A connected hero, alive in a room. Its position — `x`/`z` on the ground, `y` for elevation, all
 * in tile units — is inherited from `PlayerProfile`, which is also the shape that gets saved, so
 * the runtime and the save cannot disagree about how many axes a hero has.
 */
export interface PlayerRuntime extends PlayerProfile {
  identityKind: "character" | "hero";
  partyId: string | null;
  /**
   * The three locomotion flags the hero's own client reports alongside its position
   * (`MoveMessage`). The room stores and relays them; it never derives them, because a position
   * stream cannot tell a jump, a swim and an open canopy apart — which is exactly what a remote
   * renderer needs in order to draw the difference.
   */
  airborne: boolean;
  swimming: boolean;
  gliding: boolean;
  /** Client-reported vertical velocity. Presentation only; never used for an outcome. */
  vy: number;
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
  /** Room-local visual reward flourish. Shared materials never live on the player. */
  peasantCarry: { kind: PeasantCarryKind; until: number } | null;
  /** Short room-local marker refreshed while this hero truly stands inside an allied camp. */
  campHealingUntil: number;
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
  facing: GroundVector;
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
  /** Temporary authored pickup grants. Room-local and never persisted. */
  movementEffects: Map<MovementEffectKind, ActiveMovementEffect>;
  /**
   * The counter of the shop this hero currently has open, in tile units — the cell of the `openShop`
   * event that served them. Room-local and never persisted: a shop is a conversation, not a state.
   *
   * The buy path measures against THIS rather than a room-global merchant, which is what lets a map
   * carry several traders and what stops a hero buying from across the map after walking away.
   */
  shopAnchor: WorldPosition | null;
  /**
   * How many times the ROOM has moved this hero — a ghost release, a Pas de Lumen landing, an
   * authored teleport, a charge.
   *
   * The client owns where its hero is (the S3 spec, decision 4) and reports it at 20 Hz, so a
   * server-authored displacement races the frames already in flight: those were computed from where
   * the hero used to be, and a room that stored them would let the last stale one undo the
   * displacement. This counter is what tells the two apart. It ships to its owner inside
   * `SelfState.displacement` together with the position it stamps, comes back on every `MoveMessage`,
   * and a frame whose stamp is not the current one is dropped (`applyReportedMove`).
   *
   * Monotone and room-local: never persisted, never read from a client, and reset by the fresh
   * runtime a cross-map handoff builds — the destination's welcome re-seeds the client from it.
   */
  displacement: number;
  /** One server-granted velocity carried by the current displacement stamp. */
  displacementImpulse: WorldPosition | null;
  /** The last `displacement` value actually shipped in a `SelfState`. The gap between the two is
   *  what `announceDisplacements` (`worldTick.ts`) owes the client before the next snapshot. */
  displacementAnnounced: number;
}

export interface MonsterRuntime extends WorldPosition {
  id: string;
  name: string;
  kind: MonsterKind;
  species: MonsterSpecies;
  attackProfile: MonsterAttackProfile;
  graphicAssetId: EditorAssetId | null;
  rank: MonsterRank;
  /** Authored start restored on respawn. `spawnY` selects the correct stacked storey. */
  spawnX: number;
  spawnY: number;
  spawnZ: number;
  patrolRadius: number;
  mayEnterSafeZone?: boolean;
  hp: number;
  maxHp: number;
  damage: number;
  /** Authored movement speed restored whenever a new run starts. */
  baseSpeed: number;
  speed: number;
  pursuitMode: MonsterPursuitMode;
  acceleration: number;
  maxSpeed: number;
  oneHitKill: boolean;
  /** First beat of the current runner chase; null while no living hero is being pursued. */
  pursuitStartedAt: number | null;
  /** Incremented on authoritative teleports so remote clients do not interpolate through them. */
  positionRevision: number;
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
  /** Horizontal velocity. Relentless runner pursuers may temporarily leave the ground. */
  vx: number;
  vz: number;
  /** Server-authored ballistic crossing used only by relentless pursuers. */
  runnerLeap: MonsterRunnerLeapRuntime | null;
  threat: Map<string, ThreatEntry>;
  contributions: Map<string, CombatContribution>;
  rewardsGranted: boolean;
  navigation: MonsterNavigationRuntime;
  facing: GroundVector;
  action: CombatActionRuntime | null;
}

export interface MonsterRunnerLeapRuntime {
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  startedAt: number;
  endsAt: number;
}

/**
 * A monster's path is a plan across the ground plane: waypoints are `GroundVector`s and the
 * elevation under each is whatever the terrain says when the monster gets there. Storing a `y`
 * per waypoint would freeze a height the heightfield already owns.
 */
export interface MonsterNavigationRuntime {
  state: MonsterNavigationState;
  path: GroundVector[];
  pathIndex: number;
  destination: GroundVector | null;
  requestedDestination: GroundVector | null;
  targetId: string | null;
  requestId: number;
  requestPending: boolean;
  lastPathRequestAt: number;
  unreachableTargetId: string | null;
  unreachableUntil: number;
  abandonReason: string | null;
  directBlockedDestination: GroundVector | null;
}

export interface GuardRuntime extends WorldPosition {
  id: string;
  hp: number;
  maxHp: number;
  /** The post it patrols around, on the ground plane. */
  homeX: number;
  homeZ: number;
  patrolRadius: number;
  lastAttackAt: number;
  fightingUntil: number;
  graphicAssetId: EditorAssetId | null;
  graphicTint: number;
}

/**
 * A dropped item lying in the room. It takes everything but its position from the wire snapshot;
 * the position is the runtime's own three axes, because `LootSnapshot` still carries the pixel
 * world's two-axis `x`/`y` until the wire itself is converted. Omitting rather than inheriting
 * those two fields is what makes the serialization boundary a compile error instead of a silent
 * reinterpretation of `y`.
 */
export interface GroundLoot extends Omit<LootSnapshot, "x" | "y">, WorldPosition {
  expiresAt: number;
  ownerId?: string;
}

export interface PersistenceServices {
  save(player: PlayerRuntime, socket: WebSocket, force?: boolean): Promise<boolean>;
  rejectStaleSave(socket: WebSocket, player: PlayerRuntime): void;
}

export interface InternalWorldEvent {
  message: ServerMessage;
  position?: WorldPosition;
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

/**
 * The saved shape of a hero. All three axes travel together: `x`/`z` are where they stand and `y`
 * is how high, in tile units. Dropping `z` here would typecheck as long as `y` still existed and
 * would only surface as a hero reappearing on the wrong side of the map after a reconnect.
 */
export function toProfile(player: PlayerRuntime): SaveableProfile {
  return {
    id: player.id,
    nick: player.nick,
    x: player.x,
    y: player.y,
    z: player.z,
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
    harvestGoldLedgerBaseline: Math.max(0, player.harvestGoldLedgerBaseline ?? 0),
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

/**
 * The room moves a hero. **Every server-authored position write goes through here, and there is no
 * second way to do it** — `applyReportedMove` (`worldTick.ts`), which stores what the CLIENT
 * reports, is the only other place in this package that assigns `player.x`.
 *
 * Two things it exists to make impossible at once:
 *
 * - **A half-written position.** `x` and `z` are the two GROUND axes and `y` is ELEVATION; a write
 *   that carries two of the three typechecks fine and puts the world on its side. This branch has
 *   already shipped that twice. One writer, all three axes.
 * - **A displacement silently undone.** Bumping {@link PlayerRuntime.displacement} is what makes the
 *   client frames still in flight — computed from where the hero used to be — droppable. Sprinkling
 *   the increment across fourteen call sites is the same trap with a second face: the fifteenth
 *   would forget it, and nothing would fail.
 *
 * A write that changes nothing is not a displacement and does not stamp one: there is no in-flight
 * frame that could undo a move to where the hero already stands, and stamping it would spend a
 * client round trip re-adopting a position it already holds.
 *
 * It updates no spatial index and sends nothing. Callers keep both, because the index update needs
 * the previous position they already hold and the send needs their connection id.
 */
export function displacePlayer(player: PlayerRuntime, position: WorldPosition): boolean {
  if (player.x === position.x && player.y === position.y && player.z === position.z) return false;
  player.x = position.x;
  player.y = position.y;
  player.z = position.z;
  player.displacementImpulse = null;
  player.displacement += 1;
  player.dirty = true;
  return true;
}

/** Stamp a server-granted velocity even when the hero remains at the same position. */
export function impulsePlayer(player: PlayerRuntime, impulse: WorldPosition): void {
  player.displacementImpulse = { ...impulse };
  player.displacement += 1;
  player.dirty = true;
}

export function newPlayer(
  profile: PlayerProfile,
  connectionId: string,
  roomKey: string,
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
    harvestGoldLedgerBaseline: Math.max(0, profile.harvestGoldLedgerBaseline ?? 0),
    shopAnchor,
    appearance: { ...profile.appearance },
    equipment: { ...profile.equipment },
    corpse: profile.corpse === null ? null : { ...profile.corpse },
    inventory: {
      ...profile.inventory,
      consumables: normalizeConsumables(profile.inventory.consumables, profile.inventory.potions),
    },
    quest: { ...profile.quest },
    // A hero enters standing on the ground: the client's first `move` frame replaces all three the
    // instant it reports.
    airborne: false,
    swimming: false,
    gliding: false,
    vy: 0,
    // Nobody has been moved by the room yet, and the welcome ships this same zero: the client's
    // first report echoes it back and is accepted.
    displacement: 0,
    displacementImpulse: null,
    displacementAnnounced: 0,
    dirty: false,
    lastAttackAt:
      cooldowns.attackUntil === 0
        ? 0
        : cooldowns.attackUntil - attackCooldownMs(profile.class, profile.talents),
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
    peasantCarry: null,
    campHealingUntil: 0,
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
    movementEffects: new Map(),
    lastResurrectAt:
      cooldowns.resurrectUntil === 0 ? 0 : cooldowns.resurrectUntil - RESURRECT_COOLDOWN_MS,
    messageTimes: [],
    malformedCount: 0,
    facing: { x: 1, z: 0 },
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
      attackUntil: player.lastAttackAt + attackCooldownMs(player.class, player.talents),
      healUntil: player.lastHealAt + healCooldownMs,
      skillCooldowns: player.skillCooldowns,
      guardUntil: 0,
      resurrectUntil: player.lastResurrectAt + RESURRECT_COOLDOWN_MS,
    },
    now,
  );
}

/**
 * `spawn` is where the body lands when its stored position is not standable — the map's authored
 * spawn, which only the caller knows. It defaults to the grid centre because that is the origin of
 * the tile-unit world and the only point every map has; a room that knows better should say so.
 */
export function profileFromAttachment(
  attachment: Attachment,
  terrain?: ZoneTerrain,
  spawn: GroundVector = { x: 0, z: 0 },
): PlayerProfile {
  const level = attachment.level ?? 1;
  const playerClass = attachment.class ?? "warrior";
  return {
    id: attachment.id,
    nick: attachment.nick,
    ...restoreStandablePosition(terrain, attachment, spawn),
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

function lifeFromAttachment(attachment: Attachment): {
  life: LifeState;
  corpse: WorldPosition | null;
} {
  const life = attachment.life ?? "alive";
  const corpse = attachment.corpse ?? null;
  if (life === "alive" || corpse === null) return { life: "alive", corpse: null };
  return { life, corpse: { ...corpse } };
}

export function positionFromAttachment(
  attachment: Attachment | null,
  terrain?: ZoneTerrain,
  spawn: GroundVector = { x: 0, z: 0 },
): WorldPosition {
  return attachment === null
    ? { x: spawn.x, y: 0, z: spawn.z }
    : restoreStandablePosition(terrain, attachment, spawn);
}

export function createMonsters(spawns: readonly MonsterSpawn[]): MonsterRuntime[] {
  return spawns.map((spawn) => {
    const defaults = defaultMonsterTuning(spawn.species);
    // Old fixtures and pre-heightfield spawn payloads have no vertical coordinate. Treat those as
    // surface encounters instead of feeding `undefined` into the body-aware ground query, which
    // otherwise selects the highest platform in the column (for example a bridge overhead).
    const spawnY = typeof spawn.y === "number" && Number.isFinite(spawn.y) ? spawn.y : 0;
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
      attackProfile: resolveMonsterAttackProfile(spawn.species, spawn.attackProfile),
      graphicAssetId: spawn.graphicAssetId ?? null,
      rank: tuning.rank,
      // Written explicitly rather than left to the spread so the runtime start and respawn anchor
      // stay together. Authored underground encounters carry their storey in `y`; replacing it
      // with zero puts every stacked encounter back on the surface.
      x: spawn.x,
      y: spawnY,
      z: spawn.z,
      spawnX: spawn.x,
      spawnY,
      spawnZ: spawn.z,
      hp: tuning.maxHp,
      maxHp: tuning.maxHp,
      damage: tuning.damage,
      baseSpeed: tuning.speed,
      speed: tuning.speed,
      pursuitMode: spawn.pursuitMode ?? "standard",
      acceleration: spawn.acceleration ?? 0,
      maxSpeed: Math.max(tuning.speed, spawn.maxSpeed ?? tuning.speed),
      oneHitKill: spawn.oneHitKill ?? false,
      pursuitStartedAt: null,
      positionRevision: 0,
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
      vz: 0,
      runnerLeap: null,
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
      facing: { x: 1, z: 0 },
      action: null,
    };
  });
}

export function createGuards(definitions: readonly GuardDefinition[]): GuardRuntime[] {
  return definitions.map((guard) => ({
    ...guard,
    // Same rule as the monsters above: the definition authors a spot on the ground, not a height.
    x: guard.x,
    y: 0,
    z: guard.z,
    hp: GUARD_MAX_HP,
    maxHp: GUARD_MAX_HP,
    homeX: guard.x,
    homeZ: guard.z,
    lastAttackAt: 0,
    fightingUntil: 0,
    graphicAssetId: guard.graphicAssetId ?? null,
    graphicTint: guard.graphicTint ?? 0xffffff,
  }));
}
