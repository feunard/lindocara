import { DurableObject } from "cloudflare:workers";
import { EMPTY_ADVENTURE_STATE, type PartyAdventureState } from "../shared/adventure-state.js";
import type { ServerMessage } from "../shared/protocol.js";
import {
  loadAdventureEventIds,
  loadPartyAdventureState,
  savePartyAdventureState,
} from "./adventure-state-store.js";
import { createDb } from "./db/index.js";

/**
 * How long a state change waits before its debounced D1 write, matching the hero profile flush
 * cadence. Party-empty flushes immediately and cancels a pending debounce, so the last owner never
 * relies on the timer surviving.
 */
const ADVENTURE_STATE_SAVE_DEBOUNCE_MS = 5_000;

/**
 * Durable coordinator addressed by party id. It owns the persistent session directory and fans
 * party-wide messages out to the currently loaded map rooms. Simulation remains in the existing
 * World room implementation, which keeps the proven combat/tick systems isolated by
 * `${partyId}:${mapId}` while making the party, rather than a global map, the routing root.
 *
 * It also owns the party's live adventure state — switches, variables, self-switches (spec
 * Decision 2). State belongs to the party, not the hero: four heroes across different map rooms
 * share one set of switches, so exactly one writer (this coordinator) holds it. Rooms only READ it,
 * through the read-only snapshot pushed to each on room start and on change. This tranche has no
 * in-game mutation path; the only change source is `applyStateChangeForTest`, the test seam
 * standing in for tranche 5's interpreter.
 */
export class GameSession extends DurableObject<Env> {
  /** The party's live state, loaded lazily on first room admission and held read-only for rooms.
   *  `null` until loaded; `#ensureState` is the single load point. */
  #state: PartyAdventureState | null = null;
  /** A change is waiting to be written. Party-empty flushes it; the debounce writes it after 5s. */
  #dirty = false;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

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
   * The coordinator's held snapshot, for a `World` room re-derived from hibernation. That room woke
   * without a `fetch`-time push, so it pulls the authoritative copy from here — this coordinator is
   * the single writer, so its held state is at least as fresh as the debounced D1 row, and reading
   * it is not a second cache. Load-on-demand when this coordinator is itself fresh (`#state` null),
   * exactly like a first room admission.
   */
  async getAdventureState(partyId: string): Promise<PartyAdventureState> {
    const storedPartyId = await this.ctx.storage.get<string>("partyId");
    if (storedPartyId !== undefined && storedPartyId !== partyId) return EMPTY_ADVENTURE_STATE;
    return this.#ensureState(partyId);
  }

  /** Load the party's adventure state once, on first contact. Degrades to empty, never throws
   *  (`loadPartyAdventureState`'s posture). */
  async #ensureState(partyId: string): Promise<PartyAdventureState> {
    if (this.#state === null) {
      this.#state = await loadPartyAdventureState(createDb(this.env.DB), partyId);
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
    const state = await this.#ensureState(partyId);
    await this.env.WORLD.getByName(roomKey).installAdventureState(partyId, state);
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
    if (this.#saveTimer !== null) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    // The party-empty flush can race a teardown that drops the party row (an FK the save depends
    // on): swallow and log rather than reject `roomEmptied`, mirroring the debounced path's catch.
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
   * The ONLY change source this tranche. Tranche 5's interpreter becomes the real caller of
   * `#applyStateChange`; until then a change can only be driven by a test standing in for it. Not
   * reachable from a client — the Worker forwards only WebSocket upgrades to `fetch`.
   */
  async applyStateChangeForTest(
    partyId: string,
    change: { switchId: string; value: boolean },
  ): Promise<void> {
    await this.#applyStateChange(partyId, (state) => ({
      ...state,
      switches: { ...state.switches, [change.switchId]: change.value },
    }));
  }

  /**
   * Apply a state change, then push the new snapshot to EVERY room so two heroes on different maps
   * re-evaluate their pages against the same state, and schedule the debounced save. This is
   * tranche 5's entry point for command-driven mutation; its single caller today is the test seam.
   */
  async #applyStateChange(
    partyId: string,
    mutate: (state: PartyAdventureState) => PartyAdventureState,
  ): Promise<void> {
    const storedPartyId = await this.ctx.storage.get<string>("partyId");
    if (storedPartyId !== partyId) return;
    const current = await this.#ensureState(partyId);
    this.#state = mutate(current);
    this.#dirty = true;
    this.#scheduleSave(partyId);
    await this.#pushStateToAllRooms(partyId);
  }

  async #pushStateToAllRooms(partyId: string): Promise<void> {
    const state = this.#state;
    if (state === null) return;
    const rooms = (await this.ctx.storage.get<string[]>("rooms")) ?? [];
    await Promise.all(
      rooms.map((roomKey) =>
        this.env.WORLD.getByName(roomKey).installAdventureState(partyId, state),
      ),
    );
  }

  #scheduleSave(partyId: string): void {
    if (this.#saveTimer !== null) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      void this.#flushSave(partyId).catch((error) => {
        console.error(
          JSON.stringify({
            event: "party_adventure_state_save_failed",
            partyId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    }, ADVENTURE_STATE_SAVE_DEBOUNCE_MS);
  }

  async #flushSave(partyId: string): Promise<void> {
    if (!this.#dirty || this.#state === null) return;
    const db = createDb(this.env.DB);
    const liveEventIds = await loadAdventureEventIds(db, partyId);
    await savePartyAdventureState(db, partyId, this.#state, liveEventIds);
    this.#dirty = false;
  }
}
