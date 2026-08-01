/**
 * The full authoritative tick order and its combat/interaction glue — tranche β of the legacy
 * `World` Durable Object, kept out of the room shell so `WorldRoom` stays a thin transport
 * adapter. Every function here is a line-for-line port of the matching `world.ts` private method
 * (the source line is cited on each), re-keyed from workerd `WebSocket` to the Alepha connection-id
 * string and fed its cross-boundary seams through {@link WorldTickDeps}.
 *
 * `advanceWorldTick` reproduces the legacy `#advanceTick` order (`world.ts:4259-4421`) verbatim:
 * consumable effects → rogue expirations (+sendState) → damage-over-time → players (+player-touch
 * triggers) → npc events → held-action ends → adventure exits → combat actions (players) → warrior
 * cyclones → sanctuaries → projectiles → periodic resource state → monsters (+contact teleporters)
 * → combat actions (monsters) → guards → expired loot → event-run drain → every 2nd tick deltas +
 * party-state broadcasts → queued resyncs.
 *
 * Task 7 filled the event/quest slots: the budgeted event-run drain and its effect dispatch, the
 * authored `action`/`player-touch`/`monster` triggers, quest conversations, cheat commands and the
 * real D1-backed quest-reward claim / potion decrement (through `WorldTickDeps`). Page
 * EVALUATION stays out of the tick entirely — `worldEvents.ts`'s `evaluateActiveEvents` runs on
 * state install and hero join only. Task 8 filled the last two deps stubs: adventure-exit
 * transitions and authored cross-map teleports both ride `WorldRoom`'s epoch-fenced handoff
 * choreography (freeze → checkpoint → forced save → `PresenceRoom.handoff` → remove → close 4008),
 * reached through `deps.transitionAdventureExit`/`deps.teleportCrossMap`; the detection and dispatch
 * in this file were already correct and are unchanged. Deliberately NOT ported here: the legacy
 * runtime-party (`party.*`) mechanic — rollback-only per CLAUDE.md (hero sessions must not expose
 * it), not ported at all.
 */

import {
  type AuthoredQuestMarker,
  type AuthoredQuestProgress,
  type AuthoredQuestTracker,
  activePageIndex,
  authoredQuestTrackers,
  EMPTY_ADVENTURE_STATE,
} from "@lindocara/engine/adventure-state.js";
import { parseCheatCommand } from "@lindocara/engine/cheats.js";
import {
  actionForClassSlot,
  isMonsterRangedAction,
  LUMEN_STEP_MAX_HOLD_MS,
  MONSTER_SPECIAL_ACTIONS,
  monsterActionDefinition,
} from "@lindocara/engine/combat-actions.js";
import {
  CONSUMABLE_COOLDOWN_MS,
  CONSUMABLE_MAX_STACK,
  CONSUMABLES,
  type ConsumableId,
  isConsumableId,
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
import { DIALOGUE_CLOSE_RADIUS, type EventCommand } from "@lindocara/engine/event-commands.js";
import type { StateMutation } from "@lindocara/engine/event-interpreter.js";
import {
  applyDamage,
  applyExperience,
  hasLineOfSight,
  INTERACTION_RANGE,
  isMonsterSpecialTechnique,
  isWalkable,
  isWalkableForLumen,
  LOOT_EXPIRY_MS,
  MAX_MONSTER_BODY_RADIUS,
  MONSTER_AGGRO_RANGE,
  type MonsterSpecialTechnique,
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
  resolveTerrain,
  withinRange,
} from "@lindocara/engine/game.js";
import { LOCAL_CHAT_RADIUS, SPATIAL_EVENT_RADIUS } from "@lindocara/engine/interest.js";
import {
  eventCellCentre,
  exitEvents,
  isInteractiveWorldEventKind,
  type MapEvent,
} from "@lindocara/engine/map-events.js";
import { isMapSkillEnabled, mapHeroClassSettings } from "@lindocara/engine/map-hero-settings.js";
import { merchantForRuntimeRoom } from "@lindocara/engine/merchant.js";
import type {
  ClientMessage,
  QuestDialogueEntry,
  RogueShadowDanceSequence,
  ServerMessage,
} from "@lindocara/engine/protocol.js";
import {
  authoredQuestRuntimeState,
  buildQuestInteractionIndex,
  completedQuestIds,
  type QuestActor,
  type QuestBusinessEvent,
  questMarkerForTarget,
  questMarkerPriority,
  questTargetCandidates,
} from "@lindocara/engine/quest-runtime.js";
import type { AuthoredQuestDefinition, QuestEventReference } from "@lindocara/engine/quests.js";
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
import { editorAsset } from "@lindocara/engine/tiny-swords-catalog.js";
import type { ZoneDefinition } from "@lindocara/engine/zones.js";
import type { AuthoredQuestChange } from "../../authored-quest-system.js";
import { executeCheatCommand } from "../../world/cheat-command-system.js";
import {
  advanceCombatActions,
  cancelCombatAction,
  finishHeldCombatAction,
  startCombatAction,
} from "../../world/combat-action-system.js";
import {
  applyGuardDamage,
  guardedDamage,
  isPlayerInvulnerable,
} from "../../world/combat-system.js";
import { beginRewardAttribution, clearMonsterCombat } from "../../world/contribution-system.js";
import {
  advanceDamageOverTime,
  applyDamageOverTime,
  removeDamageOverTimeBySource,
  removeDamageOverTimeByTarget,
  spreadDamageOverTime,
} from "../../world/damage-over-time-system.js";
import {
  abortRunsForHero,
  advanceRun,
  chooseRun,
  closeDistantDialogues,
  type DispatchEffect,
  drainRuns,
  resetEventRunRuntime,
  startRun,
} from "../../world/event-run-system.js";
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
  advancePolarityOrbs,
  advanceSanctuaries,
  armLifeLink,
  cleanseNegativeEffect,
  emergencyMendPower,
  expireLumenPortals,
  luminousTransfigurationPower,
  mirroredLifeLinkPower,
  nearestMercyCorpse,
  novaJudgmentDamageMultiplier,
  novaSpecializationMultipliers,
  type PolarityOrbRuntime,
  removeLumenPortalsByOwner,
  removePolarityOrbsByOwner,
  removeSanctuariesByOwner,
  type SanctuaryRuntime,
  sacredPassageTargets,
  startLumenPortal,
  startPolarityOrb,
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
  advanceAdditionalVolleys,
  applyCometExplosion,
  focusedVolleyPowerRatio,
  linePiercerPowerRatio,
  retreatShotDirections,
  scheduleAdditionalVolleys,
  swornPreyTarget,
  windstepCanInterrupt,
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
  rupturePoisonWithShiv,
} from "../../world/rogue-state-system.js";
import { movePlayerInDirection, nearestChargeTarget } from "../../world/skill-system.js";
import {
  broadcastNetworkUpdates,
  selfState,
  sendState,
  sendWorldResync,
} from "../../world/snapshot-system.js";
import {
  activeRallyPowerMultiplier,
  advanceWarriorCyclones,
  advanceWarriorVortices,
  applyKingsChallenge,
  applyRallyingCry,
  applySeismicImpact,
  applyWarBanner,
  chargeCounterOffensive,
  colossusChargeImpacts,
  consumeCounterOffensive,
  cycloneImpactTimes,
  cycloneRecoveryMs,
  damageAfterWarriorProtection,
  startWarriorCyclone,
  startWarriorVortex,
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
import type { QuestAbandonResult, QuestAcceptanceResult, QuestTurnInResult } from "./PartyRoom.ts";
import {
  activeEventCentre,
  detectMonsterTouch,
  detectPlayerTouch,
  logGoldRefusedOnce,
  logItemRefusedOnce,
  logTeleportRefusedOnce,
  runnablePage,
} from "./worldEvents.ts";
import type { PendingQuestConversation, WorldRoomState } from "./worldState.ts";

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
  /** Coordinator RPC for authored-quest business events (legacy `#recordQuestEvent`), whose
   *  returned quest changes drive the completed-quest automatic reward claim fan-out. */
  recordQuestEvent(partyId: string, event: QuestBusinessEvent): void;
  /** Party-wide chat fan-out through the coordinator (legacy `GAME_SESSION.broadcast`). */
  broadcastToParty(partyId: string, message: ServerMessage): void;
  /**
   * The interpreter's mutation batch, UP to the party coordinator — the single writer (legacy
   * `GameSession.applyStateChanges` via the retained stub). The returned promise resolves once the
   * coordinator has committed AND pushed the new snapshot back to this room; the drain pauses on it
   * (`state.eventStateSync`) while simulation keeps ticking.
   */
  applyStateChanges(mutations: readonly StateMutation[]): Promise<void>;
  /** Authored-quest RPC round-trips to the party coordinator (legacy `#gameSession(...)`). */
  acceptAuthoredQuest(
    partyId: string,
    actor: QuestActor,
    questId: string,
    target: QuestEventReference,
    inventory: Readonly<Record<string, number>>,
  ): Promise<QuestAcceptanceResult>;
  abandonAuthoredQuest(
    partyId: string,
    actor: QuestActor,
    questId: string,
  ): Promise<QuestAbandonResult>;
  completeAuthoredQuest(
    partyId: string,
    actor: QuestActor,
    questId: string,
    target: QuestEventReference | null,
    rewardChoiceId: string | undefined,
    heroState: {
      level: number;
      xp: number;
      hp: number;
      inventory: Readonly<Record<string, number>>;
    },
  ): Promise<QuestTurnInResult>;
  /** The authored `endAdventure` completion: flip the party's save to completed, latch the
   *  coordinator and broadcast victory (legacy `#dispatchEndAdventure`'s async body). */
  completeAdventure(partyId: string): Promise<void>;
  /** Whether cheat commands are honoured (legacy `env.CHEATS_ENABLED === "true"`). */
  cheatsEnabled: boolean;
  /** The authored-exit handoff (`WorldRoom.transitionAdventureExit`): freeze, checkpoint, force-save,
   *  epoch-fenced `PresenceRoom.handoff`, then remove and close `ZONE_TRANSITION` (4008). A stale
   *  handoff aborts through the same `rejectStaleSave` path every other epoch loss uses. */
  transitionAdventureExit(
    connectionId: string,
    player: PlayerRuntime,
    exitId: string,
    now: number,
  ): void;
  /** An authored cross-map teleport rides the same epoch-fenced handoff as an exit
   *  (`WorldRoom.teleportCrossMap`); same-map teleports are fully authoritative here already. */
  teleportCrossMap(
    connectionId: string,
    player: PlayerRuntime,
    mapId: string,
    col: number,
    row: number,
    now: number,
    eventId: string,
  ): void;
  /** The idempotent, epoch-fenced D1 quest-reward claim for built-in quest chapters
   *  (`HeroSaveService.claimQuestReward`, port of legacy `claimHeroQuestReward`). */
  claimQuestReward(player: PlayerRuntime, reward: QuestRewardClaim): Promise<boolean>;
  /**
   * Consume one health potion and return the remaining count, or `null` when none can be spent —
   * the legacy fenced save-then-decrement D1 chain (`#consumePotion`), serialized per hero through
   * `state.itemMutations` by the implementation.
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

function configuredSkill(w: WorldGlue, player: PlayerRuntime, slot: SkillSlot): SkillDefinition {
  const skill = skillWithTalents(player.class, player.talents, slot);
  const stats = mapHeroClassSettings(zone(w.state).heroSettings, player.class).stats;
  if (slot === 1) return { ...skill, range: stats.attackRange };
  if (player.class === "priest" && skill.id === "mend" && stats.heal) {
    return {
      ...skill,
      range: stats.heal.range,
      power: stats.heal.base,
      allyPower: stats.heal.base,
    };
  }
  return skill;
}

function configuredAttackDamage(w: WorldGlue, player: PlayerRuntime): number {
  const stats = mapHeroClassSettings(zone(w.state).heroSettings, player.class).stats;
  return stats.attackBase + Math.max(0, player.level - 1) * stats.attackPerLevel;
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

/** Port of `#selfState` (`world.ts:5820`): the welcome's self snapshot, trackers and markers
 *  included. */
export function selfStateFor(w: WorldGlue, player: PlayerRuntime): ReturnType<typeof selfState> {
  const chapter = player.quest.chapter ?? "three_offerings";
  return selfState(
    player,
    questDefinition(zone(w.state), chapter)?.target,
    playerQuestTrackers(w.state, player),
    playerQuestMarkers(w.state, player),
  );
}

/** Port of the join-time `mapEntered` gameplay fact (`world.ts:852`): arrival is a server-minted
 *  fact, not a client claim; reconnects are harmless (reach objectives clamp at one). */
export function recordMapEntered(w: WorldGlue, player: PlayerRuntime): void {
  recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
    id,
    mapId,
    actor,
    type: "mapEntered",
  }));
}

/** Port of `#sendState` (`world.ts:5830`), authored-quest trackers and markers included. */
export function sendStateTo(w: WorldGlue, connectionId: string, player: PlayerRuntime): void {
  const chapter = player.quest.chapter ?? "three_offerings";
  sendState(
    connectionId,
    player,
    questDefinition(zone(w.state), chapter)?.target,
    (recipient, message) => w.deps.send(recipient, message),
    playerQuestTrackers(w.state, player),
    playerQuestMarkers(w.state, player),
  );
}

/** Port of `#authoredQuestTrackers` (`world.ts:5842`). */
function playerQuestTrackers(
  state: WorldRoomState,
  player: PlayerRuntime,
): readonly AuthoredQuestTracker[] {
  const registry = state.adventureRegistry;
  const adventureState = state.adventureState.state;
  const definitions = registry.quests ?? [];
  const scopeById = new Map(definitions.map((quest) => [quest.id, quest.scope]));
  const scopedProgress = (
    progress: Readonly<Record<string, AuthoredQuestProgress>> | undefined,
    scope: "party" | "personal",
  ): Record<string, AuthoredQuestProgress> =>
    Object.fromEntries(
      Object.entries(progress ?? {}).filter(([, value]) => {
        const resolvedScope = value.definitionSnapshot?.scope;
        return resolvedScope === undefined || resolvedScope === scope;
      }),
    );
  const partyRegistry = {
    ...registry,
    quests: definitions.filter((quest) => quest.scope === "party"),
  };
  const personalRegistry = {
    ...registry,
    quests: definitions.filter((quest) => quest.scope === "personal"),
  };
  const partyProgress = Object.fromEntries(
    Object.entries(scopedProgress(adventureState.quests, "party")).filter(
      ([questId, value]) =>
        value.definitionSnapshot !== null || scopeById.get(questId) !== "personal",
    ),
  );
  const personalProgress = Object.fromEntries(
    Object.entries(scopedProgress(player.authoredQuestProgress, "personal")).filter(
      ([questId, value]) => value.definitionSnapshot !== null || scopeById.get(questId) !== "party",
    ),
  );
  const completed = new Set([
    ...completedQuestIds(adventureState.quests),
    ...completedQuestIds(player.authoredQuestProgress),
  ]);
  const availableQuestIds = (scope: "party" | "personal"): Set<string> =>
    new Set(
      definitions.flatMap((definition) => {
        if (definition.scope !== scope || definition.acceptance !== "manual") return [];
        const progress =
          scope === "party" ? partyProgress[definition.id] : personalProgress[definition.id];
        return authoredQuestRuntimeState(definition, progress, {
          level: player.level,
          completedQuestIds: completed,
          adventureState,
        }) === "available"
          ? [definition.id]
          : [];
      }),
    );
  return [
    ...authoredQuestTrackers(
      partyRegistry,
      { ...adventureState, quests: partyProgress },
      { availableQuestIds: availableQuestIds("party") },
    ),
    ...authoredQuestTrackers(
      personalRegistry,
      { ...EMPTY_ADVENTURE_STATE, quests: personalProgress },
      { availableQuestIds: availableQuestIds("personal") },
    ),
  ];
}

/** Port of `#questDefinitionsForPlayer` (`world.ts:5911`). */
function questDefinitionsForPlayer(
  state: WorldRoomState,
  player: PlayerRuntime,
): AuthoredQuestDefinition[] {
  const definitions = new Map(
    (state.adventureRegistry.quests ?? []).map((definition) => [definition.id, definition]),
  );
  for (const progress of Object.values(state.adventureState.state.quests ?? {})) {
    if (
      progress.definitionSnapshot?.scope === "party" &&
      (progress.status !== "completed" || !progress.definitionSnapshot.repeatable)
    ) {
      definitions.set(progress.definitionSnapshot.id, progress.definitionSnapshot);
    }
  }
  for (const progress of Object.values(player.authoredQuestProgress ?? {})) {
    if (
      progress.definitionSnapshot?.scope === "personal" &&
      (progress.status !== "completed" || !progress.definitionSnapshot.repeatable)
    ) {
      definitions.set(progress.definitionSnapshot.id, progress.definitionSnapshot);
    }
  }
  return [...definitions.values()];
}

/** Port of `#questProgressForPlayer` (`world.ts:5934`). */
function questProgressForPlayer(
  state: WorldRoomState,
  player: PlayerRuntime,
  definition: AuthoredQuestDefinition,
): AuthoredQuestProgress | undefined {
  return definition.scope === "party"
    ? state.adventureState.state.quests?.[definition.id]
    : player.authoredQuestProgress?.[definition.id];
}

/** Port of `#authoredQuestMarkers` (`world.ts:5943`). */
function playerQuestMarkers(state: WorldRoomState, player: PlayerRuntime): AuthoredQuestMarker[] {
  const mapId = state.location?.zoneId;
  if (!mapId) return [];
  const index = buildQuestInteractionIndex(questDefinitionsForPlayer(state, player));
  const completed = new Set([
    ...completedQuestIds(state.adventureState.state.quests),
    ...completedQuestIds(player.authoredQuestProgress),
  ]);
  const markers = new Map<string, AuthoredQuestMarker["kind"]>();
  for (const event of state.activeEvents) {
    for (const candidate of questTargetCandidates(index, { mapId, eventId: event.id })) {
      const progress = questProgressForPlayer(state, player, candidate.definition);
      const runtimeState = authoredQuestRuntimeState(candidate.definition, progress, {
        level: player.level,
        completedQuestIds: completed,
        adventureState: state.adventureState.state,
      });
      const marker = questMarkerForTarget(candidate, runtimeState);
      if (!marker) continue;
      const current = markers.get(event.id);
      if (!current || questMarkerPriority(marker) > questMarkerPriority(current)) {
        markers.set(event.id, marker);
      }
    }
  }
  return [...markers].map(([eventId, kind]) => ({ eventId, kind }));
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
    w.state.activeEvents,
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
 * Port of `#freeze` (`world.ts:5674`). The queue-clear on every life transition is the invariant
 * prediction relies on: no half-applied command batches. A life transition also ends any open
 * quest conversation and aborts the hero's event runs — a panel opened in one life state must not
 * linger into another, and a run buffered across a death/revive must not resume against a
 * different life state.
 */
function freeze(w: WorldGlue, player: PlayerRuntime): void {
  player.lastInput = NO_INPUT;
  player.queue = [];
  player.starvedTicks = 0;
  exitRogueStealth(player, w.deps.now());
  const staleConversation = w.state.questConversations.get(player.id);
  if (staleConversation) {
    w.state.questConversations.delete(player.id);
    const connectionId = connectionOf(w.state, player.id);
    if (connectionId !== undefined) {
      w.deps.send(connectionId, { t: "quest.close", conversationId: staleConversation.id });
    }
  }
  abortRunsForHero(w.state.eventRuns, player.id);
  cancelCombatAction(player);
  player.guarding = false;
  player.guardActivatedAt = 0;
  player.challengeReductionUntil = 0;
  player.challengeReduction = 0;
  player.rallyPowerUntil = 0;
  player.rallyPowerMultiplier = 0;
  player.warriorCyclone = null;
  player.warriorChargeFollowup = null;
  player.warriorCounterReserve = 0;
  player.warriorBannerChallengeUntil = 0;
  player.warriorBannerChallengeReduction = 0;
  player.warriorBannerPower.clear();
  player.warriorVortex = null;
  player.rangerVolleySequence = null;
  player.rangerAfterimage = null;
  player.priestLifeLinks = [];
  player.priestSoulAnchor = null;
  clearRogueTransientState(player);
  player.negativeEffects.clear();
  removeDamageOverTimeBySource(w.state.damageOverTime, player.id);
  removeSanctuariesByOwner(w.state.sanctuaries, player.id);
  removeLumenPortalsByOwner(w.state.lumenPortals, player.id);
  removePolarityOrbsByOwner(w.state.polarityOrbs, player.id);
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
    monster.respawnMode === "never" ? Number.POSITIVE_INFINITY : now + monster.respawnDelayMs;
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
  for (const poison of [...w.state.damageOverTime].filter(
    (effect) =>
      effect.kind === "poison" && effect.targetKind === "monster" && effect.targetId === monster.id,
  )) {
    const source = playerById(w.state, poison.sourceId);
    const contagion = source
      ? talentEffect(source.class, source.talents, "rogue_contagion", 4)
      : undefined;
    if (!source?.authorized || !contagion) continue;
    const targets = w.state.monsters
      .filter(
        (candidate) =>
          candidate.id !== monster.id &&
          candidate.deadUntil <= now &&
          pointDistance(monster, candidate) <= contagion.range &&
          hasLineOfSight(monster, candidate, zone(w.state).terrain.tiles) &&
          !w.state.damageOverTime.some(
            (effect) =>
              effect.kind === "poison" &&
              effect.sourceId === source.id &&
              effect.targetKind === "monster" &&
              effect.targetId === candidate.id,
          ),
      )
      .sort(
        (left, right) =>
          pointDistance(monster, left) - pointDistance(monster, right) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, Math.max(0, contagion.maximumTargets));
    const concentrated = talentEffect(source.class, source.talents, "rogue_concentrated_venom", 4);
    spreadDamageOverTime(
      w.state.damageOverTime,
      {
        kind: "poison",
        sourceId: source.id,
        sourceSkillId: "poisoned_shiv",
        targetKind: "monster",
        targetId: monster.id,
      },
      targets.map((target) => target.id),
      concentrated?.maxStacks ?? 1,
    );
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
  triggerMonsterDefeatEvent(w, player, monster);
  clearMonsterCombat(monster);
}

/** Port of `#triggerMonsterDefeatEvent` (`world.ts:3417`): a defeated authored monster runs its
 *  active page's command program, triggered on behalf of the killing hero. */
function triggerMonsterDefeatEvent(
  w: WorldGlue,
  player: PlayerRuntime,
  monster: MonsterRuntime,
): void {
  if (player.identityKind !== "hero" || !monster.id.startsWith("mon-")) return;
  const eventId = monster.id.slice(4);
  const event = w.state.location?.definition.events?.find(
    (candidate) => candidate.kind === "monster" && candidate.id === eventId,
  );
  if (!event) return;
  const pageIndex = activePageIndex(event, w.state.adventureState.state);
  if (pageIndex === null) return;
  const program = event.pages[pageIndex]?.commands;
  if (!program || program.length === 0) return;
  startRun(w.state.eventRuns, {
    event,
    pageIndex,
    program,
    heroId: player.id,
    runId: crypto.randomUUID(),
  });
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
    (basic ? configuredAttackDamage(w, player) : skill.power + Math.max(0, player.level - 1) * 2);
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
  mirrored = false,
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
  if (!mirrored) mirrorLifeLinks(w, target, actualAmount, now);
  return actualAmount;
}

function mirrorLifeLinks(
  w: WorldGlue,
  healedTarget: PlayerRuntime,
  usefulHealing: number,
  now: number,
): void {
  for (const [ownerConnectionId, owner] of w.state.players) {
    owner.priestLifeLinks = owner.priestLifeLinks.filter((link) => link.expiresAt > now);
    for (const link of owner.priestLifeLinks) {
      const linkedConnectionId = connectionOf(w.state, link.targetId);
      if (linkedConnectionId === undefined) continue;
      const linked = w.state.players.get(linkedConnectionId);
      if (
        linked?.life !== "alive" ||
        owner.life !== "alive" ||
        pointDistance(owner, linked) > link.range ||
        !hasLineOfSight(owner, linked, zone(w.state).terrain.tiles)
      )
        continue;
      const counterpart =
        healedTarget.id === owner.id
          ? { connectionId: linkedConnectionId, player: linked }
          : healedTarget.id === linked.id
            ? { connectionId: ownerConnectionId, player: owner }
            : null;
      if (!counterpart) continue;
      const power = mirroredLifeLinkPower(usefulHealing, link);
      if (power <= 0) continue;
      healPlayer(
        w,
        ownerConnectionId,
        owner,
        counterpart.connectionId,
        counterpart.player,
        power,
        "mend",
        now,
        counterpart.player === owner,
        true,
      );
    }
  }
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
  technique?: Exclude<MonsterSpecialTechnique, "none">,
): void {
  if (isPlayerInvulnerable(player, now)) return;
  const hpBefore = player.hp;
  const stealthEnded = exitRogueStealth(player, now);
  const protectedDamage = damageAfterWarriorProtection(
    player,
    damage,
    w.state.players.values(),
    now,
    (source, target) => areCombatAllies(source, target),
    (source, target) => hasLineOfSight(source, target, zone(w.state).terrain.tiles),
    (protector, prevented) =>
      chargeCounterOffensive(
        protector,
        prevented,
        talentEffect(protector.class, protector.talents, "counter_offensive", 2),
        "ally",
      ),
  );
  const {
    amount: appliedDamage,
    result,
    parried,
    prevented,
    retaliationRatio,
  } = guardedDamage(player, protectedDamage, now);
  chargeCounterOffensive(
    player,
    prevented,
    talentEffect(player.class, player.talents, "counter_offensive", 2),
    parried ? "parry" : "guard",
  );
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
      const guardSkill = configuredSkill(w, player, 2);
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
  const soulAnchor = player.priestSoulAnchor;
  if (
    result.killed &&
    soulAnchor &&
    soulAnchor.expiresAt > now &&
    isWalkable(soulAnchor, PLAYER_SIZE, zone(w.state).terrain)
  ) {
    const owner = playerById(w.state, soulAnchor.ownerId);
    if (owner?.authorized && owner.life === "alive" && areCombatAllies(owner, player)) {
      const previous = { x: player.x, y: player.y };
      player.hp = 1;
      player.x = soulAnchor.x;
      player.y = soulAnchor.y;
      player.priestSoulAnchor = null;
      if (soulAnchor.cleansePoison) {
        cleanseNegativeEffect(player, "poison");
        removeDamageOverTimeByTarget(w.state.damageOverTime, "player", player.id);
      }
      w.state.playerGrid.update(player, previous);
      const anchorDamage = Math.max(0, hpBefore - 1);
      generateResource(player.class, player.resource, "damage_taken", anchorDamage);
      player.dirty = true;
      w.deps.send(connectionId, {
        t: "event",
        code: "combat.hurt",
        params: {
          species,
          damage: anchorDamage,
          monsterId,
          ...(technique ? { technique } : {}),
        },
        tone: "bad",
        x: player.x,
        y: player.y,
      });
      sendStateTo(w, connectionId, player);
      return;
    }
  }
  player.hp = result.hp;
  generateResource(player.class, player.resource, "damage_taken", appliedDamage);
  player.dirty = true;
  w.deps.send(connectionId, {
    t: "event",
    code: "combat.hurt",
    // Keep the damage event tied to the same authoritative attacker as the spatial animation.
    params: { species, damage: appliedDamage, monsterId, ...(technique ? { technique } : {}) },
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
    : monsterActionDefinition(monster.species, monster.attackProfile);
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
  const definition = monsterActionDefinition(monster.species, monster.attackProfile);
  if (!specialDefinition && isMonsterRangedAction(definition)) {
    const origin = projectileOrigin(monster, action.direction, definition.projectile.radius);
    spawnProjectile(w.state.projectiles, {
      actionId: action.id,
      owner: monster,
      roomKey: w.state.roomKey,
      origin,
      direction: action.direction,
      definition: definition.projectile,
      range: definition.range,
      power: monster.damage,
      targetFilter: "players_and_guards",
      sourceSkillId: "monster_ranged_attack",
      basic: true,
      now,
    });
    return;
  }
  const origin = { x: monster.x + PLAYER_SIZE / 2, y: monster.y + PLAYER_SIZE / 2 };
  if (specialTechnique) {
    sendSpatialEvent(
      w,
      {
        t: "monster.special_impact",
        actionId: action.id,
        actorId: monster.id,
        technique: specialTechnique,
        x: origin.x,
        y: origin.y,
        direction: { ...action.direction },
        impactAt: now,
      },
      origin,
    );
  }
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
    const silhouette = player.rogueSilhouette;
    if (
      !silhouette ||
      silhouette.expiresAt <= now ||
      !monster.threat.has(player.id) ||
      !hits(silhouette, PLAYER_SIZE / 2)
    )
      continue;
    silhouette.hp = Math.max(0, silhouette.hp - damage);
    monster.revealedUntil = Math.max(monster.revealedUntil, now + 900);
    if (silhouette.hp <= 0) {
      player.rogueSilhouette = null;
      monster.threat.delete(player.id);
    }
    sendStateTo(w, connectionId, player);
  }
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
    damagePlayer(
      w,
      connectionId,
      player,
      damage,
      monster.species,
      monster.id,
      now,
      specialTechnique ?? undefined,
    );
    drainedDamage += damage;
  }
  for (const guard of w.state.guards) {
    if (!hits(guard, PLAYER_SIZE / 2)) continue;
    applyGuardDamage(guard, damage);
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
  const skill = configuredSkill(w, owner.player, baseSkill.slot);
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
  const targetWasCritical =
    target.hp / Math.max(1, maxHpForLevel(target.level)) <= (emergency?.threshold ?? 0);
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
  const lifeLink = baseSkill
    ? talentEffect(owner.player.class, owner.player.talents, "life_link", baseSkill.slot)
    : undefined;
  const chain = baseSkill
    ? talentEffect(owner.player.class, owner.player.talents, "chain_heal", baseSkill.slot)
    : undefined;
  if (lifeLink && restored > 0) {
    armLifeLink(
      owner.player,
      target.id,
      lifeLink,
      now,
      emergency && targetWasCritical ? "emergency" : chain ? "chain" : "base",
    );
  }
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
  if (chained) {
    const chainedHealing = healPlayer(
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
    if (lifeLink && chainedHealing > 0)
      armLifeLink(owner.player, chained[1].id, lifeLink, now, "chain");
  }
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
    const transfiguration = talentEffect(
      player.class,
      player.talents,
      "luminous_transfiguration",
      3,
    );
    if (transfiguration) {
      const power = luminousTransfigurationPower(player.level, transfiguration);
      for (const [targetConnectionId, target] of w.state.players) {
        if (
          target === player ||
          target.life !== "alive" ||
          !areCombatAllies(player, target) ||
          pointDistance(player, target) > transfiguration.radius ||
          !hasLineOfSight(player, target, terrain.tiles)
        )
          continue;
        healPlayer(
          w,
          connectionId,
          player,
          targetConnectionId,
          target,
          power,
          action.skillId,
          now,
          false,
        );
      }
    }
    const lumenGate = talentEffect(player.class, player.talents, "lumen_gate", 3);
    const lumenOrigin = action.priestLumenOrigin;
    if (
      lumenGate &&
      lumenOrigin &&
      pointDistance(lumenOrigin, player) > 1 &&
      isWalkable(lumenOrigin, PLAYER_SIZE, terrain) &&
      isWalkable(player, PLAYER_SIZE, terrain)
    ) {
      const sacredPassage = talentEffect(player.class, player.talents, "sacred_passage", 3);
      const portal = startLumenPortal(w.state.lumenPortals, {
        ownerId: player.id,
        from: lumenOrigin,
        to: { x: player.x, y: player.y },
        effect: lumenGate,
        now,
        transfiguration: Boolean(transfiguration),
        healingPower: sacredPassage
          ? sacredPassage.power + Math.max(0, player.level - 1) * sacredPassage.powerPerLevel
          : 0,
      });
      sendSpatialEventAcross(
        w,
        {
          t: "priest.lumen_portal",
          id: portal.id,
          actorId: player.id,
          from: portal.from,
          to: portal.to,
          startedAt: now,
          endsAt: portal.expiresAt,
        },
        [portal.from, portal.to],
      );
    }
  }
  if (action?.skillId === "heartseeker") {
    const target = action.rangerSwornPreyTargetId
      ? w.state.monsters.find(
          (monster) => monster.id === action.rangerSwornPreyTargetId && monster.deadUntil <= now,
        )
      : undefined;
    if (target && hasLineOfSight(player, target, zone(w.state).terrain.tiles)) {
      action.direction = normalizeDirection(
        { x: target.x - player.x, y: target.y - player.y },
        action.direction,
      );
    }
    if (action.resolved) {
      const skill = configuredSkill(w, player, 5);
      spawnPlayerProjectiles(
        w,
        player,
        action,
        skill,
        actionForClassSlot(player.class, 5),
        "monsters",
        now,
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
  const skill = configuredSkill(w, player, slot);
  if (!isSkillUnlocked(player.level, slot)) {
    deps.send(connectionId, {
      t: "event",
      code: "skill.locked",
      params: { level: SKILL_UNLOCK_LEVEL[slot], skill: skill.id },
      tone: "info",
    });
    return false;
  }
  if (!isMapSkillEnabled(zone(w.state).heroSettings, player.class, slot)) {
    deps.send(connectionId, {
      t: "event",
      code: "skill.disabled",
      params: { skill: skill.id },
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
  const inexorable =
    skill.id === "shield_bash"
      ? talentEffect(player.class, player.talents, "inexorable_breakthrough", 3)
      : undefined;
  if (player.warriorChargeFollowup && player.warriorChargeFollowup.expiresAt <= now)
    player.warriorChargeFollowup = null;
  const chargeFollowup = inexorable ? player.warriorChargeFollowup : null;
  const followupTarget = chargeFollowup
    ? nearestChargeTarget(
        player,
        w.state.monsterGrid
          .queryRadius(player, skill.range + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS)
          .filter((monster) => monster.id !== chargeFollowup.excludedTargetId),
        skill.range,
        now,
        (monster) => hasLineOfSight(player, monster, zone(w.state).terrain.tiles),
      )
    : null;
  if (chargeFollowup && !followupTarget) {
    deps.send(connectionId, {
      t: "event",
      code: "skill.no_target",
      params: { skill: skill.id },
      tone: "info",
    });
    return false;
  }
  const afterimage =
    skill.id === "dash" ? talentEffect(player.class, player.talents, "afterimage", 4) : undefined;
  if (player.rangerAfterimage && player.rangerAfterimage.expiresAt <= now)
    player.rangerAfterimage = null;
  if (afterimage && player.rangerAfterimage) {
    const destination = { x: player.rangerAfterimage.x, y: player.rangerAfterimage.y };
    if (!isWalkable(destination, PLAYER_SIZE, zone(w.state).terrain)) {
      deps.send(connectionId, {
        t: "event",
        code: "skill.blocked",
        params: { skill: skill.id },
        tone: "info",
        ...destination,
      });
      return false;
    }
    const origin = { x: player.x, y: player.y };
    cancelCombatAction(player);
    player.x = destination.x;
    player.y = destination.y;
    player.rangerAfterimage = null;
    player.dirty = true;
    w.state.playerGrid.update(player, origin);
    const swapDirection = normalizeDirection(
      { x: destination.x - origin.x, y: destination.y - origin.y },
      player.facing,
    );
    const swapAction: CombatActionRuntime = {
      id: crypto.randomUUID(),
      kind: "skill",
      skillId: skill.id,
      slot,
      direction: swapDirection,
      startedAt: now,
      impactAt: now,
      recoveryEndsAt: now + 180,
      resolved: true,
    };
    if (talentEffect(player.class, player.talents, "dash_invulnerability", 4))
      player.action = swapAction;
    const retreatShot = talentEffect(player.class, player.talents, "retreat_shot", 4);
    if (retreatShot) spawnRetreatShot(w, player, swapAction, skill, retreatShot, now);
    sendStateTo(w, connectionId, player);
    sendSpatialEvent(
      w,
      {
        t: "animation",
        actionId: swapAction.id,
        actorKind: "player",
        actorId: player.id,
        action: "skill",
        skillId: skill.id,
        talented: true,
        evolved: true,
        direction: swapDirection,
        startedAt: now,
        impactAt: now,
        recoveryEndsAt: now + 180,
      },
      player,
    );
    return true;
  }
  const danceMaster =
    skill.id === "shadow_dance"
      ? talentEffect(player.class, player.talents, "rogue_dance_master", 5)
      : undefined;
  player.rogueDanceMarks = player.rogueDanceMarks.filter((mark) => mark.expiresAt > now);
  const availableDanceMarks = player.rogueDanceMarks.filter((mark) => mark.availableAt <= now);
  if (danceMaster && availableDanceMarks.length > 0) {
    const markedIds = new Set(availableDanceMarks.map((mark) => mark.targetId));
    const candidates = w.state.monsters
      .filter(
        (monster) =>
          markedIds.has(monster.id) &&
          monster.deadUntil <= now &&
          hasRogueLineOfSight(player, monster, zone(w.state).terrain),
      )
      .sort((left, right) => {
        const leftDirection = normalizeDirection(
          { x: left.x - player.x, y: left.y - player.y },
          player.facing,
        );
        const rightDirection = normalizeDirection(
          { x: right.x - player.x, y: right.y - player.y },
          player.facing,
        );
        const leftAlignment = leftDirection.x * player.facing.x + leftDirection.y * player.facing.y;
        const rightAlignment =
          rightDirection.x * player.facing.x + rightDirection.y * player.facing.y;
        return (
          rightAlignment - leftAlignment ||
          pointDistance(player, left) - pointDistance(player, right) ||
          left.id.localeCompare(right.id)
        );
      });
    const destination = candidates
      .map((target) =>
        planShadowDance(player, [target], skill.range, 1, now, zone(w.state).terrain, (monster) =>
          monsterBodyRadius(monster.species),
        ),
      )
      .find((result) => result.ok)?.plan.strikes[0]?.landing;
    if (!destination) {
      deps.send(connectionId, {
        t: "event",
        code: "skill.no_target",
        params: { skill: skill.id },
        tone: "info",
      });
      return false;
    }
    const origin = { x: player.x, y: player.y };
    cancelCombatAction(player);
    player.x = destination.x;
    player.y = destination.y;
    player.rogueDanceMarks = [];
    player.dirty = true;
    w.state.playerGrid.update(player, origin);
    sendStateTo(w, connectionId, player);
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
          { x: destination.x - origin.x, y: destination.y - origin.y },
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
    releaseCounterOffensive(w, connectionId, player, skill, now);
    player.guarding = false;
    player.guardActivatedAt = 0;
    player.skillCooldowns[slot - 1] = now + skill.cooldownMs;
    player.dirty = true;
    sendStateTo(w, connectionId, player);
    return true;
  }
  const resourceCost = skillResourceCost(player.class, slot);
  if (!chargeFollowup && !canSpendResource(player.resource, resourceCost)) {
    deps.send(connectionId, { t: "event", code: "resource.insufficient", tone: "info" });
    return false;
  }
  if (slot === 1 && now - player.lastAttackAt < skill.cooldownMs) return false;
  if (skill.id === "mend" && now - player.lastHealAt < skill.cooldownMs) return false;
  if (!chargeFollowup && slot !== 1 && (player.skillCooldowns[slot - 1] ?? 0) > now) return false;
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
    followupTarget ??
    (definition.shape === "charge"
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
      : null);
  const swornPrey =
    skill.id === "heartseeker"
      ? talentEffect(player.class, player.talents, "sworn_prey", slot)
      : undefined;
  const swornTarget = swornPrey
    ? swornPreyTarget(
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
        : swornTarget
          ? normalizeDirection(
              { x: swornTarget.x - player.x, y: swornTarget.y - player.y },
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
  const windstep =
    definition.shape === "dash"
      ? talentEffect(player.class, player.talents, "windstep", slot)
      : undefined;
  if (windstep && windstepCanInterrupt(player.action, now)) cancelCombatAction(player);
  if (chargeFollowup) cancelCombatAction(player);
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
      : swornPrey
        ? { channelDurationMs: swornPrey.maximumHoldMs }
        : {}),
  });
  if (!action) return false;
  if (chargeFollowup) {
    action.warriorChargeFollowup = { excludedTargetId: chargeFollowup.excludedTargetId };
    player.warriorChargeFollowup = null;
  }
  if (swornTarget) action.rangerSwornPreyTargetId = swornTarget.id;
  if (shadowStep?.ok === true) {
    action.rogueShadowStep = {
      targetId: shadowStep.plan.targetId,
      destination: { ...shadowStep.plan.destination },
      phaseThroughObstacles: shadowStepPhase,
    };
  }
  if (talentEffect(player.class, player.talents, "sacred_passage", slot))
    action.sacredPassageHealedIds = new Set();
  if (skill.id === "blink" && talentEffect(player.class, player.talents, "lumen_gate", slot))
    action.priestLumenOrigin = { x: player.x, y: player.y };

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
  else if (!chargeFollowup && skill.id !== "iron_guard" && skill.id !== "vanish")
    player.skillCooldowns[slot - 1] = now + skill.cooldownMs;
  if (skill.id === "mend") player.lastHealAt = now;
  if (!chargeFollowup) spendResource(player.resource, resourceCost);
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
  const danceMaster = talentEffect(player.class, player.talents, "rogue_dance_master", 5);
  if (danceMaster) {
    player.rogueDanceMarks = [...new Set(strikes.map((strike) => strike.targetId))]
      .filter((targetId) => {
        const target = w.state.monsters.find((monster) => monster.id === targetId);
        return Boolean(target && target.deadUntil <= now);
      })
      .map((targetId) => ({
        targetId,
        availableAt: endsAt,
        expiresAt: endsAt + Math.max(0, danceMaster.markDurationMs),
      }));
    sendStateTo(w, connectionId, player);
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
    .filter(
      (monster) =>
        monster.deadUntil <= now && monster.id !== action.warriorChargeFollowup?.excludedTargetId,
    )
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
  const colossus = talentEffect(player.class, player.talents, "colossus_charge", skill.slot);
  if (colossus) {
    const terrainFraction = terrainImpact?.fraction ?? 1;
    const contacts = colossusChargeImpacts(
      monsterImpacts.map(({ monster, impact }) => ({
        target: monster,
        fraction: impact.fraction,
      })),
      terrainFraction,
      colossus,
    );
    movePlayer(w, player, action.direction, Math.max(0, distance * terrainFraction - 1));
    const basePower = skill.power + Math.max(0, player.level - 1) * 2;
    for (const contact of contacts) {
      damageMonster(
        w,
        connectionId,
        player,
        contact.target,
        skill,
        now,
        false,
        Math.max(1, Math.round(basePower * contact.powerRatio)),
      );
    }
    const firstTargetId = contacts[0]?.target.id;
    const inexorable = talentEffect(
      player.class,
      player.talents,
      "inexorable_breakthrough",
      skill.slot,
    );
    if (firstTargetId && inexorable && !action.warriorChargeFollowup) {
      player.warriorChargeFollowup = {
        excludedTargetId: firstTargetId,
        expiresAt: now + Math.max(0, inexorable.reactivationWindowMs),
      };
    }
    if (terrainImpact) {
      w.deps.send(connectionId, {
        t: "event",
        code: "skill.blocked",
        params: { skill: skill.id },
        tone: "info",
        x: terrainImpact.point.x,
        y: terrainImpact.point.y,
      });
    }
    return;
  }
  const first = firstSegmentImpact([terrainImpact, ...monsterImpacts.map(({ impact }) => impact)]);
  const travel = Math.max(0, distance * (first?.fraction ?? 1) - 1);
  movePlayer(w, player, action.direction, travel);
  let directTargetId: string | null = null;
  if (first?.kind === "entity") {
    const target = monsterImpacts.find(({ impact }) => impact.id === first.id)?.monster;
    if (target) {
      directTargetId = target.id;
      damageMonster(w, connectionId, player, target, skill, now, false);
      const inexorable = talentEffect(
        player.class,
        player.talents,
        "inexorable_breakthrough",
        skill.slot,
      );
      if (inexorable && !action.warriorChargeFollowup) {
        player.warriorChargeFollowup = {
          excludedTargetId: target.id,
          expiresAt: now + Math.max(0, inexorable.reactivationWindowMs),
        };
      }
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
  const returningArrow = talentEffect(player.class, player.talents, "returning_arrow", skill.slot);
  const swornPrey = talentEffect(player.class, player.talents, "sworn_prey", skill.slot);
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
    const healStats = mapHeroClassSettings(zone(w.state).heroSettings, player.class).stats.heal;
    const power =
      targetFilter === "wounded_allies"
        ? (skill.allyPower ?? skill.power) +
          Math.max(0, player.level - 1) * (healStats?.perLevel ?? 3)
        : skill.slot === 1
          ? configuredAttackDamage(w, player)
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
      ...(returningArrow
        ? { returnRange: skill.range * Math.max(0, returningArrow.returnRangeMultiplier) }
        : {}),
      ...(swornPrey && action.rangerSwornPreyTargetId
        ? {
            homingTargetId: action.rangerSwornPreyTargetId,
            homingTurnRateRadians: swornPrey.turnRateRadians,
          }
        : {}),
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
    Math.round(configuredAttackDamage(w, player) * Math.max(0, effect.powerRatio)),
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
  const skill = configuredSkill(w, player, slot as SkillSlot);
  const definition = actionForClassSlot(player.class, slot);
  const center = { x: player.x + PLAYER_SIZE / 2, y: player.y + PLAYER_SIZE / 2 };
  const terrain = zone(w.state).terrain;

  if (definition.shape === "stealth") {
    if (enterRogueStealth(player, now)) {
      const silhouette = talentEffect(player.class, player.talents, "rogue_silhouette", 3);
      if (silhouette) {
        player.rogueSilhouette = {
          x: player.x,
          y: player.y,
          hp: Math.max(1, silhouette.health),
          expiresAt: now + Math.max(0, silhouette.durationMs),
        };
      }
      const smokeScreen = talentEffect(player.class, player.talents, "rogue_smoke_screen", 3);
      if (smokeScreen) applyRogueSmokeProtection(player, now, smokeScreen);
      if (!silhouette) forgetPlayer(w, player);
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
      if (skill.id === "poisoned_shiv" && result && !result.killed) {
        const rupture = talentEffect(player.class, player.talents, "rogue_rupture", 4);
        if (rupture) {
          const detonation = rupturePoisonWithShiv(
            w.state.damageOverTime,
            player.id,
            monster.id,
            rupture,
          );
          if (detonation.damage > 0) {
            const ruptureResult = damageMonster(
              w,
              connectionId,
              player,
              monster,
              skill,
              now,
              false,
              detonation.damage,
              { poisonRupture: true },
            );
            if (ruptureResult?.killed) continue;
          }
        }
        applyRoguePoison(w, player, monster, skill, now);
      }
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
    const origin = { x: player.x, y: player.y };
    movePlayer(w, player, { x: -action.direction.x, y: -action.direction.y }, skill.distance ?? 0);
    const afterimage = talentEffect(player.class, player.talents, "afterimage", slot as SkillSlot);
    if (afterimage) {
      player.rangerAfterimage = {
        ...origin,
        expiresAt: now + Math.max(0, afterimage.durationMs),
      };
      for (const monster of w.state.monsterGrid.queryRadius(origin, afterimage.aggroRadius)) {
        if (
          monster.deadUntil <= now &&
          pointDistance(origin, monster) <= afterimage.aggroRadius &&
          hasLineOfSight(origin, monster, terrain.tiles)
        )
          tauntMonster(player, monster, now);
      }
      sendStateTo(w, connectionId, player);
    }
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
    if (
      skill.id === "heartseeker" &&
      action.channelMaxEndsAt !== undefined &&
      action.channelEndsAt === undefined
    )
      return;
    spawnPlayerProjectiles(w, player, action, skill, definition, "monsters", now);
    if (definition.shape === "volley") {
      const tripleVolley = talentEffect(
        player.class,
        player.talents,
        "triple_volley",
        slot as SkillSlot,
      );
      if (tripleVolley)
        player.rangerVolleySequence = scheduleAdditionalVolleys(action, tripleVolley);
    }
    return;
  }
  if (definition.shape === "heal_projectile") {
    spawnPlayerProjectiles(w, player, action, skill, definition, "wounded_allies", now);
    return;
  }
  if (definition.shape === "area_taunt") {
    const rally = talentEffect(player.class, player.talents, "rallying_cry", slot as SkillSlot);
    const banner = talentEffect(player.class, player.talents, "war_banner", slot as SkillSlot);
    const radius = skill.radius ?? skill.range;
    if (rally) {
      applyRallyingCry(
        player,
        w.state.players.values(),
        rally,
        radius,
        now,
        (source, target) => areCombatAllies(source, target),
        (source, target) => hasLineOfSight(source, target, terrain.tiles),
      );
      if (banner) {
        applyWarBanner(
          player,
          w.state.players.values(),
          rally,
          undefined,
          banner.durationMs,
          now,
          (source, target) => areCombatAllies(source, target),
          (target) =>
            pointDistance(player, target) <= radius &&
            hasLineOfSight(player, target, terrain.tiles),
        );
      }
      return;
    }
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
    if (banner && challenge) {
      applyWarBanner(
        player,
        w.state.players.values(),
        undefined,
        challenge,
        banner.durationMs,
        now,
        (source, target) => areCombatAllies(source, target),
        () => true,
      );
    }
    return;
  }
  const judgment = talentEffect(player.class, player.talents, "nova_judgment", slot as SkillSlot);
  const mercy = talentEffect(player.class, player.talents, "nova_mercy", slot as SkillSlot);
  const novaMultipliers = novaSpecializationMultipliers(judgment, mercy);
  if (
    definition.shape === "nova" &&
    mercy?.reviveNearest &&
    now - player.lastResurrectAt >= RESURRECT_COOLDOWN_MS
  ) {
    const radius = skill.radius ?? skill.range;
    const corpse = nearestMercyCorpse(
      w.state.players.values(),
      (candidate) => pointDistance(player, candidate.corpse ?? candidate),
      (candidate) =>
        candidate !== player &&
        candidate.life === "corpse" &&
        candidate.corpse !== null &&
        areCombatAllies(player, candidate) &&
        pointDistance(player, candidate.corpse) <= radius &&
        hasLineOfSight(player, candidate.corpse, terrain.tiles),
    );
    if (corpse) {
      const targetConnectionId = connectionOf(w.state, corpse.id);
      if (targetConnectionId !== undefined) {
        player.lastResurrectAt = now;
        revivePlayerByPriest(w, connectionId, player, targetConnectionId, corpse, now);
      }
    }
  }
  const polarityOrb = talentEffect(player.class, player.talents, "polarity_orb", slot as SkillSlot);
  if (definition.shape === "nova" && polarityOrb) {
    const orb = startPolarityOrb(
      w.state.polarityOrbs,
      player.id,
      { x: player.x, y: player.y },
      skill.radius ?? skill.range,
      polarityOrb,
      now,
    );
    sendSpatialEvent(
      w,
      {
        t: "priest.polarity_orb",
        id: orb.id,
        actorId: player.id,
        x: orb.x,
        y: orb.y,
        maximumRadius: orb.maximumRadius,
        startedAt: orb.startedAt,
        returnsAt: orb.returnsAt,
        endsAt: orb.endsAt,
      },
      orb,
    );
    return;
  }
  if (definition.shape === "area_damage" || definition.shape === "nova") {
    const cyclone = talentEffect(player.class, player.talents, "cyclone", slot as SkillSlot);
    const eyeOfTheStorm = talentEffect(
      player.class,
      player.talents,
      "eye_of_the_storm",
      slot as SkillSlot,
    );
    if (cyclone) {
      startWarriorCyclone(player, action.id, skill, cyclone, now);
      if (eyeOfTheStorm) {
        startWarriorVortex(
          player,
          { x: player.x, y: player.y },
          skill.radius ?? skill.range,
          {
            ...eyeOfTheStorm,
            durationMs: cyclone.ticks * cyclone.intervalMs,
          },
          now,
          true,
        );
      }
      return;
    }
    const steelTempest = talentEffect(
      player.class,
      player.talents,
      "steel_tempest",
      slot as SkillSlot,
    );
    const radius = skill.radius ?? skill.range;
    for (const monster of w.state.monsterGrid.queryRadius(
      center,
      radius + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS,
    )) {
      if (
        monster.deadUntil <= now &&
        withinRange(player, monster, radius + monsterBodyRadius(monster.species)) &&
        hasLineOfSight(player, monster, terrain.tiles)
      ) {
        const result = damageMonster(
          w,
          connectionId,
          player,
          monster,
          skill,
          now,
          false,
          Math.max(
            1,
            Math.round(
              (skill.power + Math.max(0, player.level - 1) * 2) *
                (judgment
                  ? novaJudgmentDamageMultiplier(monster.hp, monster.maxHp, judgment)
                  : novaMultipliers.damage),
            ),
          ),
        );
        if (result && !result.killed && steelTempest) tauntMonster(player, monster, now);
      }
    }
    if (steelTempest && eyeOfTheStorm) {
      startWarriorVortex(player, { x: player.x, y: player.y }, radius, eyeOfTheStorm, now, false);
    }
  }
  if (definition.shape === "area_heal" || definition.shape === "nova") {
    areaHeal(w, connectionId, player, skill, now, novaMultipliers.healing);
    const soulAnchor = talentEffect(player.class, player.talents, "soul_anchor", slot as SkillSlot);
    if (skill.id === "prayer" && soulAnchor) {
      const radius = skill.radius ?? skill.range;
      const cleansePoison = Boolean(
        talentEffect(player.class, player.talents, "absolution", slot as SkillSlot),
      );
      for (const target of w.state.players.values()) {
        if (
          target.life !== "alive" ||
          !areCombatAllies(player, target) ||
          pointDistance(player, target) > radius ||
          !hasLineOfSight(player, target, terrain.tiles)
        )
          continue;
        target.priestSoulAnchor = {
          ownerId: player.id,
          x: player.x,
          y: player.y,
          expiresAt: now + soulAnchor.durationMs,
          cleansePoison,
        };
      }
    }
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
  const skill = configuredSkill(w, player, 5);
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

function advanceRangerVolley(w: WorldGlue, player: PlayerRuntime, now: number): void {
  const sequence = player.rangerVolleySequence;
  if (!sequence) return;
  advanceAdditionalVolleys(
    player,
    now,
    (salvo) => {
      sendSpatialEvent(
        w,
        {
          t: "animation",
          actionId: salvo.actionId,
          actorKind: "player",
          actorId: player.id,
          action: "skill",
          skillId: "volley",
          talented: true,
          evolved: true,
          direction: { ...sequence.direction },
          startedAt: salvo.animationAt,
          impactAt: salvo.impactAt,
          recoveryEndsAt: salvo.recoveryEndsAt,
        },
        player,
      );
    },
    (salvo) => {
      const action: CombatActionRuntime = {
        id: salvo.actionId,
        kind: "skill",
        skillId: "volley",
        slot: 3,
        direction: { ...sequence.direction },
        startedAt: salvo.animationAt,
        impactAt: salvo.impactAt,
        recoveryEndsAt: salvo.recoveryEndsAt,
        resolved: true,
      };
      spawnPlayerProjectiles(
        w,
        player,
        action,
        configuredSkill(w, player, 3),
        actionForClassSlot(player.class, 3),
        "monsters",
        now,
      );
    },
  );
}

function pushMonsterAwayFrom(
  w: WorldGlue,
  monster: MonsterRuntime,
  center: Vec2,
  distance: number,
): void {
  const direction = normalizeDirection(
    { x: monster.x - center.x, y: monster.y - center.y },
    monster.facing,
  );
  const previous = { x: monster.x, y: monster.y };
  const moved = resolveTerrain(
    monster,
    {
      x: monster.x + direction.x * Math.max(0, distance),
      y: monster.y + direction.y * Math.max(0, distance),
    },
    zone(w.state).terrain,
  );
  monster.x = moved.x;
  monster.y = moved.y;
  w.state.monsterGrid.update(monster, previous);
}

function releaseCounterOffensive(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  skill: SkillDefinition,
  now: number,
): void {
  const effect = talentEffect(player.class, player.talents, "counter_offensive", 2);
  if (!effect) {
    player.warriorCounterReserve = 0;
    return;
  }
  const power = consumeCounterOffensive(player);
  if (power <= 0) return;
  const center = { x: player.x, y: player.y };
  for (const monster of w.state.monsterGrid
    .queryRadius(center, effect.radius + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    if (
      monster.deadUntil > now ||
      !withinRange(player, monster, effect.radius + monsterBodyRadius(monster.species)) ||
      !hasLineOfSight(player, monster, zone(w.state).terrain.tiles)
    )
      continue;
    const result = damageMonster(w, connectionId, player, monster, skill, now, false, power);
    if (!result?.killed) {
      pushMonsterAwayFrom(w, monster, center, effect.knockbackDistance);
      tauntMonster(player, monster, now);
    }
  }
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
      direction: { ...player.facing },
      startedAt: now,
      impactAt: now,
      recoveryEndsAt: now + 240,
    },
    player,
  );
}

function pulseWarriorVortex(
  w: WorldGlue,
  player: PlayerRuntime,
  center: Vec2,
  effect: Extract<TalentEffect, { kind: "eye_of_the_storm" }>,
  now: number,
): void {
  const radius = player.warriorVortex?.radius ?? 0;
  for (const monster of w.state.monsterGrid
    .queryRadius(center, radius + PLAYER_SIZE + MAX_MONSTER_BODY_RADIUS)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    if (
      monster.deadUntil > now ||
      pointDistance(center, monster) > radius + monsterBodyRadius(monster.species) ||
      !hasLineOfSight(center, monster, zone(w.state).terrain.tiles)
    )
      continue;
    const previous = { x: monster.x, y: monster.y };
    const direction = normalizeDirection(
      { x: center.x - monster.x, y: center.y - monster.y },
      monster.facing,
    );
    const moved = resolveTerrain(
      monster,
      {
        x: monster.x + direction.x * effect.pullDistance,
        y: monster.y + direction.y * effect.pullDistance,
      },
      zone(w.state).terrain,
    );
    monster.x = moved.x;
    monster.y = moved.y;
    monster.slowMultiplier = Math.min(monster.slowMultiplier, 1 - effect.slowRatio);
    monster.slowUntil = Math.max(monster.slowUntil, now + effect.slowDurationMs);
    w.state.monsterGrid.update(monster, previous);
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

function applyLumenPortal(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  now: number,
): void {
  const terrain = zone(w.state).terrain;
  for (const portal of [...w.state.lumenPortals].sort((a, b) => a.id.localeCompare(b.id))) {
    if (
      portal.expiresAt <= now ||
      portal.ownerId === player.id ||
      portal.usedPlayerIds.has(player.id)
    )
      continue;
    const ownerConnectionId = connectionOf(w.state, portal.ownerId);
    if (ownerConnectionId === undefined) continue;
    const owner = w.state.players.get(ownerConnectionId);
    if (!owner?.authorized || owner.life !== "alive" || !areCombatAllies(owner, player)) continue;
    const atFrom = pointDistance(player, portal.from) <= portal.triggerRadius;
    const atTo = pointDistance(player, portal.to) <= portal.triggerRadius;
    if (!atFrom && !atTo) continue;
    const destination = atFrom ? portal.to : portal.from;
    if (!isWalkable(destination, PLAYER_SIZE, terrain)) continue;
    portal.usedPlayerIds.add(player.id);
    const previous = { x: player.x, y: player.y };
    player.x = destination.x;
    player.y = destination.y;
    player.dirty = true;
    w.state.playerGrid.update(player, previous);
    if (portal.healingPower > 0)
      healPlayer(
        w,
        ownerConnectionId,
        owner,
        connectionId,
        player,
        portal.healingPower,
        "blink",
        now,
        false,
      );
    sendStateTo(w, connectionId, player);
    return;
  }
}

function crossedRing(
  distance: number,
  fromRadius: number,
  toRadius: number,
  bodyRadius: number,
): boolean {
  const minimum = Math.min(fromRadius, toRadius) - bodyRadius;
  const maximum = Math.max(fromRadius, toRadius) + bodyRadius;
  return distance >= Math.max(0, minimum) && distance <= maximum;
}

function resolvePolarityOrbStep(
  w: WorldGlue,
  orb: PolarityOrbRuntime,
  fromRadius: number,
  toRadius: number,
  returning: boolean,
  now: number,
): void {
  const ownerConnectionId = connectionOf(w.state, orb.ownerId);
  if (ownerConnectionId === undefined) return;
  const owner = w.state.players.get(ownerConnectionId);
  if (!owner?.authorized || owner.life !== "alive") return;
  const skill = configuredSkill(w, owner, 5);
  const judgment = talentEffect(owner.class, owner.talents, "nova_judgment", 5);
  const mercy = talentEffect(owner.class, owner.talents, "nova_mercy", 5);
  const multipliers = novaSpecializationMultipliers(judgment, mercy);
  const hitIds = returning ? orb.returnHitIds : orb.outwardHitIds;
  const center = { x: orb.x, y: orb.y };
  for (const monster of [...w.state.monsters].sort((a, b) => a.id.localeCompare(b.id))) {
    const hitId = `monster:${monster.id}`;
    if (
      monster.deadUntil > now ||
      hitIds.has(hitId) ||
      !crossedRing(
        pointDistance(center, monster),
        fromRadius,
        toRadius,
        monsterBodyRadius(monster.species),
      ) ||
      !hasLineOfSight(center, monster, zone(w.state).terrain.tiles)
    )
      continue;
    hitIds.add(hitId);
    damageMonster(
      w,
      ownerConnectionId,
      owner,
      monster,
      skill,
      now,
      false,
      Math.max(
        1,
        Math.round(
          (skill.power + Math.max(0, owner.level - 1) * 2) *
            (judgment
              ? novaJudgmentDamageMultiplier(monster.hp, monster.maxHp, judgment)
              : multipliers.damage),
        ),
      ),
    );
  }
  for (const [targetConnectionId, target] of [...w.state.players].sort(([, a], [, b]) =>
    a.id.localeCompare(b.id),
  )) {
    const hitId = `player:${target.id}`;
    if (
      target.life !== "alive" ||
      !areCombatAllies(owner, target) ||
      hitIds.has(hitId) ||
      !crossedRing(pointDistance(center, target), fromRadius, toRadius, PLAYER_SIZE / 2) ||
      !hasLineOfSight(center, target, zone(w.state).terrain.tiles)
    )
      continue;
    hitIds.add(hitId);
    healPlayer(
      w,
      ownerConnectionId,
      owner,
      targetConnectionId,
      target,
      Math.max(
        1,
        Math.round((skill.power + Math.max(0, owner.level - 1) * 2) * multipliers.healing),
      ),
      skill.id,
      now,
      target === owner,
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

function revivePlayerByPriest(
  w: WorldGlue,
  casterConnectionId: string,
  caster: PlayerRuntime,
  targetConnectionId: string,
  target: PlayerRuntime,
  now: number,
): void {
  target.life = "alive";
  target.resurrectionAt = 0;
  target.corpse = null;
  target.hp = resurrectHp(target.level);
  grantReviveGrace(w, target, now);
  freeze(w, target);

  w.deps.send(casterConnectionId, {
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
    params: { name: caster.nick },
    tone: "good",
    x: target.x,
    y: target.y,
  });
  sendStateTo(w, targetConnectionId, target);
}

/** Port of `#resurrectNearbyCorpse` (`world.ts:3748`): the interact key is the priest's revive. */
function resurrectNearbyCorpse(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  now: number,
): { handled: boolean; cooldownStarted: boolean } {
  const heal = mapHeroClassSettings(zone(w.state).heroSettings, player.class).stats.heal;
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
  revivePlayerByPriest(w, connectionId, player, targetConnectionId, target, now);
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
 * an authored map has none (`zoneFromMapPayload` always bakes `portals: []`), so this arm is
 * currently unreachable; it stays ported verbatim (the legacy denial code, not Task 8's real
 * handoff) so a future catalogue-portal authoring path has a safe default rather than a silent
 * no-op. Authored quest bindings and `action` event triggers slot in between the resurrection and
 * the legacy quest keepers with Task 7.
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
    // Unreachable today (see the docblock above); refusing is the safe authoritative answer for
    // whenever a catalogue portal exists to hit.
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
  // Standard authored quest bindings win before the same event's advanced command program. If no
  // quest has anything relevant to show, the event program remains the full-control fallback.
  if (triggerQuestTargetNearby(w, connectionId, player)) return { cooldownStarted: false };
  // Authored `action` events sit between the life-critical resurrection above and the legacy
  // quest keepers below (see `triggerActionEventNearby`).
  if (triggerActionEventNearby(w, player)) return { cooldownStarted: false };
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
    player.guardReduction = configuredSkill(w, player, 2).reduction ?? 0;
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
  player.warriorChargeFollowup = null;
  player.warriorCounterReserve = 0;
  player.warriorBannerChallengeUntil = 0;
  player.warriorBannerChallengeReduction = 0;
  player.warriorBannerPower.clear();
  player.warriorVortex = null;
  player.rangerVolleySequence = null;
  player.rangerAfterimage = null;
  player.priestLifeLinks = [];
  player.priestSoulAnchor = null;
  removeLumenPortalsByOwner(w.state.lumenPortals, player.id);
  removePolarityOrbsByOwner(w.state.polarityOrbs, player.id);
  if (player.guarding) {
    player.guardReduction = configuredSkill(w, player, 2).reduction ?? 0;
    player.guardActivatedAt = 0;
  }
  player.dirty = true;
  sendStateTo(w, connectionId, player);
  w.deps.send(connectionId, { t: "event", code: "talent.reset", tone: "good" });
}

/**
 * Port of the `chat` arm of `#handleMessage` (`world.ts:1891-1909`). A `/command` is parsed first
 * and handled by the cheat executor (gated on `deps.cheatsEnabled`); `party` fans out through the
 * coordinator (the persistent D1 party, across map rooms); anything else is local AOI chat. The
 * legacy runtime-party fallback is rollback-only and not ported.
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
  const cheatCommand = parseCheatCommand(text);
  if (cheatCommand) {
    handleCheatCommand(w, connectionId, player, cheatCommand);
    return;
  }
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
// Cheat commands
// -------------------------------------------------------------------------------------------------

/** Port of `#cheatRevive` (`world.ts:5718`). */
function cheatRevive(w: WorldGlue, player: PlayerRuntime): void {
  player.life = "alive";
  player.resurrectionAt = 0;
  player.corpse = null;
  player.hp = maxHpForLevel(player.level);
  grantReviveGrace(w, player, w.deps.now());
  freeze(w, player);
}

/**
 * Port of `#teleportSameMap` (`world.ts:5068`): refuse an unwalkable/out-of-bounds destination
 * with a structured log while the run continues; otherwise set the authoritative position AND
 * clear the command queue — the death-transition precedent: a stale queue replayed after the snap
 * is the post-teleport sprint bug.
 */
export function teleportSameMap(
  w: WorldGlue,
  player: PlayerRuntime,
  col: number,
  row: number,
  eventId: string,
): "teleported" | "first-refusal" | "repeat-refusal" {
  const terrain = zone(w.state).terrain;
  const destination = eventCellCentre({ col, row });
  const inBounds =
    destination.x >= 0 &&
    destination.y >= 0 &&
    destination.x < terrain.width &&
    destination.y < terrain.height;
  if (!inBounds || !isWalkable(destination, PLAYER_SIZE, terrain)) {
    const first = logTeleportRefusedOnce(
      w.state,
      eventId,
      inBounds ? "unwalkable" : "out_of_bounds",
      { heroId: player.id, mapId: w.state.location?.zoneId ?? null, col, row },
    );
    return first ? "first-refusal" : "repeat-refusal";
  }
  const previousPosition = { x: player.x, y: player.y };
  player.x = destination.x;
  player.y = destination.y;
  w.state.playerGrid.update(player, previousPosition);
  // Clear the movement queue so no buffered command replays past the snap (the sprint bug class).
  player.queue = [];
  player.lastInput = NO_INPUT;
  player.starvedTicks = 0;
  player.dirty = true;
  return "teleported";
}

/** Port of `#handleCheatCommand` (`world.ts:1912`): the executor mutates session state only;
 *  life-state transitions, terrain validation and sends stay here. Gated on `deps.cheatsEnabled`
 *  (legacy `env.CHEATS_ENABLED !== "true"` refusal). */
export function handleCheatCommand(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  command: NonNullable<ReturnType<typeof parseCheatCommand>>,
): void {
  if (!w.deps.cheatsEnabled) {
    w.deps.send(connectionId, { t: "event", code: "cheat.disabled", tone: "bad" });
    return;
  }
  const result = executeCheatCommand(player, command);
  if (result.transition === "die") {
    player.hp = 0;
    killPlayer(w, connectionId, player);
  } else if (result.transition === "ghost") {
    if (player.life === "alive") {
      player.hp = 0;
      killPlayer(w, connectionId, player);
    }
    handleRelease(w, connectionId, player);
  } else if (result.transition === "revive") {
    cheatRevive(w, player);
  }
  if (result.teleport) {
    const destination = eventCellCentre(result.teleport);
    const terrain = zone(w.state).terrain;
    const landable =
      destination.x < terrain.width &&
      destination.y < terrain.height &&
      isWalkable(destination, PLAYER_SIZE, terrain);
    if (!landable) {
      w.deps.send(connectionId, { t: "event", code: "cheat.tp_blocked", tone: "bad" });
      return;
    }
    teleportSameMap(w, player, result.teleport.col, result.teleport.row, "cheat");
  }
  if (result.stateChanged) sendStateTo(w, connectionId, player);
  w.deps.send(connectionId, { t: "event", ...result.event, x: player.x, y: player.y });
}

// -------------------------------------------------------------------------------------------------
// Authored event triggers, the budgeted drain and effect dispatch
// -------------------------------------------------------------------------------------------------

/**
 * Port of `#triggerActionEventNearby` (`world.ts:1339`): the interact-key trigger — the nearest
 * `action` event within `INTERACTION_RANGE` starts a run. Returns true when an action event was
 * FOUND (so `handleInteract` stops here even if the run was dropped by the one-run lock) — an
 * interact spent on an event is not a fall-through to the quest NPCs.
 */
function triggerActionEventNearby(w: WorldGlue, player: PlayerRuntime): boolean {
  if (player.identityKind !== "hero") return false;
  const events = w.state.location?.definition.events ?? [];
  let best: {
    event: MapEvent;
    pageIndex: number;
    program: readonly EventCommand[];
    distance: number;
  } | null = null;
  for (const event of events) {
    const runnable = runnablePage(w.state, event, "action");
    if (runnable === null) continue;
    const distance = pointDistance(player, activeEventCentre(w.state, event));
    if (distance > INTERACTION_RANGE) continue;
    if (best === null || distance < best.distance) best = { event, ...runnable, distance };
  }
  if (best === null) return false;
  const chosen = best;
  const started = startRun(w.state.eventRuns, {
    event: chosen.event,
    pageIndex: chosen.pageIndex,
    program: chosen.program,
    heroId: player.id,
    runId: crypto.randomUUID(),
  });
  if (started) {
    const graphic = chosen.event.pages[chosen.pageIndex]?.graphicAssetId;
    const interaction =
      chosen.event.kind === "npc" ||
      chosen.event.kind === "guard" ||
      (graphic != null && editorAsset(graphic)?.domain === "character")
        ? "npcTalked"
        : "objectInteracted";
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) =>
      interaction === "npcTalked"
        ? { id, mapId, actor, type: "npcTalked", targetEventId: chosen.event.id }
        : { id, mapId, actor, type: "objectInteracted", targetEventId: chosen.event.id },
    );
  }
  return true;
}

/** Resume a `say` run from the `event.advance` intent — validated hero==triggerer inside
 *  `advanceRun`; a stray intent from anyone else drops silently. */
export function handleEventAdvance(w: WorldGlue, player: PlayerRuntime, runId: string): void {
  advanceRun(w.state.eventRuns, player.id, runId);
}

/** Resume a `choices` run from the `event.choose` intent — the option is re-derived and
 *  range-checked from the live command inside `chooseRun`, never a trusted count. */
export function handleEventChoose(
  w: WorldGlue,
  player: PlayerRuntime,
  runId: string,
  index: number,
): void {
  chooseRun(w.state.eventRuns, player.id, runId, index);
}

/**
 * Port of `#closeDistantDialogues` (`world.ts:4546`): end every run parked on a dialogue whose
 * triggerer has walked beyond `DIALOGUE_CLOSE_RADIUS` of its event cell (WoW's rule: the panel
 * closes, the conversation is over). Ending the run is NOT a rollback — anything the run already
 * wrote stays written; walk-away abandons only the REMAINDER.
 */
function closeWalkedAwayDialogues(w: WorldGlue): void {
  if (w.state.eventRuns.contexts.size === 0) return;
  const events = w.state.location?.definition.events ?? [];
  closeDistantDialogues(w.state.eventRuns, (context) => {
    const player = playerById(w.state, context.heroId);
    if (player === undefined) return true;
    const event = events.find((candidate) => candidate.id === context.eventId);
    if (event === undefined) return true;
    return pointDistance(player, activeEventCentre(w.state, event)) > DIALOGUE_CLOSE_RADIUS;
  });
}

/**
 * Port of `#flushDialogue` (`world.ts:4564`): send every buffered dialogue beat to its triggerer's
 * socket, then clear the buffer. `say`/`choices` carry authored prose — the sanctioned
 * codes-not-sentences data exception — and `closeDialogue` becomes `event.close`. A beat whose
 * triggerer has no socket (already gone) is dropped silently.
 */
function flushDialogue(w: WorldGlue): void {
  const dialogue = w.state.eventRuns.dialogue;
  if (dialogue.length === 0) return;
  for (const buffered of dialogue) {
    const connectionId = connectionOf(w.state, buffered.heroId);
    if (connectionId === undefined) continue;
    const message = buffered.message;
    if (message.kind === "say") {
      w.deps.send(
        connectionId,
        message.name === null
          ? { t: "event.say", runId: buffered.runId, text: message.text }
          : { t: "event.say", runId: buffered.runId, text: message.text, name: message.name },
      );
    } else if (message.kind === "offerChoices") {
      w.deps.send(connectionId, {
        t: "event.choices",
        runId: buffered.runId,
        prompt: message.prompt,
        options: [...message.options],
      });
    } else {
      w.deps.send(connectionId, { t: "event.close", runId: buffered.runId });
    }
  }
  dialogue.length = 0;
}

/** Port of `#dispatchGold` (`world.ts:4774`): a `changeGold` lands on the triggerer's session
 *  inventory, clamped at zero; a positive grant tells the hero with `loot.picked`. A grant landing
 *  mid-transition is refused with a deduped structured log. */
function dispatchGold(
  w: WorldGlue,
  dispatch: DispatchEffect,
  effect: Extract<DispatchEffect["effect"], { kind: "changeGold" }>,
): void {
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (connectionId === undefined || !player?.authorized) return;
  if (player.transitioning) {
    logGoldRefusedOnce(w.state, dispatch.eventId, "transitioning", { heroId: player.id });
    return;
  }
  const before = player.inventory.gold;
  const after = Math.max(0, before + effect.amount);
  if (after === before) return;
  player.inventory.gold = after;
  player.dirty = true;
  if (effect.amount > 0) {
    w.deps.send(connectionId, {
      t: "event",
      code: "loot.picked",
      params: { amount: effect.amount, kind: "gold" },
      tone: "good",
    });
  }
  sendStateTo(w, connectionId, player);
}

/** Port of `#dispatchItems` (`world.ts:4829`): a `changeItems` lands on the triggerer's consumable
 *  bag. The runtime is the item-id authority; a full stack refuses with `item.full`; a negative
 *  change clamps at zero; every landed change syncs the `potions` mirror and the self snapshot. */
function dispatchItems(
  w: WorldGlue,
  dispatch: DispatchEffect,
  effect: Extract<DispatchEffect["effect"], { kind: "changeItems" }>,
): void {
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (connectionId === undefined || !player?.authorized) return;
  if (player.transitioning) {
    logItemRefusedOnce(w.state, dispatch.eventId, effect.itemId, "transitioning", {
      heroId: player.id,
    });
    return;
  }
  if (!isConsumableId(effect.itemId)) {
    logItemRefusedOnce(w.state, dispatch.eventId, effect.itemId, "unknown_item", {
      heroId: player.id,
    });
    return;
  }
  const item: ConsumableId = effect.itemId;
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  player.inventory.consumables = counts;
  let landed = 0;
  if (effect.count > 0) {
    if (counts[item] >= CONSUMABLE_MAX_STACK) {
      w.deps.send(connectionId, { t: "event", code: "item.full", params: { item }, tone: "bad" });
      return;
    }
    const added = Math.min(effect.count, CONSUMABLE_MAX_STACK - counts[item]);
    counts[item] += added;
    landed = added;
    if (item === "health_potion") player.inventory.potions = counts.health_potion;
    player.dirty = true;
    w.deps.send(connectionId, {
      t: "event",
      code: "loot.picked",
      params: { amount: added, kind: item },
      tone: "good",
    });
  } else {
    const before = counts[item];
    const after = Math.max(0, before + effect.count);
    if (after === before) return;
    counts[item] = after;
    landed = after - before;
    if (item === "health_potion") player.inventory.potions = counts.health_potion;
    player.dirty = true;
  }
  if (landed > 0) {
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemAcquired",
      itemId: item,
      amount: landed,
      inventoryQuantity: counts[item],
    }));
  } else if (landed < 0) {
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemRemoved",
      itemId: item,
      amount: -landed,
      inventoryQuantity: counts[item],
    }));
  }
  sendStateTo(w, connectionId, player);
}

/** Port of `#dispatchTeleport` (`world.ts:4932`). Same-map is fully authoritative here; cross-map
 *  rides `deps.teleportCrossMap` (`WorldRoom.teleportCrossMap`), the same epoch-fenced handoff an
 *  authored exit uses. */
function dispatchTeleport(
  w: WorldGlue,
  dispatch: DispatchEffect,
  effect: Extract<DispatchEffect["effect"], { kind: "teleport" }>,
  now: number,
): void {
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (connectionId === undefined || !player?.authorized || player.transitioning) return;
  if (effect.mapId === w.state.location?.zoneId) {
    const fromX = player.x + PLAYER_SIZE / 2;
    const fromY = player.y + PLAYER_SIZE / 2;
    const result = teleportSameMap(w, player, effect.col, effect.row, dispatch.eventId);
    if (result === "first-refusal") {
      w.deps.send(connectionId, { t: "event", code: "zone.transition_failed", tone: "bad" });
    } else if (result === "teleported") {
      w.deps.send(connectionId, {
        t: "event",
        code: "zone.transition",
        params: {
          teleport: 1,
          sameMap: 1,
          fromX,
          fromY,
          toX: player.x + PLAYER_SIZE / 2,
          toY: player.y + PLAYER_SIZE / 2,
        },
        tone: "good",
        x: fromX,
        y: fromY,
      });
    }
    return;
  }
  w.deps.teleportCrossMap(
    connectionId,
    player,
    effect.mapId,
    effect.col,
    effect.row,
    now,
    dispatch.eventId,
  );
}

/** Port of `#dispatchOpenShop` (`world.ts:5011`): the event's cell becomes the hero's counter —
 *  `handleBuyConsumable` measures against it, so walking away ends the trade. */
function dispatchOpenShop(w: WorldGlue, dispatch: DispatchEffect): void {
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (connectionId === undefined || !player?.authorized || player.life !== "alive") return;
  const event = (zone(w.state).events ?? []).find((candidate) => candidate.id === dispatch.eventId);
  if (!event) return;
  player.shopAnchor = activeEventCentre(w.state, event);
  w.deps.send(connectionId, { t: "merchant.open" });
}

/** Port of `#dispatchEndAdventure` (`world.ts:5023`): mark the party's save complete and broadcast
 *  victory, at most once per room lifetime (`state.adventureEndDispatched`); a failed completion
 *  frees the guard so a later trigger can retry. */
function dispatchEndAdventure(w: WorldGlue, dispatch: DispatchEffect): void {
  if (w.state.adventureEndDispatched) return;
  const connectionId = connectionOf(w.state, dispatch.heroId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (connectionId === undefined || !player?.authorized || player.identityKind !== "hero") return;
  const partyId = player.partyId;
  if (!partyId) return;
  w.state.adventureEndDispatched = true;
  w.deps.waitUntil(
    w.deps.completeAdventure(partyId).catch((error: unknown) => {
      w.state.adventureEndDispatched = false;
      console.error(
        JSON.stringify({
          event: "event_end_adventure_failed",
          partyId,
          eventId: dispatch.eventId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }),
  );
}

/**
 * Port of `#drainEventRuns` (`world.ts:4455`): step every live run its budgeted slice, then
 * dispatch the effects that need this room's authority. State mutations are batched into ONE
 * coordinator RPC (the single writer); the drain pauses (`state.eventStateSync`) until that push
 * lands, while simulation keeps ticking — the next drain must seed its working copy from the
 * acknowledged snapshot, never a pre-batch value that would replay a non-idempotent `add`.
 *
 * Order: close any walked-away dialogue FIRST (it buffers a `closeDialogue` beat and releases the
 * lock), then drain the survivors, then flush every buffered beat — a run's `say`/`choices` and
 * its distance-close all reach the wire in the same tick they were produced.
 */
export function drainEventRuns(w: WorldGlue, now: number): void {
  closeWalkedAwayDialogues(w);
  if (w.state.eventStateSync !== null) {
    flushDialogue(w);
    return;
  }
  if (w.state.eventRuns.contexts.size > 0) {
    const { effects } = drainRuns(w.state.eventRuns, {
      state: w.state.adventureState.state,
      tick: w.state.tick,
    });
    const mutations: StateMutation[] = [];
    for (const dispatch of effects) {
      const effect = dispatch.effect;
      if (effect.kind === "mutateState") {
        mutations.push(effect.op);
      } else if (effect.kind === "teleport") {
        dispatchTeleport(w, dispatch, effect, now);
      } else if (effect.kind === "endAdventure") {
        dispatchEndAdventure(w, dispatch);
      } else if (effect.kind === "openShop") {
        dispatchOpenShop(w, dispatch);
      } else if (effect.kind === "changeGold") {
        dispatchGold(w, dispatch, effect);
      } else if (effect.kind === "changeItems") {
        dispatchItems(w, dispatch, effect);
      } else {
        const player = playerById(w.state, dispatch.heroId);
        if (player) {
          recordActorQuestEvent(w, player, ({ id, mapId, actor }) =>
            effect.fact.type === "areaEntered"
              ? { id, mapId, actor, type: "areaEntered", areaId: effect.fact.areaId }
              : {
                  id,
                  mapId,
                  actor,
                  type: "activityCompleted",
                  activityId: effect.fact.activityId,
                  amount: 1,
                },
          );
        }
      }
    }
    if (mutations.length > 0 && w.state.partyId !== "") {
      const sync = w.deps.applyStateChanges(mutations);
      w.state.eventStateSync = sync;
      w.deps.waitUntil(
        sync.then(
          () => {
            if (w.state.eventStateSync === sync) w.state.eventStateSync = null;
          },
          (error: unknown) => {
            if (w.state.eventStateSync === sync) {
              w.state.eventStateSync = null;
              // The run has already advanced past mutations that never became authoritative.
              // Continuing would execute its remainder against a lie, so release every lock.
              resetEventRunRuntime(w.state.eventRuns);
            }
            console.error(
              JSON.stringify({
                event: "event_state_sync_failed",
                partyId: w.state.partyId,
                roomKey: w.state.roomKey,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          },
        ),
      );
    }
  }
  flushDialogue(w);
}

// -------------------------------------------------------------------------------------------------
// Authored quest conversations (quest.open / quest.result / quest.close)
// -------------------------------------------------------------------------------------------------

/** Port of `#questDialogueEntries` (`world.ts:1050`). */
function questDialogueEntries(
  w: WorldGlue,
  player: PlayerRuntime,
  target: QuestEventReference,
): QuestDialogueEntry[] {
  const state = w.state;
  const speakingEvent = state.location?.definition.events?.find(
    (event) => event.id === target.eventId,
  );
  const speakerName =
    speakingEvent?.name.trim() ||
    (speakingEvent ? `EV${String(speakingEvent.ordinal).padStart(3, "0")}` : "EV000");
  const definitions = questDefinitionsForPlayer(state, player);
  const index = buildQuestInteractionIndex(definitions);
  const completed = new Set([
    ...completedQuestIds(state.adventureState.state.quests),
    ...completedQuestIds(player.authoredQuestProgress),
  ]);
  const selected = new Map<
    string,
    {
      candidate: ReturnType<typeof questTargetCandidates>[number];
      state: ReturnType<typeof authoredQuestRuntimeState>;
      rank: number;
    }
  >();
  for (const candidate of questTargetCandidates(index, target)) {
    const progress = questProgressForPlayer(state, player, candidate.definition);
    const runtimeState = authoredQuestRuntimeState(candidate.definition, progress, {
      level: player.level,
      completedQuestIds: completed,
      adventureState: state.adventureState.state,
    });
    const rank =
      runtimeState === "ready" && candidate.role === "turn-in"
        ? 5
        : runtimeState === "available" &&
            candidate.role === "giver" &&
            candidate.definition.acceptance === "manual"
          ? 4
          : runtimeState === "active"
            ? 3
            : runtimeState === "completed"
              ? 2
              : runtimeState === "unavailable"
                ? 1
                : 0;
    if (rank === 0) continue;
    const current = selected.get(candidate.definition.id);
    if (!current || rank > current.rank)
      selected.set(candidate.definition.id, { candidate, state: runtimeState, rank });
  }
  return [...selected.values()]
    .sort((left, right) => right.rank - left.rank)
    .flatMap(({ candidate, state: runtimeState }) => {
      const definition = candidate.definition;
      const phase =
        runtimeState === "available"
          ? ("offer" as const)
          : runtimeState === "active" ||
              runtimeState === "ready" ||
              runtimeState === "completed" ||
              runtimeState === "unavailable"
            ? runtimeState
            : null;
      if (!phase) return [];
      const text =
        phase === "offer"
          ? definition.dialogues.offer || definition.description
          : phase === "active"
            ? definition.dialogues.reminder || definition.journalSummary || definition.description
            : phase === "ready"
              ? definition.dialogues.ready || definition.journalSummary || definition.description
              : phase === "completed"
                ? definition.dialogues.completed
                : definition.dialogues.unavailable;
      // Completed/unavailable entries are useful only when the creator authored an explicit line;
      // otherwise they would crowd a multi-quest giver with inert cards.
      if ((phase === "completed" || phase === "unavailable") && text.length === 0) return [];
      const canTurnIn = phase === "ready" && candidate.role === "turn-in";
      return [
        {
          questId: definition.id,
          speakerName,
          title: definition.title || `Quête ${definition.id}`,
          text,
          category: definition.category,
          region: definition.region,
          landmark: definition.landmark,
          giverName: definition.giverName || speakerName,
          phase,
          canAccept:
            phase === "offer" && candidate.role === "giver" && definition.acceptance === "manual",
          canTurnIn,
          rewardChoices: canTurnIn
            ? definition.rewards.choices.map((choice) => ({ id: choice.id, label: choice.label }))
            : [],
        },
      ];
    });
}

/** Port of `#triggerQuestTargetNearby` (`world.ts:1148`): open the standard quest panel for the
 *  nearest bound action event. */
function triggerQuestTargetNearby(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
): boolean {
  if (player.identityKind !== "hero" || player.partyId === null) return false;
  const state = w.state;
  const mapId = state.location?.zoneId;
  if (!mapId) return false;
  let nearest: { event: MapEvent; pageIndex: number; distance: number } | null = null;
  for (const event of state.location?.definition.events ?? []) {
    if (!isInteractiveWorldEventKind(event.kind)) continue;
    const pageIndex = activePageIndex(event, state.adventureState.state);
    if (pageIndex === null) continue;
    const page = event.pages[pageIndex];
    if (page?.trigger !== "action") continue;
    const distance = pointDistance(player, activeEventCentre(state, event));
    if (distance > INTERACTION_RANGE) continue;
    const entries = questDialogueEntries(w, player, { mapId, eventId: event.id });
    if (entries.length === 0) continue;
    if (!nearest || distance < nearest.distance) nearest = { event, pageIndex, distance };
  }
  if (!nearest) return false;
  const found = nearest;
  const target = { mapId, eventId: found.event.id };
  const entries = questDialogueEntries(w, player, target);
  if (entries.length === 0) return false;
  const conversation: PendingQuestConversation = {
    id: crypto.randomUUID(),
    heroId: player.id,
    target,
    questIds: new Set(entries.map((entry) => entry.questId)),
    resolved: false,
  };
  state.questConversations.set(player.id, conversation);
  w.deps.send(connectionId, { t: "quest.open", conversationId: conversation.id, entries });
  const graphic = found.event.pages[found.pageIndex]?.graphicAssetId;
  const interaction =
    found.event.kind === "npc" ||
    found.event.kind === "guard" ||
    (graphic != null && editorAsset(graphic)?.domain === "character")
      ? "npcTalked"
      : "objectInteracted";
  recordActorQuestEvent(w, player, ({ id, mapId: eventMapId, actor }) =>
    interaction === "npcTalked"
      ? { id, mapId: eventMapId, actor, type: "npcTalked", targetEventId: found.event.id }
      : { id, mapId: eventMapId, actor, type: "objectInteracted", targetEventId: found.event.id },
  );
  return true;
}

/** Port of `#applyAuthoredQuestReward` (`world.ts:4608`). */
function applyAuthoredQuestReward(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  result: Extract<QuestTurnInResult, { ok: true }>,
  customRun?: { event: MapEvent; pageIndex: number },
): void {
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  const beforeLevel = player.level;
  for (const item of result.consumed) {
    const itemId = item.itemId as ConsumableId;
    counts[itemId] = Math.max(0, counts[itemId] - item.quantity);
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemRemoved",
      itemId,
      amount: item.quantity,
      inventoryQuantity: counts[itemId],
    }));
  }
  for (const item of result.items) {
    const itemId = item.itemId as ConsumableId;
    counts[itemId] = Math.min(CONSUMABLE_MAX_STACK, counts[itemId] + item.quantity);
    recordActorQuestEvent(w, player, ({ id, mapId, actor }) => ({
      id,
      mapId,
      actor,
      type: "itemAcquired",
      itemId,
      amount: item.quantity,
      inventoryQuantity: counts[itemId],
    }));
  }
  player.inventory.consumables = counts;
  player.inventory.potions = counts.health_potion;
  player.inventory.gold += result.gold;
  const gained = applyExperience(player.level, player.xp, result.experience);
  player.level = gained.level;
  player.xp = gained.xp;
  player.hp = maxHpForLevel(gained.level);
  player.dirty = true;
  sendStateTo(w, connectionId, player);
  const rewardedItemCount = result.items.reduce((total, item) => total + item.quantity, 0);
  if (result.experience > 0 || result.gold > 0 || rewardedItemCount > 0) {
    w.deps.send(connectionId, {
      t: "event",
      code: "authored_quest.reward",
      params: { experience: result.experience, gold: result.gold, items: rewardedItemCount },
      tone: "good",
    });
  }
  if (player.level > beforeLevel) {
    w.deps.send(connectionId, {
      t: "event",
      code: "level_up",
      params: { level: player.level },
      tone: "good",
    });
  }
  if (result.customCommands.length > 0 && customRun) {
    startRun(w.state.eventRuns, {
      event: customRun.event,
      pageIndex: customRun.pageIndex,
      program: result.customCommands,
      heroId: player.id,
      runId: crypto.randomUUID(),
    });
  }
}

/** Port of `#claimAutomaticQuestReward` (`world.ts:4683`). */
export async function claimAutomaticQuestReward(
  w: WorldGlue,
  player: PlayerRuntime,
  questId: string,
): Promise<void> {
  const connectionId = connectionOf(w.state, player.id);
  const actor = questActor(player);
  if (connectionId === undefined || !actor || player.partyId === null) return;
  if (!(await w.deps.savePlayer(player, connectionId))) return;
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  const result = await w.deps.completeAuthoredQuest(
    player.partyId,
    actor,
    questId,
    null,
    undefined,
    {
      level: player.level,
      xp: player.xp,
      hp: player.hp,
      inventory: counts,
    },
  );
  if (result.ok) applyAuthoredQuestReward(w, connectionId, player, result);
}

/** The completed-quest automatic reward fan-out on `recordQuestEvent`'s result — the `.then`
 *  half of legacy `#recordQuestEvent` (`world.ts:4700-4717`). */
export function handleQuestChanges(
  w: WorldGlue,
  event: QuestBusinessEvent,
  changes: readonly AuthoredQuestChange[],
): void {
  const fallbackHeroId =
    event.type === "monsterKilled" || event.type === "bossDefeated"
      ? event.killer.heroId
      : event.actor.heroId;
  for (const change of changes) {
    if (change.status !== "completed") continue;
    const heroId = change.heroId ?? fallbackHeroId;
    const player = playerById(w.state, heroId);
    if (player) {
      w.deps.waitUntil(claimAutomaticQuestReward(w, player, change.questId));
    }
  }
}

/** Port of `#handleQuestAction` (`world.ts:1197`). */
export async function handleQuestAction(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  message: Extract<ClientMessage, { t: "quest.action" }>,
): Promise<void> {
  const state = w.state;
  const conversation = state.questConversations.get(player.id);
  if (!conversation || conversation.id !== message.conversationId) return;
  if (message.action === "close") {
    state.questConversations.delete(player.id);
    w.deps.send(connectionId, { t: "quest.close", conversationId: conversation.id });
    return;
  }
  if (conversation.resolved || !message.questId || !conversation.questIds.has(message.questId)) {
    return;
  }
  const event = state.location?.definition.events?.find(
    (candidate) => candidate.id === conversation.target.eventId,
  );
  const pageIndex = event ? activePageIndex(event, state.adventureState.state) : null;
  const page = pageIndex === null ? undefined : event?.pages[pageIndex];
  if (
    pageIndex === null ||
    !event ||
    !page ||
    page.trigger !== "action" ||
    pointDistance(player, activeEventCentre(state, event)) > DIALOGUE_CLOSE_RADIUS
  ) {
    state.questConversations.delete(player.id);
    w.deps.send(connectionId, { t: "quest.close", conversationId: conversation.id });
    return;
  }
  const definition = questDefinitionsForPlayer(state, player).find(
    (quest) => quest.id === message.questId,
  );
  const entry = questDialogueEntries(w, player, conversation.target).find(
    (candidate) => candidate.questId === message.questId,
  );
  if (!definition || !entry) return;
  if (message.action === "refuse") {
    if (!entry.canAccept) return;
    conversation.resolved = true;
    w.deps.send(connectionId, {
      t: "quest.result",
      conversationId: conversation.id,
      questId: definition.id,
      speakerName: entry.speakerName,
      title: definition.title || `Quête ${definition.id}`,
      text: definition.dialogues.refused,
      outcome: "refused",
    });
    return;
  }
  const actor = questActor(player);
  if (!actor || player.partyId === null) return;
  if (message.action === "accept") {
    if (!entry.canAccept) return;
    const inventory = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
    const result = await w.deps.acceptAuthoredQuest(
      player.partyId,
      actor,
      definition.id,
      conversation.target,
      inventory,
    );
    conversation.resolved = true;
    w.deps.send(connectionId, {
      t: "quest.result",
      conversationId: conversation.id,
      questId: definition.id,
      speakerName: entry.speakerName,
      title: definition.title || `Quête ${definition.id}`,
      text: result.ok ? definition.dialogues.accepted : "",
      outcome: result.ok ? "accepted" : "failed",
    });
    if (result.ok && result.progress.status === "completed") {
      await claimAutomaticQuestReward(w, player, definition.id);
    }
    return;
  }
  if (!entry.canTurnIn) return;
  if (!(await w.deps.savePlayer(player, connectionId))) return;
  const counts = normalizeConsumables(player.inventory.consumables, player.inventory.potions);
  const result = await w.deps.completeAuthoredQuest(
    player.partyId,
    actor,
    definition.id,
    conversation.target,
    message.rewardChoiceId,
    { level: player.level, xp: player.xp, hp: player.hp, inventory: counts },
  );
  conversation.resolved = true;
  if (result.ok) {
    // Personal-scope completion state reaches this hero through the coordinator's own
    // personal-progress push (`installPersonalQuestProgress`), exactly like legacy.
    applyAuthoredQuestReward(w, connectionId, player, result, { event, pageIndex });
  }
  w.deps.send(connectionId, {
    t: "quest.result",
    conversationId: conversation.id,
    questId: definition.id,
    speakerName: entry.speakerName,
    title: definition.title || `Quête ${definition.id}`,
    text: result.ok ? definition.dialogues.turnIn : "",
    outcome: result.ok ? "completed" : "failed",
  });
}

/** Port of `#handleQuestAbandon` (`world.ts:1311`): journal abandonment is an intent — the
 *  coordinator rechecks ownership, state and the pinned rule. */
export async function handleQuestAbandon(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  questId: string,
): Promise<void> {
  const actor = questActor(player);
  if (!actor || player.partyId === null) return;
  const result = await w.deps.abandonAuthoredQuest(player.partyId, actor, questId);
  if (!result.ok) {
    w.deps.send(connectionId, { t: "event", code: "authored_quest.action_failed", tone: "bad" });
    return;
  }
  const conversation = w.state.questConversations.get(player.id);
  if (conversation) {
    w.state.questConversations.delete(player.id);
    w.deps.send(connectionId, { t: "quest.close", conversationId: conversation.id });
  }
  // The pushed authoritative snapshot drives the actor and every party member's journal notice.
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
 *  transition itself is `deps.transitionAdventureExit` (`WorldRoom.transitionAdventureExit`). */
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
    if (player.warriorChargeFollowup && player.warriorChargeFollowup.expiresAt <= now)
      player.warriorChargeFollowup = null;
    expireRogueOpening(player, now);
    expireRogueExecution(player, now);
    expireRoguePredatorShiv(player, now);
    expireRogueShadowDanceProtection(player, now);
    player.priestLifeLinks = player.priestLifeLinks.filter((link) => link.expiresAt > now);
    if (player.priestSoulAnchor && player.priestSoulAnchor.expiresAt <= now)
      player.priestSoulAnchor = null;
    const shadowReturnExpired = expireRogueShadowReturn(player, now);
    const smokeProtectionExpired = expireRogueSmokeProtection(player, now);
    const silhouetteExpired = Boolean(
      player.rogueSilhouette && player.rogueSilhouette.expiresAt <= now,
    );
    if (silhouetteExpired) player.rogueSilhouette = null;
    const marksBefore = player.rogueDanceMarks.length;
    player.rogueDanceMarks = player.rogueDanceMarks.filter((mark) => mark.expiresAt > now);
    const selfStateChanged =
      shadowReturnExpired ||
      smokeProtectionExpired ||
      silhouetteExpired ||
      marksBefore !== player.rogueDanceMarks.length;
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
      const skill = configuredSkill(w, source, baseSkill.slot);
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
      detectPlayerTouch(state, player, previous);
      applySacredPassage(w, connectionId, player, previous, now);
      applyLumenPortal(w, connectionId, player, now);
    },
  });
  expireLumenPortals(state.lumenPortals, now);
  // NPCs held by a live event run or an open quest conversation stand still for the exchange.
  const pausedNpcIds = new Set([
    ...state.eventRuns.contexts.keys(),
    ...[...state.questConversations.values()].map((conversation) => conversation.target.eventId),
  ]);
  state.activeEvents = advanceNpcEvents({
    events: state.activeEvents,
    movement: state.npcMovement,
    players: [...state.players.values()],
    terrain: zone(state).terrain,
    tick: state.tick,
    pausedEventIds: pausedNpcIds,
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
  for (const player of state.players.values()) advanceRangerVolley(w, player, now);
  advanceWarriorCyclones(state.players.values(), now, (player, radius, power) =>
    resolveWarriorCycloneStrike(w, player, radius, power, now),
  );
  advanceWarriorVortices(state.players.values(), now, (player, center, effect) =>
    pulseWarriorVortex(w, player, center, effect, now),
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
  advancePolarityOrbs(state.polarityOrbs, now, (orb, fromRadius, toRadius, returning) =>
    resolvePolarityOrbStep(w, orb, fromRadius, toRadius, returning, now),
  );
  advanceProjectiles<string>(
    {
      projectiles: state.projectiles,
      terrain: zone(state).terrain,
      monsters: state.monsters,
      players: state.players,
      guards: state.guards,
      monsterGrid: state.monsterGrid,
      playerGrid: state.playerGrid,
      canHeal: (owner, target) => areCombatAllies(owner, target),
      damageMonster: (projectile, monster, impactAt) =>
        projectileDamage(w, projectile, monster, impactAt),
      healPlayer: (projectile, connectionId, target, impactAt) =>
        projectileHeal(w, projectile, connectionId, target, impactAt),
      damagePlayer: (projectile, connectionId, target, impactAt) => {
        const attacker = state.monsters.find((monster) => monster.id === projectile.ownerId);
        if (attacker)
          damagePlayer(
            w,
            connectionId,
            target,
            projectile.power,
            attacker.species,
            attacker.id,
            impactAt,
          );
      },
      damageGuard: (projectile, guard) => {
        applyGuardDamage(guard, projectile.power);
      },
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
    onMonsterMoved: (monster, previous) => detectMonsterTouch(state, monster, previous),
  };
  advanceMonsters(monsterContext, now);
  advanceCombatActions(state.monsters, now, (monster, action) =>
    resolveMonsterAction(w, monster, action, now),
  );
  advanceGuards(monsterContext, now);
  processExpiredLoot(state.loot, state.lootGrid, now);
  // Drain event runs AFTER all authoritative simulation (movement, combat, monsters, loot) and
  // BEFORE the network flush: a run's teleport acts on final positions and rides out THIS tick's
  // snapshot, and the budget guarantees the drain returns so the tick never hangs.
  drainEventRuns(w, now);
  if (state.tick % NETWORK_TICKS_PER_SNAPSHOT === 0) {
    broadcastNetworkUpdates(
      state.players,
      state.tick,
      (player) => worldView(interestContext(w), player),
      (connectionId, message) => deps.send(connectionId, message),
      state.activeEvents,
    );
    // The legacy runtime-party pass (`broadcastPartyStateIfChanged`) is rollback-only and absent;
    // hero rooms rebuild the roster from the persistent party.
    broadcastHeroPartyStates(w);
  }
  flushQueuedResyncs(w, now);
}
