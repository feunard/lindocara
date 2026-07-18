import { DurableObject } from "cloudflare:workers";
import { WS_CLOSE } from "../shared/close-codes.js";
import {
  type CombatCooldownState,
  emptyCombatCooldowns,
  hasActiveCombatCooldowns,
  latestCombatCooldown,
  normalizeCombatCooldowns,
} from "../shared/cooldowns.js";
import { createDb } from "./db/index.js";
import { acquireSessionEpoch, handoffProfileLocation } from "./profile.js";

export const PRESENCE_TTL_MS = 30_000;
export const PRESENCE_HEARTBEAT_MS = 10_000;

export interface PresenceTiming {
  /** How long an acquired or renewed lease stays valid. */
  ttlMs: number;
  /** How often a room re-asserts the lease of every player it owns. */
  heartbeatMs: number;
}

function overrideMs(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The lease clock, read once per Durable Object out of `Env`.
 *
 * Both overrides are absent in production and in `wrangler.jsonc`, so this returns the two
 * constants above and behaviour is byte-for-byte unchanged. They exist because the fencing tests
 * verify the *logic* — that a room which cannot renew invalidates itself — not the numeric value
 * of the timeout, and a test suite has no business sleeping through a 30-second lease to prove it.
 *
 * This is deliberately a pure function of `Env` rather than a mutable module global: a lease clock
 * belongs to one Durable Object, and nothing a client sends can reach a Worker binding.
 */
export function presenceTiming(env: Env): PresenceTiming {
  return {
    ttlMs: overrideMs(env.PRESENCE_TTL_MS_OVERRIDE, PRESENCE_TTL_MS),
    heartbeatMs: overrideMs(env.PRESENCE_HEARTBEAT_MS_OVERRIDE, PRESENCE_HEARTBEAT_MS),
  };
}

export interface PresenceLease {
  characterId: string;
  connectionId: string;
  sessionEpoch: number;
  roomKey: string;
  zoneId: string;
  instanceId: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface AcquirePresence {
  characterId: string;
  connectionId: string;
  roomKey: string;
  zoneId: string;
  instanceId: string;
}

export interface HandoffPresence {
  characterId: string;
  connectionId: string;
  sessionEpoch: number;
  sourceRoomKey: string;
  destinationRoomKey: string;
  zoneId: string;
  instanceId: string;
  x: number;
  y: number;
}

interface PresenceRow extends Record<string, SqlStorageValue> {
  character_id: string;
  connection_id: string;
  session_epoch: number;
  room_key: string;
  zone_id: string;
  instance_id: string;
  acquired_at: number;
  expires_at: number;
}

interface CooldownRow extends Record<string, SqlStorageValue> {
  session_epoch: number;
  attack_until: number;
  heal_until: number;
  skill_1_until: number;
  skill_2_until: number;
  skill_3_until: number;
  skill_4_until: number;
  skill_5_until: number;
  guard_until: number;
  resurrect_until: number;
}

function validIdentity(value: string): boolean {
  return value.length > 0 && value.length <= 128;
}

/** One deterministic coordinator per character. D1 owns the monotone epoch; this DO owns its lease. */
export class CharacterPresence extends DurableObject<Env> {
  #operations: Promise<void> = Promise.resolve();
  /** This coordinator's lease length, fixed for its lifetime. Never derived from a client. */
  readonly #ttlMs: number;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#ttlMs = presenceTiming(env).ttlMs;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS active_presence (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        character_id TEXT NOT NULL,
        connection_id TEXT NOT NULL,
        session_epoch INTEGER NOT NULL,
        room_key TEXT NOT NULL,
        zone_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        acquired_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS combat_cooldowns (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        session_epoch INTEGER NOT NULL,
        attack_until INTEGER NOT NULL,
        heal_until INTEGER NOT NULL,
        skill_1_until INTEGER NOT NULL,
        skill_2_until INTEGER NOT NULL,
        skill_3_until INTEGER NOT NULL,
        skill_4_until INTEGER NOT NULL,
        skill_5_until INTEGER NOT NULL,
        guard_until INTEGER NOT NULL,
        resurrect_until INTEGER NOT NULL
      )
    `);
  }

  /** Identity-specific D1 fence. HeroPresence overrides these two seams and reuses lease logic. */
  protected acquireIdentityEpoch(identityId: string): Promise<number | null> {
    return acquireSessionEpoch(createDb(this.env.DB), identityId);
  }

  protected handoffIdentityLocation(
    identityId: string,
    sessionEpoch: number,
    destination: Pick<HandoffPresence, "zoneId" | "instanceId" | "x" | "y">,
  ): Promise<number | null> {
    return handoffProfileLocation(
      createDb(this.env.DB),
      { id: identityId, sessionEpoch },
      destination,
    );
  }

  acquire(request: AcquirePresence): Promise<PresenceLease> {
    return this.#serialized(() => this.#acquire(request));
  }

  renew(connectionId: string, sessionEpoch: number): Promise<boolean> {
    return this.#serialized(async () => {
      const current = this.#current();
      const now = Date.now();
      if (
        !current ||
        current.connectionId !== connectionId ||
        current.sessionEpoch !== sessionEpoch ||
        current.expiresAt <= now
      ) {
        if (current && current.expiresAt <= now) this.#clear();
        return false;
      }
      const expiresAt = now + this.#ttlMs;
      this.ctx.storage.sql.exec(
        "UPDATE active_presence SET expires_at = ? WHERE singleton = 1",
        expiresAt,
      );
      await this.#scheduleAlarm();
      return true;
    });
  }

  isAuthorized(connectionId: string, sessionEpoch: number, roomKey: string): Promise<boolean> {
    return this.#serialized(async () => {
      const current = this.#current();
      const now = Date.now();
      if (current && current.expiresAt <= now) {
        this.#clear();
        await this.#scheduleAlarm();
        return false;
      }
      return (
        current?.connectionId === connectionId &&
        current.sessionEpoch === sessionEpoch &&
        current.roomKey === roomKey
      );
    });
  }

  release(connectionId: string, sessionEpoch: number): Promise<boolean> {
    return this.#serialized(async () => {
      const current = this.#current();
      if (current?.connectionId !== connectionId || current.sessionEpoch !== sessionEpoch) {
        return false;
      }
      this.#clear();
      await this.#scheduleAlarm();
      return true;
    });
  }

  /**
   * The source World has already frozen and saved its player. This conditional D1 update moves
   * the durable location and increments the epoch in one statement, fencing every late source
   * save before the browser is asked to reconnect.
   */
  handoff(request: HandoffPresence): Promise<PresenceLease | null> {
    return this.#serialized(() => this.#handoff(request));
  }

  checkpointCooldowns(
    connectionId: string,
    sessionEpoch: number,
    cooldowns: CombatCooldownState,
    now = Date.now(),
  ): Promise<boolean> {
    return this.#serialized(async () => {
      const current = this.#current();
      if (
        !current ||
        current.connectionId !== connectionId ||
        current.sessionEpoch !== sessionEpoch ||
        current.expiresAt <= Date.now()
      ) {
        return false;
      }
      this.#writeCooldowns(sessionEpoch, normalizeCombatCooldowns(cooldowns, now));
      await this.#scheduleAlarm();
      return true;
    });
  }

  readCooldowns(
    connectionId: string,
    sessionEpoch: number,
    now = Date.now(),
  ): Promise<CombatCooldownState | null> {
    return this.#serialized(async () => {
      const current = this.#current();
      if (
        !current ||
        current.connectionId !== connectionId ||
        current.sessionEpoch !== sessionEpoch ||
        current.expiresAt <= Date.now()
      ) {
        return null;
      }
      const stored = this.#storedCooldowns(now);
      if (!stored || stored.sessionEpoch !== sessionEpoch) return emptyCombatCooldowns();
      await this.#scheduleAlarm();
      return stored.state;
    });
  }

  /** Used by character deletion and by tests that need deterministic expiry without sleeping. */
  expireAt(now = Date.now()): Promise<boolean> {
    return this.#serialized(async () => {
      const current = this.#current();
      const expired = current !== null && current.expiresAt <= now;
      if (expired) this.#clear();
      this.#storedCooldowns(now);
      await this.#scheduleAlarm();
      return expired;
    });
  }

  revoke(closeCode = WS_CLOSE.CHARACTER_DELETED, reason = "character deleted"): Promise<boolean> {
    return this.#serialized(async () => {
      const current = this.#current();
      this.#clear();
      this.#clearCooldowns();
      await this.ctx.storage.deleteAlarm();
      if (!current) return false;
      await this.#invalidateRoom(current, closeCode, reason);
      return true;
    });
  }

  current(): Promise<PresenceLease | null> {
    return this.#serialized(async () => this.#current());
  }

  override async alarm(): Promise<void> {
    await this.expireAt(Date.now());
  }

  async #acquire(request: AcquirePresence): Promise<PresenceLease> {
    if (
      !validIdentity(request.characterId) ||
      !validIdentity(request.connectionId) ||
      !validIdentity(request.roomKey) ||
      !validIdentity(request.zoneId) ||
      !validIdentity(request.instanceId)
    ) {
      throw new Error("invalid presence acquisition");
    }

    const previous = this.#current();
    if (previous && previous.connectionId !== request.connectionId) {
      // Freeze and persist the old owner while its D1 epoch is still valid. If the room is gone,
      // acquisition still proceeds and the epoch increment below fences every late write.
      await this.#invalidateRoom(
        previous,
        WS_CLOSE.CHARACTER_REPLACED,
        "same character connected elsewhere",
      );
    }

    const sessionEpoch = await this.acquireIdentityEpoch(request.characterId);
    if (sessionEpoch === null) throw new Error("unknown character");

    const now = Date.now();
    const lease: PresenceLease = {
      ...request,
      sessionEpoch,
      acquiredAt: now,
      expiresAt: now + this.#ttlMs,
    };
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO active_presence
       (singleton, character_id, connection_id, session_epoch, room_key, zone_id, instance_id,
        acquired_at, expires_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      lease.characterId,
      lease.connectionId,
      lease.sessionEpoch,
      lease.roomKey,
      lease.zoneId,
      lease.instanceId,
      lease.acquiredAt,
      lease.expiresAt,
    );
    this.#promoteCooldowns(lease.sessionEpoch, now);
    await this.#scheduleAlarm();

    return lease;
  }

  async #handoff(request: HandoffPresence): Promise<PresenceLease | null> {
    const current = this.#current();
    if (
      !current ||
      current.expiresAt <= Date.now() ||
      current.characterId !== request.characterId ||
      current.connectionId !== request.connectionId ||
      current.sessionEpoch !== request.sessionEpoch ||
      current.roomKey !== request.sourceRoomKey ||
      !validIdentity(request.destinationRoomKey) ||
      !validIdentity(request.zoneId) ||
      !validIdentity(request.instanceId) ||
      !Number.isFinite(request.x) ||
      !Number.isFinite(request.y)
    ) {
      if (current && current.expiresAt <= Date.now()) this.#clear();
      return null;
    }

    const nextEpoch = await this.handoffIdentityLocation(
      current.characterId,
      current.sessionEpoch,
      request,
    );
    if (nextEpoch === null) return null;

    const now = Date.now();
    const next: PresenceLease = {
      characterId: current.characterId,
      connectionId: current.connectionId,
      sessionEpoch: nextEpoch,
      roomKey: request.destinationRoomKey,
      zoneId: request.zoneId,
      instanceId: request.instanceId,
      acquiredAt: now,
      expiresAt: now + this.#ttlMs,
    };
    this.ctx.storage.sql.exec(
      `UPDATE active_presence
       SET session_epoch = ?, room_key = ?, zone_id = ?, instance_id = ?, acquired_at = ?, expires_at = ?
       WHERE singleton = 1`,
      next.sessionEpoch,
      next.roomKey,
      next.zoneId,
      next.instanceId,
      next.acquiredAt,
      next.expiresAt,
    );
    this.#promoteCooldowns(next.sessionEpoch, now);
    await this.#scheduleAlarm();
    return next;
  }

  async #invalidateRoom(lease: PresenceLease, closeCode: number, reason: string): Promise<void> {
    try {
      await this.env.WORLD.getByName(lease.roomKey).invalidatePresence(
        lease.characterId,
        lease.connectionId,
        closeCode,
        reason,
      );
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "presence_invalidation_failed",
          characterId: lease.characterId,
          connectionId: lease.connectionId,
          sessionEpoch: lease.sessionEpoch,
          roomKey: lease.roomKey,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  #current(): PresenceLease | null {
    const row = this.ctx.storage.sql
      .exec<PresenceRow>(
        `SELECT character_id, connection_id, session_epoch, room_key, zone_id, instance_id,
                acquired_at, expires_at
         FROM active_presence WHERE singleton = 1`,
      )
      .toArray()[0];
    return row
      ? {
          characterId: row.character_id,
          connectionId: row.connection_id,
          sessionEpoch: row.session_epoch,
          roomKey: row.room_key,
          zoneId: row.zone_id,
          instanceId: row.instance_id,
          acquiredAt: row.acquired_at,
          expiresAt: row.expires_at,
        }
      : null;
  }

  #clear(): void {
    this.ctx.storage.sql.exec("DELETE FROM active_presence WHERE singleton = 1");
  }

  #cooldownRow(): CooldownRow | undefined {
    return this.ctx.storage.sql
      .exec<CooldownRow>(
        `SELECT session_epoch, attack_until, heal_until,
                skill_1_until, skill_2_until, skill_3_until, skill_4_until, skill_5_until,
                guard_until, resurrect_until
         FROM combat_cooldowns WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  #storedCooldowns(now: number): { sessionEpoch: number; state: CombatCooldownState } | null {
    const row = this.#cooldownRow();
    if (!row) return null;
    const state = normalizeCombatCooldowns(
      {
        attackUntil: row.attack_until,
        healUntil: row.heal_until,
        skillCooldowns: [
          row.skill_1_until,
          row.skill_2_until,
          row.skill_3_until,
          row.skill_4_until,
          row.skill_5_until,
        ],
        guardUntil: row.guard_until,
        resurrectUntil: row.resurrect_until,
      },
      now,
    );
    if (!hasActiveCombatCooldowns(state)) {
      this.#clearCooldowns();
      return null;
    }
    this.#writeCooldowns(row.session_epoch, state);
    return { sessionEpoch: row.session_epoch, state };
  }

  #writeCooldowns(sessionEpoch: number, state: CombatCooldownState): void {
    if (!hasActiveCombatCooldowns(state)) {
      this.#clearCooldowns();
      return;
    }
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO combat_cooldowns
       (singleton, session_epoch, attack_until, heal_until,
        skill_1_until, skill_2_until, skill_3_until, skill_4_until, skill_5_until,
        guard_until, resurrect_until)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionEpoch,
      state.attackUntil,
      state.healUntil,
      ...state.skillCooldowns,
      state.guardUntil,
      state.resurrectUntil,
    );
  }

  #promoteCooldowns(sessionEpoch: number, now: number): void {
    const stored = this.#storedCooldowns(now);
    if (stored) this.#writeCooldowns(sessionEpoch, stored.state);
  }

  #clearCooldowns(): void {
    this.ctx.storage.sql.exec("DELETE FROM combat_cooldowns WHERE singleton = 1");
  }

  async #scheduleAlarm(): Promise<void> {
    const now = Date.now();
    const deadlines: number[] = [];
    const current = this.#current();
    if (current && current.expiresAt > now) deadlines.push(current.expiresAt);
    const stored = this.#storedCooldowns(now);
    if (stored) deadlines.push(latestCombatCooldown(stored.state));
    const next = deadlines.filter((deadline) => deadline > now).sort((a, b) => a - b)[0];
    if (next === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operations.then(operation, operation);
    this.#operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
