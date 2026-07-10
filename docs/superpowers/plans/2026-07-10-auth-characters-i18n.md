# Accounts, Character Select, and FR/EN i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace anonymous nickname login with username/password accounts owning up to 3 characters (create/select/delete screens), and localize every player-facing string in English and French.

**Architecture:** New `account` + `character` D1 tables replace `player` (drop-and-recreate). The Worker gains `/api/register`, password login, and character CRUD; the world joins via `/api/ws?character=<id>` after an ownership check. i18n is client-side: typed `en`/`fr` dictionaries in `src/shared/i18n/` (platform-free data), a DOM-aware `t()` layer in `src/client/i18n.ts`, and server events converted from English prose to `code + params` on the wire.

**Tech Stack:** Cloudflare Workers + Durable Objects, D1 + Drizzle, WebCrypto PBKDF2-SHA256, Vite/PixiJS client, Vitest in workerd, Biome.

**Spec:** `docs/superpowers/specs/2026-07-10-auth-characters-i18n-design.md`

## Global Constraints

- Biome `noNonNullAssertion` is on: never write `!`, narrow properly. Run `npm run lint:fix` before every commit.
- `src/shared/` imports nothing from Cloudflare or the DOM (checked by both client and worker tsconfigs).
- Tests must not import DOM-touching client files (`src/client/i18n.ts`, `main.ts`, …) — only `src/shared/` and `src/server/`.
- Never trust a client message; parsers return `null` and the frame is dropped.
- Tests drive the real Durable Object over real WebSockets. The world DO is a singleton per test file: assert on which ids are present, never how many.
- The test pool does not isolate D1 between tests: truncate in `afterEach` (`DELETE FROM character` before `DELETE FROM account` — FK), never `reset()`.
- Usernames: pattern `^[A-Za-z0-9_-]{2,16}$`, stored lowercase (uniqueness is case-insensitive by normalization). Passwords: 8–128 chars, no complexity rules. Character names: same pattern as usernames, NOT unique.
- `MAX_CHARACTERS_PER_ACCOUNT = 3`. `PBKDF2_ITERATIONS = 100_000`.
- localStorage key `lindocara_locale`, values `"en" | "fr"`.
- API error bodies carry stable machine codes (`{ "error": "username_taken" }`), never English sentences — the client maps codes to i18n keys.
- The wire keeps the field name `nick` in `PlayerSnapshot`/`Attachment`; it now means "character name". Do not rename it.
- Commit at the end of every task. `npm run check` must pass at every commit **except** the noted transitional ones (client login is broken between Task 4 and Task 8 at runtime; typecheck/tests stay green throughout).

## Pre-flight (before Task 1)

- [ ] The repo has staged deletions (root screenshots + `.codex-dev.*.log`) and a modified `.gitignore` from an earlier cleanup. Commit them first, alone:

```bash
git commit -m "Remove dev/verification scratch artifacts from tracking"
```

- [ ] Create the feature branch:

```bash
git checkout -b feature/auth-characters-i18n
```

---

### Task 1: PBKDF2 password hashing

**Files:**
- Create: `src/server/password.ts`
- Test: `test/password.test.ts`

**Interfaces:**
- Produces: `PBKDF2_ITERATIONS: number`, `interface PasswordRecord { hash: string; salt: string; iterations: number }`, `hashPassword(password: string, iterations?: number): Promise<PasswordRecord>`, `verifyPassword(password: string, record: PasswordRecord): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/password.test.ts
import { describe, expect, it } from "vitest";
import { hashPassword, PBKDF2_ITERATIONS, verifyPassword } from "../src/server/password.js";

describe("password hashing", () => {
  it("round-trips a password", async () => {
    const record = await hashPassword("correct horse battery staple");
    expect(record.iterations).toBe(PBKDF2_ITERATIONS);
    expect(await verifyPassword("correct horse battery staple", record)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const record = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery stable", record)).toBe(false);
    expect(await verifyPassword("", record)).toBe(false);
  });

  it("salts every hash uniquely", async () => {
    const first = await hashPassword("same password");
    const second = await hashPassword("same password");
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it("verifies a record hashed with a legacy iteration count", async () => {
    // The count is stored per-row so it can be raised later without breaking old accounts.
    const legacy = await hashPassword("old password", 50_000);
    expect(legacy.iterations).toBe(50_000);
    expect(await verifyPassword("old password", legacy)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/password.test.ts`
Expected: FAIL — cannot resolve `../src/server/password.js`

- [ ] **Step 3: Write the implementation**

```ts
// src/server/password.ts
/**
 * PBKDF2-SHA256 password hashing via WebCrypto — native in workerd, zero dependencies.
 *
 * The iteration count is stored alongside each hash so it can be raised later without
 * invalidating existing accounts: an old row verifies with its recorded count, and new
 * accounts pick up the new constant.
 */

export const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

export interface PasswordRecord {
  /** base64 of the derived bits */
  hash: string;
  /** base64 of the per-account random salt */
  salt: string;
  iterations: number;
}

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as ArrayBuffer, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<PasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return { hash: toBase64(hash), salt: toBase64(salt), iterations };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const expected = fromBase64(record.hash);
  const actual = await derive(password, fromBase64(record.salt), record.iterations);
  if (expected.length !== actual.length) return false;
  // Constant-time comparison: never early-exit on the first differing byte.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= (expected[i] ?? 0) ^ (actual[i] ?? 0);
  return diff === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/password.test.ts`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/server/password.ts test/password.test.ts
git commit -m "Add PBKDF2-SHA256 password hashing"
```

---

### Task 2: `account` + `character` schema, drop `player`

**Files:**
- Modify: `src/server/db/schema.ts` (full rewrite below)
- Create: `migrations/0002_*.sql` (generated)
- Modify: `test/db.test.ts` (full rewrite below; Task 3 extends it)

**Interfaces:**
- Produces: Drizzle tables `account`, `character` (exported from `src/server/db/index.js` via `export * from "./schema.js"`); types `Account`, `NewAccount`, `Character`, `NewCharacter`. The `player` table and its types are GONE — `src/server/profile.ts` still imports them, so **profile.ts is rewritten in this same task** (minimal version; services come in Task 3).
- Consumes: nothing new.

- [ ] **Step 1: Rewrite the schema**

Replace the entire contents of `src/server/db/schema.ts`:

```ts
/**
 * The D1 schema: accounts own up to three characters.
 *
 * `username` is stored lowercase, so its UNIQUE constraint is case-insensitive by
 * construction — "Nico" and "nico" are the same account. Character `name` is deliberately
 * NOT unique: accounts claim usernames; characters do not claim names.
 */

import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Milliseconds since the epoch, as SQLite integers. `unixepoch()` is seconds. */
const nowMs = sql`(unixepoch() * 1000)`;

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  /** Always lowercase — normalized before every read and write. */
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  /** Stored per-row so PBKDF2_ITERATIONS can be raised without breaking old accounts. */
  passwordIterations: integer("password_iterations").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const character = sqliteTable(
  "character",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    x: real("x").notNull().default(784),
    y: real("y").notNull().default(450),
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),
    hp: integer("hp").notNull().default(100),
    appearance: text("appearance", {
      enum: ["azure", "ember", "moss", "violet"],
    })
      .notNull()
      .default("azure"),
    potions: integer("potions").notNull().default(2),
    gold: integer("gold").notNull().default(0),
    crystals: integer("crystals").notNull().default(0),
    weapon: text("weapon", { enum: ["rusty_sword"] })
      .notNull()
      .default("rusty_sword"),
    questStatus: text("quest_status", {
      enum: ["available", "active", "ready", "completed"],
    })
      .notNull()
      .default("available"),
    questProgress: integer("quest_progress").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [index("character_account_idx").on(table.accountId)],
);

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type Character = typeof character.$inferSelect;
export type NewCharacter = typeof character.$inferInsert;
```

- [ ] **Step 2: Rewrite `src/server/profile.ts` to compile against the new schema**

Minimal version — the world's load/save boundary only. (Character creation moves to `characters.ts` in Task 3; `loadOrCreateProfile` and `appearanceForId` are deleted.)

```ts
// src/server/profile.ts — full replacement
import { eq } from "drizzle-orm";
import { clampRestoredPosition, maxHpForLevel } from "../shared/game.js";
import type { Appearance, Inventory, QuestState } from "../shared/protocol.js";
import type { Vec2 } from "../shared/simulation.js";
import { type Character, character, type Db } from "./db/index.js";

export interface PlayerProfile extends Vec2 {
  id: string;
  nick: string;
  level: number;
  xp: number;
  hp: number;
  appearance: Appearance;
  inventory: Inventory;
  quest: QuestState;
}

function fromRow(row: Character): PlayerProfile {
  const position = clampRestoredPosition({ x: row.x, y: row.y }, row.id);
  const maxHp = maxHpForLevel(row.level);
  return {
    id: row.id,
    nick: row.name,
    ...position,
    level: Math.max(1, row.level),
    xp: Math.max(0, row.xp),
    hp: Math.min(maxHp, Math.max(1, row.hp)),
    appearance: row.appearance,
    inventory: {
      potions: Math.max(0, row.potions),
      gold: Math.max(0, row.gold),
      crystals: Math.max(0, row.crystals),
      weapon: row.weapon,
    },
    quest: {
      status: row.questStatus,
      progress: Math.max(0, row.questProgress),
      target: 3,
    },
  };
}

/**
 * Load by character id, never create. Characters exist only through POST /api/characters,
 * so a missing row here means the socket must be refused.
 */
export async function loadProfile(db: Db, characterId: string): Promise<PlayerProfile | null> {
  const row = await db.select().from(character).where(eq(character.id, characterId)).get();
  if (!row) return null;
  await db.update(character).set({ lastSeenAt: new Date() }).where(eq(character.id, characterId));
  return fromRow(row);
}

export type SaveableProfile = PlayerProfile;

export async function saveProfile(db: Db, profile: SaveableProfile): Promise<void> {
  await db
    .update(character)
    .set({
      name: profile.nick,
      x: profile.x,
      y: profile.y,
      level: profile.level,
      xp: profile.xp,
      hp: profile.hp,
      appearance: profile.appearance,
      potions: profile.inventory.potions,
      gold: profile.inventory.gold,
      crystals: profile.inventory.crystals,
      weapon: profile.inventory.weapon,
      questStatus: profile.quest.status,
      questProgress: profile.quest.progress,
      lastSeenAt: new Date(),
    })
    .where(eq(character.id, profile.id));
}
```

- [ ] **Step 3: Patch `src/server/world.ts` to compile (transitional)**

`world.ts:229` calls `loadOrCreateProfile(createDb(this.env.DB), id, nick)`. Replace with:

```ts
const profile = await loadProfile(createDb(this.env.DB), id);
if (!profile) return new Response("unknown character", { status: 404 });
```

and change the import at `world.ts:61-66` from `loadOrCreateProfile` to `loadProfile`. The headers are still `x-player-id`/`x-player-nick` at this point (Task 6 renames them); the `nick` header is now unused — remove the `const nick = ...` line and drop `|| !nick` from the guard, keeping `if (!id) return new Response("unauthorized", { status: 401 });`.

**Transitional note:** between this task and Task 6, joining the world requires a character row to already exist. `test/world.test.ts` will fail until its helper is updated — update it NOW as part of this task's Step 5.

- [ ] **Step 4: Generate and inspect the migration**

```bash
npm run db:generate
```

Expected: a new `migrations/0002_<adjective>_<name>.sql` containing `CREATE TABLE account`, `CREATE TABLE character`, `CREATE INDEX character_account_idx`, a UNIQUE constraint/index on `account.username`, and `DROP TABLE player`. Open it and verify all five are present. Apply locally:

```bash
npm run db:migrate
```

- [ ] **Step 5: Update `test/world.test.ts`'s join helper (transitional shim)**

The old helper POSTs `{nickname}` to `/api/session`. Auth doesn't exist yet, so shim it: keep `testSession` as-is (it still works — `/api/session` is unchanged until Task 4), but the DO now refuses ids without a character row. Insert one directly. Replace the `Client.join` body's session/DB section (`world.test.ts:87-99`) with:

```ts
  static async join(
    nickname: string,
    options: { pump?: boolean; position?: { x: number; y: number } } = {},
  ): Promise<Client> {
    const session = await testSession(nickname);
    const spawn = options.position ?? { x: 784, y: 450 };
    await env.DB.prepare(
      "INSERT INTO account (id, username, password_hash, password_salt, password_iterations) VALUES (?, ?, 'x', 'x', 1)",
    )
      .bind(`acct-${session.id}`, `u-${session.id}`.slice(0, 16).toLowerCase())
      .run();
    await env.DB.prepare(
      "INSERT INTO character (id, account_id, name, x, y) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(session.id, `acct-${session.id}`, nickname, spawn.x, spawn.y)
      .run();
    const response = await SELF.fetch(`${ORIGIN}/api/ws`, {
      headers: { Upgrade: "websocket", Cookie: session.cookie },
    });
```

One assertion needs adjusting: the "welcomes a player" test expects `spawnPosition(welcome.selfId)` — the shim inserts a fixed position instead, so change that assertion to `toMatchObject({ x: 784, y: 450 })`. (Task 6 replaces this whole shim with the real register→create→join flow and restores spawn semantics.)

- [ ] **Step 6: Rewrite `test/db.test.ts`**

Full replacement:

```ts
/**
 * Schema tests: the generated migration, the Drizzle types, and the tables cannot silently
 * drift apart. Service-level behavior (accounts, characters) is tested alongside in Task 3.
 */

import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { account, character, createDb } from "../src/server/db/index.js";
import { loadProfile, saveProfile } from "../src/server/profile.js";

describe("account and character tables", () => {
  // The pool does not isolate storage between tests. Truncate children before parents (FK).
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  it("creates both tables and drops player", async () => {
    const { results } = await env.DB.prepare(
      "select name from sqlite_master where type = 'table' and name in ('account', 'character', 'player')",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(["account", "character"]);
  });

  it("has the account columns the schema declares", async () => {
    const { results } = await env.DB.prepare("pragma table_info(account)").all<{
      name: string;
      notnull: number;
      pk: number;
    }>();
    const columns = Object.fromEntries(results.map((c) => [c.name, c]));
    expect(Object.keys(columns).sort()).toEqual([
      "created_at",
      "id",
      "last_seen_at",
      "password_hash",
      "password_iterations",
      "password_salt",
      "username",
    ]);
    expect(columns.id?.pk).toBe(1);
    expect(columns.username?.notnull).toBe(1);
  });

  it("enforces unique usernames", async () => {
    const db = createDb(env.DB);
    const row = {
      id: "a1",
      username: "nico",
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    };
    await db.insert(account).values(row);
    await expect(db.insert(account).values({ ...row, id: "a2" })).rejects.toThrow();
  });

  it("has the character columns the schema declares", async () => {
    const { results } = await env.DB.prepare("pragma table_info(character)").all<{
      name: string;
    }>();
    expect(results.map((c) => c.name).sort()).toEqual([
      "account_id",
      "appearance",
      "created_at",
      "crystals",
      "gold",
      "hp",
      "id",
      "last_seen_at",
      "level",
      "name",
      "potions",
      "quest_progress",
      "quest_status",
      "weapon",
      "x",
      "xp",
      "y",
    ]);
  });

  it("round-trips a character through Drizzle, defaulting the game columns", async () => {
    const db = createDb(env.DB);
    await db.insert(account).values({
      id: "acct-1",
      username: "owner",
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    });
    await db.insert(character).values({ id: "char-1", accountId: "acct-1", name: "Hero" });

    const rows = await db.select().from(character);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "char-1",
      accountId: "acct-1",
      name: "Hero",
      x: 784,
      y: 450,
      level: 1,
      xp: 0,
      hp: 100,
      appearance: "azure",
      potions: 2,
      gold: 0,
      crystals: 0,
      weapon: "rusty_sword",
      questStatus: "available",
      questProgress: 0,
    });
    expect(rows[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("loadProfile returns null for an unknown character and never creates", async () => {
    const db = createDb(env.DB);
    expect(await loadProfile(db, "no-such-character")).toBeNull();
    expect(await db.select().from(character)).toEqual([]);
  });

  it("persists and restores progression through the profile service", async () => {
    const db = createDb(env.DB);
    await db.insert(account).values({
      id: "acct-2",
      username: "owner2",
      passwordHash: "h",
      passwordSalt: "s",
      passwordIterations: 1,
    });
    await db.insert(character).values({ id: "char-2", accountId: "acct-2", name: "Hero2" });

    const profile = await loadProfile(db, "char-2");
    if (!profile) throw new Error("expected a profile");
    profile.x = 321;
    profile.y = 432;
    profile.level = 4;
    profile.xp = 37;
    profile.hp = 88;
    profile.inventory.gold = 19;
    profile.quest.status = "active";
    profile.quest.progress = 2;
    await saveProfile(db, profile);

    const restored = await loadProfile(db, "char-2");
    expect(restored).toMatchObject({
      id: "char-2",
      nick: "Hero2",
      x: 321,
      y: 432,
      level: 4,
      xp: 37,
      hp: 88,
      inventory: { gold: 19 },
      quest: { status: "active", progress: 2 },
    });
  });
});
```

- [ ] **Step 7: Run the full check**

Run: `npm run check`
Expected: PASS (lint, 3 typechecks, all tests — including the shimmed world tests).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Replace player table with account + character schema"
```

---

### Task 3: Account and character services

**Files:**
- Create: `src/server/accounts.ts`, `src/server/characters.ts`
- Test: extend `test/db.test.ts` (new describe blocks)

**Interfaces:**
- Consumes: `hashPassword`/`verifyPassword` (Task 1), `account`/`character` tables (Task 2).
- Produces:
  - `accounts.ts`: `interface AccountIdentity { id: string; username: string }`, `normalizeUsername(username: string): string`, `createAccount(db: Db, username: string, password: string): Promise<AccountIdentity | "username_taken">`, `verifyCredentials(db: Db, username: string, password: string): Promise<AccountIdentity | null>`.
  - `characters.ts`: `MAX_CHARACTERS_PER_ACCOUNT = 3`, `isValidCharacterName(v: unknown): v is string`, `isValidAppearance(v: unknown): v is Appearance`, `interface CharacterSummary { id: string; name: string; appearance: Appearance; level: number }`, `listCharacters(db, accountId): Promise<CharacterSummary[]>`, `createCharacter(db, accountId, name, appearance): Promise<CharacterSummary | "limit_reached">`, `deleteCharacter(db, accountId, characterId): Promise<boolean>`, `characterOwnedBy(db, accountId, characterId): Promise<CharacterSummary | null>`.

- [ ] **Step 1: Write the failing tests** (append to `test/db.test.ts`, inside the file but as new top-level describes; they rely on the same `afterEach` truncation, so give them their own copy)

```ts
import {
  createAccount,
  normalizeUsername,
  verifyCredentials,
} from "../src/server/accounts.js";
import {
  characterOwnedBy,
  createCharacter,
  deleteCharacter,
  listCharacters,
  MAX_CHARACTERS_PER_ACCOUNT,
} from "../src/server/characters.js";
import { spawnPosition } from "../src/shared/game.js";

describe("accounts service", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  it("creates an account and verifies its credentials", async () => {
    const db = createDb(env.DB);
    const created = await createAccount(db, "Nico", "a good password");
    if (created === "username_taken") throw new Error("unexpected collision");
    expect(created.username).toBe("nico"); // stored lowercase

    expect(await verifyCredentials(db, "nico", "a good password")).toMatchObject({
      id: created.id,
    });
    // Login is case-insensitive on the username…
    expect(await verifyCredentials(db, "NICO", "a good password")).toMatchObject({
      id: created.id,
    });
    // …but never on the password.
    expect(await verifyCredentials(db, "nico", "A good password")).toBeNull();
    expect(await verifyCredentials(db, "stranger", "a good password")).toBeNull();
  });

  it("rejects a duplicate username case-insensitively", async () => {
    const db = createDb(env.DB);
    await createAccount(db, "nico", "a good password");
    expect(await createAccount(db, "NiCo", "another password")).toBe("username_taken");
  });
});

describe("characters service", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  async function owner(username = "owner"): Promise<string> {
    const created = await createAccount(createDb(env.DB), username, "a good password");
    if (created === "username_taken") throw new Error("test account collision");
    return created.id;
  }

  it("creates up to the cap, then refuses", async () => {
    const db = createDb(env.DB);
    const accountId = await owner();
    for (let i = 0; i < MAX_CHARACTERS_PER_ACCOUNT; i++) {
      const created = await createCharacter(db, accountId, `Hero${i}`, "ember");
      expect(created).toMatchObject({ name: `Hero${i}`, appearance: "ember", level: 1 });
    }
    expect(await createCharacter(db, accountId, "OneTooMany", "moss")).toBe("limit_reached");
    expect(await listCharacters(db, accountId)).toHaveLength(MAX_CHARACTERS_PER_ACCOUNT);
  });

  it("spawns a new character at its deterministic plaza spawn", async () => {
    const db = createDb(env.DB);
    const created = await createCharacter(db, await owner(), "Fresh", "azure");
    if (created === "limit_reached") throw new Error("unexpected cap");
    const row = await loadProfile(db, created.id);
    expect(row).toMatchObject(spawnPosition(created.id));
  });

  it("scopes list, ownership, and delete to the owning account", async () => {
    const db = createDb(env.DB);
    const alice = await owner("alice");
    const bob = await owner("bob");
    const created = await createCharacter(db, alice, "AliceHero", "violet");
    if (created === "limit_reached") throw new Error("unexpected cap");

    expect(await listCharacters(db, bob)).toEqual([]);
    expect(await characterOwnedBy(db, alice, created.id)).toMatchObject({ id: created.id });
    expect(await characterOwnedBy(db, bob, created.id)).toBeNull();

    expect(await deleteCharacter(db, bob, created.id)).toBe(false);
    expect(await deleteCharacter(db, alice, created.id)).toBe(true);
    expect(await listCharacters(db, alice)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/db.test.ts`
Expected: FAIL — cannot resolve `../src/server/accounts.js`

- [ ] **Step 3: Implement `src/server/accounts.ts`**

```ts
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
```

- [ ] **Step 4: Implement `src/server/characters.ts`**

```ts
/**
 * Account-facing character CRUD. The world never creates characters; it only loads them
 * by id through profile.ts after the Worker has proven ownership here.
 */

import { and, eq } from "drizzle-orm";
import { maxHpForLevel, spawnPosition } from "../shared/game.js";
import type { Appearance } from "../shared/protocol.js";
import { character, type Db } from "./db/index.js";

export const MAX_CHARACTERS_PER_ACCOUNT = 3;

const NAME_PATTERN = /^[A-Za-z0-9_-]{2,16}$/;
const APPEARANCES: readonly Appearance[] = ["azure", "ember", "moss", "violet"];

export function isValidCharacterName(value: unknown): value is string {
  return typeof value === "string" && NAME_PATTERN.test(value);
}

export function isValidAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCES as readonly string[]).includes(value);
}

export interface CharacterSummary {
  id: string;
  name: string;
  appearance: Appearance;
  level: number;
}

function summary(row: {
  id: string;
  name: string;
  appearance: Appearance;
  level: number;
}): CharacterSummary {
  return { id: row.id, name: row.name, appearance: row.appearance, level: row.level };
}

export async function listCharacters(db: Db, accountId: string): Promise<CharacterSummary[]> {
  const rows = await db.select().from(character).where(eq(character.accountId, accountId));
  return rows.map(summary);
}

export async function createCharacter(
  db: Db,
  accountId: string,
  name: string,
  appearance: Appearance,
): Promise<CharacterSummary | "limit_reached"> {
  const existing = await listCharacters(db, accountId);
  if (existing.length >= MAX_CHARACTERS_PER_ACCOUNT) return "limit_reached";

  const id = crypto.randomUUID();
  const position = spawnPosition(id);
  await db.insert(character).values({
    id,
    accountId,
    name,
    ...position,
    appearance,
    hp: maxHpForLevel(1),
  });
  return { id, name, appearance, level: 1 };
}

export async function characterOwnedBy(
  db: Db,
  accountId: string,
  characterId: string,
): Promise<CharacterSummary | null> {
  const row = await db
    .select()
    .from(character)
    .where(and(eq(character.id, characterId), eq(character.accountId, accountId)))
    .get();
  return row ? summary(row) : null;
}

export async function deleteCharacter(
  db: Db,
  accountId: string,
  characterId: string,
): Promise<boolean> {
  const owned = await characterOwnedBy(db, accountId, characterId);
  if (!owned) return false;
  await db.delete(character).where(eq(character.id, characterId));
  return true;
}
```

- [ ] **Step 5: Run tests, then the full check**

Run: `npx vitest run test/db.test.ts` → all pass. Then `npm run check` → PASS.

- [ ] **Step 6: Commit**

```bash
npm run lint:fix
git add -A
git commit -m "Add account and character services"
```

---

### Task 4: Session payload + register/login endpoints

**Files:**
- Modify: `src/server/session.ts` (payload + validators)
- Modify: `src/server/index.ts` (routes)
- Modify: `test/session.test.ts`, `test/worker.test.ts` (mechanical: `nick` → `username`)
- Modify: `test/world.test.ts` (the shim's `testSession` — see Step 6)
- Create: `test/auth.test.ts`

**Interfaces:**
- Consumes: `createAccount`, `verifyCredentials` (Task 3).
- Produces: `Session` is now `{ id: string; username: string; iat: number }` where `id` is the **account** id; `isValidUsername(v: unknown): v is string` (renamed from `isValidNickname`, same pattern); `isValidPassword(v: unknown): v is string` (string, 8–128 chars); `createSession(id: string, username: string): Session`. Endpoints: `POST /api/register`, `POST /api/session` (both `{username, password}` → set cookie, return `{id, username}`), `GET /api/me` → `{id, username}`.

- [ ] **Step 1: Write the failing tests**

```ts
// test/auth.test.ts
/**
 * The account API through the real Worker: register, login, and the guarantees the
 * client relies on (case-insensitive usernames, indistinguishable 401s, machine-readable
 * error codes).
 */

import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

const ORIGIN = "https://lindocara.test";

function post(path: string, body: unknown, cookie?: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

export function cookieOf(response: Response): string {
  const header = response.headers.get("Set-Cookie");
  const pair = header?.split(";")[0];
  if (!pair) throw new Error("no session cookie issued");
  return pair;
}

describe("register and login", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  it("registers, sets a session cookie, and /api/me sees the account", async () => {
    const response = await post("/api/register", { username: "Nico", password: "12345678" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ username: "nico" });

    const me = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: cookieOf(response) } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ username: "nico" });
  });

  it("rejects a duplicate username case-insensitively with a machine code", async () => {
    await post("/api/register", { username: "taken", password: "12345678" });
    const dup = await post("/api/register", { username: "TAKEN", password: "87654321" });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "username_taken" });
  });

  it("validates username and password shape", async () => {
    expect((await post("/api/register", { username: "x", password: "12345678" })).status).toBe(400);
    expect((await post("/api/register", { username: "okname", password: "short" })).status).toBe(
      400,
    );
    expect((await post("/api/register", "not an object")).status).toBe(400);
  });

  it("logs in with the right password and rejects the wrong one", async () => {
    await post("/api/register", { username: "player1", password: "12345678" });
    const ok = await post("/api/session", { username: "PLAYER1", password: "12345678" });
    expect(ok.status).toBe(200);
    expect(cookieOf(ok)).toContain("lindocara_session=");

    const bad = await post("/api/session", { username: "player1", password: "xxxxxxxx" });
    expect(bad.status).toBe(401);
  });

  it("returns byte-identical 401s for unknown user and wrong password", async () => {
    await post("/api/register", { username: "existing", password: "12345678" });
    const wrongPassword = await post("/api/session", { username: "existing", password: "xxxxxxxx" });
    const unknownUser = await post("/api/session", { username: "phantom_", password: "xxxxxxxx" });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(await wrongPassword.text()).toBe(await unknownUser.text());
  });

  it("logout clears the cookie", async () => {
    const registered = await post("/api/register", { username: "leaver", password: "12345678" });
    const out = await SELF.fetch(`${ORIGIN}/api/session`, {
      method: "DELETE",
      headers: { Cookie: cookieOf(registered) },
    });
    expect(out.status).toBe(204);
    expect(out.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL — `/api/register` returns 404; `/api/session` still expects `{nickname}`.

- [ ] **Step 3: Update `src/server/session.ts`**

Mechanical but exact:
- `interface Session` → `{ id: string; username: string; iat: number }` and update the doc comment: the id is now an **account** id minted at registration, not per-login.
- Rename `NICKNAME_PATTERN` → `USERNAME_PATTERN`, `isValidNickname` → `isValidUsername` (same regex).
- Add below it:

```ts
export function isValidPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 128;
}
```

- In `verifySession`, replace the `.nick` shape check with `!isValidUsername((session as Session).username)` and destructure `{ id, username, iat }`.
- Replace `createSession`:

```ts
export function createSession(id: string, username: string): Session {
  return { id, username, iat: Math.floor(Date.now() / 1000) };
}
```

- [ ] **Step 4: Update `src/server/index.ts`**

Replace `handleLogin` and add `handleRegister`; both share a body reader:

```ts
import { createAccount, verifyCredentials } from "./accounts.js";
import { createDb } from "./db/index.js";
import {
  clearSessionCookie,
  createSession,
  isValidPassword,
  isValidUsername,
  readSessionCookie,
  serializeSessionCookie,
  signSession,
  verifySession,
} from "./session.js";

interface Credentials {
  username: string;
  password: string;
}

/** Returns parsed credentials or a ready-to-send 400. */
async function readCredentials(request: Request): Promise<Credentials | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected_json" }, { status: 400 });
  }
  const username = (body as { username?: unknown } | null)?.username;
  const password = (body as { password?: unknown } | null)?.password;
  if (!isValidUsername(username)) return json({ error: "invalid_username" }, { status: 400 });
  if (!isValidPassword(password)) return json({ error: "invalid_password" }, { status: 400 });
  return { username, password };
}

async function sessionResponse(
  account: { id: string; username: string },
  env: Env,
  url: URL,
): Promise<Response> {
  const session = createSession(account.id, account.username);
  const token = await signSession(session, env.SESSION_SECRET);
  return json(
    { id: account.id, username: account.username },
    { headers: { "Set-Cookie": serializeSessionCookie(token, isSecure(url)) } },
  );
}

async function handleRegister(request: Request, env: Env, url: URL): Promise<Response> {
  const credentials = await readCredentials(request);
  if (credentials instanceof Response) return credentials;
  const account = await createAccount(createDb(env.DB), credentials.username, credentials.password);
  if (account === "username_taken") return json({ error: "username_taken" }, { status: 409 });
  return sessionResponse(account, env, url);
}

async function handleLogin(request: Request, env: Env, url: URL): Promise<Response> {
  const credentials = await readCredentials(request);
  if (credentials instanceof Response) return credentials;
  const account = await verifyCredentials(
    createDb(env.DB),
    credentials.username,
    credentials.password,
  );
  // One body for both "no such user" and "wrong password" — indistinguishable by design.
  if (!account) return json({ error: "invalid_credentials" }, { status: 401 });
  return sessionResponse(account, env, url);
}
```

Routing: add `if (url.pathname === "/api/register" && request.method === "POST") return handleRegister(request, env, url);` next to the `/api/session` routes. `GET /api/me` returns `{ id: session.id, username: session.username }`. In `handleJoin`, the forwarded headers still say `x-player-id: session.id` — **but session.id is now an account id and the DO loads by character id, so world joins are broken until Task 6's `?character=` parameter.** That is expected; Step 6 keeps the tests green.

- [ ] **Step 5: Update `test/session.test.ts` and `test/worker.test.ts`**

Read each file and apply mechanically:
- `test/session.test.ts`: every `Session` fixture `{ id, nick, iat }` → `{ id, username, iat }`; `isValidNickname` → `isValidUsername`; nickname-validation cases become username-validation cases (same pattern, same expectations). Add one case: `isValidPassword("1234567")` is false, `isValidPassword("12345678")` is true.
- `test/worker.test.ts`: any test that POSTs `/api/session` with `{nickname}` now registers first via `/api/register` with `{username, password: "12345678"}` or asserts the new 400/401 codes. Keep the `SESSION_SECRET`-missing 503 test untouched.

- [ ] **Step 6: Update the `test/world.test.ts` shim's `testSession`**

Auth changed under it. Replace `testSession` with a register-based helper (the DB-insert shim from Task 2 stays for the character row, but the account row now comes from the real endpoint — insert the character with the session's real account id):

```ts
let accountCounter = 0;

async function testSession(nickname: string): Promise<TestSession> {
  const username = `u${++accountCounter}${nickname}`.toLowerCase().slice(0, 16);
  const response = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "12345678" }),
  });
  expect(response.status).toBe(200);
  const token = response.headers.get("Set-Cookie")?.split(";")[0]?.split("=")[1];
  if (!token) throw new Error("no session cookie issued");
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("id" in body) || typeof body.id !== "string") {
    throw new Error("register response did not include an account id");
  }
  return { cookie: `${SESSION_COOKIE}=${token}`, id: body.id };
}
```

In `Client.join`, drop the raw `INSERT INTO account` (the register call created it) and insert the character owned by `session.id`; the join id is the **character** id, which the DO still reads from `x-player-id` — so give the character the id the Worker forwards. Until Task 6, the Worker forwards `session.id` (the account id), so **set the character's id to `session.id`** in the shim insert:

```ts
await env.DB.prepare(
  "INSERT INTO character (id, account_id, name, x, y) VALUES (?, ?, ?, ?, ?)",
)
  .bind(session.id, session.id, nickname, spawn.x, spawn.y)
  .run();
```

(A character whose id equals its account id is a shim-only oddity that Task 6 removes.)

- [ ] **Step 7: Run everything**

Run: `npx vitest run test/auth.test.ts test/session.test.ts test/worker.test.ts test/world.test.ts` → PASS. Then `npm run check` → PASS.

- [ ] **Step 8: Commit**

```bash
npm run lint:fix
git add -A
git commit -m "Add username/password accounts: register and login endpoints"
```

**Transitional note:** from this commit until Task 8, the browser client cannot log in (it still POSTs `{nickname}`). Typecheck and tests stay green.

---

### Task 5: Character endpoints

**Files:**
- Modify: `src/server/index.ts`
- Create: `test/characters.test.ts`

**Interfaces:**
- Consumes: `listCharacters`, `createCharacter`, `deleteCharacter`, `isValidCharacterName`, `isValidAppearance` (Task 3); session helpers (Task 4).
- Produces: `GET /api/characters` → `CharacterSummary[]`; `POST /api/characters` `{name, appearance}` → `CharacterSummary` (400 `invalid_name`/`invalid_appearance`, 409 `limit_reached`); `DELETE /api/characters/:id` → 204 or 404. All 401 without a session.

- [ ] **Step 1: Write the failing tests**

```ts
// test/characters.test.ts
import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";

const ORIGIN = "https://lindocara.test";

async function registered(username: string): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "12345678" }),
  });
  expect(response.status).toBe(200);
  const pair = response.headers.get("Set-Cookie")?.split(";")[0];
  if (!pair) throw new Error("no session cookie issued");
  return pair;
}

function characters(cookie: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`${ORIGIN}/api/characters`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...init?.headers },
  });
}

describe("character endpoints", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM character");
    await env.DB.exec("DELETE FROM account");
  });

  it("requires a session", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/characters`);
    expect(response.status).toBe(401);
  });

  it("creates, lists, and deletes a character", async () => {
    const cookie = await registered("crud_user");

    const created = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "Hero", appearance: "ember" }),
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as { id: string };
    expect(body).toMatchObject({ name: "Hero", appearance: "ember", level: 1 });

    const listed = await characters(cookie);
    expect(await listed.json()).toMatchObject([{ id: body.id, name: "Hero" }]);

    const deleted = await SELF.fetch(`${ORIGIN}/api/characters/${body.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(deleted.status).toBe(204);
    expect(await (await characters(cookie)).json()).toEqual([]);
  });

  it("validates name and appearance with machine codes", async () => {
    const cookie = await registered("validator");
    const badName = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "x", appearance: "ember" }),
    });
    expect(badName.status).toBe(400);
    expect(await badName.json()).toEqual({ error: "invalid_name" });

    const badLook = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "FineName", appearance: "plaid" }),
    });
    expect(badLook.status).toBe(400);
    expect(await badLook.json()).toEqual({ error: "invalid_appearance" });
  });

  it("refuses a fourth character", async () => {
    const cookie = await registered("hoarder");
    for (const name of ["One", "Two", "Three"]) {
      const created = await characters(cookie, {
        method: "POST",
        body: JSON.stringify({ name, appearance: "azure" }),
      });
      expect(created.status).toBe(200);
    }
    const fourth = await characters(cookie, {
      method: "POST",
      body: JSON.stringify({ name: "Four", appearance: "azure" }),
    });
    expect(fourth.status).toBe(409);
    expect(await fourth.json()).toEqual({ error: "limit_reached" });
  });

  it("hides other accounts' characters from list and delete", async () => {
    const aliceCookie = await registered("alice");
    const bobCookie = await registered("bob");
    const created = await characters(aliceCookie, {
      method: "POST",
      body: JSON.stringify({ name: "AliceHero", appearance: "violet" }),
    });
    const body = (await created.json()) as { id: string };

    expect(await (await characters(bobCookie)).json()).toEqual([]);
    const theft = await SELF.fetch(`${ORIGIN}/api/characters/${body.id}`, {
      method: "DELETE",
      headers: { Cookie: bobCookie },
    });
    expect(theft.status).toBe(404);
    expect(await (await characters(aliceCookie)).json()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/characters.test.ts`
Expected: FAIL — `/api/characters` returns 404 "not found".

- [ ] **Step 3: Implement the endpoints in `src/server/index.ts`**

```ts
import {
  createCharacter,
  deleteCharacter,
  isValidAppearance,
  isValidCharacterName,
  listCharacters,
} from "./characters.js";

async function handleListCharacters(request: Request, env: Env): Promise<Response> {
  const session = await currentSession(request, env);
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  return json(await listCharacters(createDb(env.DB), session.id));
}

async function handleCreateCharacter(request: Request, env: Env): Promise<Response> {
  const session = await currentSession(request, env);
  if (!session) return json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "expected_json" }, { status: 400 });
  }
  const name = (body as { name?: unknown } | null)?.name;
  const appearance = (body as { appearance?: unknown } | null)?.appearance;
  if (!isValidCharacterName(name)) return json({ error: "invalid_name" }, { status: 400 });
  if (!isValidAppearance(appearance)) return json({ error: "invalid_appearance" }, { status: 400 });

  const created = await createCharacter(createDb(env.DB), session.id, name, appearance);
  if (created === "limit_reached") return json({ error: "limit_reached" }, { status: 409 });
  return json(created);
}

async function handleDeleteCharacter(
  request: Request,
  env: Env,
  characterId: string,
): Promise<Response> {
  const session = await currentSession(request, env);
  if (!session) return json({ error: "unauthorized" }, { status: 401 });
  const deleted = await deleteCharacter(createDb(env.DB), session.id, characterId);
  if (!deleted) return json({ error: "not_found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
```

Routing block (place after the `/api/me` route):

```ts
if (url.pathname === "/api/characters" && request.method === "GET") {
  return handleListCharacters(request, env);
}
if (url.pathname === "/api/characters" && request.method === "POST") {
  return handleCreateCharacter(request, env);
}
const characterPath = url.pathname.match(/^\/api\/characters\/([0-9a-f-]{36})$/);
if (characterPath?.[1] && request.method === "DELETE") {
  return handleDeleteCharacter(request, env, characterPath[1]);
}
```

- [ ] **Step 4: Run tests, then the full check**

Run: `npx vitest run test/characters.test.ts` → PASS. Then `npm run check` → PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add -A
git commit -m "Add character list/create/delete endpoints"
```

---

### Task 6: Join the world as a character

**Files:**
- Modify: `src/server/index.ts` (`handleJoin`)
- Modify: `src/server/world.ts` (header rename, duplicate-kick comment)
- Modify: `test/world.test.ts` (replace the shim with the real flow)

**Interfaces:**
- Consumes: `characterOwnedBy` (Task 3), `loadProfile` (Task 2).
- Produces: `GET /api/ws?character=<id>` — 400 `missing character` without the param, 403 `forbidden` when the character isn't owned by the session's account, 101 otherwise. The DO reads `x-character-id` (renamed from `x-player-id`; `x-player-nick` is gone) and keys players/duplicate-kicks by character id. Everything downstream (`PlayerSnapshot.id`, `Attachment.id`, D1 saves) is the character id.

- [ ] **Step 1: Write the failing test** (add to `test/world.test.ts`)

```ts
it("refuses a join for a character the session does not own", async () => {
  const alice = await testCharacter("own_a");
  const bob = await testCharacter("own_b");

  const stolen = await SELF.fetch(`${ORIGIN}/api/ws?character=${alice.characterId}`, {
    headers: { Upgrade: "websocket", Cookie: bob.cookie },
  });
  expect(stolen.status).toBe(403);

  const missing = await SELF.fetch(`${ORIGIN}/api/ws`, {
    headers: { Upgrade: "websocket", Cookie: bob.cookie },
  });
  expect(missing.status).toBe(400);
});
```

(`testCharacter` is defined in Step 3.)

- [ ] **Step 2: Update `src/server/index.ts` `handleJoin`**

```ts
import { characterOwnedBy } from "./characters.js";

async function handleJoin(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("expected a websocket upgrade", { status: 426 });
  }

  const session = await currentSession(request, env);
  if (!session) return new Response("unauthorized", { status: 401 });

  const characterId = url.searchParams.get("character");
  if (!characterId) return new Response("missing character", { status: 400 });

  // Ownership is proven here, outside the Durable Object, so the DO can trust the header.
  const owned = await characterOwnedBy(createDb(env.DB), session.id, characterId);
  if (!owned) return new Response("forbidden", { status: 403 });

  const stub = env.WORLD.get(env.WORLD.idFromName(WORLD_NAME));
  return stub.fetch(
    new Request(request, {
      headers: { Upgrade: "websocket", "x-character-id": owned.id },
    }),
  );
}
```

Update the call site: `if (url.pathname === "/api/ws") return handleJoin(request, env, url);`

In `src/server/world.ts` `fetch`, rename the header read to `const id = request.headers.get("x-character-id");` and update the duplicate-kick comment to say "same character connected elsewhere". No other world change — `loadProfile` was wired in Task 2.

- [ ] **Step 3: Replace the shim in `test/world.test.ts` with the real flow**

Replace `testSession` + the `Client.join` DB inserts with:

```ts
interface TestCharacter {
  cookie: string;
  characterId: string;
}

let accountCounter = 0;

/** Register a fresh account and create one character on it through the real API. */
async function testCharacter(
  name: string,
  position?: { x: number; y: number },
): Promise<TestCharacter> {
  const username = `u${++accountCounter}${name}`.toLowerCase().slice(0, 16);
  const registered = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "12345678" }),
  });
  expect(registered.status).toBe(200);
  const pair = registered.headers.get("Set-Cookie")?.split(";")[0];
  if (!pair) throw new Error("no session cookie issued");

  const created = await SELF.fetch(`${ORIGIN}/api/characters`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: pair },
    body: JSON.stringify({ name, appearance: "azure" }),
  });
  expect(created.status).toBe(200);
  const body = (await created.json()) as { id: string };

  if (position) {
    await env.DB.prepare("UPDATE character SET x = ?, y = ? WHERE id = ?")
      .bind(position.x, position.y, body.id)
      .run();
  }
  return { cookie: pair, characterId: body.id };
}
```

`Client.join` becomes:

```ts
  static async join(
    nickname: string,
    options: { pump?: boolean; position?: { x: number; y: number } } = {},
  ): Promise<Client> {
    const session = await testCharacter(nickname, options.position);
    const response = await SELF.fetch(`${ORIGIN}/api/ws?character=${session.characterId}`, {
      headers: { Upgrade: "websocket", Cookie: session.cookie },
    });
    // …rest unchanged…
```

Character names must satisfy `^[A-Za-z0-9_-]{2,16}$` — every existing `Client.join("...")` argument in the file already does. Restore the Task 2 assertion change: "welcomes a player" expects `spawnPosition(welcome.selfId)` again (real characters spawn deterministically by their id). Remove the now-unused `TestSession` interface and `SESSION_COOKIE` import if nothing else uses them.

- [ ] **Step 4: Run everything**

Run: `npx vitest run test/world.test.ts` → PASS including the new ownership test. Then `npm run check` → PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add -A
git commit -m "Join the world by owned character id"
```

---

### Task 7: i18n dictionaries + static UI translation

**Files:**
- Create: `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts`, `src/shared/i18n/index.ts` (platform-free data — importable from tests and, in principle, the server)
- Create: `src/client/i18n.ts` (DOM layer: locale state, `t()`, toggle, `applyStaticText`)
- Modify: `index.html` (add `data-i18n` attributes + locale toggle; screens themselves come in Task 8)
- Modify: `src/client/main.ts`, `src/client/world-layout.ts`, `src/client/renderer.ts`, `src/client/style.css`
- Test: `test/i18n.test.ts`

**Interfaces:**
- Produces:
  - shared: `type MessageKey = keyof typeof en`, `type Locale = "en" | "fr"`, `dictionaries: Record<Locale, Record<MessageKey, string>>`, `format(template: string, params?: Record<string, string | number>): string`.
  - client: `t(key: MessageKey, params?): string`, `currentLocale(): Locale`, `setLocale(l: Locale): void`, `onLocaleChange(fn: () => void): void`, `applyStaticText(): void`, `initLocale(): void`.
- Key naming: `auth.*`, `chars.*`, `appearance.*`, `hud.*`, `item.*`, `quest.*`, `prompt.*`, `chat.*`, `help.*`, `status.*`, `npc.warden.*`, `monster.*`, `zone.*`, `poi.*`, `interior.*`, `event.*` (event templates land in Task 9 but are declared NOW so the dictionaries are written once).

**Transitional note:** after this task the static UI, HUD, prompts, zones, and POIs are localized; server events still arrive as English prose (fixed in Task 9). Canvas labels re-render live via a renderer text registry.

- [ ] **Step 1: Write the failing test**

```ts
// test/i18n.test.ts
import { describe, expect, it } from "vitest";
import { dictionaries, format } from "../src/shared/i18n/index.js";

describe("i18n", () => {
  it("interpolates {tokens} and leaves unknown tokens visible", () => {
    expect(format("You hit {name} for {damage}.", { name: "Gloamcap", damage: 12 })).toBe(
      "You hit Gloamcap for 12.",
    );
    expect(format("Missing {token} stays", {})).toBe("Missing {token} stays");
    expect(format("No params")).toBe("No params");
  });

  it("keeps en and fr key parity", () => {
    // Compile-time enforced too (fr is Record<MessageKey, string>); this guards the build output.
    expect(Object.keys(dictionaries.fr).sort()).toEqual(Object.keys(dictionaries.en).sort());
  });

  it("has no empty translations", () => {
    for (const locale of ["en", "fr"] as const) {
      for (const [key, value] of Object.entries(dictionaries[locale])) {
        expect(value, `${locale}:${key}`).not.toBe("");
      }
    }
  });
});
```

Run: `npx vitest run test/i18n.test.ts` → FAIL (module missing).

- [ ] **Step 2: Write the English dictionary**

```ts
// src/shared/i18n/en.ts
/**
 * Every player-facing string, EN. Keys are stable identifiers; fr.ts must cover exactly
 * this set (enforced by its Record type). Platform-free: data only.
 */

export const en = {
  // Auth screen
  "auth.eyebrow": "A tiny online world",
  "auth.subtitle": "Everwild Hollow",
  "auth.tagline":
    "Wake beneath the Heartroot. Swear Elowen's oath. Face the strange life of the Gloamwood.",
  "auth.tab.login": "Log in",
  "auth.tab.register": "Create account",
  "auth.username": "Username",
  "auth.password": "Password",
  "auth.password_confirm": "Confirm password",
  "auth.submit.login": "Enter the Hollow",
  "auth.submit.register": "Create account",
  "auth.error.username_taken": "That username is already taken.",
  "auth.error.invalid_credentials": "Wrong username or password.",
  "auth.error.invalid_username":
    "Username must be 2-16 characters: letters, digits, underscore or hyphen.",
  "auth.error.invalid_password": "Password must be 8-128 characters.",
  "auth.error.password_mismatch": "Passwords do not match.",
  "auth.error.generic": "Something went wrong. Try again.",

  // Character select
  "chars.title": "Choose your wayfarer",
  "chars.new": "New character",
  "chars.play": "Play",
  "chars.delete": "Delete",
  "chars.delete_confirm": "Delete forever?",
  "chars.create.title": "New wayfarer",
  "chars.create.name": "Name",
  "chars.create.appearance": "Appearance",
  "chars.create.submit": "Create",
  "chars.create.cancel": "Cancel",
  "chars.error.limit_reached": "This account already has 3 characters.",
  "chars.error.invalid_name":
    "Name must be 2-16 characters: letters, digits, underscore or hyphen.",
  "chars.logout": "Log out",
  "appearance.azure": "Azure",
  "appearance.ember": "Ember",
  "appearance.moss": "Moss",
  "appearance.violet": "Violet",

  // HUD
  "hud.level": "Level {level}",
  "hud.lv": "Lv {level}",
  "hud.vit": "VIT",
  "hud.spark": "SPARK",
  "hud.oath": "Active Oath",
  "hud.strike": "Strike",
  "hud.pack": "Wayfarer's Pack",
  "hud.switch_character": "Switch character",
  "hud.logout": "Log out",

  // Items
  "item.potion": "Heartroot tonic",
  "item.gold": "Sunmarks",
  "item.crystal": "Gloam shards",
  "item.sword": "Weathered blade",
  "item.sword_on": "On",

  // Quest panel
  "quest.available": "Keeper Elowen waits beside the Heartroot.",
  "quest.active": "Quiet gloam creatures in the woods ({progress}/{target})",
  "quest.ready": "Return to Elowen at the Heartroot.",
  "quest.completed": "The Gloamcap Oath is fulfilled.",

  // Prompts
  "prompt.close_interior": "[E] Close threshold view",
  "prompt.look_inside": "[E] Look inside {name}",
  "prompt.swear": "[E] Swear the Gloamcap Oath",
  "prompt.claim": "[E] Claim your reward",
  "prompt.speak": "[E] Speak with Elowen",
  "prompt.hunt": "Follow the Old Road - hunt gloam creatures [Space]",
  "prompt.approach": "Approach the golden marker - Keeper Elowen [E]",

  // Chat, help, status
  "chat.title": "Campfire voices",
  "chat.placeholder": "Enter: chat...",
  "help.move": "move",
  "help.strike": "strike",
  "help.commune": "commune",
  "help.tonic": "tonic",
  "status.connecting": "connecting as {name}...",
  "status.connected": "connected - Everwild Hollow",
  "status.disconnected": "disconnected - {reason}",
  "status.welcome_hint": "Elowen stands beside the golden marker. Press [E] to begin.",
  "status.connection_lost": "Connection lost. Reload to rejoin.",

  // NPC
  "npc.warden.name": "Keeper Elowen",
  "npc.warden.role": "The Gloamcap Oath",

  // Monsters (keys match MonsterSpecies, Task 9)
  "monster.gloamcap": "Gloamcap",
  "monster.murkbud": "Murkbud",
  "monster.briar_ooze": "Briar Ooze",
  "monster.relic_ooze": "Relic Ooze",
  "monster.mire_murkbud": "Mire Murkbud",
  "monster.vault_gloamcap": "Vault Gloamcap",

  // Zones
  "zone.heartroot_crossing": "Heartroot Crossing",
  "zone.old_road": "The Old Road",
  "zone.sunwake_clearing": "Sunwake Clearing",
  "zone.gloamwood": "Gloamwood",
  "zone.old_root_farm": "Old Root Farm",
  "zone.moonmere_reach": "Moonmere Reach",
  "zone.wayfarer_camp": "Wayfarer Camp",
  "zone.elderfall_ruins": "Elderfall Ruins",
  "zone.duskmire": "Duskmire",
  "zone.sealed_gate": "The Sealed Gate",

  // Points of interest
  "poi.heartroot": "The Heartroot",
  "poi.crossing_square": "Crossing Square",
  "poi.three_way_stone": "Three-Way Stone",
  "poi.sunwake_ring": "Sunwake Ring",
  "poi.old_root_farm": "Old Root Farm",
  "poi.old_bridge": "The Old Bridge",
  "poi.moonmere_reach": "Moonmere Reach",
  "poi.reedwater_ford": "Reedwater Ford",
  "poi.elderfall_court": "Elderfall Court",
  "poi.wayfarer_camp": "Wayfarer Camp",
  "poi.mireheart": "Mireheart",
  "poi.sealed_gate": "The Sealed Gate",

  // Interiors
  "interior.crossing-hall.name": "Crossing Hall",
  "interior.crossing-hall.copy":
    "A low fire, drying herbs, a cedar chest, and a quiet keeper sorting charms.",
  "interior.lantern-house.name": "Lantern House",
  "interior.lantern-house.copy":
    "Weathered tools, sacks of seed, a workbench, and a map of paths swallowed by moss.",
  "interior.wayfarer-rest.name": "Wayfarer Rest",
  "interior.wayfarer-rest.copy":
    "Warm coals, patched shutters, and a chest marked with the old village seal.",
  "interior.bramblewick-farm.name": "Bramblewick Farm",
  "interior.bramblewick-farm.copy":
    "Dusty tools, empty seed racks, and a route map pinned beneath a cracked window.",
  "interior.close": "Close threshold view",

  // Server events (wired in Task 9; declared now so the dictionaries are written once)
  "event.wake": "You wake beneath the Heartroot. Elowen, marked in gold, awaits your oath [E].",
  "event.combat.too_far": "Too far — step closer to strike.",
  "event.combat.hit": "You hit {species} for {damage}.",
  "event.combat.hurt": "{species} hits you for {damage}.",
  "event.monster.defeated": "Defeated {species}: +{xp} XP.",
  "event.level_up": "Level up! You are now level {level}.",
  "event.interact.nothing": "There is nothing close enough to interact with.",
  "event.quest.accepted": "Oath sworn — quiet {target} gloam creatures beyond the Heartroot.",
  "event.quest.progress": "{progress}/{target} quieted. The woods still stir.",
  "event.quest.fulfilled": "The Gloamcap Oath is fulfilled: +100 XP, +20 gold, +2 tonics.",
  "event.quest.blessing": "Elowen: the Heartroot remembers your courage.",
  "event.potion.used": "Heartroot tonic: +{heal} HP.",
  "event.player.down": "{name} was knocked out.",
  "event.respawn": "The Heartroot calls you home.",
  "event.loot.picked": "Picked up {amount} {kind}.",
} as const satisfies Record<string, string>;
```

- [ ] **Step 3: Write the French dictionary**

`fr` is typed `Record<MessageKey, string>` — a missing or extra key is a compile error.

```ts
// src/shared/i18n/fr.ts
import type { en } from "./en.js";

export const fr: Record<keyof typeof en, string> = {
  // Écran de connexion
  "auth.eyebrow": "Un petit monde en ligne",
  "auth.subtitle": "La Combe Sauvage",
  "auth.tagline":
    "Éveillez-vous sous le Cœur-Racine. Prêtez le serment d'Elowen. Affrontez l'étrange vie du Bois-Crépuscule.",
  "auth.tab.login": "Connexion",
  "auth.tab.register": "Créer un compte",
  "auth.username": "Nom d'utilisateur",
  "auth.password": "Mot de passe",
  "auth.password_confirm": "Confirmez le mot de passe",
  "auth.submit.login": "Entrer dans la Combe",
  "auth.submit.register": "Créer le compte",
  "auth.error.username_taken": "Ce nom d'utilisateur est déjà pris.",
  "auth.error.invalid_credentials": "Nom d'utilisateur ou mot de passe incorrect.",
  "auth.error.invalid_username":
    "Le nom d'utilisateur doit faire 2 à 16 caractères : lettres, chiffres, tiret ou tiret bas.",
  "auth.error.invalid_password": "Le mot de passe doit faire entre 8 et 128 caractères.",
  "auth.error.password_mismatch": "Les mots de passe ne correspondent pas.",
  "auth.error.generic": "Une erreur est survenue. Réessayez.",

  // Sélection de personnage
  "chars.title": "Choisissez votre voyageur",
  "chars.new": "Nouveau personnage",
  "chars.play": "Jouer",
  "chars.delete": "Supprimer",
  "chars.delete_confirm": "Supprimer définitivement ?",
  "chars.create.title": "Nouveau voyageur",
  "chars.create.name": "Nom",
  "chars.create.appearance": "Apparence",
  "chars.create.submit": "Créer",
  "chars.create.cancel": "Annuler",
  "chars.error.limit_reached": "Ce compte possède déjà 3 personnages.",
  "chars.error.invalid_name":
    "Le nom doit faire 2 à 16 caractères : lettres, chiffres, tiret ou tiret bas.",
  "chars.logout": "Se déconnecter",
  "appearance.azure": "Azur",
  "appearance.ember": "Braise",
  "appearance.moss": "Mousse",
  "appearance.violet": "Violet",

  // ATH
  "hud.level": "Niveau {level}",
  "hud.lv": "Niv {level}",
  "hud.vit": "VIT",
  "hud.spark": "ÉCLAT",
  "hud.oath": "Serment actif",
  "hud.strike": "Frappe",
  "hud.pack": "Sac du Voyageur",
  "hud.switch_character": "Changer de personnage",
  "hud.logout": "Se déconnecter",

  // Objets
  "item.potion": "Tonique du Cœur-Racine",
  "item.gold": "Marcs solaires",
  "item.crystal": "Éclats du crépuscule",
  "item.sword": "Lame usée",
  "item.sword_on": "Équipée",

  // Quête
  "quest.available": "Gardienne Elowen attend près du Cœur-Racine.",
  "quest.active": "Apaisez les créatures du crépuscule dans les bois ({progress}/{target})",
  "quest.ready": "Retournez voir Elowen au Cœur-Racine.",
  "quest.completed": "Le Serment du Crépuchon est accompli.",

  // Invites
  "prompt.close_interior": "[E] Fermer la vue du seuil",
  "prompt.look_inside": "[E] Regarder dans {name}",
  "prompt.swear": "[E] Prêter le Serment du Crépuchon",
  "prompt.claim": "[E] Réclamer votre récompense",
  "prompt.speak": "[E] Parler à Elowen",
  "prompt.hunt": "Suivez la Vieille Route - chassez les créatures du crépuscule [Espace]",
  "prompt.approach": "Approchez du repère doré - Gardienne Elowen [E]",

  // Discussion, aide, statut
  "chat.title": "Voix du feu de camp",
  "chat.placeholder": "Entrée : discuter...",
  "help.move": "se déplacer",
  "help.strike": "frapper",
  "help.commune": "communier",
  "help.tonic": "tonique",
  "status.connecting": "connexion en tant que {name}...",
  "status.connected": "connecté - La Combe Sauvage",
  "status.disconnected": "déconnecté - {reason}",
  "status.welcome_hint": "Elowen se tient près du repère doré. Appuyez sur [E] pour commencer.",
  "status.connection_lost": "Connexion perdue. Rechargez pour revenir.",

  // PNJ
  "npc.warden.name": "Gardienne Elowen",
  "npc.warden.role": "Le Serment du Crépuchon",

  // Monstres
  "monster.gloamcap": "Crépuchon",
  "monster.murkbud": "Sombrebourgeon",
  "monster.briar_ooze": "Limon des Ronces",
  "monster.relic_ooze": "Limon des Reliques",
  "monster.mire_murkbud": "Sombrebourgeon des Marais",
  "monster.vault_gloamcap": "Crépuchon du Caveau",

  // Zones
  "zone.heartroot_crossing": "La Croisée du Cœur-Racine",
  "zone.old_road": "La Vieille Route",
  "zone.sunwake_clearing": "La Clairière du Levant",
  "zone.gloamwood": "Le Bois-Crépuscule",
  "zone.old_root_farm": "La Ferme de la Vieille Racine",
  "zone.moonmere_reach": "Les Rives de Lunemere",
  "zone.wayfarer_camp": "Le Camp du Voyageur",
  "zone.elderfall_ruins": "Les Ruines d'Elderfall",
  "zone.duskmire": "Le Sombremarais",
  "zone.sealed_gate": "La Porte Scellée",

  // Points d'intérêt
  "poi.heartroot": "Le Cœur-Racine",
  "poi.crossing_square": "La Place de la Croisée",
  "poi.three_way_stone": "La Pierre des Trois Chemins",
  "poi.sunwake_ring": "Le Cercle du Levant",
  "poi.old_root_farm": "La Ferme de la Vieille Racine",
  "poi.old_bridge": "Le Vieux Pont",
  "poi.moonmere_reach": "Les Rives de Lunemere",
  "poi.reedwater_ford": "Le Gué des Roseaux",
  "poi.elderfall_court": "La Cour d'Elderfall",
  "poi.wayfarer_camp": "Le Camp du Voyageur",
  "poi.mireheart": "Cœur-de-Marais",
  "poi.sealed_gate": "La Porte Scellée",

  // Intérieurs
  "interior.crossing-hall.name": "Le Hall de la Croisée",
  "interior.crossing-hall.copy":
    "Un feu doux, des herbes qui sèchent, un coffre en cèdre et une gardienne silencieuse qui trie des talismans.",
  "interior.lantern-house.name": "La Maison des Lanternes",
  "interior.lantern-house.copy":
    "Des outils patinés, des sacs de semences, un établi et une carte de sentiers avalés par la mousse.",
  "interior.wayfarer-rest.name": "Le Repos du Voyageur",
  "interior.wayfarer-rest.copy":
    "Des braises chaudes, des volets rapiécés et un coffre marqué du vieux sceau du village.",
  "interior.bramblewick-farm.name": "La Ferme des Ronces",
  "interior.bramblewick-farm.copy":
    "Des outils poussiéreux, des casiers à semences vides et une carte d'itinéraire épinglée sous une fenêtre fêlée.",
  "interior.close": "Fermer la vue du seuil",

  // Événements serveur
  "event.wake":
    "Vous vous éveillez sous le Cœur-Racine. Elowen, marquée d'or, attend votre serment [E].",
  "event.combat.too_far": "Trop loin — approchez-vous pour frapper.",
  "event.combat.hit": "Vous frappez {species} : {damage} dégâts.",
  "event.combat.hurt": "{species} vous inflige {damage} dégâts.",
  "event.monster.defeated": "{species} vaincu : +{xp} XP.",
  "event.level_up": "Niveau supérieur ! Vous êtes maintenant niveau {level}.",
  "event.interact.nothing": "Rien d'assez proche pour interagir.",
  "event.quest.accepted":
    "Serment prêté — apaisez {target} créatures du crépuscule au-delà du Cœur-Racine.",
  "event.quest.progress": "{progress}/{target} apaisées. Les bois s'agitent encore.",
  "event.quest.fulfilled": "Le Serment du Crépuchon est accompli : +100 XP, +20 or, +2 toniques.",
  "event.quest.blessing": "Elowen : le Cœur-Racine se souvient de votre courage.",
  "event.potion.used": "Tonique du Cœur-Racine : +{heal} PV.",
  "event.player.down": "{name} a été terrassé.",
  "event.respawn": "Le Cœur-Racine vous rappelle à lui.",
  "event.loot.picked": "Ramassé : {amount} × {kind}.",
};
```

- [ ] **Step 4: Write the shared index**

```ts
// src/shared/i18n/index.ts
/**
 * Dictionary data and pure formatting. Platform-free: the client renders these; the server
 * only ever sends keys and params (protocol event codes), never translated text.
 */

import { en } from "./en.js";
import { fr } from "./fr.js";

export type MessageKey = keyof typeof en;
export type Locale = "en" | "fr";

export const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, fr };

/** Replace `{token}` with params[token]; unknown tokens stay visible so bugs are legible. */
export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
```

Run: `npx vitest run test/i18n.test.ts` → PASS.

- [ ] **Step 5: Write the client DOM layer**

```ts
// src/client/i18n.ts
/**
 * Locale state and DOM application. First visit: browser language (fr* → French). The
 * FR/EN toggle persists to localStorage and re-renders live — no reload.
 */

import { dictionaries, format, type Locale, type MessageKey } from "../shared/i18n/index.js";

const STORAGE_KEY = "lindocara_locale";
const listeners = new Set<() => void>();

function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "fr") return stored;
  return navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let current: Locale = detectLocale();

export function currentLocale(): Locale {
  return current;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return format(dictionaries[current][key], params);
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  for (const listener of listeners) listener();
}

export function onLocaleChange(listener: () => void): void {
  listeners.add(listener);
}

/**
 * `data-i18n="key"` sets textContent. `data-i18n-attr="attr:key;attr2:key2"` sets
 * attributes (placeholders, aria-labels, titles).
 */
export function applyStaticText(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key) element.textContent = t(key as MessageKey);
  }
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n-attr]")) {
    for (const pair of (element.dataset.i18nAttr ?? "").split(";")) {
      const colon = pair.indexOf(":");
      if (colon <= 0) continue;
      element.setAttribute(pair.slice(0, colon), t(pair.slice(colon + 1) as MessageKey));
    }
  }
}

/** Wire the toggle, stamp <html lang>, and apply the initial pass. Call once at boot. */
export function initLocale(): void {
  document.documentElement.lang = current;
  const buttons = document.querySelectorAll<HTMLButtonElement>("#locale-toggle button");
  const paint = () => {
    for (const button of buttons) {
      button.classList.toggle("active", button.dataset.locale === current);
    }
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      setLocale(button.dataset.locale === "fr" ? "fr" : "en");
    });
  }
  onLocaleChange(() => {
    paint();
    applyStaticText();
  });
  paint();
  applyStaticText();
}
```

- [ ] **Step 6: Key the static HTML**

In `index.html`: set `lang="en"` on `<html>` (the runtime stamps it), add the toggle as the first element in `<body>`:

```html
<div id="locale-toggle" role="group" aria-label="Language / Langue">
  <button type="button" data-locale="en">EN</button>
  <button type="button" data-locale="fr">FR</button>
</div>
```

Then attribute every current English text node (`index.html:15-95`), leaving the text as fallback. Exact mapping:

| Element | Attribute |
|---|---|
| `.eyebrow` | `data-i18n="auth.eyebrow"` |
| `<h2>Everwild Hollow</h2>` | `data-i18n="auth.subtitle"` |
| tagline `<p>` | `data-i18n="auth.tagline"` |
| `#player-level` | (set from TS: `t("hud.level", {level})`) |
| VIT `<span>` | `data-i18n="hud.vit"` |
| SPARK `<span>` | `data-i18n="hud.spark"` |
| "Active Oath" `<strong>` | `data-i18n="hud.oath"` |
| "Strike" `<strong>` | `data-i18n="hud.strike"` |
| "Wayfarer's Pack" `<strong>` | `data-i18n="hud.pack"` |
| `#interior-close` | `data-i18n-attr="aria-label:interior.close;title:interior.close"` |
| chat title `<span>` | `data-i18n="chat.title"` |
| `#chat-input` | `data-i18n-attr="placeholder:chat.placeholder"` |
| `#help` words | wrap each word: `<span data-i18n="help.move"></span>` etc., keeping the `<kbd>` tags |

(The login form's own labels are replaced wholesale in Task 8 — skip `#login`'s internals except the shared card copy above.)

- [ ] **Step 7: Localize the client TS strings**

- `src/client/main.ts`: import `{ initLocale, onLocaleChange, t }` from `./i18n.js`; call `initLocale()` before `fetchMe()`.
  - `INTERIORS`: drop `name`/`copy` fields; `openInterior` uses `t(`interior.${door.id}.name` as MessageKey)` — to keep type safety without casts, give `InteriorDoor` two fields `nameKey: MessageKey; copyKey: MessageKey` and fill them explicitly (`"interior.crossing-hall.name"`, …).
  - `renderState` (main.ts:146-175): item chips → `itemChip("potion", t("item.potion"), …)`, quest text → `t("quest.available")`, `t("quest.active", { progress: state.quest.progress, target: state.quest.target })`, `t("quest.ready")`, `t("quest.completed")`. Store `let lastState: SelfState | null` and `let lastPlayer: PlayerSnapshot | undefined`; register `onLocaleChange(() => { if (lastState) renderState(lastState); renderPlayer(lastPlayer); })`.
  - `renderPlayer`: `playerLevel.textContent = t("hud.level", { level: player.level })`.
  - `updatePrompt`: all seven literals → `t("prompt.close_interior")`, `t("prompt.look_inside", { name: t(door.nameKey) })`, `t("prompt.swear")`, `t("prompt.claim")`, `t("prompt.speak")`, `t("prompt.hunt")`, `t("prompt.approach")`.
  - Status lines: `setStatus(t("status.connecting", { name: me.nick }))` etc.; the welcome hint → `t("status.welcome_hint")`; connection lost → `t("status.connection_lost")`. To re-render status on toggle, wrap: `let lastStatus: () => string = () => ""` and `function setStatus(compute: () => string) { lastStatus = compute; statusBar.textContent = compute(); }`, re-running `lastStatus` in the `onLocaleChange` handler. Update every `setStatus("...")` call site to pass a thunk.
- `src/client/world-layout.ts`: change both interfaces' `name: string` to `nameKey: MessageKey` (import the type from `../shared/i18n/index.js`) and replace each literal per the `zone.*`/`poi.*` tables in Step 2 (e.g. `name: "Heartroot Crossing"` → `nameKey: "zone.heartroot_crossing"`). Every entry in `WORLD_ZONES` and `POINTS_OF_INTEREST` must get a key; if one is missing from the table, add a key following the same pattern to BOTH dictionaries.
- `src/client/renderer.ts`: import `{ onLocaleChange, t }` from `./i18n.js`.
  - Zone label (renderer.ts:943): `text: t(zone.nameKey).toUpperCase()`. POI label (:968): `text: t(poi.nameKey)`. NPC label (:1014): `` text: `${t("npc.warden.name")}\n${t("npc.warden.role")}` ``.
  - Player label (:1394): `` local ? `${player.nick}  ${t("hud.lv", { level: player.level })}` : player.nick ``.
  - Live refresh: keep a registry `#localizedTexts: Array<{ node: Text; compute: () => string }> = []` (PixiJS `Text`). At each of the three build sites above, after creating the label, push `{ node, compute }` with the same expression. In the constructor (or `create`), register `onLocaleChange(() => { for (const entry of this.#localizedTexts) entry.node.text = entry.compute(); })`. Monster and player labels are reassigned per-frame already — no registry needed.
- `src/client/style.css`: add the toggle style, consistent with the existing HUD panels:

```css
#locale-toggle {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 40;
  display: flex;
  gap: 4px;
}
#locale-toggle button {
  font: inherit;
  padding: 4px 10px;
  cursor: pointer;
  opacity: 0.55;
}
#locale-toggle button.active {
  opacity: 1;
  font-weight: 700;
}
```

(Follow the file's existing color tokens/backgrounds for the buttons — match how `#help` or panel chrome is styled.)

- [ ] **Step 8: Verify**

Run: `npm run check` → PASS. Then `npm run dev`, open the app: toggle FR on the login screen — card copy, HUD labels (after the Task 2 shim login no longer works, verify via the login screen only), and `<html lang>` must flip live. **Note:** full in-game verification of FR happens after Task 8 restores login.

- [ ] **Step 9: Commit**

```bash
npm run lint:fix
git add -A
git commit -m "Add FR/EN dictionaries and localize the static UI"
```

---

### Task 8: Auth and character-select screens

**Files:**
- Modify: `index.html` (replace `#login` with `#auth` + `#characters`, add HUD session buttons)
- Modify: `src/client/main.ts` (boot flow, API client, screen wiring)
- Modify: `src/client/net.ts` (`connect` takes a character id)
- Modify: `src/client/style.css`

**Interfaces:**
- Consumes: `/api/register`, `/api/session`, `/api/me`, `/api/characters*`, `/api/ws?character=` (Tasks 4–6); `t`/`applyStaticText`/`onLocaleChange` (Task 7).
- Produces: `WorldClient.connect(handlers: ConnectionHandlers, characterId: string): Connection`. Boot flow: `me` → `#characters` → `play(character)`; no session → `#auth`.
- No test file: this is DOM orchestration, verified end-to-end in Step 6 and by the existing world tests exercising the same endpoints.

- [ ] **Step 1: Replace `#login` in `index.html`**

Delete the `#login` block (`index.html:13-36`) and insert:

```html
<div id="auth" hidden>
  <div class="auth-card">
    <span class="eyebrow" data-i18n="auth.eyebrow">A tiny online world</span>
    <h1>lindocara</h1>
    <h2 data-i18n="auth.subtitle">Everwild Hollow</h2>
    <p data-i18n="auth.tagline">Wake beneath the Heartroot.</p>
    <div class="tabs" role="tablist">
      <button type="button" id="tab-login" class="tab active" data-i18n="auth.tab.login">Log in</button>
      <button type="button" id="tab-register" class="tab" data-i18n="auth.tab.register">Create account</button>
    </div>
    <form id="login-form">
      <label for="login-username" data-i18n="auth.username">Username</label>
      <input id="login-username" name="username" type="text" minlength="2" maxlength="16"
        pattern="[A-Za-z0-9_\-]{2,16}" autocomplete="username" autocapitalize="off"
        spellcheck="false" required />
      <label for="login-password" data-i18n="auth.password">Password</label>
      <input id="login-password" name="password" type="password" minlength="8" maxlength="128"
        autocomplete="current-password" required />
      <button type="submit" data-i18n="auth.submit.login">Enter the Hollow</button>
      <p id="login-error" role="alert"></p>
    </form>
    <form id="register-form" hidden>
      <label for="register-username" data-i18n="auth.username">Username</label>
      <input id="register-username" name="username" type="text" minlength="2" maxlength="16"
        pattern="[A-Za-z0-9_\-]{2,16}" autocomplete="username" autocapitalize="off"
        spellcheck="false" required />
      <label for="register-password" data-i18n="auth.password">Password</label>
      <input id="register-password" name="password" type="password" minlength="8" maxlength="128"
        autocomplete="new-password" required />
      <label for="register-confirm" data-i18n="auth.password_confirm">Confirm password</label>
      <input id="register-confirm" name="confirm" type="password" minlength="8" maxlength="128"
        autocomplete="new-password" required />
      <button type="submit" data-i18n="auth.submit.register">Create account</button>
      <p id="register-error" role="alert"></p>
    </form>
  </div>
</div>

<section id="characters" hidden>
  <div class="characters-card">
    <header>
      <h2 data-i18n="chars.title">Choose your wayfarer</h2>
      <button type="button" id="logout" data-i18n="chars.logout">Log out</button>
    </header>
    <div id="character-list"></div>
    <form id="character-create" hidden>
      <h3 data-i18n="chars.create.title">New wayfarer</h3>
      <label for="character-name" data-i18n="chars.create.name">Name</label>
      <input id="character-name" name="name" type="text" minlength="2" maxlength="16"
        pattern="[A-Za-z0-9_\-]{2,16}" autocomplete="off" autocapitalize="off"
        spellcheck="false" required />
      <fieldset id="appearance-picker">
        <legend data-i18n="chars.create.appearance">Appearance</legend>
        <label class="swatch swatch--azure"><input type="radio" name="appearance" value="azure" checked /><span data-i18n="appearance.azure">Azure</span></label>
        <label class="swatch swatch--ember"><input type="radio" name="appearance" value="ember" /><span data-i18n="appearance.ember">Ember</span></label>
        <label class="swatch swatch--moss"><input type="radio" name="appearance" value="moss" /><span data-i18n="appearance.moss">Moss</span></label>
        <label class="swatch swatch--violet"><input type="radio" name="appearance" value="violet" /><span data-i18n="appearance.violet">Violet</span></label>
      </fieldset>
      <button type="submit" data-i18n="chars.create.submit">Create</button>
      <button type="button" id="character-create-cancel" data-i18n="chars.create.cancel">Cancel</button>
      <p id="character-error" role="alert"></p>
    </form>
  </div>
</section>
```

In the `#hud` identity panel (after `.identity-copy`), add:

```html
<div class="session-actions">
  <button type="button" id="switch-character" data-i18n="hud.switch_character">Switch character</button>
  <button type="button" id="logout-game" data-i18n="hud.logout">Log out</button>
</div>
```

- [ ] **Step 2: Update `src/client/net.ts`**

`connect(handlers: ConnectionHandlers, characterId: string): Connection` — after building the URL (`net.ts:102-103`), add `url.searchParams.set("character", characterId);`.

- [ ] **Step 3: Rewrite the boot/API section of `src/client/main.ts`**

Replace `Me`, `fetchMe`, `login`, the `loginForm` listener, and the trailing boot block (`main.ts:17-20, 129-144, 453-472`) with:

```ts
import type { Appearance } from "../shared/protocol.js";

interface Me {
  id: string;
  username: string;
}

interface CharacterSummary {
  id: string;
  name: string;
  appearance: Appearance;
  level: number;
}

/** API errors carry stable machine codes the UI maps to i18n keys. */
class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (response.status === 204) return undefined as T;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : "generic";
    throw new ApiError(code);
  }
  return body as T;
}

const fetchMe = () => api<Me>("/api/me").catch(() => null);
const fetchCharacters = () => api<CharacterSummary[]>("/api/characters");

function authErrorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : "generic";
  const known: Record<string, MessageKey> = {
    username_taken: "auth.error.username_taken",
    invalid_credentials: "auth.error.invalid_credentials",
    invalid_username: "auth.error.invalid_username",
    invalid_password: "auth.error.invalid_password",
    limit_reached: "chars.error.limit_reached",
    invalid_name: "chars.error.invalid_name",
  };
  return t(known[code] ?? "auth.error.generic");
}
```

(Import `MessageKey` from `../shared/i18n/index.js`.) New element lookups replace the old `#login` ones:

```ts
const authPanel = required<HTMLDivElement>("#auth");
const tabLogin = required<HTMLButtonElement>("#tab-login");
const tabRegister = required<HTMLButtonElement>("#tab-register");
const loginForm = required<HTMLFormElement>("#login-form");
const registerForm = required<HTMLFormElement>("#register-form");
const loginError = required<HTMLParagraphElement>("#login-error");
const registerError = required<HTMLParagraphElement>("#register-error");
const charactersPanel = required<HTMLElement>("#characters");
const characterList = required<HTMLDivElement>("#character-list");
const characterCreate = required<HTMLFormElement>("#character-create");
const characterError = required<HTMLParagraphElement>("#character-error");
```

Screen flow:

```ts
function showAuth(): void {
  authPanel.hidden = false;
  charactersPanel.hidden = true;
  required<HTMLInputElement>("#login-username").focus();
}

function setTab(register: boolean): void {
  tabLogin.classList.toggle("active", !register);
  tabRegister.classList.toggle("active", register);
  loginForm.hidden = register;
  registerForm.hidden = !register;
  loginError.textContent = "";
  registerError.textContent = "";
}
tabLogin.addEventListener("click", () => setTab(false));
tabRegister.addEventListener("click", () => setTab(true));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  sound.unlock();
  loginError.textContent = "";
  const data = new FormData(loginForm);
  try {
    await api<Me>("/api/session", {
      method: "POST",
      body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
    });
    await showCharacters();
  } catch (error) {
    loginError.textContent = authErrorText(error);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  sound.unlock();
  registerError.textContent = "";
  const data = new FormData(registerForm);
  if (data.get("password") !== data.get("confirm")) {
    registerError.textContent = t("auth.error.password_mismatch");
    return;
  }
  try {
    await api<Me>("/api/register", {
      method: "POST",
      body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
    });
    await showCharacters();
  } catch (error) {
    registerError.textContent = authErrorText(error);
  }
});

async function showCharacters(): Promise<void> {
  authPanel.hidden = true;
  let characters: CharacterSummary[];
  try {
    characters = await fetchCharacters();
  } catch {
    showAuth();
    return;
  }
  renderCharacterList(characters);
  characterCreate.hidden = characters.length > 0;
  charactersPanel.hidden = false;
}

function renderCharacterList(characters: CharacterSummary[]): void {
  characterList.replaceChildren(
    ...characters.map((character) => {
      const card = document.createElement("article");
      card.className = "character-card";
      const swatch = document.createElement("span");
      swatch.className = `swatch swatch--${character.appearance}`;
      swatch.setAttribute("aria-hidden", "true");
      const name = document.createElement("strong");
      name.textContent = character.name;
      const level = document.createElement("span");
      level.textContent = t("hud.level", { level: character.level });
      const play = document.createElement("button");
      play.type = "button";
      play.textContent = t("chars.play");
      play.addEventListener("click", () => {
        charactersPanel.hidden = true;
        void play2(character);
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "danger";
      remove.textContent = t("chars.delete");
      remove.addEventListener("click", async () => {
        if (remove.dataset.confirming !== "true") {
          remove.dataset.confirming = "true";
          remove.textContent = t("chars.delete_confirm");
          return;
        }
        await api(`/api/characters/${character.id}`, { method: "DELETE" }).catch(() => undefined);
        await showCharacters();
      });
      card.append(swatch, name, level, play, remove);
      return card;
    }),
    newCharacterCard(characters.length),
  );
}

function newCharacterCard(count: number): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "character-card character-card--new";
  card.textContent = t("chars.new");
  card.disabled = count >= 3;
  card.addEventListener("click", () => {
    characterCreate.hidden = false;
    required<HTMLInputElement>("#character-name").focus();
  });
  return card;
}

characterCreate.addEventListener("submit", async (event) => {
  event.preventDefault();
  characterError.textContent = "";
  const data = new FormData(characterCreate);
  try {
    await api<CharacterSummary>("/api/characters", {
      method: "POST",
      body: JSON.stringify({ name: data.get("name"), appearance: data.get("appearance") }),
    });
    characterCreate.reset();
    await showCharacters();
  } catch (error) {
    characterError.textContent = authErrorText(error);
  }
});
required<HTMLButtonElement>("#character-create-cancel").addEventListener("click", () => {
  characterCreate.hidden = true;
});

required<HTMLButtonElement>("#logout").addEventListener("click", async () => {
  await fetch("/api/session", { method: "DELETE" });
  window.location.reload();
});
```

Where `play2` is the renamed `play(character: CharacterSummary)` — rename back to `play` if there is no shadowing at the call site (the card's `play` button local shadows it; name the button `playButton` instead and keep `play`). Inside `play`:
- signature: `async function play(character: CharacterSummary): Promise<void>`; delete the old `loginPanel.hidden = true;` line.
- `setStatus(() => t("status.connecting", { name: character.name }))`.
- `client.connect({ … }, character.id)`.
- Wire the HUD session buttons (reload is the simplest correct teardown — the boot flow lands on `#characters` while the cookie lives):

```ts
required<HTMLButtonElement>("#switch-character").addEventListener("click", () => {
  connection.close();
  window.location.reload();
});
required<HTMLButtonElement>("#logout-game").addEventListener("click", async () => {
  connection.close();
  await fetch("/api/session", { method: "DELETE" });
  window.location.reload();
});
```

Boot block at the bottom of the file:

```ts
initLocale();
const existing = await fetchMe();
if (existing) await showCharacters();
else showAuth();
```

- [ ] **Step 4: Style the new screens in `src/client/style.css`**

Rename every `#login` selector to `#auth` (the overlay/backdrop/card styles carry over — the form styles apply to both forms). Add:

```css
#auth .tabs {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
#auth .tab {
  flex: 1;
  padding: 8px 0;
  cursor: pointer;
  opacity: 0.55;
}
#auth .tab.active {
  opacity: 1;
  font-weight: 700;
  border-bottom: 2px solid currentColor;
}

#characters {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  z-index: 30;
}
#characters .characters-card {
  min-width: 340px;
  max-width: 520px;
  display: grid;
  gap: 12px;
}
#characters header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
#character-list {
  display: grid;
  gap: 8px;
}
.character-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
}
.character-card strong {
  flex: 1;
}
.character-card--new {
  justify-content: center;
  cursor: pointer;
  opacity: 0.7;
}
.swatch {
  width: 18px;
  height: 18px;
  display: inline-block;
}
.swatch--azure { background: #4aa3df; }
.swatch--ember { background: #e2703a; }
.swatch--moss { background: #6a9955; }
.swatch--violet { background: #9b6dd6; }
#appearance-picker {
  display: flex;
  gap: 8px;
}
#appearance-picker .swatch {
  width: auto;
  height: auto;
  padding: 6px 10px;
  cursor: pointer;
}
#appearance-picker input {
  margin-right: 6px;
}
.session-actions {
  display: flex;
  gap: 6px;
}
.session-actions button {
  font-size: 0.75rem;
  cursor: pointer;
}
```

Match the existing card/panel backgrounds, borders, and fonts — copy the declarations the old `#login form` used (they are now under `#auth form`) rather than inventing a new look. If the four appearance hexes clash with the palette the renderer uses for player squares, copy the renderer's four appearance colors instead (search `renderer.ts` for `azure`).

- [ ] **Step 5: Full check**

Run: `npm run check` → PASS.

- [ ] **Step 6: End-to-end manual verification (dev)**

Restart the dev server first (`vite dev` stacks Worker versions — a stale world will confuse everything):

```bash
npm run db:migrate   # if not yet applied locally
npm run dev
```

Verify in the browser: register → lands on character select; create "Hero" (pick Ember) → card appears; Play → in world, square is ember-colored, name label says Hero; HUD "Switch character" → back at select; second character; delete it (two-click confirm); Log out → auth screen; log back in → characters still there; wrong password → localized error; FR toggle → auth + select screens flip live.

- [ ] **Step 7: Commit**

```bash
npm run lint:fix
git add -A
git commit -m "Add auth and character select screens"
```

---

### Task 9: Event codes over the wire

**Files:**
- Modify: `src/shared/protocol.ts`, `src/shared/game.ts`
- Modify: `src/server/world.ts` (all event emissions)
- Modify: `src/client/net.ts`, `src/client/main.ts`, `src/client/renderer.ts`
- Modify: `test/protocol.test.ts`, `test/i18n.test.ts`, `test/game.test.ts` (if it references `MONSTER_SPAWNS[].name`)

**Interfaces:**
- Produces (in `protocol.ts`):

```ts
export const EVENT_CODES = [
  "wake",
  "combat.too_far",
  "combat.hit",
  "combat.hurt",
  "monster.defeated",
  "level_up",
  "interact.nothing",
  "quest.accepted",
  "quest.progress",
  "quest.fulfilled",
  "quest.blessing",
  "potion.used",
  "player.down",
  "respawn",
  "loot.picked",
] as const;
export type EventCode = (typeof EVENT_CODES)[number];
export type EventParams = Record<string, string | number>;
```

  The event variant becomes `{ t: "event"; code: EventCode; params?: EventParams; tone: EventTone; x?: number; y?: number }`. There is no `text` field anywhere on the wire anymore.
- Produces (in `game.ts`): `export type MonsterSpecies = "gloamcap" | "murkbud" | "briar_ooze" | "relic_ooze" | "mire_murkbud" | "vault_gloamcap";` — `MonsterSpawn.name: string` becomes `species: MonsterSpecies`; `MonsterSnapshot` likewise; `NpcDefinition` loses `name` and `role` (client renders `npc.warden.*` keys).
- Produces (in `net.ts`): `onEvent(code: EventCode, params: EventParams | undefined, tone: EventTone, x?: number, y?: number): void`.

- [ ] **Step 1: Write the failing tests**

Add to `test/protocol.test.ts`:

```ts
import { EVENT_CODES, encodeServerMessage, parseServerMessage } from "../src/shared/protocol.js";

describe("event messages", () => {
  it("round-trips a coded event", () => {
    const encoded = encodeServerMessage({
      t: "event",
      code: "combat.hit",
      params: { species: "gloamcap", damage: 12 },
      tone: "info",
      x: 1,
      y: 2,
    });
    expect(parseServerMessage(encoded)).toMatchObject({ t: "event", code: "combat.hit" });
  });

  it("rejects unknown codes and the legacy text shape", () => {
    expect(
      parseServerMessage(JSON.stringify({ t: "event", code: "made.up", tone: "info" })),
    ).toBeNull();
    expect(
      parseServerMessage(JSON.stringify({ t: "event", text: "Old prose.", tone: "info" })),
    ).toBeNull();
  });
});
```

Replace `test/i18n.test.ts`'s parity test additions — add:

```ts
import { EVENT_CODES } from "../src/shared/protocol.js";

it("has a template for every event code in both languages", () => {
  for (const code of EVENT_CODES) {
    for (const locale of ["en", "fr"] as const) {
      const table = dictionaries[locale] as Record<string, string>;
      expect(table[`event.${code}`], `${locale}:event.${code}`).toBeTypeOf("string");
    }
  }
});
```

Run: `npx vitest run test/protocol.test.ts test/i18n.test.ts` → FAIL (`EVENT_CODES` missing).

- [ ] **Step 2: Change the shared types**

- `protocol.ts`: add the `EVENT_CODES`/`EventCode`/`EventParams` block; replace the event variant of `ServerMessage`; in `parseServerMessage`, replace the event branch with:

```ts
if (
  value.t === "event" &&
  typeof value.code === "string" &&
  (EVENT_CODES as readonly string[]).includes(value.code) &&
  (value.params === undefined || isRecord(value.params)) &&
  (value.tone === "info" || value.tone === "good" || value.tone === "bad")
) {
  return value as unknown as ServerMessage;
}
```

- `protocol.ts` `MonsterSnapshot`: `name: string` → `species: MonsterSpecies` (import the type from `./game.js`).
- `game.ts`: add the `MonsterSpecies` type; in `MonsterSpawn` replace `name: string` with `species: MonsterSpecies`; update all 14 `MONSTER_SPAWNS` entries per this exact mapping — `"Gloamcap"`→`"gloamcap"`, `"Murkbud"`→`"murkbud"`, `"Briar Ooze"`→`"briar_ooze"`, `"Relic Ooze"`→`"relic_ooze"`, `"Mire Murkbud"`→`"mire_murkbud"`, `"Vault Gloamcap"`→`"vault_gloamcap"`. `NpcDefinition` becomes `{ id: string } & Vec2`; `QUEST_NPC` drops `name`/`role`.

- [ ] **Step 3: Convert every emission in `src/server/world.ts`**

The `Monster` interface's `name: string` → `species: MonsterSpecies` (it spreads from `MONSTER_SPAWNS`, so this follows automatically — update the interface). `#monsterSnapshots` maps `species: monster.species` instead of `name`. `#damagePlayer(ws, player, damage, species: MonsterSpecies, now)` — update the one call site to pass `monster.species`. The full emission table (each `#send`/`#broadcast` with `text:` is replaced; `tone`, `x`, `y` keep their current values):

| Site (current text) | Replacement |
|---|---|
| `world.ts:252-256` "You wake beneath…" | `{ t: "event", code: "wake", tone: "info" }` |
| `:345` "Too far — step closer…" | `{ t: "event", code: "combat.too_far", tone: "info" }` |
| `:352-358` "You hit ${target.name}…" | `{ t: "event", code: "combat.hit", params: { species: target.species, damage }, tone: "info", x: target.x, y: target.y }` |
| `:383-390` level up / defeated | split into the same ternary on `result.levelsGained > 0`: `{ code: "level_up", params: { level: player.level } }` vs `{ code: "monster.defeated", params: { species: monster.species, xp: MONSTER_XP } }`, both `tone: "good"` |
| `:397-401` "nothing close enough" | `{ t: "event", code: "interact.nothing", tone: "info" }` |
| `:407-410` "Oath sworn…" | `{ t: "event", code: "quest.accepted", params: { target: QUEST_KILL_TARGET }, tone: "good" }` |
| `:413-417` "…quieted. The woods still stir." | `{ t: "event", code: "quest.progress", params: { progress: player.quest.progress, target: QUEST_KILL_TARGET }, tone: "info" }` |
| `:426-430` "…Oath is fulfilled: +100 XP…" | `{ t: "event", code: "quest.fulfilled", tone: "good" }` |
| `:432-436` "Elowen: the Heartroot remembers…" | `{ t: "event", code: "quest.blessing", tone: "good" }` |
| `:449` "Heartroot tonic: +45 HP." | `{ t: "event", code: "potion.used", params: { heal: 45 }, tone: "good" }` |
| `:604-610` "${source} hits you…" | `{ t: "event", code: "combat.hurt", params: { species, damage }, tone: "bad", x: player.x, y: player.y }` |
| `:615` "${player.nick} was knocked out." | `{ t: "event", code: "player.down", params: { name: player.nick }, tone: "bad" }` (broadcast) |
| `:629` "The Heartroot calls you home." | `{ t: "event", code: "respawn", tone: "info" }` |
| `:643-647` "Picked up ${amount} ${kind}." | `{ t: "event", code: "loot.picked", params: { amount: item.amount, kind: item.kind }, tone: "good" }` |

After this, grep `src/server/world.ts` for `text:` — the only remaining hits must be chat messages.

- [ ] **Step 4: Update the client**

- `net.ts`: `ConnectionHandlers.onEvent(code: EventCode, params: EventParams | undefined, tone: EventTone, x?: number, y?: number)`; the fall-through in `#handle` (`net.ts:184`) becomes `handlers.onEvent(message.code, message.params, message.tone, message.x, message.y);`. Import the types from `../shared/protocol.js`.
- `main.ts`: replace `shouldLogEvent` and the `onEvent` handler:

```ts
/** Resolve species/kind params to localized names, then apply the event template. */
function eventText(code: EventCode, params: EventParams = {}): string {
  const resolved: EventParams = { ...params };
  if (typeof resolved.species === "string") {
    resolved.species = t(`monster.${resolved.species}` as MessageKey);
  }
  if (typeof resolved.kind === "string") {
    resolved.kind = t(`item.${resolved.kind}` as MessageKey);
  }
  return t(`event.${code}` as MessageKey, resolved);
}

/** Your own hits spam the combat log; everything else is worth a line. */
function shouldLogEvent(code: EventCode): boolean {
  return code !== "combat.hit";
}
```

```ts
onEvent: (code, params, tone, x, y) => {
  const text = eventText(code, params);
  if (shouldLogEvent(code)) addEvent(text, tone);
  renderer.showWorldEvent(text, tone, x, y);
  switch (code) {
    case "combat.too_far":
      sound.attack();
      renderer.playAttackMiss();
      break;
    case "level_up":
    case "quest.fulfilled":
      sound.levelUp();
      break;
    case "loot.picked":
    case "quest.accepted":
    case "potion.used":
      sound.loot();
      break;
    case "player.down":
    case "respawn":
      sound.death();
      break;
    case "combat.hit":
    case "combat.hurt":
      sound.hit();
      break;
    default:
      break;
  }
},
```

  (The two `as MessageKey` casts are load-bearing: `monster.*`/`item.*`/`event.*` key coverage is guaranteed by the Step 1 parity test plus the closed `MonsterSpecies`/`ItemKind`/`EventCode` unions. If Biome flags the casts, prefer a `satisfies`-checked lookup table; do not weaken the dictionaries to `Record<string, string>`.)
- `renderer.ts`: monster labels (`:1294`, `:1716`) → `t(`monster.${monster.species}` as MessageKey)` (and the aggro `!  ` prefix stays); NPC label already uses `npc.warden.*` from Task 7.
- `test/game.test.ts` / `test/world.test.ts`: grep for `.name` on monsters or `QUEST_NPC.name` and update to `species` / drop. The welcome assertion `questNpc: QUEST_NPC` self-adjusts.

- [ ] **Step 5: Run everything**

Run: `npm run check` → PASS. Grep the repo for leftovers: `grep -rn "swing hits only air\|Picked up \|knocked out" src/` → no hits in `src/`.

- [ ] **Step 6: Manual verification (dev)**

Restart `npm run dev`. In FR: attack a slime → « Vous frappez Crépuchon : 24 dégâts. » floats and the hit sound plays; get hit → « … vous inflige 9 dégâts. »; drink a potion → tonic line + loot sound; complete the quest loop → all lines French. Toggle EN mid-game → next events arrive in English.

- [ ] **Step 7: Commit**

```bash
npm run lint:fix
git add -A
git commit -m "Send event codes over the wire; localize all server events"
```

---

### Task 10: Docs, full check, deploy, live verification

**Files:**
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: Update `CLAUDE.md`**

- Architecture block: `session.ts` line → "HMAC-signed cookie carrying the account identity. accounts.ts owns username/password (PBKDF2), characters.ts owns the roster."; add `accounts.ts`, `characters.ts`, `password.ts` lines under `src/server/`; add `shared/i18n/` ("FR/EN dictionaries — data only; the server sends codes, never prose") and `client/i18n.ts` lines.
- Database section: replace the `player` paragraph — one `account` row per registered user (username unique, stored lowercase), up to 3 `character` rows per account; the character row is what the world loads/saves; character `name` is deliberately not unique.
- Add a Gotcha: "**Server events are codes, not sentences.** `{ t: "event", code, params }` — the client owns all wording via `src/shared/i18n/`. Never add an English string to a `#send` in `world.ts`; add an `EventCode` and two dictionary entries instead (the i18n test enforces parity)."
- Conventions: add "Every player-facing string lives in `src/shared/i18n/` in both languages. API errors are machine codes."

- [ ] **Step 2: Update `README.md`**

- Intro: mention accounts (username/password), up to 3 characters, character select, and full FR/EN localization with a live toggle.
- Play table: add "FR/EN button — switch language".
- Database section: describe `account` + `character` (replacing the single-`player` description).

- [ ] **Step 3: Full check + local smoke**

```bash
npm run check
```

Expected: PASS. Then one last dev-server pass over the Task 8 Step 6 checklist.

- [ ] **Step 4: Deploy (user-authorized for lindocara.alepha.dev)**

Migrations first, so the tables exist before the code that reads them. **`0002` drops the `player` table — production test data is lost; this was explicitly approved in the spec.**

```bash
npm run db:migrate:remote
npm run deploy
```

- [ ] **Step 5: Verify live**

```bash
# Register a probe account (delete-account API doesn't exist; use an obviously-disposable name)
curl -sS -X POST https://lindocara.alepha.dev/api/register \
  -H 'Content-Type: application/json' \
  -c /tmp/lindocara-probe.jar \
  -d '{"username":"probe_ci_1","password":"probe-password-1"}'
# → {"id":"…","username":"probe_ci_1"}

curl -sS https://lindocara.alepha.dev/api/me -b /tmp/lindocara-probe.jar
# → same identity

curl -sS -X POST https://lindocara.alepha.dev/api/characters \
  -H 'Content-Type: application/json' -b /tmp/lindocara-probe.jar \
  -d '{"name":"Probe","appearance":"moss"}'
# → {"id":"<CHAR_ID>","name":"Probe","appearance":"moss","level":1}

curl -sS -o /dev/null -w '%{http_code}\n' \
  "https://lindocara.alepha.dev/api/ws" -b /tmp/lindocara-probe.jar
# → 400 (missing character param — proves the new join path is live)

curl -sS -X DELETE "https://lindocara.alepha.dev/api/characters/<CHAR_ID>" \
  -b /tmp/lindocara-probe.jar -o /dev/null -w '%{http_code}\n'
# → 204

curl -sS -X POST https://lindocara.alepha.dev/api/session \
  -H 'Content-Type: application/json' \
  -d '{"username":"probe_ci_1","password":"wrong-password"}' -o /dev/null -w '%{http_code}\n'
# → 401
```

Then a human pass in the browser at https://lindocara.alepha.dev/ — register, create, play, toggle FR — before calling it done.

- [ ] **Step 6: Commit and merge**

```bash
npm run lint:fix
git add -A
git commit -m "Update docs for accounts, characters, and FR/EN i18n"
```

Then use superpowers:finishing-a-development-branch to merge `feature/auth-characters-i18n` into `main` and push.

---

## Plan self-review notes

- **Spec coverage:** login/register tabs → Task 4+8; 3-character roster with create (name+appearance)/select/delete → Tasks 3, 5, 8; `/api/ws?character=` ownership → Task 6; PBKDF2 → Task 1; drop-and-recreate migration → Task 2; FR/EN of every label with live toggle + localStorage + `navigator.language` → Task 7; event codes + species keys + sound-by-code → Task 9; identical 401s → Task 4; docs → Task 10. No gaps found.
- **Deliberate deviations from the spec, with reasons:** (1) username case-insensitivity via lowercase normalization instead of `COLLATE NOCASE` — same behavior, plain Drizzle support; (2) dictionaries live in `src/shared/i18n/` instead of `src/client/i18n/` — they must be importable from workerd tests, and the DOM layer stays client-side; (3) `NpcDefinition` drops `name`/`role` rather than carrying unused English.
- **Type consistency check:** `CharacterSummary` is produced in Task 3 and consumed by Tasks 5/6/8 with the same shape; `EventCode`/`EventParams` produced in Task 9's protocol block match every consumer signature; `loadProfile` nullable return is handled at both call sites (world 404, tests).
