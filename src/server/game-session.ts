import { DurableObject } from "cloudflare:workers";
import {
  type AdventureRegistry,
  EMPTY_ADVENTURE_STATE,
  EMPTY_REGISTRY,
  normalizeAuthoredQuestProgress,
  type PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import { applyStateMutation, type StateMutation } from "@lindocara/engine/event-interpreter.js";
import type { ServerMessage } from "@lindocara/engine/protocol.js";
import {
  loadAdventureEventIds,
  loadPartyAdventureState,
  savePartyAdventureState,
} from "./adventure-state-store.js";
import { loadAdventure } from "./adventures.js";
import { createDb } from "./db/index.js";
import { loadPartyForRuntime } from "./parties.js";

/**
 * How long a state change waits before its debounced D1 write, matching the hero profile flush
 * cadence. Party-empty flushes immediately and cancels a pending alarm, so the last owner never
 * relies on the timer surviving.
 */
const ADVENTURE_STATE_SAVE_DEBOUNCE_MS = 5_000;

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
  if (!quest) return false;
  return (
    mutation.type !== "advanceQuest" ||
    quest.objectives.some((objective) => objective.id === mutation.objectiveId)
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
      this.#state = {
        state: normalizeAuthoredQuestProgress(registry, state),
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
    await this.#pushStateToAllRooms(partyId, next);
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
