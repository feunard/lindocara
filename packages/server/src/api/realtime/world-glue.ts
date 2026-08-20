/**
 * The seam every other world-tick module shares: {@link WorldGlue}, {@link WorldTickDeps} and the
 * small accessors that read a room's collections. It imports none of its siblings, which is what
 * keeps the split acyclic at the type level.
 *
 * Extracted from `worldTick.ts`, which had grown to 7100 lines and 136 declarations while its own
 * docblock still called it "the tick order". Same functions, same explicit-dependency shape; only
 * the file boundary is new.
 */

import { CONSUMABLES } from "@lindocara/engine/consumables.js";
import type { TransitionCategory } from "@lindocara/engine/event-commands.js";
import type { StateMutation } from "@lindocara/engine/event-interpreter.js";
import type { GroundVector } from "@lindocara/engine/ground.js";
import type { HarvestResourceKind } from "@lindocara/engine/harvest.js";
import { mapHeroClassSettings } from "@lindocara/engine/map-hero-settings.js";
import type { ServerMessage } from "@lindocara/engine/protocol.js";
import type { QuestActor, QuestBusinessEvent } from "@lindocara/engine/quest-runtime.js";
import type { QuestEventReference } from "@lindocara/engine/quests.js";
import { CLASS_SKILLS, type SkillDefinition, type SkillSlot } from "@lindocara/engine/skills.js";
import { skillWithTalents } from "@lindocara/engine/talents.js";
import { BODY_RADIUS } from "@lindocara/engine/terrain-access.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { ZoneDefinition } from "@lindocara/engine/zones.js";
import {
  type BuildingRuntime,
  buildingSnapshot,
  buildingWithinRadius,
  damageBuilding,
} from "../../world/building-system.js";
import type { NavigationRuntime } from "../../world/navigation-system.js";
import { activeRallyPowerMultiplier } from "../../world/warrior-variant-system.js";
import type { PlayerRuntime } from "../../world/world-runtime.js";
import type {
  HitHarvestNodeRequest,
  HitHarvestNodeResult,
  QuestAbandonResult,
  QuestAcceptanceResult,
  QuestTurnInResult,
  ReserveHarvestNodeRequest,
  ReserveHarvestNodeResult,
} from "./PartyRoom.ts";
import { sendRoomEvent } from "./world-send.ts";
import type { WorldRoomState } from "./worldState.ts";

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
    category: TransitionCategory,
    /** The SOURCE event is `eventId` above (it names the log line); this is the event on the
     *  DESTINATION map to arrive at, when the command authored one. */
    destinationEventId?: string,
  ): void;
  /** An intact authored building door enters its linked ordinary member map. */
  enterBuilding(
    connectionId: string,
    player: PlayerRuntime,
    mapId: string,
    now: number,
    buildingId: string,
  ): void;
  /** The idempotent, epoch-fenced D1 quest-reward claim for built-in quest chapters
   *  (`HeroSaveService.claimQuestReward`, port of legacy `claimHeroQuestReward`). */
  claimQuestReward(player: PlayerRuntime, reward: QuestRewardClaim): Promise<boolean>;
  reserveHarvestNode(request: ReserveHarvestNodeRequest): Promise<ReserveHarvestNodeResult>;
  hitHarvestNode(
    request: HitHarvestNodeRequest,
    resource: HarvestResourceKind,
  ): Promise<HitHarvestNodeResult>;
  cancelHarvestNode(request: HitHarvestNodeRequest): Promise<boolean>;
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

export interface MonsterDamageContext {
  damageOverTime?: boolean;
  persistentOwnerCredit?: boolean;
  poisonRupture?: boolean;
  suppressHitEvent?: boolean;
}

// -------------------------------------------------------------------------------------------------
// Shared helpers
// -------------------------------------------------------------------------------------------------

/**
 * The daylight a dropped stack is nudged by so it does not sit exactly under the body that dropped
 * it — the pixel path's `+ 8` on both ground axes, in tile units. Elevation is NOT offset: loot
 * lands on the ground the monster died on, and adding an eighth of a tile to `y` would float it.
 */
export const LOOT_DROP_OFFSET = 8 / TILE_SIZE;

/**
 * The travel a held Pas de Lumen must cover before its gate is worth opening — one PIXEL, as it
 * always was, expressed in tile units. Carried over verbatim rather than rounded to a tile: it is
 * an "did the priest move at all" guard, not a balance range.
 */
export const MINIMUM_PORTAL_SPAN = 1 / TILE_SIZE;

/**
 * How far short of its contact a charge stops, so the warrior never ends flush inside what it hit —
 * one PIXEL, as it always was. A bare `- 1` in tile units would have eaten a whole tile of travel
 * off every charge and turned a wall stop into a visible rebound.
 */
export const IMPACT_BACKOFF = 1 / TILE_SIZE;

/**
 * A hero's body DIAMETER in tile units — the tile-unit successor of the bare `PLAYER_SIZE` that
 * widened every broad-phase grid query, so a body whose navigation point is just outside the query
 * radius is still found by its far edge. `PLAYER_SIZE / 2` sites become `BODY_RADIUS` directly.
 */
export const BODY_DIAMETER = BODY_RADIUS * 2;

export function zone(state: WorldRoomState): ZoneDefinition {
  if (!state.location) throw new Error("world room was not initialized with a zone");
  return state.location.definition;
}

export function configuredSkill(
  w: WorldGlue,
  player: PlayerRuntime,
  slot: SkillSlot,
): SkillDefinition {
  const stats = mapHeroClassSettings(zone(w.state).heroSettings, player.class).stats;
  const baseSkill = CLASS_SKILLS[player.class][slot - 1];
  if (!baseSkill) throw new Error(`Missing ${player.class} skill in slot ${slot}`);
  const skill = skillWithTalents(
    player.class,
    player.talents,
    slot,
    slot === 1 ? { ...baseSkill, range: stats.attackRange } : baseSkill,
  );
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

export function configuredAttackDamage(w: WorldGlue, player: PlayerRuntime): number {
  const stats = mapHeroClassSettings(zone(w.state).heroSettings, player.class).stats;
  return stats.attackBase + Math.max(0, player.level - 1) * stats.attackPerLevel;
}

export function buildingDamagePower(
  w: WorldGlue,
  player: PlayerRuntime,
  skill: SkillDefinition,
  basic: boolean,
  frozenPower?: number,
): number {
  const base =
    frozenPower ??
    (basic ? configuredAttackDamage(w, player) : skill.power + Math.max(0, player.level - 1) * 2);
  return Math.max(
    1,
    Math.round(
      base *
        (player.damageBoostUntil > w.deps.now() ? 1 + CONSUMABLES.damage_elixir.effectValue : 1) *
        (1 + activeRallyPowerMultiplier(player, w.deps.now())),
    ),
  );
}

export function damageBuildingTarget(
  w: WorldGlue,
  building: BuildingRuntime,
  power: number,
): boolean {
  const result = damageBuilding(building, power);
  if (!result) return false;
  sendRoomEvent(w, { t: "building.state", building: buildingSnapshot(building) });
  return true;
}

export function damageBuildingsWithin(
  w: WorldGlue,
  player: PlayerRuntime,
  skill: SkillDefinition,
  center: GroundVector,
  radius: number,
  frozenPower?: number,
): void {
  const power = buildingDamagePower(w, player, skill, false, frozenPower);
  for (const building of w.state.buildings) {
    if (buildingWithinRadius(building, center, radius)) damageBuildingTarget(w, building, power);
  }
}

export function navigationRuntime(state: WorldRoomState): NavigationRuntime {
  if (!state.navigation) throw new Error("world room navigation was not initialized");
  return state.navigation;
}

export function connectionOf(state: WorldRoomState, playerId: string): string | undefined {
  return state.connectionIdByHeroId.get(playerId);
}

export function playerById(state: WorldRoomState, playerId: string): PlayerRuntime | undefined {
  const connectionId = connectionOf(state, playerId);
  return connectionId === undefined ? undefined : state.players.get(connectionId);
}

/**
 * Port of `#areCombatAllies` (`world.ts:3150`), hero branch only: every player this room admits is
 * a hero of the same persistent party by construction, and the legacy runtime-party branch belongs
 * to the rollback rooms this port does not carry.
 */
export function areCombatAllies(a: PlayerRuntime, b: PlayerRuntime): boolean {
  if (a.id === b.id) return true;
  return (
    a.identityKind === "hero" &&
    b.identityKind === "hero" &&
    a.partyId !== null &&
    a.partyId === b.partyId
  );
}

/** Port of `#questActor` (`world.ts:4601`). */
export function questActor(player: PlayerRuntime | undefined): QuestActor | null {
  if (!player?.authorized || player.identityKind !== "hero" || player.partyId === null) return null;
  return { heroId: player.id, sessionEpoch: player.sessionEpoch, level: player.level };
}

/** Port of `#recordActorQuestEvent` (`world.ts:4733`). */
export function recordActorQuestEvent(
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
// Reported movement
// -------------------------------------------------------------------------------------------------

/**
 * Elevation slack around the room's own relief, in world units. A jump apex is
 * `jump.speed² / (2 · gravity)` = 1.35 units above the ground it left, and nothing else the hero
 * does goes higher; four is that with room to spare, and still two orders of magnitude tighter than
 * the wire's own ±128.
 */
export const REPORTED_ELEVATION_SLACK = 4;
