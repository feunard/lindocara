/**
 * The account boundary: username/password → a signed-session-worthy identity.
 * Callers validate input shape (see session.ts); this module owns storage and hashing.
 */

import { eq } from "drizzle-orm";
import { account, type Db } from "./db/index.js";
import { hashPassword, PBKDF2_ITERATIONS, verifyPassword } from "./password.js";

export interface AccountIdentity {
  id: string;
  username: string;
}

/** Usernames are stored lowercase so the UNIQUE constraint is case-insensitive. */
export function normalizeUsername(username: string): string {
  return username.toLowerCase();
}

/** Drizzle wraps the D1 driver error ("Failed query: ...") with the real SQLITE_CONSTRAINT
 *  message reachable only via `.cause`. Walk the chain rather than trusting the top message. */
function causedByUnique(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.message.includes("UNIQUE")) return true;
    current = current.cause;
  }
  return false;
}

export async function createAccount(
  db: Db,
  username: string,
  password: string,
  targetIterations = PBKDF2_ITERATIONS,
): Promise<AccountIdentity | "username_taken"> {
  const normalized = normalizeUsername(username);
  const record = await hashPassword(password, targetIterations);
  const id = crypto.randomUUID();
  const now = new Date();
  try {
    await db.insert(account).values({
      id,
      username: normalized,
      passwordHash: record.hash,
      passwordSalt: record.salt,
      passwordIterations: record.iterations,
      createdAt: now,
      lastSeenAt: now,
    });
  } catch (error) {
    // The UNIQUE constraint is the source of truth — no read-then-write race. Anything else
    // (a transient D1 error, a schema mismatch) is a real failure and must not be masked as
    // a username collision.
    if (causedByUnique(error)) return "username_taken";
    throw error;
  }
  return { id, username: normalized };
}

export async function accountExists(db: Db, id: string): Promise<boolean> {
  const row = await db.select({ id: account.id }).from(account).where(eq(account.id, id)).get();
  return row !== undefined;
}

export async function verifyCredentials(
  db: Db,
  username: string,
  password: string,
  targetIterations = PBKDF2_ITERATIONS,
): Promise<AccountIdentity | null> {
  const row = await db
    .select()
    .from(account)
    .where(eq(account.username, normalizeUsername(username)))
    .get();
  if (!row) {
    // Burn the same PBKDF2 cost as a real check so "unknown user" and "wrong password"
    // are indistinguishable by response time as well as by response body.
    await hashPassword(password, targetIterations);
    return null;
  }
  const ok = await verifyPassword(password, {
    hash: row.passwordHash,
    salt: row.passwordSalt,
    iterations: row.passwordIterations,
  });
  if (!ok) return null;
  const upgraded =
    row.passwordIterations < targetIterations
      ? await hashPassword(password, targetIterations)
      : null;
  await db
    .update(account)
    .set(
      upgraded
        ? {
            lastSeenAt: new Date(),
            passwordHash: upgraded.hash,
            passwordSalt: upgraded.salt,
            passwordIterations: upgraded.iterations,
          }
        : { lastSeenAt: new Date() },
    )
    .where(eq(account.id, row.id));
  return { id: row.id, username: row.username };
}
