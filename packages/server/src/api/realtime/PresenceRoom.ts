import {
  type CombatCooldownState,
  emptyCombatCooldowns,
  hasActiveCombatCooldowns,
  normalizeCombatCooldowns,
} from "@lindocara/engine/cooldowns.js";
import { $inject } from "alepha";
import { $room } from "alepha/websocket";
import { HeroEpochService } from "../services/HeroEpochService.ts";
import { RealtimeChannels } from "./channels.ts";

/** Ported verbatim from `packages/server/src/hero-profile.ts`'s `PRESENCE_TTL_MS`. */
export const PRESENCE_TTL_MS = 30_000;

/** The in-memory lease this headless room installs on a successful `acquire`/`handoff`. */
export interface PresenceLease {
  connectionId: string;
  sessionEpoch: number;
  roomKey: string;
  zoneId: string;
  instanceId: string;
  expiresAt: number;
}

export interface AcquirePresenceRequest {
  connectionId: string;
  roomKey: string;
  zoneId: string;
  instanceId: string;
}

export interface HandoffPresenceRequest {
  connectionId: string;
  sessionEpoch: number;
  mapId: string;
  /** Tile units: `x`/`z` ground, `y` elevation. All three travel or none do. */
  x: number;
  y: number;
  z: number;
}

interface StoredCooldowns {
  sessionEpoch: number;
  state: CombatCooldownState;
}

interface PresenceRoomState {
  lease: PresenceLease | null;
  cooldowns: StoredCooldowns | null;
}

/**
 * The headless per-hero presence/lease room, successor to legacy `CharacterPresence`/
 * `HeroPresence` (`packages/server/src/character-presence.ts:107-240`). `roomId` is the hero id;
 * `state()` is created lazily on first `call()` and holds exactly one lease plus one cooldown
 * checkpoint — there is never more than one authoritative holder per hero. The cooldown checkpoint
 * OUTLIVES any single lease: both `acquire` (reconnect) and `handoff` (map transition) carry
 * still-active cooldowns forward onto the new lease's epoch (`promoteCooldowns`), matching legacy's
 * `#promoteCooldowns` — a reconnect or a zone hop must never be a free cooldown refresh.
 *
 * **Volatility, and why it is still safe.** Unlike the legacy Durable-Object-backed
 * `CharacterPresence`, this room's state lives ONLY in this process's memory: Alepha's headless
 * `$room` has no storage/alarm primitive (see the realtime-tranche plan's "Verified recon
 * findings" #4). A headless room that receives no `call()` for `NodeWebSocketServerProvider`'s
 * 5-minute idle sweep (`ROOM_IDLE_TTL_MS`) is disposed and its lease (and any promoted cooldown
 * checkpoint) is gone — indistinguishable, from the caller's point of view, from the lease simply
 * expiring. Either way the very next `isAuthorized` call returns `false`, and the room holding the
 * hero's WebSocket (`WorldRoom`, Task 4+) closes that socket with `WS_CLOSE.PRESENCE_LOST` (4003),
 * sending the player back through the reconnect flow, where a lost cooldown checkpoint restores as
 * empty — a rare eviction-triggered refresh, not the routine one an unconditional reset would have
 * been. **D1 is what actually keeps hero data safe**: every fenced write goes through
 * `HeroEpochService`, which gates on `hero.session_epoch` in the SAME statement as the mutation, so
 * a lost lease can only ever cost a player a reconnect — it can never let two connections both
 * believe they hold the authoritative copy of one hero.
 */
export class PresenceRoom {
  heroEpochService = $inject(HeroEpochService);
  realtimeChannels = $inject(RealtimeChannels);

  /**
   * The lease clock. A plain, publicly reassignable field rather than a constructor parameter:
   * every `RoomMethod` below reads `this.now()` at call time, so a test can advance virtual time
   * past the 30s TTL by reassigning this field (`presenceRoom.now = () => acquiredAt + 30_001`)
   * instead of sleeping through it. Production code never touches it, so it stays `Date.now`.
   */
  now: () => number = () => Date.now();

  /**
   * roomId = heroId. `alepha.inject(PresenceRoom).room.call(heroId, "acquire", …)` is the calling
   * convention every later realtime-tranche room (`PartyRoom`, `WorldRoom`) mirrors — this class
   * is headless (`tickHz` omitted), reached only through `methods`, never a direct browser socket.
   */
  room = $room({
    channel: this.realtimeChannels.presenceChannel,
    state: (): PresenceRoomState => ({ lease: null, cooldowns: null }),
    methods: {
      acquire: (room, request: AcquirePresenceRequest) =>
        this.acquire(room.roomId, room.state, request),
      renew: (room, connectionId: string, sessionEpoch: number) =>
        this.renew(room.state, connectionId, sessionEpoch),
      isAuthorized: (room, connectionId: string, sessionEpoch: number, roomKey: string) =>
        this.isAuthorized(room.state, connectionId, sessionEpoch, roomKey),
      release: (room, connectionId: string, sessionEpoch: number) =>
        this.release(room.state, connectionId, sessionEpoch),
      handoff: (room, request: HandoffPresenceRequest) =>
        this.handoff(room.roomId, room.state, request),
      checkpointCooldowns: (
        room,
        connectionId: string,
        sessionEpoch: number,
        cooldowns: CombatCooldownState,
      ) => this.checkpointCooldowns(room.state, connectionId, sessionEpoch, cooldowns),
      readCooldowns: (room, connectionId: string, sessionEpoch: number) =>
        this.readCooldowns(room.state, connectionId, sessionEpoch),
    },
  });

  /**
   * Freezes/saves nothing itself (that is the caller's job, exactly like legacy's `World`
   * freezing the previous room before acquiring elsewhere): bumps the D1 epoch, then installs a
   * fresh lease unconditionally. A second `acquire` for the same hero (a reconnect, or the same
   * character opened elsewhere) always wins over whatever lease existed — the old holder's next
   * `isAuthorized` simply starts failing. Any still-active checkpointed cooldowns survive the new
   * lease (`promoteCooldowns`) — a reconnect is not a free cooldown reset.
   */
  protected async acquire(
    heroId: string,
    state: PresenceRoomState,
    request: AcquirePresenceRequest,
  ): Promise<{ sessionEpoch: number } | null> {
    const sessionEpoch = await this.heroEpochService.acquireEpoch(heroId);
    if (sessionEpoch === null) return null;
    state.lease = {
      connectionId: request.connectionId,
      sessionEpoch,
      roomKey: request.roomKey,
      zoneId: request.zoneId,
      instanceId: request.instanceId,
      expiresAt: this.now() + PRESENCE_TTL_MS,
    };
    this.promoteCooldowns(state, sessionEpoch);
    return { sessionEpoch };
  }

  /** Extends the current lease's TTL. Refuses (and self-heals) an already-lapsed lease. */
  protected renew(state: PresenceRoomState, connectionId: string, sessionEpoch: number): boolean {
    const lease = this.currentLease(state);
    if (!lease || lease.connectionId !== connectionId || lease.sessionEpoch !== sessionEpoch) {
      return false;
    }
    state.lease = { ...lease, expiresAt: this.now() + PRESENCE_TTL_MS };
    return true;
  }

  /** True only for the live, non-expired lease holder addressing the room it was granted for. */
  protected isAuthorized(
    state: PresenceRoomState,
    connectionId: string,
    sessionEpoch: number,
    roomKey: string,
  ): boolean {
    const lease = this.currentLease(state);
    return (
      lease !== null &&
      lease.connectionId === connectionId &&
      lease.sessionEpoch === sessionEpoch &&
      lease.roomKey === roomKey
    );
  }

  /** Clears the lease if (and only if) the caller is its current holder. */
  protected release(state: PresenceRoomState, connectionId: string, sessionEpoch: number): void {
    const lease = state.lease;
    if (lease && lease.connectionId === connectionId && lease.sessionEpoch === sessionEpoch) {
      state.lease = null;
    }
  }

  /**
   * The fenced move+increment behind a map transition. The source room has already frozen and
   * saved its player; this conditionally moves the durable location and bumps the epoch in one D1
   * statement (`HeroEpochService.handoffEpoch`), fencing every late source-room save before the
   * browser is ever asked to reconnect at the new location. A stale `sessionEpoch` — or a lease
   * that already lapsed — aborts without touching D1 or the in-memory lease. Any still-active
   * checkpointed cooldowns survive the map transition (`promoteCooldowns`) — a zone hop is not a
   * free cooldown reset any more than a reconnect is.
   */
  protected async handoff(
    heroId: string,
    state: PresenceRoomState,
    request: HandoffPresenceRequest,
  ): Promise<{ sessionEpoch: number } | null> {
    const lease = this.currentLease(state);
    if (
      !lease ||
      lease.connectionId !== request.connectionId ||
      lease.sessionEpoch !== request.sessionEpoch ||
      !Number.isFinite(request.x) ||
      !Number.isFinite(request.y) ||
      !Number.isFinite(request.z)
    ) {
      return null;
    }
    const nextEpoch = await this.heroEpochService.handoffEpoch({
      heroId,
      sessionEpoch: lease.sessionEpoch,
      mapId: request.mapId,
      position: { x: request.x, y: request.y, z: request.z },
    });
    if (nextEpoch === null) return null;
    state.lease = { ...lease, sessionEpoch: nextEpoch, expiresAt: this.now() + PRESENCE_TTL_MS };
    this.promoteCooldowns(state, nextEpoch);
    return { sessionEpoch: nextEpoch };
  }

  /**
   * Records a cooldown checkpoint for the current lease holder. Purely in-memory (see the class
   * docblock): still-active cooldowns survive the routine `acquire`/`handoff` path via
   * `promoteCooldowns`; only an actual room eviction (the rare volatile-state case) loses the
   * checkpoint and restores empty cooldowns on the next `readCooldowns` — never anything durable.
   */
  protected checkpointCooldowns(
    state: PresenceRoomState,
    connectionId: string,
    sessionEpoch: number,
    cooldowns: CombatCooldownState,
  ): boolean {
    const lease = this.currentLease(state);
    if (!lease || lease.connectionId !== connectionId || lease.sessionEpoch !== sessionEpoch) {
      return false;
    }
    state.cooldowns = { sessionEpoch, state: normalizeCombatCooldowns(cooldowns, this.now()) };
    return true;
  }

  /**
   * Reads back the current lease holder's cooldown checkpoint. Returns `emptyCombatCooldowns()`
   * (never `null`) once authorization holds but nothing has been checkpointed yet under this
   * exact epoch — the `sessionEpoch` mismatch arm is a defensive fallback (mirrors legacy's own
   * `readCooldowns`), not dead code: `promoteCooldowns` re-tags surviving cooldowns onto every new
   * epoch, but a caller that skipped straight to `readCooldowns` without ever going through
   * `acquire`/`handoff` for the epoch it names would otherwise read another epoch's checkpoint.
   * Returns `null` only when the caller is not the live lease holder.
   */
  protected readCooldowns(
    state: PresenceRoomState,
    connectionId: string,
    sessionEpoch: number,
  ): CombatCooldownState | null {
    const lease = this.currentLease(state);
    if (!lease || lease.connectionId !== connectionId || lease.sessionEpoch !== sessionEpoch) {
      return null;
    }
    if (!state.cooldowns || state.cooldowns.sessionEpoch !== sessionEpoch) {
      return emptyCombatCooldowns();
    }
    return state.cooldowns.state;
  }

  /**
   * Carries any still-active checkpointed cooldowns forward onto a NEW `sessionEpoch`, called by
   * both `acquire` and `handoff` right after they install their new lease — port of legacy
   * `CharacterPresence`'s `#promoteCooldowns` (`character-presence.ts:349,:403,:514-517`).
   * Without this, a reconnect or a map transition would silently reset every cooldown (including a
   * long ultimate), which is a live-play exploit, not just a UX regression: a player could hop
   * zones or reconnect to refresh a skill early. Cooldowns are re-normalized against `this.now()`
   * first (`normalizeCombatCooldowns`, the same bounded-deadline pass `checkpointCooldowns` already
   * runs), so an entry whose expiry has already passed is dropped rather than promoted; if nothing
   * survives, `state.cooldowns` becomes `null` instead of an inert empty record.
   */
  protected promoteCooldowns(state: PresenceRoomState, sessionEpoch: number): void {
    if (!state.cooldowns) return;
    const survivors = normalizeCombatCooldowns(state.cooldowns.state, this.now());
    state.cooldowns = hasActiveCombatCooldowns(survivors)
      ? { sessionEpoch, state: survivors }
      : null;
  }

  /**
   * The single expiry check every method above reads through: a lapsed lease is cleared as a
   * side effect of being observed, exactly like legacy `CharacterPresence`'s own read paths
   * self-heal instead of waiting on a separate sweep.
   */
  protected currentLease(state: PresenceRoomState): PresenceLease | null {
    const lease = state.lease;
    if (lease && lease.expiresAt <= this.now()) {
      state.lease = null;
      return null;
    }
    return lease;
  }
}
