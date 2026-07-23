import { DurableObject } from "cloudflare:workers";
import {
  type AdventureRegistry,
  type AuthoredQuestProgress,
  EMPTY_ADVENTURE_STATE,
  EMPTY_REGISTRY,
  normalizeAuthoredQuestProgress,
  type PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import { CONSUMABLE_IDS, CONSUMABLE_MAX_STACK } from "@lindocara/engine/consumables.js";
import { applyStateMutation, type StateMutation } from "@lindocara/engine/event-interpreter.js";
import { applyExperience, maxHpForLevel } from "@lindocara/engine/game.js";
import type { ServerMessage } from "@lindocara/engine/protocol.js";
import {
  authoredQuestRuntimeState,
  buildQuestObjectiveIndex,
  completedQuestIds,
  createAuthoredQuestProgress,
  createAuthoredQuestProgressForAcceptance,
  type QuestBusinessEvent,
  type QuestObjectiveIndex,
  questPrerequisitesHold,
} from "@lindocara/engine/quest-runtime.js";
import type { AuthoredQuestDefinition, QuestEventReference } from "@lindocara/engine/quests.js";
import {
  loadAdventureEventIds,
  loadPartyAdventureState,
  savePartyAdventureState,
} from "./adventure-state-store.js";
import { loadAdventure } from "./adventures.js";
import { claimAuthoredQuestReward } from "./authored-quest-rewards.js";
import { type AuthoredQuestChange, processAuthoredQuestEvent } from "./authored-quest-system.js";
import { createDb } from "./db/index.js";
import {
  loadHeroAuthoredQuestProgress,
  saveHeroAuthoredQuestProgress,
} from "./hero-persistence.js";
import { loadPartyForRuntime } from "./parties.js";

/**
 * How long a state change waits before its debounced D1 write, matching the hero profile flush
 * cadence. Party-empty flushes immediately and cancels a pending alarm, so the last owner never
 * relies on the timer surviving.
 */
const ADVENTURE_STATE_SAVE_DEBOUNCE_MS = 5_000;

export type QuestAcceptanceResult =
  | { readonly ok: true; readonly progress: AuthoredQuestProgress }
  | {
      readonly ok: false;
      readonly reason: "party" | "quest" | "target" | "state" | "prerequisite" | "fence";
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

function sameEventReference(left: QuestEventReference | null, right: QuestEventReference): boolean {
  return left?.mapId === right.mapId && left.eventId === right.eventId;
}

/** The party's held snapshot plus the monotone version rooms use to drop out-of-order pushes. */
interface VersionedState {
  state: PartyAdventureState;
  version: number;
  registry: AdventureRegistry;
}

/** Quest commands are authored map data, so their ids are shape-checked at the map boundary and
 * membership-checked here, where the party's authoritative adventure registry is available. */
function mutationBelongsToRegistry(registry: AdventureRegistry, mutation: StateMutation): boolean {
  if (
    mutation.type !== "startQuest" &&
    mutation.type !== "advanceQuest" &&
    mutation.type !== "completeQuest"
  ) {
    return true;
  }
  const quest = (registry.quests ?? []).find((candidate) => candidate.id === mutation.questId);
  // GameSession owns PARTY progress. Personal progress is epoch-fenced in hero_quest and cannot be
  // mutated through this party-wide command seam.
  if (quest?.scope !== "party") return false;
  return (
    mutation.type !== "advanceQuest" ||
    quest.objectives.some(
      (objective) => objective.id === mutation.objectiveId && objective.type === "manual",
    )
  );
}

/**
 * Durable coordinator addressed by party id. It owns the persistent session directory and fans
 * party-wide messages out to the currently loaded map rooms. Simulation remains in the existing
 * World room implementation, which keeps the proven combat/tick systems isolated by
 * `${partyId}:${mapId}` while making the party, rather than a global map, the routing root.
 *
 * It also owns the party's live adventure state — switches, variables, self-switches (spec
 * Decision 2). State belongs to the party, not the hero: four heroes across different map rooms
 * share one set of switches, so exactly one writer (this coordinator) holds it. Rooms only READ it,
 * through the read-only snapshot pushed to each on room start and on change. Tranche 5's interpreter
 * is now the real change source: a room drains an event's commands and RPCs the resulting mutations
 * here through `applyStateChanges`; nothing a browser can send reaches this path.
 *
 * ## Durability across eviction (T4 obligation)
 *
 * The debounced D1 write is scheduled with `ctx.storage.setAlarm`, not a `setTimeout` a coordinator
 * eviction would drop. For the alarm to flush AFTER an eviction cleared this object's memory, the
 * dirty state must itself be durable, so every mutation persists `{ liveState, stateVersion,
 * stateDirty }` to `ctx.storage` before scheduling. `alarm()` reloads them and writes D1; the
 * party-empty flush is the other durable point, and the held copy is always at least as fresh as D1.
 */
export class GameSession extends DurableObject<Env> {
  /** The party's live state + version, loaded lazily on first contact and held for rooms to read.
   *  `null` until loaded; `#ensureState` is the single load point. */
  #state: VersionedState | null = null;
  /** A change is waiting to be written. Party-empty flushes it; the alarm writes it after 5s. */
  #dirty = false;
  /** Built once with the loaded adventure; target lookup is O(the matching bucket), not O(quests). */
  #questIndex: QuestObjectiveIndex | null = null;
  /** Older accepted definitions can target something the current registry no longer does. */
  #partyPinnedQuestIndex: QuestObjectiveIndex = buildQuestObjectiveIndex([]);
  /** Active saves pin their accepted definition. Cache its narrow index by object identity. */
  #definitionIndexes = new WeakMap<AuthoredQuestDefinition, QuestObjectiveIndex>();
  /** Personal progress is immediately persisted; this is only the coordinator's read-through copy. */
  #personalQuestProgress = new Map<string, Record<string, AuthoredQuestProgress>>();
  #personalPinnedQuestIndexes = new Map<string, QuestObjectiveIndex>();
  /** Completion permanently closes the business-event intake for this live party. */
  #partyCompleted = false;
  /** RPCs can interleave at awaits. Serialize state/event mutations to avoid lost updates. */
  #stateWriteQueue: Promise<void> = Promise.resolve();
  /**
   * A World tick may originate a business event and wait for this coordinator RPC. Calling that
   * same World back before returning would form a Durable Object callback cycle. Deferred room
   * notifications live on their own ordered queue: authority is durable first, the source RPC can
   * return, then every versioned party/personal UI push lands in coordinator order.
   */
  #roomPushQueue: Promise<void> = Promise.resolve();
  /** Test seam only (null in production): a barrier the next `#flushSave` parks on just before its
   *  version-guarded dirty clear, so a test can land a mutation mid-flush deterministically and prove
   *  the guard keeps the newer version. */
  #flushRaceBarrier: { promise: Promise<void>; resolve: () => void } | null = null;

  async #rememberRoom(partyId: string, roomKey: string): Promise<void> {
    const storedPartyId = await this.ctx.storage.get<string>("partyId");
    if (storedPartyId !== undefined && storedPartyId !== partyId) {
      throw new Error("game session party identity mismatch");
    }
    const rooms = new Set((await this.ctx.storage.get<string[]>("rooms")) ?? []);
    rooms.add(roomKey);
    // `rooms` is every room ever seen (the broadcast fan-out set); `activeRooms` is the subset that
    // currently has players, so party-empty can be detected when the last one drains.
    const activeRooms = new Set((await this.ctx.storage.get<string[]>("activeRooms")) ?? []);
    activeRooms.add(roomKey);
    await this.ctx.storage.put({ partyId, rooms: [...rooms], activeRooms: [...activeRooms] });
    await this.#ensureState(partyId);
  }

  /**
   * The coordinator's held snapshot + version, for a `World` room re-derived from hibernation. That
   * room woke without a `fetch`-time push, so it pulls the authoritative copy from here — this
   * coordinator is the single writer, so its held state is at least as fresh as the debounced D1 row
   * (and, since the mutation is persisted to `ctx.storage`, survives this coordinator's own
   * eviction). Load-on-demand when this coordinator is itself fresh (`#state` null).
   */
  async getAdventureState(partyId: string): Promise<VersionedState> {
    const storedPartyId = await this.ctx.storage.get<string>("partyId");
    if (storedPartyId !== undefined && storedPartyId !== partyId) {
      return { state: EMPTY_ADVENTURE_STATE, version: 0, registry: EMPTY_REGISTRY };
    }
    return this.#ensureState(partyId);
  }

  /**
   * Load the party's state + version once, on first contact. Prefers the durable `ctx.storage`
   * copy (the freshest, written on every mutation and surviving eviction) over the debounced D1 row,
   * then falls back to D1. Degrades to empty, never throws (`loadPartyAdventureState`'s posture).
   */
  async #ensureState(partyId: string): Promise<VersionedState> {
    if (this.#state === null) {
      const liveState = await this.ctx.storage.get<PartyAdventureState>("liveState");
      const version = (await this.ctx.storage.get<number>("stateVersion")) ?? 0;
      this.#dirty = (await this.ctx.storage.get<boolean>("stateDirty")) ?? false;
      const state = liveState ?? (await loadPartyAdventureState(createDb(this.env.DB), partyId));
      const db = createDb(this.env.DB);
      const party = await loadPartyForRuntime(db, partyId);
      const authored = party
        ? await loadAdventure(db, party.hostAccountId, party.adventureId)
        : null;
      const registry = authored?.registry ?? EMPTY_REGISTRY;
      this.#partyCompleted =
        party?.status === "completed" ||
        ((await this.ctx.storage.get<boolean>("partyCompleted")) ?? false);
      this.#questIndex = buildQuestObjectiveIndex(registry.quests ?? []);
      const normalizedState = normalizeAuthoredQuestProgress(registry, state);
      this.#partyPinnedQuestIndex = this.#pinnedIndex(normalizedState.quests, "party");
      this.#state = {
        state: normalizedState,
        version,
        registry,
      };
    }
    return this.#state;
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected a websocket upgrade", { status: 426 });
    }
    const partyId = request.headers.get("x-party-id");
    const roomKey = request.headers.get("x-room-key");
    const mapId = request.headers.get("x-zone-id");
    if (!partyId || !roomKey || !mapId || roomKey !== `${partyId}:${mapId}`) {
      return new Response("invalid game session room", { status: 400 });
    }
    await this.#rememberRoom(partyId, roomKey);
    // Room start: push the party's snapshot to the room before it admits the hero, so its
    // join-time page evaluation sees the loaded state. Awaited before delegating so the install
    // lands first on this same World object.
    const held = await this.#ensureState(partyId);
    await this.env.WORLD.getByName(roomKey).installAdventureState(
      partyId,
      held.state,
      held.version,
      held.registry,
    );
    return this.env.WORLD.getByName(roomKey).fetch(request);
  }

  /** Party chat and victory use this path; no browser message can call it directly. */
  async broadcast(partyId: string, message: ServerMessage): Promise<void> {
    const storedPartyId = await this.ctx.storage.get<string>("partyId");
    if (storedPartyId !== partyId) return;
    const rooms = (await this.ctx.storage.get<string[]>("rooms")) ?? [];
    await Promise.all(
      rooms.map((roomKey) => this.env.WORLD.getByName(roomKey).broadcastParty(partyId, message)),
    );
  }

  /**
   * Called by a World room when it has emptied (the same coordinator <-> World RPC seam that
   * carries party chat/victory). When the last room drains, flush the adventure state to D1 with
   * the orphan-self-switch prune — the durable save that outlives the live session.
   */
  async roomEmptied(partyId: string, roomKey: string): Promise<void> {
    const storedPartyId = await this.ctx.storage.get<string>("partyId");
    if (storedPartyId !== partyId) return;
    const activeRooms = new Set((await this.ctx.storage.get<string[]>("activeRooms")) ?? []);
    activeRooms.delete(roomKey);
    await this.ctx.storage.put("activeRooms", [...activeRooms]);
    if (activeRooms.size > 0) return;
    await this.ctx.storage.deleteAlarm();
    // The party-empty flush can race a teardown that drops the party row (an FK the save depends
    // on): swallow and log rather than reject `roomEmptied`, mirroring the alarm path's catch.
    await this.#flushSave(partyId).catch((error) => {
      console.error(
        JSON.stringify({
          event: "party_adventure_state_flush_failed",
          partyId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }

  /**
   * The interpreter's mutation RPC (spec Decision 1): a room drains an event's commands and sends the
   * resulting switch/variable/self-switch writes UP here — the single writer. Applied serially in
   * order, bumping the monotone version ONCE for the batch, then pushed to every room. Not reachable
   * from a client; the Worker forwards only WebSocket upgrades to `fetch`.
   */
  async applyStateChanges(partyId: string, mutations: readonly StateMutation[]): Promise<void> {
    if (mutations.length === 0) return;
    await this.#enqueueStateWrite(async () => {
      const current = await this.#ensureState(partyId);
      const accepted = mutations.filter((mutation) =>
        mutationBelongsToRegistry(current.registry, mutation),
      );
      if (accepted.length === 0) return;
      await this.#applyStateChange(partyId, (state) => {
        let next = state;
        for (const mutation of accepted) next = applyStateMutation(next, mutation);
        return normalizeAuthoredQuestProgress(current.registry, next);
      });
    });
  }

  /**
   * Consume one server-minted gameplay fact. World is the only caller; browser messages cannot
   * reach a Durable Object RPC. Party progress is persisted by the existing alarm path, while each
   * personal transition is written immediately behind the hero's session epoch fence.
   */
  async recordQuestEvent(
    partyId: string,
    event: QuestBusinessEvent,
  ): Promise<readonly AuthoredQuestChange[]> {
    return this.#enqueueStateWrite(async () => {
      const storedPartyId = await this.ctx.storage.get<string>("partyId");
      if (storedPartyId !== partyId || this.#partyCompleted) return [];
      const current = await this.#ensureState(partyId);
      const currentIndex =
        this.#questIndex ?? buildQuestObjectiveIndex(current.registry.quests ?? []);
      this.#questIndex = currentIndex;
      const db = createDb(this.env.DB);
      const result = await processAuthoredQuestEvent({
        registry: current.registry,
        partyState: current.state,
        currentIndex,
        partyPinnedIndex: this.#partyPinnedQuestIndex,
        event,
        indexForDefinition: (definition) => this.#indexForDefinition(definition),
        loadPersonal: async (actor) => {
          const cached = this.#personalQuestProgress.get(actor.heroId);
          if (cached) return cached;
          const loaded = await loadHeroAuthoredQuestProgress(db, actor.heroId);
          this.#personalQuestProgress.set(actor.heroId, loaded);
          this.#personalPinnedQuestIndexes.set(actor.heroId, this.#pinnedIndex(loaded, "personal"));
          return loaded;
        },
        personalPinnedIndex: (actor) =>
          this.#personalPinnedQuestIndexes.get(actor.heroId) ?? buildQuestObjectiveIndex([]),
        savePersonal: async (actor, questId, progress) => {
          try {
            return await saveHeroAuthoredQuestProgress(db, {
              heroId: actor.heroId,
              sessionEpoch: actor.sessionEpoch,
              questId,
              progress,
            });
          } catch (error) {
            // One failed hero write must not hide another hero's successful transition or leave the
            // coordinator's cache ahead of D1. The failed row simply remains eligible next event.
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
        await this.#applyStateChange(partyId, () => result.partyState, true);
      }
      for (const update of result.personalUpdates) {
        this.#personalQuestProgress.set(update.actor.heroId, update.progress);
        this.#deferRoomPush(partyId, () =>
          this.#pushPersonalQuestProgress(partyId, update.actor.heroId, update.progress),
        );
      }
      return result.changes;
    });
  }

  /** Accept a standard giver offer after re-validating every fact behind the client button. */
  async acceptAuthoredQuest(
    partyId: string,
    actor: { heroId: string; sessionEpoch: number; level: number },
    questId: string,
    target: QuestEventReference,
    inventory: Readonly<Record<string, number>>,
  ): Promise<QuestAcceptanceResult> {
    return this.#enqueueStateWrite(async () => {
      const storedPartyId = await this.ctx.storage.get<string>("partyId");
      if (storedPartyId !== partyId || this.#partyCompleted) {
        return { ok: false, reason: "party" };
      }
      const current = await this.#ensureState(partyId);
      const definition = (current.registry.quests ?? []).find((quest) => quest.id === questId);
      if (definition?.acceptance !== "manual") {
        return { ok: false, reason: "quest" };
      }
      if (!sameEventReference(definition.giver, target)) {
        return { ok: false, reason: "target" };
      }
      const db = createDb(this.env.DB);
      let personal = this.#personalQuestProgress.get(actor.heroId);
      if (!personal) {
        personal = await loadHeroAuthoredQuestProgress(db, actor.heroId);
        this.#personalQuestProgress.set(actor.heroId, personal);
        this.#personalPinnedQuestIndexes.set(actor.heroId, this.#pinnedIndex(personal, "personal"));
      }
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
        await this.#applyStateChange(partyId, (state) => ({ ...state, quests }), true);
      } else {
        const saved = await saveHeroAuthoredQuestProgress(db, {
          heroId: actor.heroId,
          sessionEpoch: actor.sessionEpoch,
          questId,
          progress: accepted,
        });
        if (!saved) return { ok: false, reason: "fence" };
        personal = { ...personal, [questId]: accepted };
        this.#personalQuestProgress.set(actor.heroId, personal);
        this.#personalPinnedQuestIndexes.set(actor.heroId, this.#pinnedIndex(personal, "personal"));
        const pushed = personal;
        this.#deferRoomPush(partyId, () =>
          this.#pushPersonalQuestProgress(partyId, actor.heroId, pushed),
        );
      }
      return { ok: true, progress: accepted };
    });
  }

  /** Atomically consume deliveries, complete progress and grant one authored reward attempt. */
  async completeAuthoredQuest(
    partyId: string,
    actor: { heroId: string; sessionEpoch: number; level: number },
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
    return this.#enqueueStateWrite(async () => {
      const storedPartyId = await this.ctx.storage.get<string>("partyId");
      if (storedPartyId !== partyId || this.#partyCompleted) {
        return { ok: false, reason: "party" };
      }
      const current = await this.#ensureState(partyId);
      const db = createDb(this.env.DB);
      let personal = this.#personalQuestProgress.get(actor.heroId);
      if (!personal) {
        personal = await loadHeroAuthoredQuestProgress(db, actor.heroId);
        this.#personalQuestProgress.set(actor.heroId, personal);
        this.#personalPinnedQuestIndexes.set(actor.heroId, this.#pinnedIndex(personal, "personal"));
      }
      const partyProgress = current.state.quests?.[questId];
      const personalProgress = personal[questId];
      const progress = partyProgress ?? personalProgress;
      const definition =
        progress?.definitionSnapshot ??
        (current.registry.quests ?? []).find((quest) => quest.id === questId);
      if (!definition || !progress) {
        return { ok: false, reason: "quest" };
      }
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
      const nextPersonal = { ...personal };
      if (definition.scope === "party") {
        nextPartyState = {
          ...nextPartyState,
          quests: { ...(nextPartyState.quests ?? {}), [questId]: completed },
        };
      } else {
        nextPersonal[questId] = completed;
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
      let createdNextPersonal: { questId: string; progress: AuthoredQuestProgress } | undefined;
      const nextDefinition = definition.rewards.nextQuestId
        ? (current.registry.quests ?? []).find(
            (candidate) => candidate.id === definition.rewards.nextQuestId,
          )
        : undefined;
      if (nextDefinition?.scope === "party" && !nextPartyState.quests?.[nextDefinition.id]) {
        nextPartyState = {
          ...nextPartyState,
          quests: {
            ...(nextPartyState.quests ?? {}),
            [nextDefinition.id]: createAuthoredQuestProgress(nextDefinition),
          },
        };
      } else if (nextDefinition?.scope === "personal" && !nextPersonal[nextDefinition.id]) {
        const nextProgress = createAuthoredQuestProgress(nextDefinition);
        nextPersonal[nextDefinition.id] = nextProgress;
        createdNextPersonal = { questId: nextDefinition.id, progress: nextProgress };
      }
      const partyChanged = nextPartyState !== current.state;
      const personalChanged = definition.scope === "personal" || createdNextPersonal !== undefined;
      const claimed = await claimAuthoredQuestReward(this.env.DB, {
        ownerKind: definition.scope,
        ownerId: definition.scope === "party" ? partyId : actor.heroId,
        partyId,
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
        ...(definition.scope === "personal"
          ? { completedPersonal: { questId, progress: completed } }
          : {}),
        ...(createdNextPersonal ? { nextPersonal: createdNextPersonal } : {}),
        ...(partyChanged ? { partyState: nextPartyState } : {}),
      });
      if (!claimed) return { ok: false, reason: "fence" };
      if (partyChanged) {
        const next = {
          state: nextPartyState,
          version: current.version + 1,
          registry: current.registry,
        };
        this.#state = next;
        this.#dirty = false;
        await this.ctx.storage.put({
          liveState: next.state,
          stateVersion: next.version,
          stateDirty: false,
        });
        await this.ctx.storage.deleteAlarm();
        this.#partyPinnedQuestIndex = this.#pinnedIndex(nextPartyState.quests, "party");
        this.#deferRoomPush(partyId, () => this.#pushStateToAllRooms(partyId, next));
      }
      if (personalChanged) {
        personal = nextPersonal;
        this.#personalQuestProgress.set(actor.heroId, personal);
        this.#personalPinnedQuestIndexes.set(actor.heroId, this.#pinnedIndex(personal, "personal"));
        const pushed = personal;
        this.#deferRoomPush(partyId, () =>
          this.#pushPersonalQuestProgress(partyId, actor.heroId, pushed),
        );
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

  /** Close quest progression as soon as the authoritative open -> completed fence succeeds. */
  async markPartyCompleted(partyId: string): Promise<void> {
    await this.#enqueueStateWrite(async () => {
      const storedPartyId = await this.ctx.storage.get<string>("partyId");
      if (storedPartyId !== partyId) return;
      this.#partyCompleted = true;
      await this.ctx.storage.put("partyCompleted", true);
    });
  }

  #indexForDefinition(definition: AuthoredQuestDefinition): QuestObjectiveIndex {
    const cached = this.#definitionIndexes.get(definition);
    if (cached) return cached;
    const index = buildQuestObjectiveIndex([definition]);
    this.#definitionIndexes.set(definition, index);
    return index;
  }

  #pinnedIndex(
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

  async #pushPersonalQuestProgress(
    partyId: string,
    heroId: string,
    progress: Readonly<Record<string, AuthoredQuestProgress>>,
  ): Promise<void> {
    const rooms = (await this.ctx.storage.get<string[]>("rooms")) ?? [];
    const results = await Promise.allSettled(
      rooms.map((roomKey) =>
        this.env.WORLD.getByName(roomKey).installPersonalQuestProgress(partyId, heroId, progress),
      ),
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

  #enqueueStateWrite<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#stateWriteQueue.then(work);
    this.#stateWriteQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #deferRoomPush(partyId: string, work: () => Promise<void>): void {
    const queued = this.#roomPushQueue.then(work);
    this.#roomPushQueue = queued.catch((error) => {
      console.error(
        JSON.stringify({
          event: "quest_room_push_failed",
          partyId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
    this.ctx.waitUntil(this.#roomPushQueue);
  }

  /**
   * The tranche-4 test seam, now delegating to the REAL mutation path (`applyStateChanges`) so a
   * test drives exactly what the interpreter drives. Standing in for a hand-authored `setSwitch`.
   */
  async applyStateChangeForTest(
    partyId: string,
    change: { switchId: string; value: boolean },
  ): Promise<void> {
    await this.applyStateChanges(partyId, [
      { type: "setSwitch", switchId: change.switchId, value: change.value },
    ]);
  }

  /**
   * Apply a state change, bump the version, persist the dirty state durably, schedule the debounced
   * alarm, then push the new snapshot to EVERY room so heroes on different maps re-evaluate their
   * pages against the same state.
   */
  async #applyStateChange(
    partyId: string,
    mutate: (state: PartyAdventureState) => PartyAdventureState,
    deferRoomPush = false,
  ): Promise<void> {
    const storedPartyId = await this.ctx.storage.get<string>("partyId");
    if (storedPartyId !== partyId) return;
    const current = await this.#ensureState(partyId);
    const next: VersionedState = {
      state: mutate(current.state),
      version: current.version + 1,
      registry: current.registry,
    };
    this.#state = next;
    this.#dirty = true;
    // Persist the dirty state durably BEFORE scheduling the alarm: an eviction that clears this
    // object's memory must not lose the flip, and `alarm()` reloads exactly these keys.
    await this.ctx.storage.put({
      liveState: next.state,
      stateVersion: next.version,
      stateDirty: true,
    });
    await this.#scheduleSave();
    if (deferRoomPush) {
      this.#deferRoomPush(partyId, () => this.#pushStateToAllRooms(partyId, next));
    } else {
      await this.#pushStateToAllRooms(partyId, next);
    }
  }

  async #pushStateToAllRooms(partyId: string, held: VersionedState): Promise<void> {
    const rooms = (await this.ctx.storage.get<string[]>("rooms")) ?? [];
    await Promise.all(
      rooms.map((roomKey) =>
        this.env.WORLD.getByName(roomKey).installAdventureState(
          partyId,
          held.state,
          held.version,
          held.registry,
        ),
      ),
    );
  }

  /** Arm the debounced flush as a durable alarm. Leaves an already-armed alarm in place (debounce
   *  semantics: the first mutation sets the deadline, later ones do not push it out). */
  async #scheduleSave(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) !== null) return;
    await this.ctx.storage.setAlarm(Date.now() + ADVENTURE_STATE_SAVE_DEBOUNCE_MS);
  }

  /** The debounced D1 write. Fires even after an eviction cleared this object's memory: `#flushSave`
   *  reloads the dirty state from `ctx.storage` through `#ensureState`. */
  override async alarm(): Promise<void> {
    const partyId = await this.ctx.storage.get<string>("partyId");
    if (partyId === undefined) return;
    await this.#flushSave(partyId).catch((error) => {
      console.error(
        JSON.stringify({
          event: "party_adventure_state_save_failed",
          partyId,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    });
  }

  async #flushSave(partyId: string): Promise<void> {
    const held = await this.#ensureState(partyId);
    if (!this.#dirty) return;
    // Capture the version we are about to persist. A mutation can land during the awaited D1 write
    // (that write does not hold the input gate closed), bumping `#state.version` and re-setting
    // `#dirty`; clearing `#dirty` unconditionally would clobber that flag and strand the newer state
    // out of D1 until session end. Only clear when what we wrote is still current.
    const savedVersion = held.version;
    const db = createDb(this.env.DB);
    const liveEventIds = await loadAdventureEventIds(db, partyId);
    await savePartyAdventureState(db, partyId, held.state, liveEventIds);
    // Test-only rendezvous point (see `#flushRaceBarrier`): production never installs a barrier.
    const barrier = this.#flushRaceBarrier;
    if (barrier !== null) {
      this.#flushRaceBarrier = null;
      await barrier.promise;
    }
    if (this.#state !== null && this.#state.version === savedVersion) {
      this.#dirty = false;
      await this.ctx.storage.put("stateDirty", false);
    } else {
      // A mid-flush mutation moved past what we saved: stay dirty and re-arm so it reaches D1.
      await this.#scheduleSave();
    }
  }

  /**
   * Test seam: reproduce the flush-window race deterministically inside the object. Starts a real
   * `#flushSave` (which parks at the barrier just before its dirty clear), lands a real mutation while
   * it is parked, then releases the flush — proving the version-guarded clear keeps the newer version.
   */
  async raceFlushWithMutationForTest(partyId: string, switchId: string): Promise<void> {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    this.#flushRaceBarrier = { promise, resolve };
    const flushing = this.#flushSave(partyId);
    await this.applyStateChanges(partyId, [{ type: "setSwitch", switchId, value: true }]);
    resolve();
    await flushing;
  }
}
