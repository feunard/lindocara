/**
 * The full authoritative tick order and its combat/interaction glue — tranche β of the legacy
 * `World` Durable Object, kept out of the room shell so `WorldRoom` stays a thin transport
 * adapter. Every function here is a line-for-line port of the matching `world.ts` private method
 * (the source line is cited on each), re-keyed from workerd `WebSocket` to the Alepha connection-id
 * string and fed its cross-boundary seams through {@link WorldTickDeps}.
 *
 * `advanceWorldTick` reproduces the legacy `#advanceTick` order (`world.ts:4259-4421`) verbatim:
 * consumable effects → rogue expirations (+sendState) → damage-over-time → players → npc events →
 * held-action ends → adventure exits → combat actions (players) → warrior cyclones → sanctuaries →
 * projectiles → periodic resource state → monsters → combat actions (monsters) → guards → expired
 * loot → event-run drain (Task 7 stub) → every 2nd tick deltas + party-state broadcasts → queued
 * resyncs.
 *
 * Deliberately NOT ported here (each slot keeps its position so later tasks only fill it in):
 * - event runs, quest conversations, authored `action`/`player-touch`/`monster` event triggers and
 *   authored-monster/guard page reconciliation — Task 7 (events & adventure state);
 * - portal/adventure-exit transitions — Task 8 (map transitions); the exit DETECTION runs, its
 *   transition seam is a deps stub;
 * - the built-in quest-chapter reward claim and the D1-backed potion decrement — `WorldTickDeps`'s
 *   `claimQuestReward`/`consumePotion` remain in-memory stubs (no in-game path yet exercises the
 *   idempotent D1 claim/decrement chain legacy runs there); `savePlayer` itself is Task 6's real
 *   `HeroSaveService`-backed fenced save, wired through `WorldRoom.glue()`;
 * - cheat commands and the legacy runtime-party (`party.*`) mechanic — the latter is rollback-only
 *   per CLAUDE.md (hero sessions must not expose it) and is not ported at all.
 */

import {
  actionForClassSlot,
  LUMEN_STEP_MAX_HOLD_MS,
  MONSTER_ACTIONS,
  MONSTER_SPECIAL_ACTIONS,
} from "@lindocara/engine/combat-actions.js";
import {
  CONSUMABLE_COOLDOWN_MS,
  CONSUMABLES,
  type ConsumableId,
  normalizeConsumables,
} from "@lindocara/engine/consumables.js";
import {
  addThreat,
  isMeaningfulContribution,
  REWARD_DISTANCE,
  recordContribution,
  splitExperience,
  tauntThreat,
  usefulHealingThreat,
} from "@lindocara/engine/cooperation.js";
import {
  CORPSE_RECLAIM_RANGE,
  canAct,
  canBeResurrected,
  RESURRECT_COOLDOWN_MS,
  REVIVE_AGGRO_GRACE_MS,
  resurrectHp,
} from "@lindocara/engine/death.js";
import {
  circleIntersectsArc,
  circleIntersectsCapsule,
  firstSegmentImpact,
  frontalArc,
  normalizeDirection,
  strikeCapsule,
  sweptProjectileEntityImpact,
  sweptProjectileTerrainImpact,
} from "@lindocara/engine/directional-combat.js";
import {
  applyDamage,
  applyExperience,
  attackDamageFor,
  CLASS_STATS,
  hasLineOfSight,
  INTERACTION_RANGE,
  isMonsterSpecialTechnique,
  isWalkable,
  isWalkableForLumen,
  LOOT_EXPIRY_MS,
  MAX_MONSTER_BODY_RADIUS,
  MONSTER_AGGRO_RANGE,
  MONSTER_RESPAWN_MS,
  type MonsterSpecies,
  maxHpForLevel,
  monsterBodyRadius,
  nearestCemetery,
  nearestShore,
  pointDistance,
  QUEST_RUN_LIMIT_MS,
  QUEST_SITE_RESPAWN_MS,
  type QuestChapter,
  type QuestSite,
  withinRange,
} from "@lindocara/engine/game.js";
import { LOCAL_CHAT_RADIUS, SPATIAL_EVENT_RADIUS } from "@lindocara/engine/interest.js";
import { exitEvents } from "@lindocara/engine/map-events.js";
import { merchantForRuntimeRoom } from "@lindocara/engine/merchant.js";
import type {
  RogueShadowDanceSequence,
  ServerMessage,
  WorldEventSnapshot,
} from "@lindocara/engine/protocol.js";
import type { QuestActor, QuestBusinessEvent } from "@lindocara/engine/quest-runtime.js";
import {
  canSpendResource,
  generateResource,
  skillResourceCost,
  spendResource,
} from "@lindocara/engine/resources.js";
import { ROGUE_BALANCE, roguePoisonTickPower } from "@lindocara/engine/rogue.js";
import {
  NETWORK_TICKS_PER_SNAPSHOT,
  NO_INPUT,
  PLAYER_SIZE,
  type Vec2,
} from "@lindocara/engine/simulation.js";
import {
  CLASS_SKILLS,
  isSkillUnlocked,
  SKILL_UNLOCK_LEVEL,
  type SkillDefinition,
  type SkillSlot,
} from "@lindocara/engine/skills.js";
import {
  evolvedTalent,
  skillWithTalents,
  type TalentEffect,
  talentEffect,
  talentEffects,
  unlockTalent,
} from "@lindocara/engine/talents.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { ZoneDefinition } from "@lindocara/engine/zones.js";
import {
  advanceCombatActions,
  cancelCombatAction,
  finishHeldCombatAction,
  startCombatAction,
} from "../../world/combat-action-system.js";
import { guardedDamage, isPlayerInvulnerable } from "../../world/combat-system.js";
import { beginRewardAttribution, clearMonsterCombat } from "../../world/contribution-system.js";
import {
  advanceDamageOverTime,
  applyDamageOverTime,
  consumeDamageOverTimePower,
  removeDamageOverTimeBySource,
  removeDamageOverTimeByTarget,
} from "../../world/damage-over-time-system.js";
import { type InterestSystemContext, worldView } from "../../world/interest-system.js";
import { collectLoot, processExpiredLoot } from "../../world/loot-system.js";
import {
  advanceGuards,
  advanceMonsters,
  forgetPlayerFromMonsters,
  type MonsterSystemContext,
} from "../../world/monster-system.js";
import { advancePlayers } from "../../world/movement-system.js";
import type { NavigationRuntime } from "../../world/navigation-system.js";
import { advanceNpcEvents } from "../../world/npc-movement-system.js";
import { heroPartyState } from "../../world/party-system.js";
import {
  advanceSanctuaries,
  cleanseNegativeEffect,
  emergencyMendPower,
  novaSpecializationMultipliers,
  removeSanctuariesByOwner,
  type SanctuaryRuntime,
  sacredPassageTargets,
  startSanctuary,
} from "../../world/priest-variant-system.js";
import {
  advanceProjectiles,
  projectileOrigin,
  removeProjectilesByOwner,
  spawnProjectile,
} from "../../world/projectile-system.js";
import { nextQuestChapter, questDefinition } from "../../world/quest-system.js";
import {
  applyCometExplosion,
  focusedVolleyPowerRatio,
  linePiercerPowerRatio,
  retreatShotDirections,
} from "../../world/ranger-variant-system.js";
import { planShadowDance } from "../../world/rogue-shadow-dance-system.js";
import {
  hasRogueLineOfSight,
  isShadowStepLandingValid,
  isShadowStepPathClear,
  planShadowReturn,
  planShadowStep,
} from "../../world/rogue-skill-system.js";
import {
  activeRogueOpening,
  applyRogueSmokeProtection,
  armRogueExecution,
  armRoguePredatorShiv,
  clearRogueTransientState,
  consumeRogueOpening,
  consumeRoguePredatorShivMultiplier,
  enterRogueStealth,
  exitRogueStealth,
  expireRogueExecution,
  expireRogueOpening,
  expireRoguePredatorShiv,
  expireRogueShadowDanceProtection,
  expireRogueShadowReturn,
  expireRogueSmokeProtection,
  expireRogueStealth,
  grantRogueOpening,
  isRogueStealthed,
  reduceRogueShadowDanceCooldown,
  resolveRogueExecutionKill,
  rogueOpeningBonusRatio,
} from "../../world/rogue-state-system.js";
import { movePlayerInDirection, nearestChargeTarget } from "../../world/skill-system.js";
import {
  broadcastNetworkUpdates,
  sendState,
  sendWorldResync,
} from "../../world/snapshot-system.js";
import {
  activeRallyPowerMultiplier,
  advanceWarriorCyclones,
  applyKingsChallenge,
  applyRallyingCry,
  applySeismicImpact,
  cycloneImpactTimes,
  cycloneRecoveryMs,
  damageAfterWarriorProtection,
  startWarriorCyclone,
} from "../../world/warrior-variant-system.js";
import {
  ATTACHMENT_EVERY_TICKS,
  CHAT_MAX_LENGTH,
  type CombatActionRuntime,
  D1_SAVE_EVERY_TICKS,
  type GroundLoot,
  type GuardRuntime,
  type MonsterRuntime,
  type PlayerRuntime,
  type ProjectileRuntime,
  RESYNC_COOLDOWN_MS,
} from "../../world/world-runtime.js";
import type { WorldRoomState } from "./worldState.ts";

/** Task 7 evaluates authored event pages; until then a room's active-event set is always empty. */
const NO_EVENTS: readonly WorldEventSnapshot[] = [];

/** The reward payload of a legacy quest-chapter turn-in (`world.ts:3885-3893`). */
export interface QuestRewardClaim {
  sessionEpoch: number;
  questId: string;
  rewardGold: number;
  rewardPotions: number;
  resultingLevel: number;
  resultingXp: number;
  resultingHp: number;
}

/**
 * Every seam the tick and the intent handlers need from the hosting room. The functions in this
 * module own room STATE mutations; anything that crosses a socket, a database, the presence lease,
 * the party coordinator or a later task's boundary comes through here.
 */
export interface WorldTickDeps {
  /** The authoritative clock. Production passes `Date.now`; tests pass a controlled value. */
  now(): number;
  send(connectionId: string, message: ServerMessage): void;
  waitUntil(promise: Promise<unknown>): void;
  /** Movement-adjacent lease renewal (legacy `#renewPresence`), fired on the 10s heartbeat. */
  renewPresence(player: PlayerRuntime): Promise<void>;
  /** Fenced D1 save (`WorldRoom.savePlayer`, backed by `HeroSaveService`). Resolves `false` on a
   *  stale epoch (the caller has already invalidated local authority and closed the socket) or a
   *  transient D1 error (the caller re-marks the player dirty for the next save beat). */
  savePlayer(player: PlayerRuntime, connectionId: string): Promise<boolean>;
  presenceHeartbeatMs: number;
  navigationDebugAvailable: boolean;
  /** Coordinator RPC for a permanently-defeated authored monster (legacy `#markMonsterDead`). */
  markPermanentMonsterDefeated(eventId: string): void;
  /** Coordinator RPC for authored-quest business events (legacy `#recordQuestEvent`). Task 7 adds
   *  the completed-quest auto-claim fan-out on its result. */
  recordQuestEvent(partyId: string, event: QuestBusinessEvent): void;
  /** Party-wide chat fan-out through the coordinator (legacy `GAME_SESSION.broadcast`). */
  broadcastToParty(partyId: string, message: ServerMessage): void;
  /** Task 7: the budgeted event-run drain. Stubbed to a no-op until the interpreter lands. */
  drainEventRuns(now: number): void;
  /** Task 8: the authored-exit handoff. Stubbed to a no-op; detection still runs in order. */
  transitionAdventureExit(
    connectionId: string,
    player: PlayerRuntime,
    exitId: string,
    now: number,
  ): void;
  /** The idempotent D1 quest-reward claim (built-in quest chapters). Stubbed to `false`
   *  (already-claimed path) — no in-game path yet exercises the legacy fenced claim chain; see the
   *  Task 6 report for the follow-up. */
  claimQuestReward(player: PlayerRuntime, reward: QuestRewardClaim): Promise<boolean>;
  /**
   * Consume one health potion and return the remaining count, or `null` when none can be spent.
   * Stubbed to an in-memory decrement — the legacy fenced save-then-decrement D1 chain
   * (`#consumePotion`) has no in-game path exercising it yet; the in-memory count is authoritative
   * either way, and the periodic `savePlayer` cadence still lands the resulting quantity in D1.
   */
  consumePotion(player: PlayerRuntime, connectionId: string): Promise<number | null>;
}

/** One live room, glued: the state the tick mutates plus the seams it calls out through. */
export interface WorldGlue {
  state: WorldRoomState;
  deps: WorldTickDeps;
}

interface MonsterDamageContext {
  damageOverTime?: boolean;
  persistentOwnerCredit?: boolean;
  poisonRupture?: boolean;
  suppressHitEvent?: boolean;
}

// -------------------------------------------------------------------------------------------------
// Shared helpers
// -------------------------------------------------------------------------------------------------

function zone(state: WorldRoomState): ZoneDefinition {
  if (!state.location) throw new Error("world room was not initialized with a zone");
  return state.location.definition;
}

function navigationRuntime(state: WorldRoomState): NavigationRuntime {
  if (!state.navigation) throw new Error("world room navigation was not initialized");
  return state.navigation;
}

function connectionOf(state: WorldRoomState, playerId: string): string | undefined {
  return state.connectionIdByHeroId.get(playerId);
}

function playerById(state: WorldRoomState, playerId: string): PlayerRuntime | undefined {
  const connectionId = connectionOf(state, playerId);
  return connectionId === undefined ? undefined : state.players.get(connectionId);
}

/** Port of `#sendState` (`world.ts:5830`) minus the authored-quest trackers/markers (Task 7). */
export function sendStateTo(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  const chapter = player.quest.chapter ?? "three_offerings";
  sendState(
    connectionId,
    player,
    questDefinition(zone(w.state), chapter)?.target,
    (recipient, message) => w.deps.send(recipient, message),
  );
}

/** Port of `#sendSpatialEvent` (`world.ts:6093`). */
function sendSpatialEvent(w: WorldGlue, message: ServerMessage, position: Vec2): void {
  for (const recipient of w.state.playerGrid.queryRadius(position, SPATIAL_EVENT_RADIUS)) {
    if (!recipient.authorized) continue;
    const connectionId = connectionOf(w.state, recipient.id);
    if (connectionId !== undefined) w.deps.send(connectionId, message);
  }
}

/** Port of `#sendSpatialEventAcross` (`world.ts:6101`). */
function sendSpatialEventAcross(
  w: WorldGlue,
  message: ServerMessage,
  positions: readonly Vec2[],
): void {
  const sent = new Set<string>();
  for (const position of positions) {
    for (const recipient of w.state.playerGrid.queryRadius(position, SPATIAL_EVENT_RADIUS)) {
      if (!recipient.authorized) continue;
      const connectionId = connectionOf(w.state, recipient.id);
      if (connectionId === undefined || sent.has(connectionId)) continue;
      sent.add(connectionId);
      w.deps.send(connectionId, message);
    }
  }
}

/** Port of `#sendLocalChat` (`world.ts:6079`). */
function sendLocalChat(w: WorldGlue, sender: PlayerRuntime, text: string): void {
  const message: ServerMessage = { t: "chat", channel: "local", from: sender.nick, text };
  for (const recipient of w.state.playerGrid.queryRadius(sender, LOCAL_CHAT_RADIUS)) {
    if (!recipient.authorized) continue;
    const connectionId = connectionOf(w.state, recipient.id);
    if (connectionId !== undefined) w.deps.send(connectionId, message);
  }
}

function interestContext(w: WorldGlue): InterestSystemContext<string> {
  return {
    players: w.state.players,
    monsters: w.state.monsters,
    guards: w.state.guards,
    loot: w.state.loot,
    projectiles: w.state.projectiles,
    playerGrid: w.state.playerGrid,
    monsterGrid: w.state.monsterGrid,
    lootGrid: w.state.lootGrid,
    navigationDebugAvailable: w.deps.navigationDebugAvailable,
    now: w.deps.now,
  };
}

/** Port of `#sendWorldResync`'s room half — the message dispatch and the tick's queued-resync
 *  payback both route through this. */
export function sendResyncTo(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  sendWorldResync(
    connectionId,
    player,
    w.state.tick,
    (recipient) => worldView(interestContext(w), recipient),
    (recipientId, message) => w.deps.send(recipientId, message),
    NO_EVENTS,
  );
}

/** Port of `#flushQueuedResyncs` (`world.ts:5274`). */
export function flushQueuedResyncs(w: WorldGlue, now: number): void {
  for (const [connectionId, player] of w.state.players) {
    if (!player.resyncQueued || !player.authorized) continue;
    if (now - player.lastResyncAt < RESYNC_COOLDOWN_MS) continue;
    player.resyncQueued = false;
    player.lastResyncAt = now;
    sendResyncTo(w, connectionId, player);
  }
}

/**
 * Port of `#areCombatAllies` (`world.ts:3150`), hero branch only: every player this room admits is
 * a hero of the same persistent party by construction, and the legacy runtime-party branch belongs
 * to the rollback rooms this port does not carry.
 */
function areCombatAllies(a: PlayerRuntime, b: PlayerRuntime): boolean {
  if (a.id === b.id) return true;
  return (
    a.identityKind === "hero" &&
    b.identityKind === "hero" &&
    a.partyId !== null &&
    a.partyId === b.partyId
  );
}

/** Port of `#questActor` (`world.ts:4601`). */
function questActor(player: PlayerRuntime | undefined): QuestActor | null {
  if (!player?.authorized || player.identityKind !== "hero" || player.partyId === null) return null;
  return { heroId: player.id, sessionEpoch: player.sessionEpoch, level: player.level };
}

/** Port of `#recordActorQuestEvent` (`world.ts:4733`). */
function recordActorQuestEvent(
  w: WorldGlue,
  player: PlayerRuntime,
  create: (base: { id: string; mapId: string; actor: QuestActor }) => QuestBusinessEvent,
): void {
  const actor = questActor(player);
  const mapId = w.state.location?.zoneId;
  if (!actor || !mapId || player.partyId === null) return;
  w.deps.recordQuestEvent(player.partyId, create({ id: crypto.randomUUID(), mapId, actor }));
}

// -------------------------------------------------------------------------------------------------
// Life-state transitions
// -------------------------------------------------------------------------------------------------

/**
 * Port of `#freeze` (`world.ts:5674`) minus the quest-conversation close and event-run abort
 * (both Task 7 — their runtimes do not exist in this room yet). The queue-clear on every life
 * transition is the invariant prediction relies on: no half-applied command batches.
 */
function freeze(w: WorldGlue, player: PlayerRuntime): void {
  player.lastInput = NO_INPUT;
  player.queue = [];
  player.starvedTicks = 0;
  exitRogueStealth(player, w.deps.now());
  cancelCombatAction(player);
  player.guarding = false;
  player.guardActivatedAt = 0;
  player.challengeReductionUntil = 0;
  player.challengeReduction = 0;
  player.rallyPowerUntil = 0;
  player.rallyPowerMultiplier = 0;
  player.warriorCyclone = null;
  clearRogueTransientState(player);
  player.negativeEffects.clear();
  removeDamageOverTimeBySource(w.state.damageOverTime, player.id);
  removeSanctuariesByOwner(w.state.sanctuaries, player.id);
  removeProjectilesByOwner(w.state.projectiles, player.id);
  player.dirty = true;
}

/** Port of `#forgetPlayer` (`world.ts:4051`). */
function forgetPlayer(w: WorldGlue, player: PlayerRuntime): void {
  forgetPlayerFromMonsters(w.state.monsters, player.id);
}

/** Port of `#grantReviveGrace` (`world.ts:5708`). */
function grantReviveGrace(w: WorldGlue, player: PlayerRuntime, now: number): void {
  player.forgottenUntil = Math.max(player.forgottenUntil, now + REVIVE_AGGRO_GRACE_MS);
  forgetPlayer(w, player);
  for (const monster of w.state.monsters) {
    if (pointDistance(monster, player) <= MONSTER_AGGRO_RANGE) {
      monster.lastAttackAt = Math.max(monster.lastAttackAt, now);
    }
  }
}

/** Port of `#killPlayer` (`world.ts:5650`): dying does not move you — your body stays put. */
export function killPlayer(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  player.life = "corpse";
  player.corpse = { x: player.x, y: player.y };
  for (const monster of w.state.monsters) monster.threat.delete(player.id);
  freeze(w, player);
  sendSpatialEvent(
    w,
    {
      t: "event",
      code: "player.down",
      params: { name: player.nick },
      tone: "bad",
      x: player.x,
      y: player.y,
    },
    player,
  );
  w.deps.send(connectionId, {
    t: "event",
    code: "death.fallen",
    tone: "bad",
    x: player.x,
    y: player.y,
  });
}

/** Port of `#release` (`world.ts:5728`): one-way and deliberate. */
export function handleRelease(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  if (player.life !== "corpse" || player.corpse === null) return;
  player.resurrectionAt = 0;
  const terrain = zone(w.state).terrain;
  const cemetery =
    player.identityKind === "hero"
      ? (terrain.spawnPoints[0] ?? nearestCemetery(player.corpse))
      : nearestCemetery(player.corpse);
  const previousPosition = { x: player.x, y: player.y };
  let releasePosition: Vec2 = cemetery;
  // An authored map currently has one spirit anchor: its entry spawn. If the player dies on that
  // exact point, releasing there would reclaim the body on the very next tick. Find the nearest
  // walkable neighbouring tile so the ghost state remains observable and playable.
  if (pointDistance(releasePosition, player.corpse) <= CORPSE_RECLAIM_RANGE) {
    const directions = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: -1 },
    ];
    for (const radius of [TILE_SIZE, TILE_SIZE * 2, TILE_SIZE * 3]) {
      const candidate = directions
        .map((direction) => ({
          x: cemetery.x + direction.x * radius,
          y: cemetery.y + direction.y * radius,
        }))
        .find(
          (position) =>
            pointDistance(position, player.corpse as Vec2) > CORPSE_RECLAIM_RANGE &&
            isWalkable(position, PLAYER_SIZE, terrain),
        );
      if (candidate) {
        releasePosition = candidate;
        break;
      }
    }
  }
  player.life = "ghost";
  player.x = releasePosition.x;
  player.y = releasePosition.y;
  w.state.playerGrid.update(player, previousPosition);
  freeze(w, player);
  w.deps.send(connectionId, {
    t: "event",
    code: "death.released",
    tone: "info",
    x: player.x,
    y: player.y,
  });
  sendStateTo(w, connectionId, player);
}

/** Port of `#reclaimCorpse` (`world.ts:5778`): walking your ghost onto your own body. */
export function reclaimCorpse(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  player.life = "alive";
  player.resurrectionAt = 0;
  player.corpse = null;
  player.hp = resurrectHp(player.level);
  grantReviveGrace(w, player, w.deps.now());
  freeze(w, player);
  w.deps.send(connectionId, {
    t: "event",
    code: "death.reclaimed",
    tone: "good",
    x: player.x,
    y: player.y,
  });
  sendStateTo(w, connectionId, player);
}

/** Port of `#collectLoot` (`world.ts:5789`), including the itemAcquired quest-event record. */
export function collectLootFor(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  const before = normalizeConsumables(
    player.inventory.consumables,
    player.inventory.potions,
  ).health_potion;
  collectLoot(
    {
      loot: w.state.loot,
      lootGrid: w.state.lootGrid,
      send: (recipient, message) => w.deps.send(recipient, message),
      sendState: (recipient, target) => sendStateTo(w, recipient, target),
    },
    connectionId,
    player,
  );
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  player.inventory.consumables = counts;
  const acquired = counts.health_potion - before;
  if (acquired > 0) {
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemAcquired",
      itemId: "health_potion",
      amount: acquired,
      inventoryQuantity: counts.health_potion,
    }));
  }
}

// -------------------------------------------------------------------------------------------------
// Contribution, rewards and monster defeat
// -------------------------------------------------------------------------------------------------

/** Port of `#recordDamage` (`world.ts:3164`). */
function recordDamage(
  player: PlayerRuntime,
  monster: MonsterRuntime,
  amount: number,
  now: number,
): void {
  if (amount <= 0 || monster.rewardsGranted) return;
  addThreat(monster.threat, player.id, amount, now);
  recordContribution(
    monster.contributions,
    player.id,
    { damage: amount, relevantThreat: amount },
    now,
  );
  generateResource(player.class, player.resource, "damage_dealt", amount);
}

/** Port of `#recordUsefulHeal` (`world.ts:3176`). */
function recordUsefulHeal(
  w: WorldGlue,
  healer: PlayerRuntime,
  target: PlayerRuntime,
  amount: number,
  now: number,
): void {
  if (amount <= 0) return;
  generateResource(healer.class, healer.resource, "useful_healing", amount);
  const threat = usefulHealingThreat(amount);
  for (const monster of w.state.monsters) {
    if (
      monster.deadUntil > now ||
      (!monster.threat.has(target.id) && !monster.contributions.has(target.id))
    )
      continue;
    addThreat(monster.threat, healer.id, threat, now);
    recordContribution(
      monster.contributions,
      healer.id,
      { usefulHealing: amount, relevantThreat: threat },
      now,
    );
  }
}

/** Port of `#heroPartyMembers` (`world.ts:3206`). */
function heroPartyMembers(w: WorldGlue, partyId: string): PlayerRuntime[] {
  return [...w.state.players.values()].filter(
    (player) => player.identityKind === "hero" && player.partyId === partyId && player.authorized,
  );
}

/** Port of `#rewardPartyMemberIds` (`world.ts:3216`), hero branch only (see `areCombatAllies`). */
function rewardPartyMemberIds(w: WorldGlue, playerId: string): Iterable<string> {
  const player = playerById(w.state, playerId);
  if (player?.identityKind !== "hero" || player.partyId === null) return [];
  return heroPartyMembers(w, player.partyId).map((other) => other.id);
}

/** Port of `#broadcastHeroPartyStates` (`world.ts:3235`), gated on the last payload sent. */
function broadcastHeroPartyStates(w: WorldGlue): void {
  const membersByParty = new Map<string, PlayerRuntime[]>();
  for (const player of w.state.players.values()) {
    if (player.identityKind !== "hero" || !player.authorized) continue;
    const partyId = player.partyId;
    if (partyId === null) continue;
    const members = membersByParty.get(partyId);
    if (members) members.push(player);
    else membersByParty.set(partyId, [player]);
  }
  for (const partyId of w.state.heroPartyBroadcasts.keys()) {
    if (!membersByParty.has(partyId)) w.state.heroPartyBroadcasts.delete(partyId);
  }
  for (const [partyId, members] of membersByParty) {
    const state = heroPartyState(partyId, members);
    const encoded = JSON.stringify(state);
    if (w.state.heroPartyBroadcasts.get(partyId) === encoded) continue;
    w.state.heroPartyBroadcasts.set(partyId, encoded);
    for (const member of members) {
      const connectionId = connectionOf(w.state, member.id);
      if (connectionId !== undefined) w.deps.send(connectionId, { t: "party.state", party: state });
    }
  }
}

/** Port of `#markMonsterDead` (`world.ts:3385`). Guard kills route here DIRECTLY — never through
 *  `defeatMonster` — which is what keeps a guard kill from ever paying a player. */
export function markMonsterDead(w: WorldGlue, monster: MonsterRuntime, now: number): void {
  cancelCombatAction(monster);
  removeDamageOverTimeByTarget(w.state.damageOverTime, "monster", monster.id);
  monster.deadUntil =
    monster.respawnMode === "never" ? Number.POSITIVE_INFINITY : now + MONSTER_RESPAWN_MS;
  monster.vx = 0;
  monster.vy = 0;
  if (monster.respawnMode !== "never" || !monster.id.startsWith("mon-")) return;
  w.deps.markPermanentMonsterDefeated(monster.id.slice(4));
}

/** Port of `#creditUndeadQuest` (`world.ts:3437`). */
function creditUndeadQuest(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  monster: MonsterRuntime,
): void {
  if (
    player.quest.chapter !== "bone_choir" ||
    player.quest.status !== "active" ||
    monster.kind !== "skull"
  )
    return;
  const target = questDefinition(zone(w.state), "bone_choir")?.target;
  if (target === undefined) return;
  player.quest.progress = Math.min(target, player.quest.progress + 1);
  if (player.quest.progress >= target) {
    player.quest.status = "ready";
    w.deps.send(connectionId, { t: "event", code: "quest.chapter_ready", tone: "good" });
  } else
    w.deps.send(connectionId, {
      t: "event",
      code: "quest.site_progress",
      params: { progress: player.quest.progress, target },
      tone: "good",
    });
}

/** Port of `#defeatMonster` (`world.ts:3260`) minus the on-defeat event-run start (Task 7). */
function defeatMonster(
  w: WorldGlue,
  player: PlayerRuntime,
  monster: MonsterRuntime,
  now: number,
  persistentOwnerCredit = false,
): void {
  if (!beginRewardAttribution(monster)) return;
  for (const [connectionId, candidate] of w.state.players) {
    const executor = talentEffect(candidate.class, candidate.talents, "rogue_executor", 2);
    if (
      executor &&
      candidate.authorized &&
      resolveRogueExecutionKill(candidate, monster.id, now, executor)
    )
      sendStateTo(w, connectionId, candidate);
  }
  markMonsterDead(w, monster, now);
  const directlyEligible = [...monster.contributions.values()]
    .filter((contribution) => {
      const candidate = playerById(w.state, contribution.playerId);
      return (
        candidate?.authorized === true &&
        candidate.life === "alive" &&
        pointDistance(candidate, monster) <= REWARD_DISTANCE &&
        isMeaningfulContribution(contribution)
      );
    })
    .map((entry) => entry.playerId);
  if (
    !directlyEligible.includes(player.id) &&
    player.authorized &&
    (persistentOwnerCredit || pointDistance(player, monster) <= REWARD_DISTANCE)
  )
    directlyEligible.push(player.id);

  const eligible = new Set(directlyEligible);
  for (const contributorId of directlyEligible) {
    for (const memberId of rewardPartyMemberIds(w, contributorId)) {
      const member = playerById(w.state, memberId);
      if (
        member?.authorized &&
        member.life === "alive" &&
        pointDistance(member, monster) <= REWARD_DISTANCE
      )
        eligible.add(memberId);
    }
  }

  // Experience is *split*, so sharing it with the party inflates nothing. Loot and quest credit
  // are minted per recipient — fight for your loot; stand near your friends for your XP.
  const contributors = new Set(directlyEligible);
  const killer = questActor(player);
  if (killer && player.partyId !== null && w.state.location !== null) {
    const actorsFor = (ids: Iterable<string>): QuestActor[] => {
      const actors: QuestActor[] = [];
      for (const id of ids) {
        const candidate = playerById(w.state, id);
        if (candidate?.partyId !== player.partyId) continue;
        const actor = questActor(candidate);
        if (actor) actors.push(actor);
      }
      return actors;
    };
    w.deps.recordQuestEvent(player.partyId, {
      id: crypto.randomUUID(),
      type: "monsterKilled",
      mapId: w.state.location.zoneId,
      monsterId: monster.id.startsWith("mon-") ? monster.id.slice(4) : monster.id,
      species: monster.species,
      killer,
      contributors: actorsFor(directlyEligible),
      nearbyParty: actorsFor(eligible),
    });
  }
  const shares = splitExperience(monster.xp, [...eligible]);
  for (const [playerId, xp] of shares) {
    const connectionId = connectionOf(w.state, playerId);
    const recipient = connectionId === undefined ? undefined : w.state.players.get(connectionId);
    if (connectionId === undefined || !recipient) continue;
    const result = applyExperience(recipient.level, recipient.xp, xp);
    recipient.level = result.level;
    recipient.xp = result.xp;
    if (result.levelsGained > 0) recipient.hp = maxHpForLevel(recipient.level);
    const earned = contributors.has(playerId);
    if (earned) creditUndeadQuest(w, connectionId, recipient, monster);

    if (earned) {
      const kind = w.state.tick % 4 === 0 ? "potion" : w.state.tick % 2 === 0 ? "crystal" : "gold";
      const droppedLoot: GroundLoot = {
        id: crypto.randomUUID(),
        kind,
        amount: kind === "gold" ? 4 : 1,
        x: monster.x + 8,
        y: monster.y + 8,
        expiresAt: now + LOOT_EXPIRY_MS,
        ownerId: recipient.id,
      };
      w.state.loot.push(droppedLoot);
      w.state.lootGrid.insert(droppedLoot);
    }
    w.deps.send(
      connectionId,
      result.levelsGained > 0
        ? { t: "event", code: "level_up", params: { level: recipient.level }, tone: "good" }
        : {
            t: "event",
            code: "monster.defeated",
            params: { species: monster.species, xp },
            tone: "good",
          },
    );
    sendStateTo(w, connectionId, recipient);
    recipient.dirty = true;
  }
  // Task 7: `#triggerMonsterDefeatEvent` starts the monster event's on-defeat command program here.
  clearMonsterCombat(monster);
}

// -------------------------------------------------------------------------------------------------
// Damage plumbing (players → monsters, monsters → players, projectiles)
// -------------------------------------------------------------------------------------------------

/** Port of `#tauntMonster` (`world.ts:2962`). */
function tauntMonster(player: PlayerRuntime, target: MonsterRuntime, now: number): void {
  const previous = target.threat.get(player.id)?.amount ?? 0;
  const amount = tauntThreat(target.threat, player.id, now);
  recordContribution(
    target.contributions,
    player.id,
    { relevantThreat: Math.max(0, amount - previous) },
    now,
  );
}

/** Port of `#damageMonster` (`world.ts:2759`). */
function damageMonster(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  target: MonsterRuntime,
  skill: SkillDefinition,
  now: number,
  basic: boolean,
  frozenPower?: number,
  context: MonsterDamageContext = {},
): { actualDamage: number; killed: boolean } | null {
  if (target.deadUntil > now) return null;
  const opening =
    basic && player.class === "rogue" && skill.id === "dual_slash"
      ? activeRogueOpening(player, now)
      : null;
  const baseDamage =
    frozenPower ??
    (basic
      ? attackDamageFor(player.class, player.level)
      : skill.power + Math.max(0, player.level - 1) * 2);
  const damage = Math.max(
    1,
    Math.round(
      baseDamage *
        (opening ? 1 + opening.bonusRatio : 1) *
        (player.damageBoostUntil > now ? 1 + CONSUMABLES.damage_elixir.effectValue : 1) *
        (1 + activeRallyPowerMultiplier(player, now)) *
        (target.weakness === player.class ? target.weaknessPercent / 100 : 1),
    ),
  );
  const actualDamage = Math.min(target.hp, damage);
  const result = applyDamage(target.hp, damage);
  target.hp = result.hp;
  recordDamage(player, target, actualDamage, now);
  if (opening) {
    if (opening.source === "shadow_step") {
      const executor = talentEffect(player.class, player.talents, "rogue_executor", 2);
      if (executor) armRogueExecution(player, target.id, now, executor);
    }
    consumeRogueOpening(player, now);
    sendStateTo(w, connectionId, player);
  }
  if (player.class === "warrior" && skill.id === "shield_bash") tauntMonster(player, target, now);
  if (!context.suppressHitEvent) {
    sendSpatialEvent(
      w,
      {
        t: "event",
        code: "combat.hit",
        params: {
          species: target.species,
          damage: actualDamage,
          skill: skill.id,
          actorId: player.id,
          ...(basic ? { basic: 1 } : {}),
          ...(context.damageOverTime ? { poisonTick: 1 } : {}),
          ...(context.poisonRupture ? { poisonRupture: 1 } : {}),
        },
        tone: "info",
        x: target.x,
        y: target.y,
      },
      target,
    );
  }
  if (result.killed) defeatMonster(w, player, target, now, context.persistentOwnerCredit === true);
  return { actualDamage, killed: result.killed };
}

/** Port of `#healPlayer` (`world.ts:3101`): useful healing means actual missing HP restored. */
function healPlayer(
  w: WorldGlue,
  casterConnectionId: string,
  caster: PlayerRuntime,
  targetConnectionId: string,
  target: PlayerRuntime,
  amount: number,
  skillId: string,
  now: number,
  selfCast: boolean,
): number {
  if (target.life !== "alive" || !areCombatAllies(caster, target)) return 0;
  const maxHp = maxHpForLevel(target.level);
  const actualAmount = Math.min(Math.max(0, amount), Math.max(0, maxHp - target.hp));
  if (actualAmount <= 0) return 0;
  target.hp += actualAmount;
  target.dirty = true;
  recordUsefulHeal(w, caster, target, actualAmount, now);
  if (targetConnectionId !== casterConnectionId) {
    w.deps.send(casterConnectionId, {
      t: "event",
      code: "heal.cast",
      params: {
        name: target.nick,
        amount: actualAmount,
        color: caster.appearance.primaryColor,
        skill: skillId,
      },
      tone: "good",
      x: target.x,
      y: target.y,
    });
  }
  w.deps.send(targetConnectionId, {
    t: "event",
    code: selfCast && targetConnectionId === casterConnectionId ? "heal.cast" : "heal.received",
    params: {
      name: caster.nick,
      amount: actualAmount,
      color: caster.appearance.primaryColor,
      skill: skillId,
    },
    tone: "good",
    x: target.x,
    y: target.y,
  });
  sendStateTo(w, targetConnectionId, target);
  return actualAmount;
}

/** Port of `#damagePlayer` (`world.ts:5583`). */
function damagePlayer(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  damage: number,
  species: MonsterSpecies,
  monsterId: string,
  now: number,
): void {
  if (isPlayerInvulnerable(player, now)) return;
  const stealthEnded = exitRogueStealth(player, now);
  const protectedDamage = damageAfterWarriorProtection(
    player,
    damage,
    w.state.players.values(),
    now,
    (source, target) => areCombatAllies(source, target),
    (source, target) => hasLineOfSight(source, target, zone(w.state).terrain.tiles),
  );
  const {
    amount: appliedDamage,
    result,
    parried,
    retaliationRatio,
  } = guardedDamage(player, protectedDamage, now);
  if (parried) {
    w.deps.send(connectionId, {
      t: "event",
      code: "talent.perfect_parry",
      tone: "good",
      x: player.x,
      y: player.y,
    });
    const attacker = w.state.monsters.find(
      (monster) => monster.id === monsterId && monster.deadUntil <= now,
    );
    if (attacker && retaliationRatio > 0) {
      const guardSkill = skillWithTalents(player.class, player.talents, 2);
      damageMonster(
        w,
        connectionId,
        player,
        attacker,
        guardSkill,
        now,
        false,
        Math.max(1, Math.round(damage * retaliationRatio)),
      );
    }
    if (stealthEnded) sendStateTo(w, connectionId, player);
    return;
  }
  player.hp = result.hp;
  generateResource(player.class, player.resource, "damage_taken", appliedDamage);
  player.dirty = true;
  w.deps.send(connectionId, {
    t: "event",
    code: "combat.hurt",
    // Keep the damage event tied to the same authoritative attacker as the spatial animation.
    params: { species, damage: appliedDamage, monsterId },
    tone: "bad",
    x: player.x,
    y: player.y,
  });
  if (result.killed) killPlayer(w, connectionId, player);
  sendStateTo(w, connectionId, player);
}

// -------------------------------------------------------------------------------------------------
// Monster combat
// -------------------------------------------------------------------------------------------------

/** Port of `#startMonsterAttack` (`world.ts:5475`): the strike direction freezes at wind-up. */
export function startMonsterAttack(
  w: WorldGlue,
  monster: MonsterRuntime,
  target: PlayerRuntime | GuardRuntime,
  now: number,
): void {
  if (monster.deadUntil > now || monster.action) return;
  const specialTechnique =
    monster.specialTechnique !== "none" && now >= monster.nextSpecialAt
      ? monster.specialTechnique
      : null;
  const definition = specialTechnique
    ? MONSTER_SPECIAL_ACTIONS[specialTechnique]
    : MONSTER_ACTIONS[monster.species];
  const direction = normalizeDirection(
    { x: target.x - monster.x, y: target.y - monster.y },
    monster.facing,
  );
  monster.facing = direction;
  const action = startCombatAction(monster, {
    kind: "monster_attack",
    ...(specialTechnique ? { skillId: specialTechnique } : {}),
    direction,
    now,
    anticipationMs: definition.anticipationMs,
    recoveryMs: definition.recoveryMs,
  });
  if (!action) return;
  if (specialTechnique) {
    monster.nextSpecialAt = now + MONSTER_SPECIAL_ACTIONS[specialTechnique].cooldownMs;
  }
  sendSpatialEvent(
    w,
    {
      t: "animation",
      actionId: action.id,
      actorKind: "monster",
      actorId: monster.id,
      action: specialTechnique ? "skill" : "attack",
      ...(specialTechnique ? { skillId: specialTechnique } : {}),
      direction: { ...action.direction },
      startedAt: action.startedAt,
      impactAt: action.impactAt,
      recoveryEndsAt: action.recoveryEndsAt,
    },
    monster,
  );
}

/** Port of `#resolveMonsterAction` (`world.ts:5518`): damages only actors still inside the frozen
 *  capsule/arc at the active frame — and only actors that are `alive` (the corpse-run guarantee). */
export function resolveMonsterAction(
  w: WorldGlue,
  monster: MonsterRuntime,
  action: CombatActionRuntime,
  now: number,
): void {
  if (monster.deadUntil > now) return;
  const specialTechnique =
    action.skillId && isMonsterSpecialTechnique(action.skillId) && action.skillId !== "none"
      ? action.skillId
      : null;
  const specialDefinition = specialTechnique ? MONSTER_SPECIAL_ACTIONS[specialTechnique] : null;
  const definition = MONSTER_ACTIONS[monster.species];
  const origin = { x: monster.x + PLAYER_SIZE / 2, y: monster.y + PLAYER_SIZE / 2 };
  const hitbox = specialDefinition
    ? null
    : strikeCapsule(origin, action.direction, definition.range, definition.hitboxRadius);
  const arc =
    specialDefinition?.shape === "cone"
      ? frontalArc(
          origin,
          action.direction,
          specialDefinition.range,
          specialDefinition.halfAngleRadians ?? Math.PI / 3,
        )
      : null;
  const damage = Math.max(
    1,
    Math.round(monster.damage * (specialDefinition?.damageMultiplier ?? 1)),
  );
  let drainedDamage = 0;
  const hits = (target: Vec2, radius: number): boolean => {
    if (!hasLineOfSight(monster, target, zone(w.state).terrain.tiles)) return false;
    const circle = {
      center: { x: target.x + PLAYER_SIZE / 2, y: target.y + PLAYER_SIZE / 2 },
      radius,
    };
    if (hitbox) return circleIntersectsCapsule(circle, hitbox);
    if (arc) return circleIntersectsArc(circle, arc);
    return (
      specialDefinition !== null &&
      pointDistance(origin, circle.center) <= specialDefinition.range + radius
    );
  };
  for (const [connectionId, player] of w.state.players) {
    if (
      !player.authorized ||
      player.life !== "alive" ||
      player.forgottenUntil > now ||
      player.invisibleUntil > now ||
      player.transitioning ||
      !hits(player, PLAYER_SIZE / 2)
    )
      continue;
    damagePlayer(w, connectionId, player, damage, monster.species, monster.id, now);
    drainedDamage += damage;
  }
  for (const guard of w.state.guards) {
    if (!hits(guard, PLAYER_SIZE / 2)) continue;
    // Guards remain service NPCs in V1, so combat may wound but never kill them.
    guard.hp = Math.max(1, guard.hp - damage);
    drainedDamage += damage;
  }
  const healRatio =
    specialDefinition && "healRatio" in specialDefinition ? specialDefinition.healRatio : 0;
  if (healRatio > 0) {
    monster.hp = Math.min(monster.maxHp, monster.hp + Math.round(drainedDamage * healRatio));
  }
}

// -------------------------------------------------------------------------------------------------
// Projectiles
// -------------------------------------------------------------------------------------------------

/** Port of `#projectileOwner` (`world.ts:5296`). */
function projectileOwner(
  w: WorldGlue,
  projectile: ProjectileRuntime,
): { connectionId: string; player: PlayerRuntime } | null {
  const connectionId = connectionOf(w.state, projectile.ownerId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (
    connectionId === undefined ||
    !player?.authorized ||
    player.transitioning ||
    player.roomKey !== projectile.roomKey ||
    player.partyId !== projectile.ownerPartyId
  )
    return null;
  return { connectionId, player };
}

/** Port of `#projectileDamage` (`world.ts:5310`). */
function projectileDamage(
  w: WorldGlue,
  projectile: ProjectileRuntime,
  monster: MonsterRuntime,
  now: number,
): void {
  const owner = projectileOwner(w, projectile);
  if (!owner || !canAct(owner.player.life)) return;
  const baseSkill = CLASS_SKILLS[owner.player.class].find(
    (candidate) => candidate.id === projectile.sourceSkillId,
  );
  if (!baseSkill) return;
  const skill = skillWithTalents(owner.player.class, owner.player.talents, baseSkill.slot);
  const execute = talentEffect(owner.player.class, owner.player.talents, "execute", skill.slot);
  const linePiercer = talentEffect(
    owner.player.class,
    owner.player.talents,
    "line_piercer",
    skill.slot,
  );
  const focusedVolley = talentEffect(
    owner.player.class,
    owner.player.talents,
    "focused_volley",
    skill.slot,
  );
  const cometArrow = talentEffect(
    owner.player.class,
    owner.player.talents,
    "comet_arrow",
    skill.slot,
  );
  let power = projectile.power;
  if (linePiercer)
    power = Math.round(power * linePiercerPowerRatio(projectile.hitEntityIds.size, linePiercer));
  if (focusedVolley) {
    const hitCount = projectile.activationHitCounts?.get(monster.id) ?? 1;
    power = Math.round(power * focusedVolleyPowerRatio(hitCount, focusedVolley));
  }
  if (cometArrow) power = Math.round(power * Math.max(0, cometArrow.directPowerRatio));
  if (execute && monster.hp / Math.max(1, monster.maxHp) <= execute.threshold)
    power = Math.round(power * (1 + execute.multiplier));
  damageMonster(w, owner.connectionId, owner.player, monster, skill, now, projectile.basic, power);
  if (cometArrow) {
    applyCometExplosion(
      w.state.monsterGrid.queryRadius(
        monster,
        cometArrow.radius + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS,
      ),
      monster.id,
      cometArrow,
      (candidate, radius) =>
        candidate.deadUntil <= now &&
        withinRange(monster, candidate, radius + monsterBodyRadius(candidate.species)) &&
        hasLineOfSight(monster, candidate, zone(w.state).terrain.tiles),
      (candidate, powerRatio) =>
        damageMonster(
          w,
          owner.connectionId,
          owner.player,
          candidate,
          skill,
          now,
          false,
          Math.max(1, Math.round(projectile.power * powerRatio)),
        ),
    );
  }
  const ricochet = talentEffect(owner.player.class, owner.player.talents, "ricochet", skill.slot);
  if (!ricochet || projectile.ricochetRemaining <= 0) return;
  const target = w.state.monsterGrid
    .queryRadius(monster, ricochet.range)
    .filter(
      (candidate) =>
        candidate.id !== monster.id &&
        candidate.deadUntil <= now &&
        !projectile.hitEntityIds.has(candidate.id) &&
        hasLineOfSight(monster, candidate, zone(w.state).terrain.tiles),
    )
    .sort((a, b) => pointDistance(monster, a) - pointDistance(monster, b))[0];
  const definition = actionForClassSlot(owner.player.class, skill.slot).projectile;
  if (!target || !definition) return;
  const origin = { x: monster.x + PLAYER_SIZE / 2, y: monster.y + PLAYER_SIZE / 2 };
  const direction = normalizeDirection({ x: target.x - monster.x, y: target.y - monster.y });
  spawnProjectile(w.state.projectiles, {
    actionId: crypto.randomUUID(),
    owner: owner.player,
    roomKey: owner.player.roomKey,
    origin,
    direction,
    definition: { ...definition, pierce: 0 },
    range: ricochet.range,
    power: Math.max(1, Math.round(projectile.power * ricochet.ratio)),
    targetFilter: "monsters",
    sourceSkillId: skill.id,
    basic: false,
    now,
    ricochetRemaining: projectile.ricochetRemaining - 1,
  });
}

/** Port of `#projectileHeal` (`world.ts:5405`). */
function projectileHeal(
  w: WorldGlue,
  projectile: ProjectileRuntime,
  targetConnectionId: string,
  target: PlayerRuntime,
  now: number,
): void {
  const owner = projectileOwner(w, projectile);
  if (!owner || !canAct(owner.player.life) || !areCombatAllies(owner.player, target)) return;
  const baseSkill = CLASS_SKILLS[owner.player.class].find(
    (candidate) => candidate.id === projectile.sourceSkillId,
  );
  const emergency = baseSkill
    ? talentEffect(owner.player.class, owner.player.talents, "emergency_mend", baseSkill.slot)
    : undefined;
  const healingPower = emergency
    ? emergencyMendPower(projectile.power, target.hp, maxHpForLevel(target.level), emergency)
    : projectile.power;
  const restored = healPlayer(
    w,
    owner.connectionId,
    owner.player,
    targetConnectionId,
    target,
    healingPower,
    projectile.sourceSkillId,
    now,
    false,
  );
  const chain = baseSkill
    ? talentEffect(owner.player.class, owner.player.talents, "chain_heal", baseSkill.slot)
    : undefined;
  if (!chain || restored <= 0) return;
  const chained = [...w.state.players]
    .filter(
      ([, candidate]) =>
        candidate.id !== target.id &&
        candidate.id !== owner.player.id &&
        candidate.life === "alive" &&
        candidate.hp < maxHpForLevel(candidate.level) &&
        areCombatAllies(owner.player, candidate) &&
        pointDistance(target, candidate) <= chain.range &&
        hasLineOfSight(target, candidate, zone(w.state).terrain.tiles),
    )
    .sort(([, a], [, b]) => pointDistance(target, a) - pointDistance(target, b))[0];
  if (chained)
    healPlayer(
      w,
      owner.connectionId,
      owner.player,
      chained[0],
      chained[1],
      Math.max(1, Math.round(projectile.power * chain.ratio)),
      projectile.sourceSkillId,
      now,
      false,
    );
}

/** Port of `#projectileBlocked` (`world.ts:5462`). */
function projectileBlocked(w: WorldGlue, projectile: ProjectileRuntime, point: Vec2): void {
  const owner = projectileOwner(w, projectile);
  if (!owner) return;
  w.deps.send(owner.connectionId, {
    t: "event",
    code: "skill.blocked",
    params: { skill: projectile.sourceSkillId },
    tone: "info",
    x: point.x,
    y: point.y,
  });
}

// -------------------------------------------------------------------------------------------------
// Player actions: start, resolve, variants
// -------------------------------------------------------------------------------------------------

/** Port of `#movePlayerInDirection` (`world.ts:2749`). */
function movePlayer(
  w: WorldGlue,
  player: PlayerRuntime,
  direction: Vec2,
  distance: number,
): boolean {
  return movePlayerInDirection(
    player,
    direction,
    distance,
    zone(w.state).terrain,
    w.state.playerGrid,
  );
}

/** Port of `#finishHeldPlayerAction` (`world.ts:1982`) — the `skill.release` intent. */
export function finishHeldPlayerAction(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  now: number,
  slot?: number,
): boolean {
  const action = player.action;
  if (!finishHeldCombatAction(player, now, slot)) return false;
  if (action?.skillId === "blink") {
    const terrain = zone(w.state).terrain;
    if (!isWalkable(player, PLAYER_SIZE, terrain)) {
      const shoreline = nearestShore(player, PLAYER_SIZE, terrain);
      if (shoreline && isWalkableForLumen(player, PLAYER_SIZE, terrain)) {
        player.x = shoreline.x;
        player.y = shoreline.y;
        player.dirty = true;
      }
    }
    const renewal = talentEffect(player.class, player.talents, "blink_heal", 3);
    if (renewal) {
      healPlayer(
        w,
        connectionId,
        player,
        connectionId,
        player,
        renewal.value + Math.max(0, player.level - 1),
        action.skillId,
        now,
        true,
      );
    }
  }
  sendStateTo(w, connectionId, player);
  return true;
}

/** Port of `#startPlayerAction` (`world.ts:2012`). Returns whether an action actually started —
 *  the caller checkpoints cooldowns onto the presence lease exactly then. */
export function startPlayerAction(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  slot: SkillSlot,
): boolean {
  const { deps } = w;
  const skill = skillWithTalents(player.class, player.talents, slot);
  if (!isSkillUnlocked(player.level, slot)) {
    deps.send(connectionId, {
      t: "event",
      code: "skill.locked",
      params: { level: SKILL_UNLOCK_LEVEL[slot], skill: skill.id },
      tone: "info",
    });
    return false;
  }
  const now = deps.now();
  if (!canAct(player.life)) return false;
  if (expireRogueStealth(player, now)) sendStateTo(w, connectionId, player);
  if (expireRogueShadowReturn(player, now)) sendStateTo(w, connectionId, player);
  const shadowReturn =
    skill.id === "shadow_step"
      ? talentEffect(player.class, player.talents, "rogue_shadow_return", 2)
      : undefined;
  if (shadowReturn && player.rogueShadowReturn) {
    const planning = planShadowReturn(player.rogueShadowReturn, now, zone(w.state).terrain);
    if (!planning.ok) {
      if (planning.reason === "expired") {
        player.rogueShadowReturn = null;
        sendStateTo(w, connectionId, player);
      } else {
        deps.send(connectionId, {
          t: "event",
          code: "skill.blocked",
          params: { skill: skill.id },
          tone: "info",
          x: player.x,
          y: player.y,
        });
      }
      return false;
    }
    const origin = { x: player.x, y: player.y };
    const predator = talentEffect(player.class, player.talents, "rogue_predator", 3);
    const stealthExited = exitRogueStealth(player, now, {
      offensive: true,
      openingBonusRatio: rogueOpeningBonusRatio(player, 3, predator?.openingBonusRatio),
    });
    if (stealthExited && predator) armRoguePredatorShiv(player, now, predator);
    cancelCombatAction(player);
    player.x = planning.destination.x;
    player.y = planning.destination.y;
    player.rogueShadowReturn = null;
    player.dirty = true;
    w.state.playerGrid.update(player, origin);
    sendStateTo(w, connectionId, player);
    deps.send(connectionId, {
      t: "event",
      code: "skill.cast",
      params: { skill: skill.id, slot },
      tone: "good",
      x: player.x,
      y: player.y,
    });
    sendSpatialEvent(
      w,
      {
        t: "animation",
        actionId: crypto.randomUUID(),
        actorKind: "player",
        actorId: player.id,
        action: "skill",
        skillId: skill.id,
        talented: true,
        evolved: true,
        direction: normalizeDirection(
          { x: planning.destination.x - origin.x, y: planning.destination.y - origin.y },
          player.facing,
        ),
        startedAt: now,
        impactAt: now,
        recoveryEndsAt: now + 180,
      },
      player,
    );
    return true;
  }
  if (skill.id === "vanish" && isRogueStealthed(player, now)) return false;
  if (player.guarding) {
    if (skill.id !== "iron_guard") return false;
    cancelCombatAction(player);
    player.guarding = false;
    player.guardActivatedAt = 0;
    player.skillCooldowns[slot - 1] = now + skill.cooldownMs;
    player.dirty = true;
    sendStateTo(w, connectionId, player);
    return true;
  }
  const resourceCost = skillResourceCost(player.class, slot);
  if (!canSpendResource(player.resource, resourceCost)) {
    deps.send(connectionId, { t: "event", code: "resource.insufficient", tone: "info" });
    return false;
  }
  if (slot === 1 && now - player.lastAttackAt < skill.cooldownMs) return false;
  if (skill.id === "mend" && now - player.lastHealAt < skill.cooldownMs) return false;
  if (slot !== 1 && (player.skillCooldowns[slot - 1] ?? 0) > now) return false;
  const definition = actionForClassSlot(player.class, slot);
  const shadowStepPhase =
    definition.shape === "shadow_step" &&
    talentEffect(player.class, player.talents, "rogue_shadow_phase", 2) !== undefined;
  const shadowStep =
    definition.shape === "shadow_step"
      ? planShadowStep(
          player,
          w.state.monsterGrid.queryRadius(
            player,
            skill.range + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS,
          ),
          skill.range,
          now,
          zone(w.state).terrain,
          (monster) => monsterBodyRadius(monster.species),
          { phaseThroughObstacles: shadowStepPhase },
        )
      : null;
  if (shadowStep && !shadowStep.ok) {
    deps.send(connectionId, {
      t: "event",
      code: shadowStep.reason === "blocked" ? "skill.blocked" : "skill.no_target",
      params: { skill: skill.id },
      tone: "info",
      x: player.x,
      y: player.y,
    });
    return false;
  }
  const shadowDance =
    definition.shape === "shadow_dance"
      ? planShadowDance(
          player,
          w.state.monsters,
          skill.range,
          ROGUE_BALANCE.shadowDance.maximumHits,
          now,
          zone(w.state).terrain,
          (monster) => monsterBodyRadius(monster.species),
          {
            repeatPrimary: Boolean(
              talentEffect(player.class, player.talents, "rogue_thousand_cuts", 5),
            ),
          },
        )
      : null;
  if (shadowDance && !shadowDance.ok) {
    deps.send(connectionId, {
      t: "event",
      code: shadowDance.reason === "blocked" ? "skill.blocked" : "skill.no_target",
      params: { skill: skill.id },
      tone: "info",
      x: player.x,
      y: player.y,
    });
    return false;
  }
  const chargeTarget =
    definition.shape === "charge"
      ? nearestChargeTarget(
          player,
          w.state.monsterGrid.queryRadius(
            player,
            skill.range + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS,
          ),
          skill.range,
          now,
          (monster) => hasLineOfSight(player, monster, zone(w.state).terrain.tiles),
        )
      : null;
  const shadowDanceTarget =
    shadowDance?.ok === true ? shadowDance.plan.strikes[0]?.targetPosition : undefined;
  const direction =
    shadowStep?.ok === true
      ? normalizeDirection(
          {
            x: shadowStep.plan.targetPosition.x - player.x,
            y: shadowStep.plan.targetPosition.y - player.y,
          },
          player.facing,
        )
      : shadowDanceTarget
        ? normalizeDirection(
            { x: shadowDanceTarget.x - player.x, y: shadowDanceTarget.y - player.y },
            player.facing,
          )
        : chargeTarget
          ? normalizeDirection(
              { x: chargeTarget.x - player.x, y: chargeTarget.y - player.y },
              player.facing,
            )
          : player.facing;
  const cyclone =
    definition.shape === "area_damage"
      ? talentEffect(player.class, player.talents, "cyclone", slot)
      : undefined;
  const action = startCombatAction(player, {
    kind: slot === 1 ? "basic" : "skill",
    skillId: skill.id,
    slot,
    direction,
    now,
    anticipationMs: definition.anticipationMs,
    recoveryMs: cyclone ? cycloneRecoveryMs(cyclone, definition.recoveryMs) : definition.recoveryMs,
    ...(definition.shape === "teleport"
      ? {
          mobilityDistance: skill.distance ?? 0,
          channelDurationMs: LUMEN_STEP_MAX_HOLD_MS,
        }
      : {}),
  });
  if (!action) return false;
  if (shadowStep?.ok === true) {
    action.rogueShadowStep = {
      targetId: shadowStep.plan.targetId,
      destination: { ...shadowStep.plan.destination },
      phaseThroughObstacles: shadowStepPhase,
    };
  }
  if (talentEffect(player.class, player.talents, "sacred_passage", slot))
    action.sacredPassageHealedIds = new Set();

  if (skill.id !== "vanish") {
    const predator = talentEffect(player.class, player.talents, "rogue_predator", 3);
    const stealthExited = exitRogueStealth(player, now, {
      offensive: true,
      openingBonusRatio: rogueOpeningBonusRatio(player, 3, predator?.openingBonusRatio),
    });
    if (stealthExited && predator) armRoguePredatorShiv(player, now, predator);
  }
  // Attacking breaks invisibility only once the action has actually been accepted.
  player.invisibleUntil = 0;

  if (slot === 1) player.lastAttackAt = now;
  else if (skill.id !== "iron_guard" && skill.id !== "vanish")
    player.skillCooldowns[slot - 1] = now + skill.cooldownMs;
  if (skill.id === "mend") player.lastHealAt = now;
  spendResource(player.resource, resourceCost);
  player.dirty = true;
  sendStateTo(w, connectionId, player);
  deps.send(connectionId, {
    t: "event",
    code: "skill.cast",
    params: { skill: skill.id, slot },
    tone: "good",
    x: player.x,
    y: player.y,
  });
  sendSpatialEvent(
    w,
    {
      t: "animation",
      actionId: action.id,
      actorKind: "player",
      actorId: player.id,
      action: slot === 1 ? "attack" : "skill",
      skillId: skill.id,
      ...(slot > 1 && talentEffects(player.class, player.talents, slot).length > 0
        ? { talented: true as const }
        : {}),
      ...(slot > 1 && evolvedTalent(player.class, player.talents, slot)
        ? { evolved: true as const }
        : {}),
      direction: { ...action.direction },
      startedAt: action.startedAt,
      impactAt: action.impactAt,
      ...(cyclone ? { impactTimes: cycloneImpactTimes(cyclone, action.impactAt) } : {}),
      recoveryEndsAt: action.recoveryEndsAt,
    },
    player,
  );
  return true;
}

/** Port of `#applyRoguePoison` (`world.ts:2829`). */
function applyRoguePoison(
  w: WorldGlue,
  player: PlayerRuntime,
  target: MonsterRuntime,
  skill: SkillDefinition,
  now: number,
): void {
  const baseSkill = CLASS_SKILLS.rogue[3];
  const talentPowerRatio = baseSkill ? skill.power / Math.max(1, baseSkill.power) : 1;
  const predator = talentEffect(player.class, player.talents, "rogue_predator", 3);
  const predatorPowerMultiplier = consumeRoguePredatorShivMultiplier(player, now, predator);
  const concentratedVenom = talentEffect(
    player.class,
    player.talents,
    "rogue_concentrated_venom",
    4,
  );
  applyDamageOverTime(w.state.damageOverTime, {
    kind: "poison",
    sourceId: player.id,
    sourceSkillId: skill.id,
    targetKind: "monster",
    targetId: target.id,
    now,
    tickCount: ROGUE_BALANCE.poisonedShiv.poisonTicks,
    tickPower: Math.max(
      1,
      Math.round(roguePoisonTickPower(player.level) * talentPowerRatio * predatorPowerMultiplier),
    ),
    intervalMs: ROGUE_BALANCE.poisonedShiv.poisonIntervalMs,
    maxStacks: concentratedVenom?.maxStacks ?? 1,
  });
}

/** Port of `#resolveShadowDance` (`world.ts:2857`). */
function resolveShadowDance(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  action: CombatActionRuntime,
  skill: SkillDefinition,
  now: number,
): void {
  const thousandCuts = talentEffect(player.class, player.talents, "rogue_thousand_cuts", 5);
  const planning = planShadowDance(
    player,
    w.state.monsters,
    skill.range,
    ROGUE_BALANCE.shadowDance.maximumHits,
    now,
    zone(w.state).terrain,
    (monster) => monsterBodyRadius(monster.species),
    { repeatPrimary: Boolean(thousandCuts) },
  );
  if (!planning.ok) {
    w.deps.send(connectionId, {
      t: "event",
      code: planning.reason === "blocked" ? "skill.blocked" : "skill.no_target",
      params: { skill: skill.id },
      tone: "info",
      x: player.x,
      y: player.y,
    });
    return;
  }

  const origin = { x: player.x, y: player.y };
  const strikes: RogueShadowDanceSequence["strikes"] = [];
  for (const planned of planning.plan.strikes) {
    const target = w.state.monsters.find((monster) => monster.id === planned.targetId);
    if (!target || target.deadUntil > now) continue;
    player.x = planned.landing.x;
    player.y = planned.landing.y;
    const repeatedPower =
      planned.repeated && thousandCuts
        ? Math.max(
            1,
            Math.round(
              (skill.power + Math.max(0, player.level - 1) * 2) * thousandCuts.repeatPowerRatio,
            ),
          )
        : undefined;
    const result = damageMonster(
      w,
      connectionId,
      player,
      target,
      skill,
      now,
      false,
      repeatedPower,
      {
        suppressHitEvent: true,
      },
    );
    if (!result) continue;
    strikes.push({
      targetId: target.id,
      from: { ...planned.from },
      targetPosition: { ...planned.targetPosition },
      landing: { ...planned.landing },
      impactAt: now + strikes.length * ROGUE_BALANCE.shadowDance.strikeIntervalMs,
      damage: result.actualDamage,
      killed: result.killed,
      ...(planned.repeated ? { repeated: true as const } : {}),
    });
  }
  const last = strikes.at(-1);
  if (!last) {
    player.x = origin.x;
    player.y = origin.y;
    return;
  }

  player.x = last.landing.x;
  player.y = last.landing.y;
  player.facing = normalizeDirection(
    { x: last.targetPosition.x - player.x, y: last.targetPosition.y - player.y },
    action.direction,
  );
  w.state.playerGrid.update(player, origin);
  const endsAt = now + Math.max(1, strikes.length) * ROGUE_BALANCE.shadowDance.strikeIntervalMs;
  player.rogueShadowDanceInvulnerableUntil = endsAt;
  player.dirty = true;
  const darkHarvest = talentEffect(player.class, player.talents, "rogue_dark_harvest", 5);
  if (darkHarvest) {
    const kills = strikes.filter((strike) => strike.killed).length;
    if (kills > 0) {
      reduceRogueShadowDanceCooldown(player, now, kills, darkHarvest);
      sendStateTo(w, connectionId, player);
    }
  }

  const sequence: RogueShadowDanceSequence = {
    t: "rogue.shadow_dance",
    actionId: action.id,
    actorId: player.id,
    startedAt: now,
    endsAt,
    strikes,
    finalPosition: { x: player.x, y: player.y },
  };
  sendSpatialEventAcross(w, sequence, [
    origin,
    ...strikes.flatMap((strike) => [strike.targetPosition, strike.landing]),
  ]);
}

/** Port of `#resolveShieldBash` (`world.ts:2559`). */
function resolveShieldBash(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  action: CombatActionRuntime,
  skill: SkillDefinition,
  now: number,
): void {
  const terrain = zone(w.state).terrain;
  const distance = skill.distance ?? 0;
  const start = { x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 };
  const end = {
    x: start.x + action.direction.x * distance,
    y: start.y + action.direction.y * distance,
  };
  const terrainImpact = sweptProjectileTerrainImpact(
    start,
    end,
    PLAYER_SIZE / 2,
    terrain.tiles,
    terrain.colliders,
  );
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const monsterImpacts = w.state.monsterGrid
    .queryRadius(midpoint, distance / 2 + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS)
    .filter((monster) => monster.deadUntil <= now)
    .map((monster) => ({
      monster,
      impact: sweptProjectileEntityImpact(
        start,
        end,
        PLAYER_SIZE / 2,
        {
          center: { x: monster.x + PLAYER_SIZE / 2, y: monster.y + PLAYER_SIZE / 2 },
          radius: monsterBodyRadius(monster.species),
        },
        monster.id,
      ),
    }))
    .filter(
      (entry): entry is { monster: MonsterRuntime; impact: NonNullable<typeof entry.impact> } =>
        entry.impact !== null,
    );
  const first = firstSegmentImpact([terrainImpact, ...monsterImpacts.map(({ impact }) => impact)]);
  const travel = Math.max(0, distance * (first?.fraction ?? 1) - 1);
  movePlayer(w, player, action.direction, travel);
  let directTargetId: string | null = null;
  if (first?.kind === "entity") {
    const target = monsterImpacts.find(({ impact }) => impact.id === first.id)?.monster;
    if (target) {
      directTargetId = target.id;
      damageMonster(w, connectionId, player, target, skill, now, false);
    }
  } else if (first?.kind === "terrain") {
    w.deps.send(connectionId, {
      t: "event",
      code: "skill.blocked",
      params: { skill: skill.id },
      tone: "info",
      x: first.point.x,
      y: first.point.y,
    });
  }
  const seismic = talentEffect(player.class, player.talents, "seismic_impact", skill.slot);
  if (!seismic) return;
  applySeismicImpact(
    w.state.monsterGrid.queryRadius(player, seismic.radius + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS),
    directTargetId,
    seismic,
    (target, radius) =>
      target.deadUntil <= now &&
      withinRange(player, target, radius + monsterBodyRadius(target.species)) &&
      hasLineOfSight(player, target, terrain.tiles),
    (target, powerRatio) =>
      damageMonster(
        w,
        connectionId,
        player,
        target,
        skill,
        now,
        false,
        Math.max(1, Math.round((skill.power + Math.max(0, player.level - 1) * 2) * powerRatio)),
      ),
  );
}

/** Port of `#spawnPlayerProjectiles` (`world.ts:2646`). */
function spawnPlayerProjectiles(
  w: WorldGlue,
  player: PlayerRuntime,
  action: CombatActionRuntime,
  skill: SkillDefinition,
  definition: ReturnType<typeof actionForClassSlot>,
  targetFilter: "monsters" | "wounded_allies",
  now: number,
): void {
  const projectileDefinition = definition.projectile;
  if (!projectileDefinition) return;
  const extraProjectiles = talentEffect(
    player.class,
    player.talents,
    "extra_projectiles",
    skill.slot,
  );
  const focusedVolley = talentEffect(player.class, player.talents, "focused_volley", skill.slot);
  // Direction is frozen at wind-up, but projectile origin is frozen only when the projectile
  // actually appears. A moving ranger/priest therefore fires from their active-frame position.
  const source = { x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 };
  const count = Math.max(1, (projectileDefinition.count ?? 1) + (extraProjectiles?.value ?? 0));
  const spread = (projectileDefinition.spreadRadians ?? 0) * (focusedVolley?.spreadMultiplier ?? 1);
  const activationHitEntityIds = count > 1 && !focusedVolley ? new Set<string>() : undefined;
  const activationHitCounts = focusedVolley ? new Map<string, number>() : undefined;
  for (let index = 0; index < count; index++) {
    const offset = count === 1 ? 0 : -spread / 2 + (spread * index) / (count - 1);
    const cosine = Math.cos(offset);
    const sine = Math.sin(offset);
    const direction = normalizeDirection({
      x: action.direction.x * cosine - action.direction.y * sine,
      y: action.direction.x * sine + action.direction.y * cosine,
    });
    const power =
      targetFilter === "wounded_allies"
        ? (skill.allyPower ?? skill.power) + Math.max(0, player.level - 1) * 3
        : skill.slot === 1
          ? attackDamageFor(player.class, player.level)
          : skill.power + Math.max(0, player.level - 1) * 2;
    spawnProjectile(w.state.projectiles, {
      actionId: action.id,
      owner: player,
      roomKey: player.roomKey,
      origin: {
        ...source,
        x:
          source.x +
          normalizeDirection(direction).x * (PLAYER_SIZE / 2 + projectileDefinition.radius + 2),
        y:
          source.y +
          normalizeDirection(direction).y * (PLAYER_SIZE / 2 + projectileDefinition.radius + 2),
      },
      direction,
      definition: projectileDefinition,
      range: skill.range,
      power,
      targetFilter,
      sourceSkillId: skill.id,
      basic: skill.slot === 1,
      now,
      ricochetRemaining: talentEffect(player.class, player.talents, "ricochet", skill.slot) ? 1 : 0,
      ...(activationHitEntityIds ? { activationHitEntityIds } : {}),
      ...(activationHitCounts ? { activationHitCounts } : {}),
    });
  }
}

/** Port of `#spawnRetreatShot` (`world.ts:2718`). */
function spawnRetreatShot(
  w: WorldGlue,
  player: PlayerRuntime,
  action: CombatActionRuntime,
  skill: SkillDefinition,
  effect: Extract<TalentEffect, { kind: "retreat_shot" }>,
  now: number,
): void {
  const arrow = actionForClassSlot("ranger", 1).projectile;
  if (!arrow) return;
  const power = Math.max(
    1,
    Math.round(attackDamageFor(player.class, player.level) * Math.max(0, effect.powerRatio)),
  );
  for (const direction of retreatShotDirections(action.direction, effect)) {
    spawnProjectile(w.state.projectiles, {
      actionId: action.id,
      owner: player,
      roomKey: player.roomKey,
      origin: projectileOrigin(player, direction, arrow.radius),
      direction,
      definition: { ...arrow, pierce: 0 },
      range: effect.range,
      power,
      targetFilter: "monsters",
      sourceSkillId: skill.id,
      basic: false,
      now,
    });
  }
}

/** Port of `#resolvePlayerAction` (`world.ts:2291`): the active frame of a player action. */
export function resolvePlayerAction(
  w: WorldGlue,
  player: PlayerRuntime,
  action: CombatActionRuntime,
  now: number,
): void {
  if (!player.authorized || player.transitioning || !canAct(player.life)) return;
  const connectionId = connectionOf(w.state, player.id);
  const slot = action.slot;
  if (connectionId === undefined || slot === undefined || slot < 1 || slot > 5) return;
  const skill = skillWithTalents(player.class, player.talents, slot as SkillSlot);
  const definition = actionForClassSlot(player.class, slot);
  const center = { x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 };
  const terrain = zone(w.state).terrain;

  if (definition.shape === "stealth") {
    if (enterRogueStealth(player, now)) {
      const smokeScreen = talentEffect(player.class, player.talents, "rogue_smoke_screen", 3);
      if (smokeScreen) applyRogueSmokeProtection(player, now, smokeScreen);
      forgetPlayer(w, player);
      sendStateTo(w, connectionId, player);
    }
    return;
  }

  if (definition.shape === "shadow_step") {
    const planned = action.rogueShadowStep;
    const target = planned
      ? w.state.monsters.find((monster) => monster.id === planned.targetId)
      : undefined;
    const destinationValid = planned
      ? planned.phaseThroughObstacles
        ? isShadowStepLandingValid(planned.destination, terrain)
        : isShadowStepPathClear(player, planned.destination, terrain)
      : false;
    if (
      !planned ||
      !target ||
      target.deadUntil > now ||
      !withinRange(player, target, skill.range) ||
      (!planned.phaseThroughObstacles && !hasRogueLineOfSight(player, target, terrain)) ||
      !destinationValid
    ) {
      w.deps.send(connectionId, {
        t: "event",
        code: target ? "skill.blocked" : "skill.no_target",
        params: { skill: skill.id },
        tone: "info",
        x: player.x,
        y: player.y,
      });
      return;
    }
    const previousPosition = { x: player.x, y: player.y };
    const shadowReturn = talentEffect(player.class, player.talents, "rogue_shadow_return", 2);
    if (shadowReturn) {
      player.rogueShadowReturn = {
        ...previousPosition,
        expiresAt: now + Math.max(0, shadowReturn.windowMs),
      };
    }
    player.x = planned.destination.x;
    player.y = planned.destination.y;
    player.facing = normalizeDirection(
      { x: target.x - player.x, y: target.y - player.y },
      action.direction,
    );
    w.state.playerGrid.update(player, previousPosition);
    const executor = talentEffect(player.class, player.talents, "rogue_executor", 2);
    grantRogueOpening(
      player,
      "shadow_step",
      now,
      rogueOpeningBonusRatio(player, 2, executor?.openingBonusRatio),
    );
    const rupture = talentEffect(player.class, player.talents, "rogue_rupture", 4);
    if (rupture) {
      const consumedPower = consumeDamageOverTimePower(
        w.state.damageOverTime,
        {
          kind: "poison",
          sourceId: player.id,
          sourceSkillId: "poisoned_shiv",
          targetKind: "monster",
          targetId: target.id,
        },
        rupture.remainingDamageRatio,
      );
      if (consumedPower > 0) {
        damageMonster(w, connectionId, player, target, skill, now, false, consumedPower, {
          poisonRupture: true,
        });
      }
    }
    sendStateTo(w, connectionId, player);
    return;
  }

  if (definition.shape === "shadow_dance") {
    resolveShadowDance(w, connectionId, player, action, skill, now);
    return;
  }

  if (definition.shape === "arc") {
    const arc = frontalArc(
      center,
      action.direction,
      skill.range,
      definition.halfAngleRadians ?? Math.PI / 3,
    );
    const targets = w.state.monsterGrid
      .queryRadius(center, skill.range + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS)
      .filter(
        (monster) =>
          monster.deadUntil <= now &&
          circleIntersectsArc(
            {
              center: { x: monster.x + PLAYER_SIZE / 2, y: monster.y + PLAYER_SIZE / 2 },
              radius: monsterBodyRadius(monster.species),
            },
            arc,
          ) &&
          (player.class === "rogue"
            ? hasRogueLineOfSight(player, monster, terrain)
            : hasLineOfSight(player, monster, terrain.tiles)),
      )
      .sort((left, right) => {
        const distance =
          Math.hypot(left.x - player.x, left.y - player.y) -
          Math.hypot(right.x - player.x, right.y - player.y);
        return distance || left.id.localeCompare(right.id);
      });
    const resolvedTargets = player.class === "rogue" ? targets.slice(0, 1) : targets;
    for (const monster of resolvedTargets) {
      const result = damageMonster(w, connectionId, player, monster, skill, now, slot === 1);
      if (skill.id === "poisoned_shiv" && result && !result.killed)
        applyRoguePoison(w, player, monster, skill, now);
    }
    return;
  }
  if (definition.shape === "charge") {
    resolveShieldBash(w, connectionId, player, action, skill, now);
    return;
  }
  if (definition.shape === "guard") {
    player.guardUntil = 0;
    player.guarding = true;
    player.guardReduction = skill.reduction ?? 0;
    player.guardActivatedAt = now;
    player.dirty = true;
    sendStateTo(w, connectionId, player);
    return;
  }
  if (definition.shape === "dash") {
    movePlayer(w, player, { x: -action.direction.x, y: -action.direction.y }, skill.distance ?? 0);
    const retreatShot = talentEffect(
      player.class,
      player.talents,
      "retreat_shot",
      slot as SkillSlot,
    );
    if (retreatShot) spawnRetreatShot(w, player, action, skill, retreatShot, now);
    return;
  }
  if (definition.shape === "teleport") {
    // Lumen Step moves through ordinary authoritative input while held. The active frame only
    // completes the fade-out; release (or a server bound) controls rematerialization.
    return;
  }
  if (definition.shape === "projectile" || definition.shape === "volley") {
    spawnPlayerProjectiles(w, player, action, skill, definition, "monsters", now);
    return;
  }
  if (definition.shape === "heal_projectile") {
    spawnPlayerProjectiles(w, player, action, skill, definition, "wounded_allies", now);
    return;
  }
  if (definition.shape === "area_taunt") {
    const rally = talentEffect(player.class, player.talents, "rallying_cry", slot as SkillSlot);
    if (rally) {
      applyRallyingCry(
        player,
        w.state.players.values(),
        rally,
        now,
        (source, target) => areCombatAllies(source, target),
        (source, target) => hasLineOfSight(source, target, terrain.tiles),
      );
      return;
    }
    const radius = skill.radius ?? skill.range;
    let taunted = 0;
    for (const monster of w.state.monsterGrid.queryRadius(
      center,
      radius + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS,
    )) {
      if (
        monster.deadUntil <= now &&
        // Reach the monster's BODY, not its centre: a troll standing with its bulk inside the ring
        // and its centre just outside is visibly in the area, so it must answer for being there.
        withinRange(player, monster, radius + monsterBodyRadius(monster.species)) &&
        hasLineOfSight(player, monster, terrain.tiles)
      ) {
        tauntMonster(player, monster, now);
        taunted += 1;
      }
    }
    const challenge = talentEffect(
      player.class,
      player.talents,
      "king_challenge",
      slot as SkillSlot,
    );
    if (challenge) applyKingsChallenge(player, taunted, challenge, now);
    return;
  }
  const novaMultipliers = novaSpecializationMultipliers(
    talentEffect(player.class, player.talents, "nova_judgment", slot as SkillSlot),
    talentEffect(player.class, player.talents, "nova_mercy", slot as SkillSlot),
  );
  if (definition.shape === "area_damage" || definition.shape === "nova") {
    const cyclone = talentEffect(player.class, player.talents, "cyclone", slot as SkillSlot);
    if (cyclone) {
      startWarriorCyclone(player, action.id, skill, cyclone, now);
      return;
    }
    const radius = skill.radius ?? skill.range;
    for (const monster of w.state.monsterGrid.queryRadius(
      center,
      radius + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS,
    )) {
      if (
        monster.deadUntil <= now &&
        withinRange(player, monster, radius + monsterBodyRadius(monster.species)) &&
        hasLineOfSight(player, monster, terrain.tiles)
      )
        damageMonster(
          w,
          connectionId,
          player,
          monster,
          skill,
          now,
          false,
          Math.max(
            1,
            Math.round((skill.power + Math.max(0, player.level - 1) * 2) * novaMultipliers.damage),
          ),
        );
    }
  }
  if (definition.shape === "area_heal" || definition.shape === "nova") {
    areaHeal(w, connectionId, player, skill, now, novaMultipliers.healing);
    const sanctuary = talentEffect(player.class, player.talents, "sanctuary", slot as SkillSlot);
    if (sanctuary) {
      startSanctuary(w.state.sanctuaries, {
        ownerId: player.id,
        x: player.x,
        y: player.y,
        radius: skill.radius ?? skill.range,
        power: skill.power + Math.max(0, player.level - 1) * 2,
        effect: sanctuary,
        now,
      });
    }
  }
}

/** Port of `#resolveWarriorCycloneStrike` (`world.ts:2973`). */
function resolveWarriorCycloneStrike(
  w: WorldGlue,
  player: PlayerRuntime,
  radius: number,
  power: number,
  now: number,
): void {
  const connectionId = connectionOf(w.state, player.id);
  if (connectionId === undefined) return;
  const skill = skillWithTalents(player.class, player.talents, 5);
  for (const monster of w.state.monsterGrid
    .queryRadius(player, radius + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    if (
      monster.deadUntil > now ||
      !withinRange(player, monster, radius + monsterBodyRadius(monster.species)) ||
      !hasLineOfSight(player, monster, zone(w.state).terrain.tiles)
    )
      continue;
    damageMonster(w, connectionId, player, monster, skill, now, false, power);
  }
}

/** Port of `#applySacredPassage` (`world.ts:2990`). */
function applySacredPassage(
  w: WorldGlue,
  casterConnectionId: string,
  caster: PlayerRuntime,
  previous: Vec2,
  now: number,
): void {
  const action = caster.action;
  const healedIds = action?.sacredPassageHealedIds;
  if (action?.skillId !== "blink" || !healedIds) return;
  const effect = talentEffect(caster.class, caster.talents, "sacred_passage", 3);
  if (!effect) return;
  const from = { x: previous.x + PLAYER_SIZE / 2, y: previous.y + PLAYER_SIZE / 2 };
  const to = { x: caster.x + PLAYER_SIZE / 2, y: caster.y + PLAYER_SIZE / 2 };
  if (from.x === to.x && from.y === to.y) return;
  const candidates = [...w.state.players.values()].filter(
    (target) => target !== caster && target.life === "alive" && areCombatAllies(caster, target),
  );
  for (const target of sacredPassageTargets(candidates, healedIds, (candidate) => {
    return (
      sweptProjectileEntityImpact(
        from,
        to,
        effect.width,
        {
          center: { x: candidate.x + PLAYER_SIZE / 2, y: candidate.y + PLAYER_SIZE / 2 },
          radius: PLAYER_SIZE / 2,
        },
        candidate.id,
      ) !== null
    );
  })) {
    const targetConnectionId = connectionOf(w.state, target.id);
    if (targetConnectionId === undefined) continue;
    healPlayer(
      w,
      casterConnectionId,
      caster,
      targetConnectionId,
      target,
      effect.power + Math.max(0, caster.level - 1) * effect.powerPerLevel,
      "blink",
      now,
      false,
    );
  }
}

/** Port of `#areaHeal` (`world.ts:3035`). */
function areaHeal(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  skill: SkillDefinition,
  now: number,
  powerMultiplier = 1,
): number {
  let healed = 0;
  const absolution = talentEffect(player.class, player.talents, "absolution", skill.slot);
  for (const [targetConnectionId, target] of w.state.players) {
    if (
      target.life !== "alive" ||
      !areCombatAllies(player, target) ||
      pointDistance(player, target) > (skill.radius ?? skill.range)
    )
      continue;
    if (!hasLineOfSight(player, target, zone(w.state).terrain.tiles)) continue;
    if (absolution) cleanseNegativeEffect(target, absolution.cleanse);
    const amount = Math.max(
      0,
      Math.round((skill.power + Math.max(0, player.level - 1) * 2) * Math.max(0, powerMultiplier)),
    );
    if (
      healPlayer(
        w,
        connectionId,
        player,
        targetConnectionId,
        target,
        amount,
        skill.id,
        now,
        target === player,
      ) > 0
    )
      healed += 1;
  }
  return healed;
}

/** Port of `#resolveSanctuaryTick` (`world.ts:3076`). */
function resolveSanctuaryTick(w: WorldGlue, sanctuary: SanctuaryRuntime, now: number): void {
  const casterConnectionId = connectionOf(w.state, sanctuary.ownerId);
  const caster =
    casterConnectionId === undefined ? undefined : w.state.players.get(casterConnectionId);
  if (casterConnectionId === undefined || !caster) return;
  for (const [targetConnectionId, target] of w.state.players) {
    if (
      target.life !== "alive" ||
      !areCombatAllies(caster, target) ||
      pointDistance(sanctuary, target) > sanctuary.radius ||
      !hasLineOfSight(sanctuary, target, zone(w.state).terrain.tiles)
    )
      continue;
    healPlayer(
      w,
      casterConnectionId,
      caster,
      targetConnectionId,
      target,
      sanctuary.power,
      "prayer",
      now,
      target === caster,
    );
  }
}

// -------------------------------------------------------------------------------------------------
// Interact, quests, consumables, merchant
// -------------------------------------------------------------------------------------------------

/** Port of `#resurrectNearbyCorpse` (`world.ts:3748`): the interact key is the priest's revive. */
function resurrectNearbyCorpse(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  now: number,
): { handled: boolean; cooldownStarted: boolean } {
  const heal = CLASS_STATS[player.class].heal;
  let target: PlayerRuntime | undefined;
  let targetConnectionId: string | undefined;
  let distance = heal?.range ?? INTERACTION_RANGE;

  for (const [candidateConnectionId, candidate] of w.state.players) {
    if (
      candidateConnectionId === connectionId ||
      !canBeResurrected(candidate.life) ||
      candidate.corpse === null
    )
      continue;
    const candidateDistance = pointDistance(player, candidate.corpse);
    if (candidateDistance > distance) continue;
    target = candidate;
    targetConnectionId = candidateConnectionId;
    distance = candidateDistance;
  }
  if (!target || targetConnectionId === undefined)
    return { handled: false, cooldownStarted: false };

  // Only now that we know a body is in reach is it worth telling a warrior he cannot help.
  if (!heal) {
    w.deps.send(connectionId, { t: "event", code: "resurrect.not_priest", tone: "info" });
    return { handled: true, cooldownStarted: false };
  }
  if (now - player.lastResurrectAt < RESURRECT_COOLDOWN_MS) {
    w.deps.send(connectionId, { t: "event", code: "resurrect.nobody", tone: "info" });
    return { handled: true, cooldownStarted: false };
  }

  player.lastResurrectAt = now;
  target.life = "alive";
  target.resurrectionAt = 0;
  target.corpse = null;
  target.hp = resurrectHp(target.level);
  grantReviveGrace(w, target, now);
  freeze(w, target);

  w.deps.send(connectionId, {
    t: "event",
    code: "resurrect.cast",
    params: { name: target.nick },
    tone: "good",
    x: target.x,
    y: target.y,
  });
  w.deps.send(targetConnectionId, {
    t: "event",
    code: "death.resurrected",
    params: { name: player.nick },
    tone: "good",
    x: target.x,
    y: target.y,
  });
  sendStateTo(w, targetConnectionId, target);
  return { handled: true, cooldownStarted: true };
}

/** Port of `#interactQuestSite` (`world.ts:3806`). */
function interactQuestSite(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  chapter: QuestChapter,
  site: QuestSite,
  now: number,
): void {
  const definition = questDefinition(zone(w.state), chapter);
  if (!definition) return;
  const { order } = site;
  if (chapter === "ward_run") {
    if (player.wardRunExpiresAt !== null && player.wardRunExpiresAt <= now) {
      player.quest.progress = 0;
      player.wardRunExpiresAt = null;
      w.deps.send(connectionId, { t: "event", code: "quest.run_expired", tone: "bad" });
      sendStateTo(w, connectionId, player);
      player.dirty = true;
      return;
    }
    if (order === 0 && player.quest.progress === 0) {
      player.wardRunExpiresAt = now + QUEST_RUN_LIMIT_MS;
      w.deps.send(connectionId, {
        t: "event",
        code: "quest.run_started",
        params: { seconds: QUEST_RUN_LIMIT_MS / 1_000 },
        tone: "good",
      });
    }
  }

  if (order !== player.quest.progress) {
    if (chapter === "mire_runes" || chapter === "ward_run") {
      player.quest.progress = 0;
      player.wardRunExpiresAt = null;
    }
    w.deps.send(connectionId, { t: "event", code: "quest.site_wrong", tone: "bad" });
    sendStateTo(w, connectionId, player);
    player.dirty = true;
    return;
  }

  if (site.kind === "resource") {
    w.state.siteRespawnAt.set(site.id, now + QUEST_SITE_RESPAWN_MS);
    sendSpatialEvent(
      w,
      {
        t: "event",
        code: "quest.site_harvested",
        params: { site: site.id, seconds: QUEST_SITE_RESPAWN_MS / 1_000 },
        tone: "good",
        x: site.x,
        y: site.y,
      },
      site,
    );
  }
  player.quest.progress += 1;
  if (player.quest.progress >= definition.target) {
    player.quest.status = "ready";
    player.wardRunExpiresAt = null;
    w.deps.send(connectionId, { t: "event", code: "quest.chapter_ready", tone: "good" });
  } else {
    w.deps.send(connectionId, {
      t: "event",
      code: "quest.site_progress",
      params: { progress: player.quest.progress, target: definition.target },
      tone: "good",
    });
  }
  player.dirty = true;
  sendStateTo(w, connectionId, player);
}

/** Port of `#completeQuestChapter` (`world.ts:3878`). The idempotent D1 claim is a Task 6 seam;
 *  its stub returns `false`, which lands on the legacy already-claimed "blessing" path. */
async function completeQuestChapter(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  chapter: QuestChapter,
): Promise<void> {
  const definition = questDefinition(zone(w.state), chapter);
  if (!definition) return;
  const result = applyExperience(player.level, player.xp, definition.rewardXp);
  const resultingHp = maxHpForLevel(result.level);
  if (!(await w.deps.savePlayer(player, connectionId))) return;
  const claimed = await w.deps.claimQuestReward(player, {
    sessionEpoch: player.sessionEpoch,
    questId: chapter,
    rewardGold: definition.rewardGold,
    rewardPotions: 1,
    resultingLevel: result.level,
    resultingXp: result.xp,
    resultingHp,
  });
  if (!claimed) {
    w.deps.send(connectionId, { t: "event", code: "quest.blessing", tone: "good" });
    return;
  }
  player.inventory.potions += 1;
  player.inventory.gold += definition.rewardGold;
  player.level = result.level;
  player.xp = result.xp;
  player.hp = resultingHp;
  player.wardRunExpiresAt = null;

  const next = nextQuestChapter(zone(w.state), chapter);
  if (next) {
    player.quest = {
      chapter: next,
      status: "available",
      progress: 0,
      target: questDefinition(zone(w.state), next)?.target ?? 0,
    };
  } else {
    player.quest.status = "completed";
  }
  w.deps.send(connectionId, {
    t: "event",
    code: "quest.fulfilled",
    params: { chapter, xp: definition.rewardXp, gold: definition.rewardGold },
    tone: "good",
  });
  player.dirty = true;
  await w.deps.savePlayer(player, connectionId);
}

/**
 * Port of `#interact` (`world.ts:3459`), the in-room parts. Portals only name catalogue zones and
 * an authored map has none, so a (currently impossible) portal hit refuses with the legacy denial
 * code until Task 8 lands the transition. Authored quest bindings and `action` event triggers slot
 * in between the resurrection and the legacy quest keepers with Task 7.
 */
export async function handleInteract(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
): Promise<{ cooldownStarted: boolean }> {
  const now = w.deps.now();
  if (!canAct(player.life)) return { cooldownStarted: false };
  const portal = zone(w.state).portals.find(
    (candidate) => pointDistance(player, candidate) <= INTERACTION_RANGE,
  );
  if (portal) {
    // Task 8: catalogue-portal transition. Refusing is the safe authoritative answer until then.
    w.deps.send(connectionId, { t: "event", code: "zone.transition_denied", tone: "bad" });
    return { cooldownStarted: false };
  }
  const merchant = merchantForRuntimeRoom();
  if (merchant && pointDistance(player, merchant) <= INTERACTION_RANGE) {
    w.deps.send(connectionId, { t: "merchant.open" });
    return { cooldownStarted: false };
  }
  // A corpse is just one more thing you can be standing next to. The skill bar is full and this
  // codebase resolves every action as "the nearest valid thing in range"; so does this.
  const resurrection = resurrectNearbyCorpse(w, connectionId, player, now);
  if (resurrection.handled) return { cooldownStarted: resurrection.cooldownStarted };
  // Task 7: authored quest targets (`#triggerQuestTargetNearby`) then authored `action` events
  // (`#triggerActionEventNearby`) slot in here, between resurrection and the legacy keepers.
  const chapter = player.quest.chapter ?? "three_offerings";
  player.quest.chapter = chapter;

  const site = zone(w.state).questSites.find(
    (candidate) =>
      candidate.chapter === chapter && pointDistance(player, candidate) <= INTERACTION_RANGE,
  );
  if (site && player.quest.status === "active") {
    if (site.kind === "resource" && (w.state.siteRespawnAt.get(site.id) ?? 0) > now) {
      w.deps.send(connectionId, { t: "event", code: "interact.nothing", tone: "info" });
      return { cooldownStarted: false };
    }
    interactQuestSite(w, connectionId, player, chapter, site, now);
    return { cooldownStarted: false };
  }

  const definition = questDefinition(zone(w.state), chapter);
  if (!definition) {
    w.deps.send(connectionId, { t: "event", code: "interact.nothing", tone: "info" });
    return { cooldownStarted: false };
  }
  if (pointDistance(player, definition.giver) > INTERACTION_RANGE) {
    w.deps.send(connectionId, { t: "event", code: "interact.nothing", tone: "info" });
    return { cooldownStarted: false };
  }

  if (player.quest.status === "available") {
    player.quest.status = "active";
    player.quest.progress = 0;
    player.quest.target = definition.target;
    player.wardRunExpiresAt = null;
    w.deps.send(connectionId, {
      t: "event",
      code: "quest.accepted",
      params: { chapter, target: definition.target },
      tone: "good",
    });
  } else if (player.quest.status === "active") {
    w.deps.send(connectionId, {
      t: "event",
      code: "quest.progress",
      params: { chapter, progress: player.quest.progress, target: definition.target },
      tone: "info",
    });
  } else if (player.quest.status === "ready") {
    await completeQuestChapter(w, connectionId, player, chapter);
  } else {
    w.deps.send(connectionId, { t: "event", code: "quest.blessing", tone: "good" });
  }
  player.dirty = true;
  sendStateTo(w, connectionId, player);
  return { cooldownStarted: false };
}

/** Port of `#useConsumable` (`world.ts:3930`). */
export async function handleUseConsumable(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  item: ConsumableId,
): Promise<void> {
  const now = w.deps.now();
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  player.inventory.consumables = counts;
  const resurrection = item === "resurrection_potion";
  if ((resurrection && player.life !== "corpse") || (!resurrection && !canAct(player.life))) {
    w.deps.send(connectionId, { t: "event", code: "item.invalid", params: { item }, tone: "info" });
    return;
  }
  if (player.consumableCooldownUntil > now) {
    w.deps.send(connectionId, {
      t: "event",
      code: "item.cooldown",
      params: { seconds: Math.ceil((player.consumableCooldownUntil - now) / 1_000) },
      tone: "info",
    });
    return;
  }
  if (counts[item] <= 0) {
    w.deps.send(connectionId, { t: "event", code: "item.invalid", params: { item }, tone: "info" });
    return;
  }

  const definition = CONSUMABLES[item];
  if (item === "health_potion") {
    const maxHp = maxHpForLevel(player.level);
    if (player.hp >= maxHp) {
      w.deps.send(connectionId, {
        t: "event",
        code: "item.invalid",
        params: { item },
        tone: "info",
      });
      return;
    }
    const remaining = await w.deps.consumePotion(player, connectionId);
    if (remaining === null) return;
    player.inventory.potions = remaining;
    counts.health_potion = remaining;
    player.hp = Math.min(maxHp, player.hp + definition.effectValue);
  } else if (item === "mana_potion") {
    if (player.resource?.kind !== "mana" || player.resource.current >= player.resource.max) {
      w.deps.send(connectionId, {
        t: "event",
        code: "item.invalid",
        params: { item },
        tone: "info",
      });
      return;
    }
    counts[item] -= 1;
    player.resource.current = Math.min(
      player.resource.max,
      player.resource.current + definition.effectValue,
    );
  } else {
    counts[item] -= 1;
    if (item === "damage_elixir") player.damageBoostUntil = now + definition.durationMs;
    if (item === "oblivion_draught") {
      player.forgottenUntil = now + definition.durationMs;
      forgetPlayer(w, player);
    }
    if (item === "invisibility_potion") {
      player.invisibleUntil = now + definition.durationMs;
      forgetPlayer(w, player);
    }
    if (item === "resurrection_potion") player.resurrectionAt = now + definition.durationMs;
  }

  player.consumableCooldownUntil = now + CONSUMABLE_COOLDOWN_MS;
  player.dirty = true;
  recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
    id,
    mapId,
    actor,
    type: "itemUsed",
    itemId: item,
    amount: 1,
  }));
  recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
    id,
    mapId,
    actor,
    type: "itemRemoved",
    itemId: item,
    amount: 1,
    inventoryQuantity: counts[item],
  }));
  w.deps.send(connectionId, { t: "event", code: "item.used", params: { item }, tone: "good" });
  sendStateTo(w, connectionId, player);
}

/** Port of `#buyConsumable` (`world.ts:4012`): the counter the hero was served at, or nothing. */
export function handleBuyConsumable(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  item: ConsumableId,
): void {
  const counter = player.shopAnchor ?? merchantForRuntimeRoom();
  if (!counter || pointDistance(player, counter) > INTERACTION_RANGE) {
    player.shopAnchor = null;
    w.deps.send(connectionId, { t: "event", code: "item.invalid", params: { item }, tone: "bad" });
    return;
  }
  const definition = CONSUMABLES[item];
  if (player.inventory[definition.currency] < definition.price) {
    w.deps.send(connectionId, {
      t: "event",
      code: "merchant.insufficient",
      params: { currency: definition.currency },
      tone: "bad",
    });
    return;
  }
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  player.inventory.consumables = counts;
  player.inventory[definition.currency] -= definition.price;
  counts[item] += 1;
  if (item === "health_potion") player.inventory.potions = counts.health_potion;
  player.dirty = true;
  recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
    id,
    mapId,
    actor,
    type: "itemAcquired",
    itemId: item,
    amount: 1,
    inventoryQuantity: counts[item],
  }));
  w.deps.send(connectionId, {
    t: "event",
    code: "merchant.purchased",
    params: { item },
    tone: "good",
  });
  sendStateTo(w, connectionId, player);
}

// -------------------------------------------------------------------------------------------------
// Talents and chat
// -------------------------------------------------------------------------------------------------

/** Port of the `talent.unlock` arm of `#handleMessage` (`world.ts:1761`). */
export function handleTalentUnlock(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  nodeId: string,
): void {
  const result = unlockTalent(player.class, player.level, player.talents, nodeId);
  if (!result.ok) {
    w.deps.send(connectionId, {
      t: "event",
      code: "talent.invalid",
      params: { reason: result.reason },
      tone: "bad",
    });
    return;
  }
  player.talents = result.selected;
  if (player.guarding) {
    player.guardReduction = skillWithTalents(player.class, player.talents, 2).reduction ?? 0;
    player.guardActivatedAt = 0;
  }
  player.dirty = true;
  sendStateTo(w, connectionId, player);
  w.deps.send(connectionId, {
    t: "event",
    code: "talent.unlocked",
    params: { talent: nodeId },
    tone: "good",
  });
}

/** Port of the `talent.reset` arm of `#handleMessage` (`world.ts:1787`). */
export function handleTalentReset(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  player.talents = [];
  if (player.guarding) {
    player.guardReduction = skillWithTalents(player.class, player.talents, 2).reduction ?? 0;
    player.guardActivatedAt = 0;
  }
  player.dirty = true;
  sendStateTo(w, connectionId, player);
  w.deps.send(connectionId, { t: "event", code: "talent.reset", tone: "good" });
}

/**
 * Port of the `chat` arm of `#handleMessage` (`world.ts:1891-1909`). `party` fans out through the
 * coordinator (the persistent D1 party, across map rooms); anything else is local AOI chat. Cheat
 * commands are not ported this tranche, and the legacy runtime-party fallback is rollback-only.
 */
export function handleChat(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  channel: string | undefined,
  rawText: string,
): void {
  const text = rawText.trim().replaceAll(/\s+/g, " ");
  if (text.length === 0 || text.length > CHAT_MAX_LENGTH) return;
  if (channel === "party") {
    if (player.identityKind === "hero" && player.partyId) {
      w.deps.broadcastToParty(player.partyId, {
        t: "chat",
        channel: "party",
        from: player.nick,
        text,
      });
    } else {
      w.deps.send(connectionId, { t: "event", code: "party.invalid", tone: "bad" });
    }
    return;
  }
  sendLocalChat(w, player, text);
}

// -------------------------------------------------------------------------------------------------
// Tick-order slots
// -------------------------------------------------------------------------------------------------

/** Port of `#advanceConsumableEffects` (`world.ts:4423`): the resurrection draught fires. */
function advanceConsumableEffects(w: WorldGlue, now: number): void {
  for (const [connectionId, player] of w.state.players) {
    if (player.resurrectionAt <= 0 || player.resurrectionAt > now) continue;
    player.resurrectionAt = 0;
    if (player.life !== "corpse") continue;
    player.life = "alive";
    player.corpse = null;
    player.hp = resurrectHp(player.level);
    grantReviveGrace(w, player, now);
    freeze(w, player);
    w.deps.send(connectionId, {
      t: "event",
      code: "item.resurrected",
      tone: "good",
      x: player.x,
      y: player.y,
    });
    sendStateTo(w, connectionId, player);
  }
}

/** Port of `#detectAdventureExits` (`world.ts:5220`). Detection runs in its legacy slot; the
 *  transition itself is the Task 8 seam (`deps.transitionAdventureExit`). */
function detectAdventureExits(w: WorldGlue, now: number): void {
  const exits = exitEvents(zone(w.state).events ?? []);
  if (exits.length === 0) return;
  for (const [connectionId, player] of w.state.players) {
    if (
      player.identityKind !== "hero" ||
      player.life !== "alive" ||
      !player.authorized ||
      player.transitioning
    ) {
      w.state.occupiedExitByPlayerId.delete(player.id);
      continue;
    }
    const col = Math.floor(player.x / TILE_SIZE);
    const row = Math.floor(player.y / TILE_SIZE);
    const exit = exits.find((candidate) => candidate.col === col && candidate.row === row);
    if (!exit) {
      w.state.occupiedExitByPlayerId.delete(player.id);
      continue;
    }
    const key = `${w.state.location?.zoneId ?? ""}:${exit.id}`;
    if (
      w.state.occupiedExitByPlayerId.get(player.id) === key ||
      now - player.lastTransitionAt < 750
    ) {
      continue;
    }
    w.state.occupiedExitByPlayerId.set(player.id, key);
    w.deps.transitionAdventureExit(connectionId, player, exit.id, now);
  }
}

/**
 * The full authoritative tick, in the legacy `#advanceTick` order (`world.ts:4259-4421`). See the
 * module docblock for the slot list and which slots are later-task stubs. SYNCHRONOUS end-to-end:
 * an async tick slower than its 50ms period silently skips beats (RoomEngine's reentrancy guard).
 */
export function advanceWorldTick(w: WorldGlue): void {
  const { state, deps } = w;
  if (state.players.size === 0 || state.location === null) return;
  state.tick += 1;
  const now = deps.now();
  const writeResourceState = state.tick % ATTACHMENT_EVERY_TICKS === 0;
  const writeD1 = state.tick % D1_SAVE_EVERY_TICKS === 0;

  advanceConsumableEffects(w, now);
  for (const [connectionId, player] of state.players) {
    expireRogueOpening(player, now);
    expireRogueExecution(player, now);
    expireRoguePredatorShiv(player, now);
    expireRogueShadowDanceProtection(player, now);
    const shadowReturnExpired = expireRogueShadowReturn(player, now);
    const smokeProtectionExpired = expireRogueSmokeProtection(player, now);
    const selfStateChanged = shadowReturnExpired || smokeProtectionExpired;
    if (expireRogueStealth(player, now) || selfStateChanged) sendStateTo(w, connectionId, player);
  }
  advanceDamageOverTime(state.damageOverTime, now, {
    sourceIsActive: (sourceId) => {
      const source = playerById(state, sourceId);
      return Boolean(
        source?.authorized &&
          !source.transitioning &&
          source.life === "alive" &&
          source.roomKey === state.location?.roomKey,
      );
    },
    targetIsActive: (targetKind, targetId) =>
      targetKind === "monster" &&
      state.monsters.some((monster) => monster.id === targetId && monster.deadUntil <= now),
    resolveTick: (effect, _stack, tick) => {
      const sourceConnectionId = connectionOf(state, effect.sourceId);
      const source =
        sourceConnectionId === undefined ? undefined : state.players.get(sourceConnectionId);
      const target = state.monsters.find((monster) => monster.id === effect.targetId);
      const baseSkill = source
        ? CLASS_SKILLS[source.class].find((skill) => skill.id === effect.sourceSkillId)
        : undefined;
      if (sourceConnectionId === undefined || !source || !target || !baseSkill) return;
      const skill = skillWithTalents(source.class, source.talents, baseSkill.slot);
      damageMonster(w, sourceConnectionId, source, target, skill, now, false, tick.power, {
        damageOverTime: true,
        persistentOwnerCredit: true,
      });
    },
  });

  advancePlayers<string>({
    players: state.players,
    playerGrid: state.playerGrid,
    zone: zone(state),
    now,
    presenceHeartbeatMs: deps.presenceHeartbeatMs,
    writeAttachment: false,
    writeD1,
    waitUntil: deps.waitUntil,
    renewPresence: (player) => deps.renewPresence(player),
    reclaimCorpse: (connectionId, player) => reclaimCorpse(w, connectionId, player),
    collectLoot: (connectionId, player) => collectLootFor(w, connectionId, player),
    savePlayer: (player, connectionId) => deps.savePlayer(player, connectionId),
    onPlayerMoved: (connectionId, player, previous) => {
      // Task 7: `#detectPlayerTouch` (authored `player-touch` event triggers) slots in here.
      applySacredPassage(w, connectionId, player, previous, now);
    },
  });
  // Task 7 pauses NPCs held by an event run or quest conversation; neither runtime exists yet.
  state.activeEvents = advanceNpcEvents({
    events: state.activeEvents,
    movement: state.npcMovement,
    players: [...state.players.values()],
    terrain: zone(state).terrain,
    tick: state.tick,
    pausedEventIds: new Set<string>(),
  });
  for (const [connectionId, player] of state.players) {
    const action = player.action;
    if (
      action?.channelMaxEndsAt !== undefined &&
      action.channelEndsAt === undefined &&
      (now >= action.channelMaxEndsAt || (action.mobilityDistance ?? 0) <= 0)
    )
      finishHeldPlayerAction(w, connectionId, player, now);
  }
  detectAdventureExits(w, now);
  advanceCombatActions(state.players.values(), now, (player, action) =>
    resolvePlayerAction(w, player, action, now),
  );
  advanceWarriorCyclones(state.players.values(), now, (player, radius, power) =>
    resolveWarriorCycloneStrike(w, player, radius, power, now),
  );
  advanceSanctuaries(
    state.sanctuaries,
    now,
    (ownerId) => {
      const owner = playerById(state, ownerId);
      return Boolean(owner?.authorized && !owner.transitioning && owner.life === "alive");
    },
    (sanctuary) => resolveSanctuaryTick(w, sanctuary, now),
  );
  advanceProjectiles<string>(
    {
      projectiles: state.projectiles,
      terrain: zone(state).terrain,
      monsters: state.monsters,
      players: state.players,
      monsterGrid: state.monsterGrid,
      playerGrid: state.playerGrid,
      canHeal: (owner, target) => areCombatAllies(owner, target),
      damageMonster: (projectile, monster, impactAt) =>
        projectileDamage(w, projectile, monster, impactAt),
      healPlayer: (projectile, connectionId, target, impactAt) =>
        projectileHeal(w, projectile, connectionId, target, impactAt),
      blocked: (projectile, point) => projectileBlocked(w, projectile, point),
    },
    now,
  );
  if (writeResourceState) {
    for (const [connectionId, player] of state.players) {
      if (player.authorized && player.resource) sendStateTo(w, connectionId, player);
    }
  }

  const monsterContext: MonsterSystemContext<string> = {
    players: state.players,
    monsters: state.monsters,
    guards: state.guards,
    monsterGrid: state.monsterGrid,
    zone: zone(state),
    tick: state.tick,
    navigation: navigationRuntime(state),
    startAttack: (monster, target, attackedAt) =>
      startMonsterAttack(w, monster, target, attackedAt),
    defeatMonster: (monster, defeatedAt) => markMonsterDead(w, monster, defeatedAt),
    // Task 7: `#detectMonsterTouch` (contact teleporters) hangs off onMonsterMoved.
  };
  advanceMonsters(monsterContext, now);
  advanceCombatActions(state.monsters, now, (monster, action) =>
    resolveMonsterAction(w, monster, action, now),
  );
  advanceGuards(monsterContext, now);
  processExpiredLoot(state.loot, state.lootGrid, now);
  // Drain event runs AFTER all authoritative simulation and BEFORE the network flush (Task 7).
  deps.drainEventRuns(now);
  if (state.tick % NETWORK_TICKS_PER_SNAPSHOT === 0) {
    broadcastNetworkUpdates(
      state.players,
      state.tick,
      (player) => worldView(interestContext(w), player),
      (connectionId, message) => deps.send(connectionId, message),
      NO_EVENTS,
    );
    // The legacy runtime-party pass (`broadcastPartyStateIfChanged`) is rollback-only and absent;
    // hero rooms rebuild the roster from the persistent party.
    broadcastHeroPartyStates(w);
  }
  flushQueuedResyncs(w, now);
}
