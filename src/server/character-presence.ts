import { DurableObject } from "cloudflare:workers";
import { WS_CLOSE } from "../shared/close-codes.js";
import { createDb } from "./db/index.js";
import { acquireSessionEpoch } from "./profile.js";

export const PRESENCE_TTL_MS = 30_000;
export const PRESENCE_HEARTBEAT_MS = 10_000;

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

function validIdentity(value: string): boolean {
  return value.length > 0 && value.length <= 128;
}

/** One deterministic coordinator per character. D1 owns the monotone epoch; this DO owns its lease. */
export class CharacterPresence extends DurableObject<Env> {
  #operations: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
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
      const expiresAt = now + PRESENCE_TTL_MS;
      this.ctx.storage.sql.exec(
        "UPDATE active_presence SET expires_at = ? WHERE singleton = 1",
        expiresAt,
      );
      await this.ctx.storage.setAlarm(expiresAt);
      return true;
    });
  }

  isAuthorized(connectionId: string, sessionEpoch: number, roomKey: string): Promise<boolean> {
    return this.#serialized(async () => {
      const current = this.#current();
      const now = Date.now();
      if (current && current.expiresAt <= now) {
        this.#clear();
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
      await this.ctx.storage.deleteAlarm();
      return true;
    });
  }

  /** Used by character deletion and by tests that need deterministic expiry without sleeping. */
  expireAt(now = Date.now()): Promise<boolean> {
    return this.#serialized(async () => {
      const current = this.#current();
      if (!current || current.expiresAt > now) return false;
      this.#clear();
      await this.ctx.storage.deleteAlarm();
      return true;
    });
  }

  revoke(closeCode = WS_CLOSE.CHARACTER_DELETED, reason = "character deleted"): Promise<boolean> {
    return this.#serialized(async () => {
      const current = this.#current();
      if (!current) return false;
      this.#clear();
      await this.ctx.storage.deleteAlarm();
      await this.#invalidateRoom(current, closeCode, reason);
      return true;
    });
  }

  current(): Promise<PresenceLease | null> {
    return this.#serialized(async () => this.#current());
  }

  override async alarm(): Promise<void> {
    await this.expireAt();
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

    const sessionEpoch = await acquireSessionEpoch(createDb(this.env.DB), request.characterId);
    if (sessionEpoch === null) throw new Error("unknown character");

    const now = Date.now();
    const lease: PresenceLease = {
      ...request,
      sessionEpoch,
      acquiredAt: now,
      expiresAt: now + PRESENCE_TTL_MS,
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
    await this.ctx.storage.setAlarm(lease.expiresAt);

    return lease;
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

  #serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operations.then(operation, operation);
    this.#operations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
