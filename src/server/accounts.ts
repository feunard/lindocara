/**
 * The account boundary: username/password → a signed-session-worthy identity.
 * Callers validate input shape (see session.ts); this module owns storage and hashing.
 */

import { eq } from "drizzle-orm";
import { account, type Db } from "./db/index.js";
import { hashPassword, verifyPassword } from "./password.js";

export interface AccountIdentity {
  id: string;
  username: string;
}

/** Usernames are stored lowercase so the UNIQUE constraint is case-insensitive. */
export function normalizeUsername(username: string): string {
  return username.toLowerCase();
}

export async function createAccount(
  db: Db,
  username: string,
  password: string,
): Promise<AccountIdentity | "username_taken"> {
  const normalized = normalizeUsername(username);
  const record = await hashPassword(password);
  const id = crypto.randomUUID();
  try {
    await db.insert(account).values({
      id,
      username: normalized,
      passwordHash: record.hash,
      passwordSalt: record.salt,
      passwordIterations: record.iterations,
    });
  } catch {
    // The UNIQUE constraint is the source of truth — no read-then-write race.
    return "username_taken";
  }
  return { id, username: normalized };
}

export async function verifyCredentials(
  db: Db,
  username: string,
  password: string,
): Promise<AccountIdentity | null> {
  const row = await db
    .select()
    .from(account)
    .where(eq(account.username, normalizeUsername(username)))
    .get();
  if (!row) {
    // Burn the same PBKDF2 cost as a real check so "unknown user" and "wrong password"
    // are indistinguishable by response time as well as by response body.
    await hashPassword(password);
    return null;
  }
  const ok = await verifyPassword(password, {
    hash: row.passwordHash,
    salt: row.passwordSalt,
    iterations: row.passwordIterations,
  });
  if (!ok) return null;
  await db.update(account).set({ lastSeenAt: new Date() }).where(eq(account.id, row.id));
  return { id: row.id, username: row.username };
}
