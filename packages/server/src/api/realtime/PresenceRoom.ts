import {
  type CombatCooldownState,
  emptyCombatCooldowns,
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
  x: number;
  y: number;
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
 * checkpoint — there is never more than one authoritative holder per hero.
 *
 * **Volatility, and why it is still safe.** Unlike the legacy Durable-Object-backed
 * `CharacterPresence`, this room's state lives ONLY in this process's memory: Alepha's headless
 * `$room` has no storage/alarm primitive (see the realtime-tranche plan's "Verified recon
 * findings" #4). A headless room that receives no `call()` for `NodeWebSocketServerProvider`'s
 * 5-minute idle sweep (`ROOM_IDLE_TTL_MS`) is disposed and its lease is gone — indistinguishable,
 * from the caller's point of view, from the lease simply expiring. Either way the very next
 * `isAuthorized` call returns `false`, and the room holding the hero's WebSocket (`WorldRoom`,
 * Task 4+) closes that socket with `WS_CLOSE.PRESENCE_LOST` (4003), sending the player back
 * through the reconnect flow. **D1 is what actually keeps data safe**: every fenced write goes
 * through `HeroEpochService`, which gates on `hero.session_epoch` in the SAME statement as the
 * mutation, so a lost lease can only ever cost a player a reconnect — it can never let two
 * connections both believe they hold the authoritative copy of one hero.
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
   * `isAuthorized` simply starts failing.
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
    // A fresh epoch starts a fresh session: any cooldown checkpoint recorded under the previous
    // lease belongs to a holder this acquire just replaced.
    state.cooldowns = null;
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
   * that already lapsed — aborts without touching D1 or the in-memory lease.
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
      !Number.isFinite(request.y)
    ) {
      return null;
    }
    const nextEpoch = await this.heroEpochService.handoffEpoch({
      heroId,
      sessionEpoch: lease.sessionEpoch,
      mapId: request.mapId,
      x: request.x,
      y: request.y,
    });
    if (nextEpoch === null) return null;
    state.lease = { ...lease, sessionEpoch: nextEpoch, expiresAt: this.now() + PRESENCE_TTL_MS };
    state.cooldowns = null;
    return { sessionEpoch: nextEpoch };
  }

  /**
   * Records a cooldown checkpoint for the current lease holder. Purely in-memory (see the class
   * docblock): a lost checkpoint restores empty cooldowns on the next `readCooldowns`, matching a
   * fresh-session experience rather than corrupting anything durable.
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
   * (never `null`) once authorization holds but nothing has been checkpointed yet or under this
   * exact epoch; returns `null` only when the caller is not the live lease holder.
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
