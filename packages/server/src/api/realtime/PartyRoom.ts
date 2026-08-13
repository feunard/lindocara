import {
  type AdventureRegistry,
  type AuthoredQuestProgress,
  EMPTY_REGISTRY,
  normalizeAuthoredQuestProgress,
  type PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import { CONSUMABLE_IDS, CONSUMABLE_MAX_STACK } from "@lindocara/engine/consumables.js";
import { applyStateMutation, type StateMutation } from "@lindocara/engine/event-interpreter.js";
import { applyExperience, maxHpForLevel } from "@lindocara/engine/game.js";
import { HARVEST_PROFILE_LIMITS } from "@lindocara/engine/harvest.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import {
  addPartyMaterials,
  applyHarvestHit,
  EMPTY_PARTY_MATERIALS,
  type HarvestNodeState,
  hasPartyMaterialAmount,
  isHarvestNodeId,
  MAX_HARVEST_HITS,
  MAX_HARVEST_RESPAWN_DELAY_MS,
  PARTY_MATERIAL_TYPES,
  type PartyMaterialAmounts,
  type PartyMaterials,
  parsePartyMaterialAmounts,
  refreshHarvestNode,
  spendPartyMaterials,
} from "@lindocara/engine/party-harvest-state.js";
import type { ServerMessage } from "@lindocara/engine/protocol.js";
import {
  authoredQuestRuntimeState,
  buildQuestObjectiveIndex,
  completedQuestIds,
  createAuthoredQuestProgress,
  createAuthoredQuestProgressForAcceptance,
  type QuestActor,
  type QuestBusinessEvent,
  type QuestObjectiveIndex,
  questPrerequisitesHold,
} from "@lindocara/engine/quest-runtime.js";
import type { AuthoredQuestDefinition, QuestEventReference } from "@lindocara/engine/quests.js";
import { $inject } from "alepha";
import { $room } from "alepha/websocket";
// Pure, D1-free authored-quest business-event engine reused as-is from the legacy source tree —
// same-package sibling, not `@lindocara/engine` (mirrors `AdventureStateService`'s own
// `../../adventure-registry.js` import). Unlike `game-session.ts`/`world.ts`/the other files the
// server package's `CLAUDE.md` names as off-limits, `authored-quest-system.ts` is pure state-in/
// state-out logic with every D1 access already pushed out through injected callbacks — reading and
// reimplementing it here would be a second, driftable copy of a business-event engine that has no
// Durable-Object- or D1-specific concern to actually port.
import {
  type AuthoredQuestChange,
  processAuthoredQuestEvent,
} from "../../authored-quest-system.js";
import { AdventureStateService } from "../services/AdventureStateService.ts";
import {
  committedSupportSpendTotals,
  MAX_SUPPORT_SPEND_ENTRIES,
  pruneSupportSpendOutcomes,
  SUPPORT_SPEND_OUTCOME_TTL_MS,
  type SupportSpendEntry,
  type SupportSpendJournal,
  type SupportSpendStatus,
  sameSupportSpend,
  supportSpendRoomBelongsToParty,
} from "../services/supportSpendJournal.ts";
import { RealtimeChannels } from "./channels.ts";

export type QuestAcceptanceResult =
  | { readonly ok: true; readonly progress: AuthoredQuestProgress }
  | {
      readonly ok: false;
      readonly reason: "party" | "quest" | "target" | "state" | "prerequisite" | "fence";
    };

export type QuestAbandonResult =
  | { readonly ok: true; readonly progress: AuthoredQuestProgress }
  | {
      readonly ok: false;
      readonly reason: "party" | "quest" | "state" | "forbidden" | "fence";
    };

export type QuestTurnInResult =
  | {
      readonly ok: true;
      readonly experience: number;
      readonly gold: number;
      readonly items: readonly { itemId: string; quantity: number }[];
      readonly consumed: readonly { itemId: string; quantity: number }[];
      readonly customCommands: AuthoredQuestDefinition["rewards"]["customCommands"];
    }
  | {
      readonly ok: false;
      readonly reason:
        | "party"
        | "quest"
        | "target"
        | "state"
        | "choice"
        | "items"
        | "inventory"
        | "fence";
    };

export interface ReserveHarvestNodeRequest {
  heroId: string;
  sessionEpoch: number;
  eventId: string;
  generation: number;
  requiredHits: number;
  reward: PartyMaterialAmounts;
  goldValue: number;
  respawnDelayMs: number | null;
  /** Absolute server deadline for transient animal carcasses; omitted by older internal callers. */
  respawnAt?: number | null;
}

export type ReserveHarvestNodeResult =
  | {
      readonly ok: true;
      readonly reservationId: string;
      readonly node: HarvestNodeState;
      readonly materials: PartyMaterials;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "party" | "generation" | "depleted" | "busy";
    };

export interface HitHarvestNodeRequest {
  heroId: string;
  eventId: string;
  reservationId: string;
}

export type HitHarvestNodeResult =
  | {
      readonly ok: true;
      readonly node: HarvestNodeState;
      readonly materials: PartyMaterials;
      readonly rewarded: boolean;
      readonly reward: PartyMaterialAmounts;
      readonly goldValue: number;
      readonly goldPending?: boolean;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid"
        | "party"
        | "reservation"
        | "generation"
        | "depleted"
        | "overflow"
        | "fence";
    };

export type ConsumePartyMaterialsResult =
  | { readonly ok: true; readonly materials: PartyMaterials }
  | { readonly ok: false; readonly reason: "invalid" | "party" | "insufficient" };

export interface PartyMaterialReservationRequest {
  readonly reservationId: string;
  readonly heroId: string;
  readonly roomKey: string;
  readonly costs: PartyMaterialAmounts;
}

export type PartyMaterialReservationResult =
  | {
      readonly ok: true;
      readonly reservationId: string;
      readonly status: "held" | SupportSpendStatus;
      readonly materials: PartyMaterials;
    }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "party" | "insufficient" | "reservation";
      /** Present when authority can report the exact stock that failed the attempted spend. */
      readonly materials?: PartyMaterials;
    };

export interface ReconcilePartyMaterialSpendsRequest {
  readonly roomKey: string;
  readonly activatedIds: readonly string[];
}

export type ReconcilePartyMaterialSpendsResult =
  | {
      readonly ok: true;
      readonly materials: PartyMaterials;
      readonly acknowledgedIds: readonly string[];
    }
  | { readonly ok: false; readonly reason: "invalid" | "party" | "overflow" };

const HARVEST_RESERVATION_TTL_MS = 10_000;
const MATERIAL_RESERVATION_TTL_MS = 10_000;
const MAX_MATERIAL_RESERVATIONS = 128;

interface HarvestReservation {
  id: string;
  heroId: string;
  sessionEpoch: number;
  eventId: string;
  generation: number;
  requiredHits: number;
  reward: PartyMaterialAmounts;
  goldValue: number;
  respawnDelayMs: number | null;
  respawnAt: number | null;
  expiresAt: number;
}

type ParsedReserveHarvestNodeRequest = Omit<
  ReserveHarvestNodeRequest,
  "goldValue" | "respawnAt"
> & {
  goldValue: number;
  respawnAt: number | null;
};

interface PartyMaterialReservation extends PartyMaterialReservationRequest {
  status: "held" | SupportSpendStatus;
  expiresAt: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseReserveHarvestNodeRequest(value: unknown): ParsedReserveHarvestNodeRequest | null {
  if (!isPlainObject(value) || !isUuid(value.heroId) || !isHarvestNodeId(value.eventId))
    return null;
  if (
    !Number.isSafeInteger(value.sessionEpoch) ||
    (value.sessionEpoch as number) < 0 ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 0 ||
    !Number.isSafeInteger(value.requiredHits) ||
    (value.requiredHits as number) < 1 ||
    (value.requiredHits as number) > MAX_HARVEST_HITS
  ) {
    return null;
  }
  if (
    value.respawnDelayMs !== null &&
    (!Number.isSafeInteger(value.respawnDelayMs) ||
      (value.respawnDelayMs as number) < 0 ||
      (value.respawnDelayMs as number) > MAX_HARVEST_RESPAWN_DELAY_MS)
  ) {
    return null;
  }
  const respawnAt = value.respawnAt === undefined ? null : value.respawnAt;
  if (respawnAt !== null && (!Number.isSafeInteger(respawnAt) || (respawnAt as number) < 0)) {
    return null;
  }
  if (value.respawnDelayMs !== null && respawnAt !== null) return null;
  const reward = parsePartyMaterialAmounts(value.reward);
  const goldValue = value.goldValue === undefined ? 0 : value.goldValue;
  if (
    !reward ||
    !Number.isSafeInteger(goldValue) ||
    (goldValue as number) < 0 ||
    (goldValue as number) > HARVEST_PROFILE_LIMITS.goldValue.max ||
    hasPartyMaterialAmount(reward) === (goldValue as number) > 0
  ) {
    return null;
  }
  return {
    heroId: value.heroId,
    sessionEpoch: value.sessionEpoch as number,
    eventId: value.eventId,
    generation: value.generation as number,
    requiredHits: value.requiredHits as number,
    reward,
    goldValue: goldValue as number,
    respawnDelayMs: value.respawnDelayMs as number | null,
    respawnAt: respawnAt as number | null,
  };
}

function parseHitHarvestNodeRequest(value: unknown): HitHarvestNodeRequest | null {
  if (
    !isPlainObject(value) ||
    !isUuid(value.heroId) ||
    !isHarvestNodeId(value.eventId) ||
    !isUuid(value.reservationId)
  ) {
    return null;
  }
  return { heroId: value.heroId, eventId: value.eventId, reservationId: value.reservationId };
}

function parsePartyMaterialReservationRequest(
  value: unknown,
): PartyMaterialReservationRequest | null {
  if (!isPlainObject(value) || !isUuid(value.reservationId) || !isUuid(value.heroId)) return null;
  const costs = parsePartyMaterialAmounts(value.costs);
  if (
    !costs ||
    !hasPartyMaterialAmount(costs) ||
    typeof value.roomKey !== "string" ||
    value.roomKey.length > 73
  )
    return null;
  return {
    reservationId: value.reservationId,
    heroId: value.heroId,
    roomKey: value.roomKey,
    costs,
  };
}

function parsePartyMaterialReservationIdentity(
  value: unknown,
): PartyMaterialReservationRequest | null {
  return parsePartyMaterialReservationRequest(value);
}

function parseReconcilePartyMaterialSpendsRequest(
  value: unknown,
): ReconcilePartyMaterialSpendsRequest | null {
  if (
    !isPlainObject(value) ||
    typeof value.roomKey !== "string" ||
    !Array.isArray(value.activatedIds)
  )
    return null;
  if (value.activatedIds.length > MAX_SUPPORT_SPEND_ENTRIES) return null;
  const activatedIds = [...new Set(value.activatedIds)];
  if (activatedIds.length !== value.activatedIds.length || activatedIds.some((id) => !isUuid(id)))
    return null;
  return { roomKey: value.roomKey, activatedIds };
}

function sameMaterialAmounts(left: PartyMaterialAmounts, right: PartyMaterialAmounts): boolean {
  return (
    (left.wood ?? 0) === (right.wood ?? 0) &&
    (left.stone ?? 0) === (right.stone ?? 0) &&
    (left.meat ?? 0) === (right.meat ?? 0)
  );
}

function materialReservationTotals(
  reservations: Iterable<PartyMaterialReservation>,
  status: PartyMaterialReservation["status"],
): PartyMaterialAmounts {
  const totals: PartyMaterialAmounts = {};
  for (const reservation of reservations) {
    if (reservation.status !== status) continue;
    for (const type of PARTY_MATERIAL_TYPES) {
      totals[type] = (totals[type] ?? 0) + (reservation.costs[type] ?? 0);
    }
  }
  return totals;
}

function availablePartyMaterials(
  materials: PartyMaterials,
  reservations: Iterable<PartyMaterialReservation>,
): PartyMaterials | null {
  return spendPartyMaterials(materials, materialReservationTotals(reservations, "held"));
}

function reservationResult(
  reservation: PartyMaterialReservation,
  materials: PartyMaterials,
): PartyMaterialReservationResult {
  return {
    ok: true,
    reservationId: reservation.reservationId,
    status: reservation.status,
    materials: { ...materials },
  };
}

function journalReservationResult(
  reservationId: string,
  entry: SupportSpendEntry,
  materials: PartyMaterials,
): PartyMaterialReservationResult {
  return {
    ok: true,
    reservationId,
    status: entry.status,
    materials: { ...materials },
  };
}

function sameEventReference(left: QuestEventReference | null, right: QuestEventReference): boolean {
  return left?.mapId === right.mapId && left.eventId === right.eventId;
}

/** The party's held snapshot plus the monotone version rooms use to drop out-of-order pushes. */
interface VersionedState {
  state: PartyAdventureState;
  version: number;
  registry: AdventureRegistry;
  supportSpends: SupportSpendJournal;
}

/** Quest commands are authored map data, so their ids are shape-checked at the map boundary and
 *  membership-checked here, where the party's authoritative adventure registry is available. Port
 *  of legacy `game-session.ts`'s `mutationBelongsToRegistry`. */
function mutationBelongsToRegistry(registry: AdventureRegistry, mutation: StateMutation): boolean {
  if (
    mutation.type !== "startQuest" &&
    mutation.type !== "advanceQuest" &&
    mutation.type !== "completeQuest"
  ) {
    return true;
  }
  const quest = (registry.quests ?? []).find((candidate) => candidate.id === mutation.questId);
  // PartyRoom owns PARTY progress. Personal progress is epoch-fenced on the hero and cannot be
  // mutated through this party-wide command seam.
  if (quest?.scope !== "party") return false;
  return (
    mutation.type !== "advanceQuest" ||
    quest.objectives.some(
      (objective) => objective.id === mutation.objectiveId && objective.type === "manual",
    )
  );
}

interface PartyRoomState {
  /** Lazily loaded on first contact; `null` until then (`ensureState`'s single load point). */
  cached: VersionedState | null;
  partyCompleted: boolean;
  /** Every `WorldRoom` that has ever joined this party (the broadcast fan-out set) — see this
   *  class's own docblock for why this directory is volatile and how it self-heals. */
  rooms: Set<string>;
  /** RPCs can interleave at awaits; every state-touching method below is enqueued here so two
   *  concurrent calls for the SAME party serialize instead of racing a lost update. Port of legacy
   *  `GameSession`'s `#stateWriteQueue`, now per-room-instance (there is one `PartyRoomState` per
   *  `partyId`) rather than a single Durable-Object-wide field. */
  writeQueue: Promise<void>;
  /** Volatile one-hit locks. Durable node generation/depletion remains the double-reward fence. */
  harvestReservations: Map<string, HarvestReservation>;
  /** Short-lived support-action sagas. Held stock is excluded from every competing spend; a
   *  committed but unconfirmed action remains idempotently refundable. */
  materialReservations: Map<string, PartyMaterialReservation>;
}

/**
 * Headless per-party coordinator, successor to legacy `GameSession` (`packages/server/src/game-
 * session.ts`). `roomId` is the party id. It owns the party's live adventure state — switches,
 * variables, self-switches, authored quest progress, materials and harvest-node progress — the
 * single writer four heroes spread across different `WorldRoom`s share, and the epoch-fenced
 * quest-reward RPCs a `WorldRoom`'s event interpreter (Task 7) calls up into.
 *
 * ## Write-through, not the legacy 5s debounce
 *
 * Legacy's `GameSession` buffered a mutation in Durable Object memory, persisted it durably to
 * `ctx.storage` (surviving THAT object's own eviction), and only flushed to D1 on a 5s alarm or on
 * party-empty. Alepha's headless `$room` exposes no storage/alarm primitive (see the realtime-
 * tranche plan's "Verified recon findings" #4) — there is nothing this room's state can survive an
 * eviction IN, so every mutating method here writes straight through to D1
 * (`AdventureStateService.save`) BEFORE pushing the new snapshot to any `WorldRoom`. This costs a
 * D1 round trip per mutation instead of one per 5s window, but it is the only way a party's flipped
 * switch or advanced quest is not silently lost the moment this process reclaims the room.
 *
 * ## The `pushToRoom`/`sendToRoom` seams
 *
 * `WorldRoom` (Task 4) does not exist yet, so this class cannot inject it to make the actual
 * cross-room RPC (`this.room.call(roomKey, "installAdventureState", state, version)` on a
 * `WorldRoom` instance this class has no way to reference without creating an import cycle before
 * that file exists). `pushToRoom`/`sendToRoom` are therefore plain, publicly reassignable fields
 * (the same seam shape `PresenceRoom.now` uses for its clock) defaulting to an inert, documented
 * no-op. Task 4 wires the real implementation once `WorldRoom` exists — by reassigning these two
 * fields at composition time — and a test overrides them directly with no `vi.mock`.
 *
 * ## The room directory is volatile
 *
 * `registerRoom`/`roomEmptied` maintain `state.rooms`, the fan-out set `broadcastToParty` and every
 * state push iterate. Like every other piece of this room's state, that set lives only in process
 * memory: an eviction (or this room simply never having been contacted before) loses it. `WorldRoom`
 * re-registers on every lease-renew beat (every 10s, per the presence-lease cadence), so a lost
 * directory self-heals within that window — a party-wide push briefly reaching fewer rooms than it
 * should, never a stale room believing it is still registered.
 */
export class PartyRoom {
  adventureStateService = $inject(AdventureStateService);
  realtimeChannels = $inject(RealtimeChannels);

  /** Reassignable deterministic clock seam, matching `PresenceRoom.now`. */
  now: () => number = () => Date.now();

  /**
   * Pushes a freshly committed `(state, version)` to one `WorldRoom`, by room key
   * (`${partyId}:${mapId}`). Defaults to an inert no-op — see this class's docblock. Reassign in
   * production once `WorldRoom` exists; reassign in a test to capture calls.
   */
  pushToRoom: (roomKey: string, state: PartyAdventureState, version: number) => Promise<void> =
    async () => {};

  /**
   * Delivers one party-wide message (chat, victory) to one `WorldRoom`, by room key. Same seam
   * shape and default as `pushToRoom`; `broadcastToParty` below is the only caller.
   */
  sendToRoom: (roomKey: string, message: ServerMessage) => Promise<void> = async () => {};

  /**
   * Pushes one hero's freshly written personal quest progress to one `WorldRoom` (Task 7 — port of
   * legacy `GameSession.#pushPersonalQuestProgress`'s per-room RPC). The write is already
   * epoch-fenced in D1 before this best-effort UI push; the room applies it only to that hero's
   * live runtime. Same reassignable-seam shape as `pushToRoom`.
   */
  pushPersonalToRoom: (
    roomKey: string,
    heroId: string,
    progress: Readonly<Record<string, AuthoredQuestProgress>>,
  ) => Promise<void> = async () => {};

  /** Fan one hero's personal progress out to every registered room (legacy
   *  `#pushPersonalQuestProgress`); rejections are logged per room, never rethrown. */
  protected async pushPersonalProgress(
    partyId: string,
    state: PartyRoomState,
    heroId: string,
    progress: Readonly<Record<string, AuthoredQuestProgress>>,
  ): Promise<void> {
    const results = await Promise.allSettled(
      [...state.rooms].map((roomKey) => this.pushPersonalToRoom(roomKey, heroId, progress)),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(
          JSON.stringify({
            event: "personal_quest_progress_push_failed",
            partyId,
            heroId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          }),
        );
      }
    }
  }

  room = $room({
    channel: this.realtimeChannels.partyChannel,
    state: (): PartyRoomState => ({
      cached: null,
      partyCompleted: false,
      rooms: new Set(),
      writeQueue: Promise.resolve(),
      harvestReservations: new Map(),
      materialReservations: new Map(),
    }),
    methods: {
      getAdventureState: (room) => this.getAdventureState(room.roomId, room.state),
      applyStateChanges: (room, mutations: readonly StateMutation[]) =>
        this.applyStateChanges(room.roomId, room.state, mutations),
      markPermanentMonsterDefeated: (room, eventId: string) =>
        this.markPermanentMonsterDefeated(room.roomId, room.state, eventId),
      reserveHarvestNode: (room, request: unknown) =>
        this.reserveHarvestNode(room.roomId, room.state, request),
      hitHarvestNode: (room, request: unknown) =>
        this.hitHarvestNode(room.roomId, room.state, request),
      reconcileHarvestGoldClaims: (room) =>
        this.reconcileHarvestGoldClaims(room.roomId, room.state),
      cancelHarvestNode: (room, request: unknown) =>
        this.cancelHarvestNode(room.roomId, room.state, request),
      consumePartyMaterials: (room, costs: unknown) =>
        this.consumePartyMaterials(room.roomId, room.state, costs),
      reservePartyMaterials: (room, request: unknown) =>
        this.reservePartyMaterials(room.roomId, room.state, request),
      commitPartyMaterials: (room, request: unknown) =>
        this.commitPartyMaterials(room.roomId, room.state, request),
      releasePartyMaterials: (room, request: unknown) =>
        this.releasePartyMaterials(room.roomId, room.state, request),
      settlePartyMaterials: (room, request: unknown) =>
        this.settlePartyMaterials(room.roomId, room.state, request),
      reconcilePartyMaterialSpends: (room, request: unknown) =>
        this.reconcilePartyMaterialSpends(room.roomId, room.state, request),
      recordQuestEvent: (room, event: QuestBusinessEvent) =>
        this.recordQuestEvent(room.roomId, room.state, event),
      acceptAuthoredQuest: (
        room,
        actor: QuestActor,
        questId: string,
        target: QuestEventReference,
        inventory: Readonly<Record<string, number>>,
      ) => this.acceptAuthoredQuest(room.roomId, room.state, actor, questId, target, inventory),
      abandonAuthoredQuest: (room, actor: QuestActor, questId: string) =>
        this.abandonAuthoredQuest(room.roomId, room.state, actor, questId),
      completeAuthoredQuest: (
        room,
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
      ) =>
        this.completeAuthoredQuest(
          room.roomId,
          room.state,
          actor,
          questId,
          target,
          rewardChoiceId,
          heroState,
        ),
      broadcastToParty: (room, message: ServerMessage) =>
        this.broadcastToParty(room.state, message),
      hasConnectedPlayers: (room) => this.hasConnectedPlayers(room.state),
      registerRoom: (room, roomKey: string) => this.registerRoom(room.roomId, room.state, roomKey),
      roomEmptied: (room, roomKey: string) => this.roomEmptied(room.state, roomKey),
      markPartyCompleted: (room) => this.markPartyCompleted(room.state),
    },
  });

  /**
   * The coordinator's held snapshot + version + registry, for a `WorldRoom` re-derived from
   * hibernation, or for any other caller that just wants the current picture. Load-on-demand when
   * this room is itself fresh (`state.cached` null).
   */
  protected async getAdventureState(
    partyId: string,
    state: PartyRoomState,
  ): Promise<Omit<VersionedState, "supportSpends">> {
    const current = await this.ensureState(partyId, state);
    return { state: current.state, version: current.version, registry: current.registry };
  }

  /**
   * Resolve prepared gold claims against the durable node state. A matching depleted generation
   * (or any later generation, which proves the earlier one completed) settles exactly once;
   * preparation without a committed hit is safely removed. Called before respawn refreshes and as
   * an admission barrier after a new presence epoch is acquired.
   */
  protected async reconcileHarvestGoldClaims(
    partyId: string,
    state: PartyRoomState,
  ): Promise<void> {
    await this.enqueueStateWrite(state, async () => {
      await this.reconcileHarvestGoldClaimsFromDurableState(partyId, state);
    });
  }

  protected async reconcileHarvestGoldClaimsFromDurableState(
    partyId: string,
    state: PartyRoomState,
  ): Promise<void> {
    const pending = await this.adventureStateService.loadPendingHarvestGoldClaims(partyId);
    if (pending.length === 0) return;
    const durable = await this.adventureStateService.loadForHarvestGoldReconciliation(partyId);
    const recovered: VersionedState = {
      state: normalizeAuthoredQuestProgress(durable.registry, durable.state),
      version: durable.version,
      registry: durable.registry,
      supportSpends: durable.supportSpends,
    };
    state.partyCompleted = durable.partyCompleted;
    state.cached = recovered;
    pending.sort((left, right) => left.id.localeCompare(right.id));
    for (const claim of pending) {
      const node = durable.state.harvestNodes?.[claim.nodeId];
      const committed =
        node !== undefined &&
        (node.generation > claim.generation ||
          (node.generation === claim.generation && node.depleted));
      if (committed) {
        await this.adventureStateService.settleHarvestGoldClaim({
          claimId: claim.id,
          partyId,
          heroId: claim.recipientHeroId,
          nodeId: claim.nodeId,
          generation: claim.generation,
          amount: claim.amount,
        });
      } else if (node === undefined || (node.generation === claim.generation && !node.depleted)) {
        await this.adventureStateService.abortHarvestGoldClaim(claim.id);
      }
    }
    // Pending claims are rare and imply an interrupted/uncertain previous call. Republish the
    // strictly reloaded state after every successful reconciliation: an earlier durable write may
    // have lost its acknowledgement before its original fan-out.
    await this.pushStateToRooms(partyId, state, recovered);
  }

  /** Load the party's registry + state + version once, on first contact. Degrades to an empty
   *  registry/state rather than throwing (`AdventureStateService`'s own posture). */
  protected async ensureState(partyId: string, state: PartyRoomState): Promise<VersionedState> {
    if (state.cached === null) {
      const context = await this.adventureStateService.loadParty(partyId);
      const registry = context
        ? await this.adventureStateService.loadRegistry(context.adventureId)
        : EMPTY_REGISTRY;
      state.partyCompleted = context?.status === "completed";
      const loaded = await this.adventureStateService.loadCoordinatorState(partyId);
      state.cached = {
        state: normalizeAuthoredQuestProgress(registry, loaded.state),
        version: loaded.version,
        registry,
        supportSpends: loaded.supportSpends,
      };
    }
    return state.cached;
  }

  /** Serializes state/quest mutations for one party so two racing RPCs apply in order rather than
   *  one clobbering the other's read-modify-write — port of legacy's `#enqueueStateWrite`. */
  protected enqueueStateWrite<T>(state: PartyRoomState, work: () => Promise<T>): Promise<T> {
    const result = state.writeQueue.then(work);
    state.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Writes a new state through to D1 (bumping the version by one), THEN pushes the committed
   * `(state, version)` to every currently registered room. The D1 write happens first and
   * unconditionally; a `pushToRoom` rejection is caught and logged per room, never allowed to make
   * the caller believe the write itself was lost (it wasn't — see this class's docblock).
   */
  protected async commitState(
    partyId: string,
    state: PartyRoomState,
    nextState: PartyAdventureState,
  ): Promise<VersionedState> {
    const current = await this.ensureState(partyId, state);
    const next: VersionedState = {
      state: nextState,
      version: current.version + 1,
      registry: current.registry,
      supportSpends: current.supportSpends,
    };
    try {
      await this.adventureStateService.save(partyId, next.state, next.version);
    } catch (error) {
      // A rejected D1 call is ambiguous: the write may have committed and only its response may
      // have been lost. Force the next queued operation to reload durable truth before deciding.
      state.cached = null;
      throw error;
    }
    // Publish the cache only after the durable write. If D1 rejects, later queued work must still
    // see the last committed state rather than a phantom depletion or material spend.
    state.cached = next;
    await this.pushStateToRooms(partyId, state, next);
    return next;
  }

  /** Same public fan-out as `commitState`, with the private spend journal in the D1 statement. */
  protected async commitStateWithSupportSpends(
    partyId: string,
    state: PartyRoomState,
    nextState: PartyAdventureState,
    supportSpends: SupportSpendJournal,
  ): Promise<VersionedState> {
    const current = await this.ensureState(partyId, state);
    const next: VersionedState = {
      state: nextState,
      version: current.version + 1,
      registry: current.registry,
      supportSpends,
    };
    try {
      await this.adventureStateService.saveWithSupportSpends(
        partyId,
        next.state,
        next.version,
        next.supportSpends,
      );
    } catch (error) {
      state.cached = null;
      throw error;
    }
    state.cached = next;
    await this.pushStateToRooms(partyId, state, next);
    return next;
  }

  /** Best-effort fan-out of already-durable state; a transport failure never rolls D1 back. */
  protected async pushStateToRooms(
    partyId: string,
    state: PartyRoomState,
    next: VersionedState,
  ): Promise<void> {
    const results = await Promise.allSettled(
      [...state.rooms].map((roomKey) => this.pushToRoom(roomKey, next.state, next.version)),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(
          JSON.stringify({
            event: "party_adventure_state_push_failed",
            partyId,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          }),
        );
      }
    }
  }

  /**
   * The interpreter's mutation RPC (spec Decision 1, tranche 5): a `WorldRoom`'s event drain sends
   * the resulting switch/variable/self-switch writes UP here — the single writer. Applied serially
   * in order, bumping the monotone version ONCE for the batch, then written through to D1 and
   * pushed to every registered room.
   */
  protected async applyStateChanges(
    partyId: string,
    state: PartyRoomState,
    mutations: readonly StateMutation[],
  ): Promise<void> {
    if (mutations.length === 0) return;
    await this.enqueueStateWrite(state, async () => {
      const current = await this.ensureState(partyId, state);
      const accepted = mutations.filter((mutation) =>
        mutationBelongsToRegistry(current.registry, mutation),
      );
      if (accepted.length === 0) return;
      let next = current.state;
      for (const mutation of accepted) next = applyStateMutation(next, mutation);
      next = normalizeAuthoredQuestProgress(current.registry, next);
      await this.commitState(partyId, state, next);
    });
  }

  /**
   * Persist one authored encounter whose editor mode is `never`. The event id is server-derived
   * from the killed runtime monster; a browser cannot call this RPC.
   */
  protected async markPermanentMonsterDefeated(
    partyId: string,
    state: PartyRoomState,
    eventId: string,
  ): Promise<void> {
    if (!isUuid(eventId)) return;
    await this.enqueueStateWrite(state, async () => {
      const current = await this.ensureState(partyId, state);
      if (current.state.defeatedMonsters?.[eventId] === true) return;
      await this.commitState(partyId, state, {
        ...current.state,
        defeatedMonsters: { ...(current.state.defeatedMonsters ?? {}), [eventId]: true },
      });
    });
  }

  /**
   * Mint a short-lived, one-hit reservation for a server-validated harvest action. The caller is a
   * `WorldRoom`, never a browser; class/tool/range/line-of-sight checks stay at that gameplay
   * boundary. This coordinator owns only cross-room exclusion and durable party state.
   */
  protected async reserveHarvestNode(
    partyId: string,
    state: PartyRoomState,
    rawRequest: unknown,
  ): Promise<ReserveHarvestNodeResult> {
    return this.enqueueStateWrite(state, async () => {
      const request = parseReserveHarvestNodeRequest(rawRequest);
      if (!request) return { ok: false, reason: "invalid" };
      const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0) return { ok: false, reason: "invalid" };
      if (
        request.respawnAt !== null &&
        (request.respawnAt <= now || request.respawnAt - now > MAX_HARVEST_RESPAWN_DELAY_MS)
      ) {
        return { ok: false, reason: "invalid" };
      }
      await this.reconcileHarvestGoldClaimsFromDurableState(partyId, state);
      let current = await this.ensureState(partyId, state);
      if (state.partyCompleted) return { ok: false, reason: "party" };

      const refreshed = refreshHarvestNode(current.state.harvestNodes ?? {}, request.eventId, now);
      if (!refreshed) return { ok: false, reason: "invalid" };
      if (refreshed.changed) {
        current = await this.commitState(partyId, state, {
          ...current.state,
          harvestNodes: refreshed.nodes,
        });
      }
      if (refreshed.node.generation !== request.generation) {
        return { ok: false, reason: "generation" };
      }
      if (refreshed.node.depleted) return { ok: false, reason: "depleted" };

      const existing = state.harvestReservations.get(request.eventId);
      if (existing && existing.expiresAt > now) {
        if (
          existing.heroId === request.heroId &&
          existing.sessionEpoch === request.sessionEpoch &&
          existing.generation === request.generation &&
          existing.requiredHits === request.requiredHits &&
          existing.respawnDelayMs === request.respawnDelayMs &&
          existing.respawnAt === request.respawnAt &&
          existing.goldValue === request.goldValue &&
          sameMaterialAmounts(existing.reward, request.reward)
        ) {
          return {
            ok: true,
            reservationId: existing.id,
            node: { ...refreshed.node },
            materials: { ...(current.state.materials ?? EMPTY_PARTY_MATERIALS) },
          };
        }
        if (existing.heroId !== request.heroId || request.sessionEpoch <= existing.sessionEpoch) {
          return { ok: false, reason: "busy" };
        }
        // A newer lease for the same hero supersedes its old volatile token. The fresh epoch is
        // still checked by the prepared-claim INSERT before any gold depletion can commit.
        state.harvestReservations.delete(request.eventId);
      }
      if (existing) state.harvestReservations.delete(request.eventId);

      const expiresAt = now + HARVEST_RESERVATION_TTL_MS;
      if (!Number.isSafeInteger(expiresAt)) return { ok: false, reason: "invalid" };
      const reservation: HarvestReservation = {
        id: crypto.randomUUID(),
        ...request,
        expiresAt,
      };
      state.harvestReservations.set(request.eventId, reservation);
      return {
        ok: true,
        reservationId: reservation.id,
        node: { ...refreshed.node },
        materials: { ...(current.state.materials ?? EMPTY_PARTY_MATERIALS) },
      };
    });
  }

  /**
   * Consume one reservation and commit the hit. A reservation is one-shot, so concurrent/replayed
   * calls cannot count the same hit twice; depletion and reward land in the same state version.
   */
  protected async hitHarvestNode(
    partyId: string,
    state: PartyRoomState,
    rawRequest: unknown,
  ): Promise<HitHarvestNodeResult> {
    return this.enqueueStateWrite(state, async () => {
      const request = parseHitHarvestNodeRequest(rawRequest);
      if (!request) return { ok: false, reason: "invalid" };
      const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0) return { ok: false, reason: "invalid" };
      await this.reconcileHarvestGoldClaimsFromDurableState(partyId, state);
      let current = await this.ensureState(partyId, state);
      current = await this.refreshMaterialReservations(partyId, state, current, now);
      if (state.partyCompleted) return { ok: false, reason: "party" };
      const reservation = state.harvestReservations.get(request.eventId);
      if (
        !reservation ||
        reservation.id !== request.reservationId ||
        reservation.heroId !== request.heroId ||
        reservation.expiresAt <= now
      ) {
        if (reservation?.expiresAt !== undefined && reservation.expiresAt <= now) {
          state.harvestReservations.delete(request.eventId);
        }
        return { ok: false, reason: "reservation" };
      }
      // Delete before the awaited write: every subsequent call queues behind this transition and
      // sees the token as spent even while D1 is being written.
      state.harvestReservations.delete(request.eventId);

      if (reservation.respawnAt !== null && reservation.respawnAt <= now) {
        return { ok: false, reason: "reservation" };
      }
      const respawnDelayMs =
        reservation.respawnAt === null ? reservation.respawnDelayMs : reservation.respawnAt - now;

      const result = applyHarvestHit(
        current.state.materials ?? EMPTY_PARTY_MATERIALS,
        current.state.harvestNodes ?? {},
        {
          eventId: reservation.eventId,
          generation: reservation.generation,
          requiredHits: reservation.requiredHits,
          reward: reservation.reward,
          respawnDelayMs,
          now,
        },
      );
      if (!result.ok) return result;
      // A committed support saga remains refundable until its WorldRoom has synchronously created
      // the action. Keep that tiny compensation capacity free so a disconnect refund cannot ever
      // overflow after a concurrent harvest reward.
      if (
        addPartyMaterials(result.materials, committedSupportSpendTotals(current.supportSpends)) ===
        null
      )
        return { ok: false, reason: "overflow" };
      const goldClaim =
        result.rewarded && reservation.goldValue > 0
          ? await this.adventureStateService.prepareHarvestGoldClaim({
              partyId,
              heroId: reservation.heroId,
              sessionEpoch: reservation.sessionEpoch,
              nodeId: reservation.eventId,
              generation: reservation.generation,
              amount: reservation.goldValue,
            })
          : null;
      if (result.rewarded && reservation.goldValue > 0 && !goldClaim) {
        return { ok: false, reason: "fence" };
      }
      if (goldClaim && goldClaim.ledgerStatus !== "prepared") {
        // A settled claim paired with a still-live generation is inconsistent durable state. Never
        // deplete it again merely because the unique idempotency row could be replayed.
        return { ok: false, reason: "fence" };
      }
      // Do not abort the preparation if this throws: a D1 write can commit and still lose its
      // acknowledgement. commitState invalidates the cache; strict reconciliation will reload the
      // node and either settle the durable depletion or abort a hit that truly did not land.
      await this.commitState(partyId, state, {
        ...current.state,
        materials: result.materials,
        harvestNodes: result.nodes,
      });
      const goldSettled = goldClaim
        ? await this.adventureStateService.settleHarvestGoldClaim({
            claimId: goldClaim.id,
            partyId,
            heroId: goldClaim.recipientHeroId,
            nodeId: goldClaim.nodeId,
            generation: goldClaim.generation,
            amount: goldClaim.amount,
          })
        : false;
      return {
        ok: true,
        node: { ...result.node },
        materials: { ...result.materials },
        rewarded: result.rewarded,
        reward: result.rewarded ? { ...reservation.reward } : {},
        goldValue: result.rewarded && goldSettled ? reservation.goldValue : 0,
        ...(result.rewarded && reservation.goldValue > 0 && !goldSettled
          ? { goldPending: true }
          : {}),
      };
    });
  }

  /** Release an unspent one-hit token after a server-side channel is cancelled. */
  protected async cancelHarvestNode(
    partyId: string,
    state: PartyRoomState,
    rawRequest: unknown,
  ): Promise<boolean> {
    return this.enqueueStateWrite(state, async () => {
      const request = parseHitHarvestNodeRequest(rawRequest);
      if (!request || state.partyCompleted || partyId.length === 0) return false;
      const reservation = state.harvestReservations.get(request.eventId);
      if (
        !reservation ||
        reservation.id !== request.reservationId ||
        reservation.heroId !== request.heroId
      ) {
        return false;
      }
      state.harvestReservations.delete(request.eventId);
      return true;
    });
  }

  /**
   * Expired volatile holds become durable `released` tombstones. Committed entries are never
   * inferred settled/refunded from time; only an owning WorldRoom reconciliation may decide them.
   */
  protected async refreshMaterialReservations(
    partyId: string,
    state: PartyRoomState,
    initial: VersionedState,
    now: number,
  ): Promise<VersionedState> {
    let current = initial;
    let journal = current.supportSpends;
    let journalChanged = false;
    for (const [id, reservation] of state.materialReservations) {
      if (reservation.expiresAt > now) continue;
      if (reservation.status === "held") {
        const existing = journal[id];
        if (existing && !sameSupportSpend(existing, reservation)) {
          throw new Error("support-spend reservation identity changed");
        }
        if (!existing) {
          const pruned = pruneSupportSpendOutcomes(journal, now, 1);
          if (!pruned) throw new Error("support-spend journal capacity exhausted");
          journal = {
            ...pruned,
            [id]: {
              heroId: reservation.heroId,
              roomKey: reservation.roomKey,
              costs: reservation.costs,
              status: "released",
              createdAt: now,
              resolvedAt: now,
            },
          };
          journalChanged = true;
        }
        reservation.status = existing?.status ?? "released";
        reservation.expiresAt = now + SUPPORT_SPEND_OUTCOME_TTL_MS;
        continue;
      }
      // Durable committed entries remain unresolved. Volatile mirrors/outcomes may be discarded.
      state.materialReservations.delete(id);
    }
    if (journalChanged) {
      current = await this.commitStateWithSupportSpends(partyId, state, current.state, journal);
    }
    return current;
  }

  /** Volatile hold: excludes stock from every competing spend without writing D1 yet. */
  protected async reservePartyMaterials(
    partyId: string,
    state: PartyRoomState,
    rawRequest: unknown,
  ): Promise<PartyMaterialReservationResult> {
    return this.enqueueStateWrite(state, async () => {
      const request = parsePartyMaterialReservationRequest(rawRequest);
      if (!request || !supportSpendRoomBelongsToParty(request.roomKey, partyId))
        return { ok: false, reason: "invalid" };
      const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0) return { ok: false, reason: "invalid" };
      let current = await this.ensureState(partyId, state);
      current = await this.refreshMaterialReservations(partyId, state, current, now);
      if (state.partyCompleted) return { ok: false, reason: "party" };

      const durable = current.supportSpends[request.reservationId];
      if (durable) {
        if (!sameSupportSpend(durable, request)) return { ok: false, reason: "reservation" };
        return journalReservationResult(
          request.reservationId,
          durable,
          current.state.materials ?? EMPTY_PARTY_MATERIALS,
        );
      }
      const existing = state.materialReservations.get(request.reservationId);
      if (existing) {
        if (
          existing.heroId !== request.heroId ||
          existing.roomKey !== request.roomKey ||
          !sameMaterialAmounts(existing.costs, request.costs)
        )
          return { ok: false, reason: "reservation" };
        return reservationResult(existing, current.state.materials ?? EMPTY_PARTY_MATERIALS);
      }
      if (state.materialReservations.size >= MAX_MATERIAL_RESERVATIONS)
        return { ok: false, reason: "reservation" };
      const heldCount = [...state.materialReservations.values()].filter(
        (reservation) => reservation.status === "held",
      ).length;
      if (!pruneSupportSpendOutcomes(current.supportSpends, now, heldCount + 1))
        return { ok: false, reason: "reservation" };
      const available = availablePartyMaterials(
        current.state.materials ?? EMPTY_PARTY_MATERIALS,
        state.materialReservations.values(),
      );
      if (!available || !spendPartyMaterials(available, request.costs))
        return {
          ok: false,
          reason: "insufficient",
          materials: { ...(available ?? EMPTY_PARTY_MATERIALS) },
        };
      const reservation: PartyMaterialReservation = {
        ...request,
        status: "held",
        expiresAt: now + MATERIAL_RESERVATION_TTL_MS,
      };
      state.materialReservations.set(request.reservationId, reservation);
      return reservationResult(reservation, current.state.materials ?? EMPTY_PARTY_MATERIALS);
    });
  }

  /** Persist the held spend. The record remains refundable until the WorldRoom settles it. */
  protected async commitPartyMaterials(
    partyId: string,
    state: PartyRoomState,
    rawIdentity: unknown,
  ): Promise<PartyMaterialReservationResult> {
    return this.enqueueStateWrite(state, async () => {
      const identity = parsePartyMaterialReservationIdentity(rawIdentity);
      if (!identity || !supportSpendRoomBelongsToParty(identity.roomKey, partyId))
        return { ok: false, reason: "invalid" };
      const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0) return { ok: false, reason: "invalid" };
      let current = await this.ensureState(partyId, state);
      current = await this.refreshMaterialReservations(partyId, state, current, now);
      if (state.partyCompleted) return { ok: false, reason: "party" };
      const durable = current.supportSpends[identity.reservationId];
      if (durable) {
        if (!sameSupportSpend(durable, identity)) return { ok: false, reason: "reservation" };
        return journalReservationResult(
          identity.reservationId,
          durable,
          current.state.materials ?? EMPTY_PARTY_MATERIALS,
        );
      }
      const reservation = state.materialReservations.get(identity.reservationId);
      if (
        !reservation ||
        reservation.heroId !== identity.heroId ||
        reservation.roomKey !== identity.roomKey ||
        !sameMaterialAmounts(reservation.costs, identity.costs)
      )
        return { ok: false, reason: "reservation" };
      if (reservation.status !== "held")
        return reservationResult(reservation, current.state.materials ?? EMPTY_PARTY_MATERIALS);
      const materials = spendPartyMaterials(
        current.state.materials ?? EMPTY_PARTY_MATERIALS,
        reservation.costs,
      );
      if (!materials)
        return {
          ok: false,
          reason: "insufficient",
          materials: { ...(current.state.materials ?? EMPTY_PARTY_MATERIALS) },
        };
      const heldCount = [...state.materialReservations.values()].filter(
        (candidate) =>
          candidate.status === "held" && candidate.reservationId !== identity.reservationId,
      ).length;
      const journal = pruneSupportSpendOutcomes(current.supportSpends, now, heldCount + 1);
      if (!journal) return { ok: false, reason: "reservation" };
      const supportSpends: SupportSpendJournal = {
        ...journal,
        [identity.reservationId]: {
          heroId: identity.heroId,
          roomKey: identity.roomKey,
          costs: identity.costs,
          status: "committed",
          createdAt: now,
          resolvedAt: null,
        },
      };
      current = await this.commitStateWithSupportSpends(
        partyId,
        state,
        { ...current.state, materials },
        supportSpends,
      );
      reservation.status = "committed";
      reservation.expiresAt = now + SUPPORT_SPEND_OUTCOME_TTL_MS;
      return reservationResult(reservation, materials);
    });
  }

  /** Idempotent abort: releases a hold or refunds a committed spend through the same write queue. */
  protected async releasePartyMaterials(
    partyId: string,
    state: PartyRoomState,
    rawIdentity: unknown,
  ): Promise<PartyMaterialReservationResult> {
    return this.enqueueStateWrite(state, async () => {
      const identity = parsePartyMaterialReservationIdentity(rawIdentity);
      if (!identity || !supportSpendRoomBelongsToParty(identity.roomKey, partyId))
        return { ok: false, reason: "invalid" };
      const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0) return { ok: false, reason: "invalid" };
      let current = await this.ensureState(partyId, state);
      current = await this.refreshMaterialReservations(partyId, state, current, now);
      const durable = current.supportSpends[identity.reservationId];
      if (durable && !sameSupportSpend(durable, identity))
        return { ok: false, reason: "reservation" };
      if (durable?.status === "committed") {
        const materials = addPartyMaterials(
          current.state.materials ?? EMPTY_PARTY_MATERIALS,
          durable.costs,
        );
        if (!materials) throw new Error("committed material reservation could not be refunded");
        const supportSpends: SupportSpendJournal = {
          ...current.supportSpends,
          [identity.reservationId]: {
            ...durable,
            status: "refunded",
            resolvedAt: Math.max(now, durable.createdAt),
          },
        };
        current = await this.commitStateWithSupportSpends(
          partyId,
          state,
          { ...current.state, materials },
          supportSpends,
        );
      } else if (durable) {
        return journalReservationResult(
          identity.reservationId,
          durable,
          current.state.materials ?? EMPTY_PARTY_MATERIALS,
        );
      } else {
        const reservation = state.materialReservations.get(identity.reservationId);
        if (reservation && !sameSupportSpend(reservation, identity))
          return { ok: false, reason: "reservation" };
        const heldCount = [...state.materialReservations.values()].filter(
          (candidate) =>
            candidate.status === "held" && candidate.reservationId !== identity.reservationId,
        ).length;
        const journal = pruneSupportSpendOutcomes(current.supportSpends, now, heldCount + 1);
        if (!journal) return { ok: false, reason: "reservation" };
        const released: SupportSpendEntry = {
          heroId: identity.heroId,
          roomKey: identity.roomKey,
          costs: identity.costs,
          status: "released",
          createdAt: now,
          resolvedAt: now,
        };
        current = await this.commitStateWithSupportSpends(partyId, state, current.state, {
          ...journal,
          [identity.reservationId]: released,
        });
      }
      const entry = current.supportSpends[identity.reservationId];
      if (!entry) throw new Error("support-spend release was not persisted");
      const volatile = state.materialReservations.get(identity.reservationId);
      if (volatile) {
        volatile.status = entry.status;
        volatile.expiresAt = now + SUPPORT_SPEND_OUTCOME_TTL_MS;
      }
      return journalReservationResult(
        identity.reservationId,
        entry,
        current.state.materials ?? EMPTY_PARTY_MATERIALS,
      );
    });
  }

  /** Once the action exists synchronously in its WorldRoom, the spend is no longer compensable. */
  protected async settlePartyMaterials(
    partyId: string,
    state: PartyRoomState,
    rawIdentity: unknown,
  ): Promise<PartyMaterialReservationResult> {
    return this.enqueueStateWrite(state, async () => {
      const identity = parsePartyMaterialReservationIdentity(rawIdentity);
      if (!identity || !supportSpendRoomBelongsToParty(identity.roomKey, partyId))
        return { ok: false, reason: "invalid" };
      const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0) return { ok: false, reason: "invalid" };
      let current = await this.ensureState(partyId, state);
      current = await this.refreshMaterialReservations(partyId, state, current, now);
      const durable = current.supportSpends[identity.reservationId];
      if (!durable || !sameSupportSpend(durable, identity))
        return { ok: false, reason: "reservation" };
      if (durable.status === "committed") {
        current = await this.commitStateWithSupportSpends(partyId, state, current.state, {
          ...current.supportSpends,
          [identity.reservationId]: {
            ...durable,
            status: "settled",
            resolvedAt: Math.max(now, durable.createdAt),
          },
        });
      }
      const entry = current.supportSpends[identity.reservationId];
      if (!entry) throw new Error("support-spend settlement was not persisted");
      const volatile = state.materialReservations.get(identity.reservationId);
      if (volatile) {
        volatile.status = entry.status;
        volatile.expiresAt = now + SUPPORT_SPEND_OUTCOME_TTL_MS;
      }
      return journalReservationResult(
        identity.reservationId,
        entry,
        current.state.materials ?? EMPTY_PARTY_MATERIALS,
      );
    });
  }

  /**
   * Resolve only one WorldRoom's uncertain commits. Its local activated-id set is authoritative for
   * that room's still-live actions; entries belonging to another room are deliberately untouched.
   */
  protected async reconcilePartyMaterialSpends(
    partyId: string,
    state: PartyRoomState,
    rawRequest: unknown,
  ): Promise<ReconcilePartyMaterialSpendsResult> {
    return this.enqueueStateWrite(state, async () => {
      const request = parseReconcilePartyMaterialSpendsRequest(rawRequest);
      if (!request || !supportSpendRoomBelongsToParty(request.roomKey, partyId))
        return { ok: false, reason: "invalid" };
      const now = this.now();
      if (!Number.isSafeInteger(now) || now < 0) return { ok: false, reason: "invalid" };
      let current = await this.ensureState(partyId, state);
      current = await this.refreshMaterialReservations(partyId, state, current, now);
      if (state.partyCompleted) return { ok: false, reason: "party" };
      const activated = new Set(request.activatedIds);
      let materials = current.state.materials ?? EMPTY_PARTY_MATERIALS;
      let supportSpends = current.supportSpends;
      let changed = false;
      for (const [reservationId, entry] of Object.entries(current.supportSpends)) {
        if (entry.roomKey !== request.roomKey || entry.status !== "committed") continue;
        if (activated.has(reservationId)) {
          supportSpends = {
            ...supportSpends,
            [reservationId]: {
              ...entry,
              status: "settled",
              resolvedAt: Math.max(now, entry.createdAt),
            },
          };
        } else {
          const refunded = addPartyMaterials(materials, entry.costs);
          if (!refunded) return { ok: false, reason: "overflow" };
          materials = refunded;
          supportSpends = {
            ...supportSpends,
            [reservationId]: {
              ...entry,
              status: "refunded",
              resolvedAt: Math.max(now, entry.createdAt),
            },
          };
        }
        changed = true;
      }
      if (changed) {
        current = await this.commitStateWithSupportSpends(
          partyId,
          state,
          { ...current.state, materials },
          supportSpends,
        );
      }
      for (const [id, reservation] of state.materialReservations) {
        const entry = current.supportSpends[id];
        if (entry?.roomKey === request.roomKey && entry.status !== "committed") {
          reservation.status = entry.status;
          reservation.expiresAt = now + SUPPORT_SPEND_OUTCOME_TTL_MS;
        }
      }
      return {
        ok: true,
        materials: { ...(current.state.materials ?? EMPTY_PARTY_MATERIALS) },
        acknowledgedIds: request.activatedIds,
      };
    });
  }

  /** All-or-nothing material spending for future party support actions/constructions. */
  protected async consumePartyMaterials(
    partyId: string,
    state: PartyRoomState,
    rawCosts: unknown,
  ): Promise<ConsumePartyMaterialsResult> {
    return this.enqueueStateWrite(state, async () => {
      const costs = parsePartyMaterialAmounts(rawCosts);
      if (!costs || !hasPartyMaterialAmount(costs)) return { ok: false, reason: "invalid" };
      const now = this.now();
      let current = await this.ensureState(partyId, state);
      current = await this.refreshMaterialReservations(partyId, state, current, now);
      if (state.partyCompleted) return { ok: false, reason: "party" };
      const available = availablePartyMaterials(
        current.state.materials ?? EMPTY_PARTY_MATERIALS,
        state.materialReservations.values(),
      );
      if (!available || !spendPartyMaterials(available, costs))
        return { ok: false, reason: "insufficient" };
      const materials = spendPartyMaterials(
        current.state.materials ?? EMPTY_PARTY_MATERIALS,
        costs,
      );
      if (!materials) return { ok: false, reason: "insufficient" };
      await this.commitState(partyId, state, { ...current.state, materials });
      return { ok: true, materials: { ...materials } };
    });
  }

  /** Narrows a progress record down to the definitions actually pinned in it, for the given scope
   *  — port of legacy `GameSession`'s `#pinnedIndex`. */
  protected pinnedIndex(
    progress: Readonly<Record<string, AuthoredQuestProgress>> | undefined,
    scope: "party" | "personal",
  ): QuestObjectiveIndex {
    const definitions = new Map<string, AuthoredQuestDefinition>();
    for (const item of Object.values(progress ?? {})) {
      const definition = item.definitionSnapshot;
      if (definition?.scope === scope) definitions.set(definition.id, definition);
    }
    return buildQuestObjectiveIndex([...definitions.values()]);
  }

  /**
   * Consume one server-minted gameplay fact (a `WorldRoom`'s tick is the only caller; a browser
   * message cannot reach this RPC). Party progress commits through the normal write-through path;
   * each personal transition is written immediately behind the hero's session-epoch fence. Quest
   * indices are rebuilt per call rather than cached across calls (unlike legacy's per-instance
   * cache) — this method fires on business events, not every tick, so the extra index build is not
   * a hot-path cost, and it keeps this room's state shape simple.
   */
  protected async recordQuestEvent(
    partyId: string,
    state: PartyRoomState,
    event: QuestBusinessEvent,
  ): Promise<readonly AuthoredQuestChange[]> {
    return this.enqueueStateWrite(state, async () => {
      const current = await this.ensureState(partyId, state);
      if (state.partyCompleted) return [];
      const currentIndex = buildQuestObjectiveIndex(current.registry.quests ?? []);
      const partyPinnedIndex = this.pinnedIndex(current.state.quests, "party");
      const personalPinnedIndexes = new Map<string, QuestObjectiveIndex>();
      const definitionIndexes = new Map<AuthoredQuestDefinition, QuestObjectiveIndex>();
      const result = await processAuthoredQuestEvent({
        registry: current.registry,
        partyState: current.state,
        currentIndex,
        partyPinnedIndex,
        event,
        indexForDefinition: (definition) => {
          const cached = definitionIndexes.get(definition);
          if (cached) return cached;
          const index = buildQuestObjectiveIndex([definition]);
          definitionIndexes.set(definition, index);
          return index;
        },
        loadPersonal: async (actor) => {
          const loaded = await this.adventureStateService.loadPersonalQuestProgress(actor.heroId);
          personalPinnedIndexes.set(actor.heroId, this.pinnedIndex(loaded, "personal"));
          return loaded;
        },
        personalPinnedIndex: (actor) =>
          personalPinnedIndexes.get(actor.heroId) ?? buildQuestObjectiveIndex([]),
        savePersonal: async (actor, questId, progress) => {
          try {
            const saved = await this.adventureStateService.savePersonalQuestProgress({
              heroId: actor.heroId,
              sessionEpoch: actor.sessionEpoch,
              questId,
              progress,
            });
            if (saved) {
              const pushed = await this.adventureStateService.loadPersonalQuestProgress(
                actor.heroId,
              );
              await this.pushPersonalProgress(partyId, state, actor.heroId, pushed);
            }
            return saved;
          } catch (error) {
            // One failed hero write must not hide another hero's successful transition. The failed
            // row simply remains eligible next event.
            console.error(
              JSON.stringify({
                event: "personal_quest_progress_save_failed",
                partyId,
                heroId: actor.heroId,
                questId,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
            return false;
          }
        },
      });
      if (result.partyChanged) {
        await this.commitState(partyId, state, result.partyState);
      }
      return result.changes;
    });
  }

  /** Accept a standard giver offer after re-validating every fact behind the client button. */
  protected async acceptAuthoredQuest(
    partyId: string,
    state: PartyRoomState,
    actor: QuestActor,
    questId: string,
    target: QuestEventReference,
    inventory: Readonly<Record<string, number>>,
  ): Promise<QuestAcceptanceResult> {
    return this.enqueueStateWrite(state, async () => {
      const current = await this.ensureState(partyId, state);
      if (state.partyCompleted) return { ok: false, reason: "party" };
      const definition = (current.registry.quests ?? []).find((quest) => quest.id === questId);
      if (definition?.acceptance !== "manual") return { ok: false, reason: "quest" };
      if (!sameEventReference(definition.giver, target)) return { ok: false, reason: "target" };
      const personal = await this.adventureStateService.loadPersonalQuestProgress(actor.heroId);
      const progress =
        definition.scope === "party" ? current.state.quests?.[questId] : personal[questId];
      const completed = new Set([
        ...completedQuestIds(current.state.quests),
        ...completedQuestIds(personal),
      ]);
      const prerequisiteContext = {
        level: actor.level,
        completedQuestIds: completed,
        adventureState: current.state,
      };
      if (authoredQuestRuntimeState(definition, progress, prerequisiteContext) !== "available") {
        return { ok: false, reason: "state" };
      }
      if (!questPrerequisitesHold(definition, prerequisiteContext)) {
        return { ok: false, reason: "prerequisite" };
      }
      const accepted = createAuthoredQuestProgressForAcceptance(
        definition,
        inventory,
        progress?.completionCount ?? 0,
      );
      if (definition.scope === "party") {
        const quests = { ...(current.state.quests ?? {}), [questId]: accepted };
        await this.commitState(partyId, state, { ...current.state, quests });
      } else {
        const saved = await this.adventureStateService.savePersonalQuestProgress({
          heroId: actor.heroId,
          sessionEpoch: actor.sessionEpoch,
          questId,
          progress: accepted,
        });
        if (!saved) return { ok: false, reason: "fence" };
        await this.pushPersonalProgress(partyId, state, actor.heroId, {
          ...personal,
          [questId]: accepted,
        });
      }
      return { ok: true, progress: accepted };
    });
  }

  /** Abandon an active attempt from the journal; ownership and the pinned rule stay authoritative. */
  protected async abandonAuthoredQuest(
    partyId: string,
    state: PartyRoomState,
    actor: QuestActor,
    questId: string,
  ): Promise<QuestAbandonResult> {
    return this.enqueueStateWrite(state, async () => {
      const current = await this.ensureState(partyId, state);
      if (state.partyCompleted) return { ok: false, reason: "party" };
      const personal = await this.adventureStateService.loadPersonalQuestProgress(actor.heroId);
      const partyProgress = current.state.quests?.[questId];
      const personalProgress = personal[questId];
      const progress = partyProgress ?? personalProgress;
      const definition =
        progress?.definitionSnapshot ??
        (current.registry.quests ?? []).find((quest) => quest.id === questId);
      if (!definition || !progress) return { ok: false, reason: "quest" };
      if (!definition.abandonable) return { ok: false, reason: "forbidden" };
      if ((progress.status !== "active" && progress.status !== "ready") || progress.rewardClaimed) {
        return { ok: false, reason: "state" };
      }
      const abandoned: AuthoredQuestProgress = { ...progress, status: "abandoned" };
      if (definition.scope === "party") {
        if (!partyProgress) return { ok: false, reason: "quest" };
        const quests = { ...(current.state.quests ?? {}), [questId]: abandoned };
        await this.commitState(partyId, state, { ...current.state, quests });
      } else {
        if (!personalProgress) return { ok: false, reason: "quest" };
        const saved = await this.adventureStateService.savePersonalQuestProgress({
          heroId: actor.heroId,
          sessionEpoch: actor.sessionEpoch,
          questId,
          progress: abandoned,
        });
        if (!saved) return { ok: false, reason: "fence" };
        await this.pushPersonalProgress(partyId, state, actor.heroId, {
          ...personal,
          [questId]: abandoned,
        });
      }
      return { ok: true, progress: abandoned };
    });
  }

  /** Atomically consume deliveries, complete progress and grant one authored reward attempt. */
  protected async completeAuthoredQuest(
    partyId: string,
    state: PartyRoomState,
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
  ): Promise<QuestTurnInResult> {
    return this.enqueueStateWrite(state, async () => {
      const current = await this.ensureState(partyId, state);
      if (state.partyCompleted) return { ok: false, reason: "party" };
      const personal = await this.adventureStateService.loadPersonalQuestProgress(actor.heroId);
      const partyProgress = current.state.quests?.[questId];
      const personalProgress = personal[questId];
      const progress = partyProgress ?? personalProgress;
      const definition =
        progress?.definitionSnapshot ??
        (current.registry.quests ?? []).find((quest) => quest.id === questId);
      if (!definition || !progress) return { ok: false, reason: "quest" };
      if (
        definition.completion === "turn-in" &&
        (target === null || !sameEventReference(definition.turnInTarget, target))
      ) {
        return { ok: false, reason: "target" };
      }
      if (
        (definition.completion === "turn-in"
          ? progress.status !== "ready"
          : progress.status !== "completed") ||
        progress.rewardClaimed
      ) {
        return { ok: false, reason: "state" };
      }
      const choice =
        rewardChoiceId === undefined
          ? undefined
          : definition.rewards.choices.find((candidate) => candidate.id === rewardChoiceId);
      if (
        (definition.rewards.choices.length > 0 && !choice) ||
        (definition.rewards.choices.length === 0 && rewardChoiceId !== undefined)
      ) {
        return { ok: false, reason: "choice" };
      }
      const aggregateItems = (
        items: readonly { itemId: string; quantity: number }[],
      ): { itemId: string; quantity: number }[] => {
        const quantities = new Map<string, number>();
        for (const item of items) {
          quantities.set(item.itemId, (quantities.get(item.itemId) ?? 0) + item.quantity);
        }
        return [...quantities].map(([itemId, quantity]) => ({ itemId, quantity }));
      };
      const items = aggregateItems([...definition.rewards.items, ...(choice?.items ?? [])]);
      const consumed = aggregateItems(
        definition.objectives.flatMap((objective) =>
          objective.type === "deliver" && objective.consume
            ? [{ itemId: objective.itemId, quantity: objective.target }]
            : [],
        ),
      );
      if (
        [...items, ...consumed].some(
          (item) => !(CONSUMABLE_IDS as readonly string[]).includes(item.itemId),
        )
      ) {
        return { ok: false, reason: "items" };
      }
      const consumedById = new Map(consumed.map((item) => [item.itemId, item.quantity]));
      const rewardsById = new Map(items.map((item) => [item.itemId, item.quantity]));
      for (const itemId of new Set([...consumedById.keys(), ...rewardsById.keys()])) {
        const currentQuantity = heroState.inventory[itemId] ?? 0;
        if (currentQuantity < (consumedById.get(itemId) ?? 0)) {
          return { ok: false, reason: "inventory" };
        }
        const resulting =
          currentQuantity - (consumedById.get(itemId) ?? 0) + (rewardsById.get(itemId) ?? 0);
        if (resulting > CONSUMABLE_MAX_STACK) return { ok: false, reason: "inventory" };
      }
      const experience = definition.rewards.experience + (choice?.experience ?? 0);
      const gold = definition.rewards.gold + (choice?.gold ?? 0);
      const xp = applyExperience(heroState.level, heroState.xp, experience);
      const completed: AuthoredQuestProgress = {
        ...progress,
        status: "completed",
        rewardClaimed: true,
        completionCount:
          definition.completion === "automatic"
            ? Math.max(1, progress.completionCount)
            : progress.completionCount + 1,
      };
      let nextPartyState = current.state;
      let nextPersonal = personal[questId];
      if (definition.scope === "party") {
        nextPartyState = {
          ...nextPartyState,
          quests: { ...(nextPartyState.quests ?? {}), [questId]: completed },
        };
      } else {
        nextPersonal = completed;
      }
      for (const change of definition.rewards.stateChanges) {
        nextPartyState = applyStateMutation(
          nextPartyState,
          change.type === "switch"
            ? { type: "setSwitch", switchId: change.switchId, value: change.value }
            : {
                type: "setVariable",
                variableId: change.variableId,
                op: change.op,
                value: change.value,
              },
        );
      }
      let nextChainedQuest: { questId: string; progress: AuthoredQuestProgress } | undefined;
      const nextDefinition = definition.rewards.nextQuestId
        ? (current.registry.quests ?? []).find(
            (candidate) => candidate.id === definition.rewards.nextQuestId,
          )
        : undefined;
      if (
        nextDefinition?.acceptance === "automatic" &&
        nextDefinition.scope === "party" &&
        !nextPartyState.quests?.[nextDefinition.id]
      ) {
        nextPartyState = {
          ...nextPartyState,
          quests: {
            ...(nextPartyState.quests ?? {}),
            [nextDefinition.id]: createAuthoredQuestProgress(nextDefinition),
          },
        };
      } else if (
        nextDefinition?.acceptance === "automatic" &&
        nextDefinition.scope === "personal" &&
        !personal[nextDefinition.id]
      ) {
        nextChainedQuest = {
          questId: nextDefinition.id,
          progress: createAuthoredQuestProgress(nextDefinition),
        };
      }
      const claimed = await this.adventureStateService.claimQuestReward({
        ownerKind: definition.scope,
        ownerId: definition.scope === "party" ? partyId : actor.heroId,
        heroId: actor.heroId,
        sessionEpoch: actor.sessionEpoch,
        questId,
        attempt: completed.completionCount,
        resultingLevel: xp.level,
        resultingXp: xp.xp,
        resultingHp: maxHpForLevel(xp.level),
        gold,
        items,
        consumeItems: consumed,
      });
      if (!claimed) return { ok: false, reason: "fence" };
      const partyChanged = nextPartyState !== current.state;
      if (partyChanged) await this.commitState(partyId, state, nextPartyState);
      const pushedPersonal: Record<string, AuthoredQuestProgress> = { ...personal };
      let personalChanged = false;
      if (definition.scope === "personal" && nextPersonal) {
        await this.adventureStateService.savePersonalQuestProgress({
          heroId: actor.heroId,
          sessionEpoch: actor.sessionEpoch,
          questId,
          progress: nextPersonal,
        });
        pushedPersonal[questId] = nextPersonal;
        personalChanged = true;
      }
      if (nextChainedQuest) {
        await this.adventureStateService.savePersonalQuestProgress({
          heroId: actor.heroId,
          sessionEpoch: actor.sessionEpoch,
          questId: nextChainedQuest.questId,
          progress: nextChainedQuest.progress,
        });
        pushedPersonal[nextChainedQuest.questId] = nextChainedQuest.progress;
        personalChanged = true;
      }
      if (personalChanged) {
        await this.pushPersonalProgress(partyId, state, actor.heroId, pushedPersonal);
      }
      return {
        ok: true,
        experience,
        gold,
        items,
        consumed,
        customCommands: definition.rewards.customCommands,
      };
    });
  }

  /** Close quest progression as soon as the authoritative open -> completed fence succeeds
   *  (`PartyController`/whichever service flips `party.status`) is the real trigger; this just
   *  latches this room's own in-memory copy so `recordQuestEvent`/the accept-abandon-complete RPCs
   *  stop touching a finished party's progress. */
  protected async markPartyCompleted(state: PartyRoomState): Promise<void> {
    await this.enqueueStateWrite(state, async () => {
      state.partyCompleted = true;
    });
  }

  /** Party chat and victory use this path; no browser message can call it directly. Fans out only
   *  to rooms currently in the directory — never all of `state.rooms`' history beyond that, since
   *  `roomEmptied` removes an entry the instant its `WorldRoom` drains. */
  protected async broadcastToParty(state: PartyRoomState, message: ServerMessage): Promise<void> {
    await Promise.all([...state.rooms].map((roomKey) => this.sendToRoom(roomKey, message)));
  }

  /** Live party-list hint. A registered WorldRoom always contains at least one connected hero;
   *  `roomEmptied` removes it as soon as its final socket leaves. The coordinator directory is
   *  volatile and self-heals on the 10s presence beat, so this is deliberately a hint, never an
   *  admission or persistence decision. */
  protected hasConnectedPlayers(state: PartyRoomState): boolean {
    return state.rooms.size > 0;
  }

  /** Registers one `WorldRoom` in this party's directory and returns the latest committed public
   *  snapshot. Registration is serialized with state writes: a write already in flight completes
   *  before this reply, while a later write sees the room in the directory and pushes to it. That
   *  closes the otherwise permanent stale-state hole when a coordinator eviction or failed push
   *  made a live room miss a harvest/material update. Called on join and every presence-renew beat;
   *  idempotent, with the private support-spend journal deliberately kept coordinator-only. */
  protected registerRoom(
    partyId: string,
    state: PartyRoomState,
    roomKey: string,
  ): Promise<Omit<VersionedState, "supportSpends">> {
    return this.enqueueStateWrite(state, async () => {
      const current = await this.ensureState(partyId, state);
      state.rooms.add(roomKey);
      return { state: current.state, version: current.version, registry: current.registry };
    });
  }

  /** Removes one `WorldRoom` once it has emptied. It shares the write queue with registration so
   *  an empty notification arriving while the first durable load is suspended always wins over
   *  that earlier registration instead of leaving a dead room in the directory. */
  protected roomEmptied(state: PartyRoomState, roomKey: string): Promise<void> {
    return this.enqueueStateWrite(state, async () => {
      state.rooms.delete(roomKey);
    });
  }
}
