# Parties Backend (bouchée 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `party` + `party_member` D1 tables and a `/api/parties` API (list public parties, create from an adventure, join with a color, host-delete) — additive, TDD, no runtime/UI/heroes change.

**Architecture:** First backend bite of plan 3 (parties + heroes) from `docs/superpowers/specs/2026-07-17-adventures-parties-design.md`. It mirrors exactly how plan 1 shipped adventures: a pure shared module (`src/shared/party.ts`), a server boundary (`src/server/parties.ts`) owning D1 reads/writes, and REST routes in `index.ts`. The running game keeps using `character`; heroes, admission cutover, colour rendering and the launch UI are later bites. A party pins the adventure's `version` and `maxPlayers` at creation so later edits can't change a live party's cap.

**Tech Stack:** TypeScript (three tsconfigs; `src/shared/` valid in browser and workerd), Drizzle ORM + D1, drizzle-kit migrations, Vitest in workerd (`cloudflare:test`, real `SELF.fetch`), Biome.

## Global Constraints

- `npm run check` (lint, typecheck, test, ui) must pass before every commit. Biome `noNonNullAssertion`: no `!`, narrow properly.
- Never trust a client message: every new parser returns `null` on malformed input, never throws.
- Server error style: `throw new Error("prefix: human detail")` — the prefix is the machine code; `index.ts` maps prefixes to `{ error: "wire_code" }` JSON + status. Every new prefix must be added to the response mapper or it becomes a 500.
- Every new wire error code gets an entry in `ERROR_KEYS` (`src/client/api.ts`) and in BOTH `src/shared/i18n/en.ts` and `fr.ts` (the parity test enforces both).
- `src/shared/` imports nothing from Cloudflare or the DOM. `src/client/` never imports `src/server/`.
- Identifiers minted by the server are UUIDs (`crypto.randomUUID()`); clients never supply row ids.
- Migrations: edit `src/server/db/schema.ts`, then `npm run db:generate` (writes `migrations/NNNN_*.sql` — commit it), then `npm run db:migrate`. Tests apply migrations automatically via `test/setup.ts`. The last migration is `0013`; the next is `0014`.
- Ownership/scoping: a party is created only from an adventure the caller owns (`loadAdventure(db, accountId, id)`); host-only actions treat a foreign/missing row as `not_found` (no existence leak).
- Repo compiles with `exactOptionalPropertyTypes: true`. Commits: `feat <lowercase>` (no colon). Single test file: `npm test -- test/<file>.test.ts`.

**Shared constants introduced (single source, `src/shared/party.ts`):**
`PARTY_COLORS = ["blue", "red", "yellow", "purple"] as const`, `PARTY_NAME_MAX = 48`.
Black is reserved for NPCs and is deliberately NOT a `PartyColor`.

---

### Task 1: Shared party types and input parsing

Pure, platform-free. Colours, the two request-body parsers, nothing else.

**Files:**
- Create: `src/shared/party.ts`
- Test: `test/party.test.ts` (new)

**Interfaces:**
- Produces (Tasks 2–3 rely on these exact names):

```ts
export const PARTY_COLORS: readonly ["blue", "red", "yellow", "purple"];
export type PartyColor = (typeof PARTY_COLORS)[number];
export const PARTY_NAME_MAX = 48;
export function isPartyColor(value: unknown): value is PartyColor;
export interface CreatePartyInput { adventureId: string; name: string | null; color: PartyColor }
export interface JoinPartyInput { color: PartyColor }
export function parseCreatePartyInput(value: unknown): CreatePartyInput | null;
export function parseJoinPartyInput(value: unknown): JoinPartyInput | null;
```

- [ ] **Step 1: Write the failing test** — create `test/party.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  isPartyColor,
  parseCreatePartyInput,
  parseJoinPartyInput,
  PARTY_COLORS,
} from "../src/shared/party.js";

describe("party colours", () => {
  it("are exactly the four hero colours, never black", () => {
    expect([...PARTY_COLORS]).toEqual(["blue", "red", "yellow", "purple"]);
    expect(isPartyColor("blue")).toBe(true);
    expect(isPartyColor("purple")).toBe(true);
    expect(isPartyColor("black")).toBe(false);
    expect(isPartyColor(2)).toBe(false);
    expect(isPartyColor(null)).toBe(false);
  });
});

describe("parseCreatePartyInput", () => {
  it("accepts an adventure id with optional name and colour, defaulting both", () => {
    expect(parseCreatePartyInput({ adventureId: "adv-1" })).toEqual({
      adventureId: "adv-1",
      name: null,
      color: "blue",
    });
    expect(parseCreatePartyInput({ adventureId: "adv-1", name: "Donjon", color: "red" })).toEqual({
      adventureId: "adv-1",
      name: "Donjon",
      color: "red",
    });
    expect(parseCreatePartyInput({ adventureId: "adv-1", name: "   " })).toEqual({
      adventureId: "adv-1",
      name: null,
      color: "blue",
    });
  });

  it("rejects malformed bodies", () => {
    const bad: unknown[] = [
      null,
      "adv",
      {},
      { adventureId: 7 },
      { adventureId: "bad id!" },
      { adventureId: "adv-1", color: "black" },
      { adventureId: "adv-1", name: "x".repeat(49) },
    ];
    for (const value of bad) expect(parseCreatePartyInput(value)).toBeNull();
  });
});

describe("parseJoinPartyInput", () => {
  it("accepts a valid colour and rejects everything else", () => {
    expect(parseJoinPartyInput({ color: "yellow" })).toEqual({ color: "yellow" });
    for (const value of [null, {}, { color: "black" }, { color: 1 }]) {
      expect(parseJoinPartyInput(value)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/party.test.ts`
Expected: FAIL — module `src/shared/party.ts` does not exist.

- [ ] **Step 3: Write the implementation** — create `src/shared/party.ts`:

```ts
/**
 * A party is one live playthrough of an adventure — like a private server. Colour belongs to a
 * player's slot in the party (blue/red/yellow/purple); black is reserved for NPCs and is not a
 * PartyColor. Pure rules only: D1 lives in server/parties.ts.
 */
export const PARTY_COLORS = ["blue", "red", "yellow", "purple"] as const;
export type PartyColor = (typeof PARTY_COLORS)[number];

export const PARTY_NAME_MAX = 48;

/** Matches server-minted adventure/map uuids. */
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export function isPartyColor(value: unknown): value is PartyColor {
  return typeof value === "string" && (PARTY_COLORS as readonly string[]).includes(value);
}

export interface CreatePartyInput {
  adventureId: string;
  name: string | null;
  color: PartyColor;
}

export interface JoinPartyInput {
  color: PartyColor;
}

export function parseCreatePartyInput(value: unknown): CreatePartyInput | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { adventureId, name, color } = record;
  if (typeof adventureId !== "string" || !ID_PATTERN.test(adventureId)) return null;
  let cleanName: string | null = null;
  if (name !== undefined && name !== null) {
    if (typeof name !== "string" || name.length > PARTY_NAME_MAX) return null;
    const trimmed = name.trim();
    cleanName = trimmed.length === 0 ? null : trimmed;
  }
  let cleanColor: PartyColor = "blue";
  if (color !== undefined) {
    if (!isPartyColor(color)) return null;
    cleanColor = color;
  }
  return { adventureId, name: cleanName, color: cleanColor };
}

export function parseJoinPartyInput(value: unknown): JoinPartyInput | null {
  if (typeof value !== "object" || value === null) return null;
  const { color } = value as Record<string, unknown>;
  if (!isPartyColor(color)) return null;
  return { color };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/party.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/shared/party.ts test/party.test.ts
git commit -m "feat add shared party colours and request parsing"
```

---

### Task 2: Party tables and the server boundary

The `party` + `party_member` tables, migration `0014`, and `src/server/parties.ts` owning create/list/join/delete. Also a legible guard so deleting an adventure a party references is refused (mirrors the map-delete guard).

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `migrations/0014_*.sql` via `npm run db:generate`
- Create: `src/server/parties.ts`
- Modify: `src/server/adventures.ts` (delete guard)
- Test: `test/parties.test.ts` (new)

**Interfaces:**
- Consumes: `PartyColor`, `CreatePartyInput` (Task 1); `loadAdventure` + `StoredAdventure` (`./adventures.js`); `party`, `partyMember`, `adventure`, `account`, `Db` (`./db/index.js`).
- Produces (Task 3 calls exactly these):

```ts
export interface PartyListing {
  id: string; name: string | null; adventureId: string; adventureTitle: string;
  maxPlayers: number; status: "open" | "completed"; hostAccountId: string; colors: PartyColor[];
}
export interface StoredParty {
  id: string; adventureId: string; adventureVersion: number; maxPlayers: number;
  hostAccountId: string; name: string | null; status: "open" | "completed";
}
export async function createParty(db: Db, accountId: string, input: CreatePartyInput): Promise<StoredParty>; // throws "adventure:"
export async function listPublicParties(db: Db): Promise<PartyListing[]>;
export async function joinParty(db: Db, accountId: string, partyId: string, color: PartyColor): Promise<void>; // throws "not_found:|already_member:|full:|color_taken:"
export async function deleteParty(db: Db, accountId: string, partyId: string): Promise<void>; // throws "not_found:"
```

- [ ] **Step 1: Add the tables and generate the migration**

In `src/server/db/schema.ts`, after the `adventureMap` table:

```ts
export const party = sqliteTable(
  "party",
  {
    /** Server-minted uuid. A client never supplies this. */
    id: text("id").primaryKey(),
    /** restrict: a party pins its adventure; deleting a referenced adventure is refused. */
    adventureId: text("adventure_id")
      .notNull()
      .references(() => adventure.id, { onDelete: "restrict" }),
    /** Pinned at creation so later adventure edits never move a live party's version or cap. */
    adventureVersion: integer("adventure_version").notNull(),
    maxPlayers: integer("max_players").notNull(),
    hostAccountId: text("host_account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    name: text("name"),
    status: text("status", { enum: ["open", "completed"] })
      .notNull()
      .default("open"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    index("party_adventure_idx").on(table.adventureId),
    index("party_host_idx").on(table.hostAccountId),
  ],
);

export const partyMember = sqliteTable(
  "party_member",
  {
    partyId: text("party_id")
      .notNull()
      .references(() => party.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    color: text("color", { enum: ["blue", "red", "yellow", "purple"] }).notNull(),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    primaryKey({ columns: [table.partyId, table.accountId] }),
    uniqueIndex("party_member_colour_unique").on(table.partyId, table.color),
    index("party_member_account_idx").on(table.accountId),
  ],
);
```

Add type exports beside the others at the bottom of the file:

```ts
export type Party = typeof party.$inferSelect;
export type PartyMember = typeof partyMember.$inferSelect;
```

Run: `npm run db:generate` (expect `migrations/0014_*.sql` with both `CREATE TABLE`s, the unique colour index, and `ON DELETE restrict`/`cascade`), then `npm run db:migrate`.

- [ ] **Step 2: Write the failing test** — create `test/parties.test.ts`:

```ts
/**
 * The parties boundary: create-from-owned-adventure, public listing, join with colour/cap/dup
 * fencing, host-only delete, and the adventure-delete guard. Truncate children before parents.
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { AdventureInput } from "../src/shared/adventure.js";
import { createAdventure, deleteAdventure } from "../src/server/adventures.js";
import { account, createDb } from "../src/server/db/index.js";
import { createMap, type MapInput } from "../src/server/maps.js";
import {
  createParty,
  deleteParty,
  joinParty,
  listPublicParties,
} from "../src/server/parties.js";

const COLS = 20;
const ROWS = 15;

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function mapInput(name: string): MapInput {
  return {
    name,
    blocks: blocks(),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: {
      entries: [{ id: "door", col: 5, row: 5 }],
      exits: [{ id: "gate", col: 7, row: 7 }],
      monsterSpawns: [],
    },
  };
}

async function seedAccount(id: string): Promise<void> {
  await createDb(env.DB)
    .insert(account)
    .values({ id, username: id, passwordHash: "h", passwordSalt: "s", passwordIterations: 1 });
}

function adventureInput(mapIds: string[], maxPlayers: number): AdventureInput {
  const [a, b] = mapIds;
  if (!a || !b) throw new Error("expected two maps");
  return {
    title: "Donjon",
    maxPlayers,
    mapIds,
    graph: {
      start: { mapId: a, entryId: "door" },
      links: [
        { mapId: a, exitId: "gate", dest: { mapId: b, entryId: "door" } },
        { mapId: b, exitId: "gate", dest: "end" },
      ],
    },
  };
}

async function seedAdventure(accountId: string, maxPlayers = 4): Promise<string> {
  const db = createDb(env.DB);
  const mapA = await createMap(db, mapInput("A"));
  const mapB = await createMap(db, mapInput("B"));
  const created = await createAdventure(db, accountId, adventureInput([mapA.id, mapB.id], maxPlayers));
  return created.id;
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM character");
  await env.DB.exec("DELETE FROM account");
});

describe("createParty", () => {
  it("creates from an owned adventure, pinning version and cap, host auto-joined", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const adventureId = await seedAdventure("owner", 3);
    const party = await createParty(db, "owner", { adventureId, name: "Chez Nico", color: "red" });
    expect(party).toMatchObject({
      adventureId,
      adventureVersion: 1,
      maxPlayers: 3,
      hostAccountId: "owner",
      name: "Chez Nico",
      status: "open",
    });
    const listing = await listPublicParties(db);
    expect(listing).toHaveLength(1);
    expect(listing[0]).toMatchObject({ id: party.id, adventureTitle: "Donjon", colors: ["red"] });
  });

  it("refuses creating from an adventure the caller does not own", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    await seedAccount("rival");
    const adventureId = await seedAdventure("owner");
    await expect(
      createParty(db, "rival", { adventureId, name: null, color: "blue" }),
    ).rejects.toThrow(/^adventure:/);
  });
});

describe("joinParty", () => {
  it("adds a member with a free colour and fences dup account, dup colour, and the cap", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("p2");
    await seedAccount("p3");
    const adventureId = await seedAdventure("host", 2);
    const party = await createParty(db, "host", { adventureId, name: null, color: "blue" });

    await expect(joinParty(db, "host", party.id, "red")).rejects.toThrow(/^already_member:/);
    await expect(joinParty(db, "p2", party.id, "blue")).rejects.toThrow(/^color_taken:/);

    await joinParty(db, "p2", party.id, "yellow");
    const listing = await listPublicParties(db);
    expect(listing[0]?.colors.sort()).toEqual(["blue", "yellow"]);

    // cap is 2, already full
    await expect(joinParty(db, "p3", party.id, "purple")).rejects.toThrow(/^full:/);
    await expect(joinParty(db, "p2", "missing-party", "red")).rejects.toThrow(/^not_found:/);
  });
});

describe("deleteParty", () => {
  it("lets only the host delete, and cascades members", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("rival");
    const adventureId = await seedAdventure("host");
    const party = await createParty(db, "host", { adventureId, name: null, color: "blue" });

    await expect(deleteParty(db, "rival", party.id)).rejects.toThrow(/^not_found:/);
    await deleteParty(db, "host", party.id);
    expect(await listPublicParties(db)).toEqual([]);
  });
});

describe("adventure delete guard", () => {
  it("refuses deleting an adventure a party references", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    const adventureId = await seedAdventure("host");
    const party = await createParty(db, "host", { adventureId, name: null, color: "blue" });

    await expect(deleteAdventure(db, "host", adventureId)).rejects.toThrow(/^referenced:/);
    await deleteParty(db, "host", party.id);
    await deleteAdventure(db, "host", adventureId); // free once no party references it
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/parties.test.ts`
Expected: FAIL — module `src/server/parties.ts` does not exist.

- [ ] **Step 4: Implement**

**`src/server/parties.ts`** (new):

```ts
/**
 * Parties: live playthroughs of an adventure, like private servers. This boundary owns the D1
 * reads and writes; a party is created only from an adventure the caller owns, and pins that
 * adventure's version and player cap so later edits can't move them under a running party.
 */
import { eq, inArray } from "drizzle-orm";
import type { CreatePartyInput, PartyColor } from "../shared/party.js";
import { loadAdventure } from "./adventures.js";
import { adventure, type Db, party, partyMember } from "./db/index.js";

export interface PartyListing {
  id: string;
  name: string | null;
  adventureId: string;
  adventureTitle: string;
  maxPlayers: number;
  status: "open" | "completed";
  hostAccountId: string;
  colors: PartyColor[];
}

export interface StoredParty {
  id: string;
  adventureId: string;
  adventureVersion: number;
  maxPlayers: number;
  hostAccountId: string;
  name: string | null;
  status: "open" | "completed";
}

function toStored(row: typeof party.$inferSelect): StoredParty {
  return {
    id: row.id,
    adventureId: row.adventureId,
    adventureVersion: row.adventureVersion,
    maxPlayers: row.maxPlayers,
    hostAccountId: row.hostAccountId,
    name: row.name,
    status: row.status,
  };
}

async function loadPartyRow(db: Db, partyId: string): Promise<typeof party.$inferSelect | null> {
  const rows = await db.select().from(party).where(eq(party.id, partyId)).limit(1);
  return rows[0] ?? null;
}

export async function createParty(
  db: Db,
  accountId: string,
  input: CreatePartyInput,
): Promise<StoredParty> {
  const adv = await loadAdventure(db, accountId, input.adventureId);
  if (!adv) throw new Error("adventure: no such adventure");
  const id = crypto.randomUUID();
  const row = {
    id,
    adventureId: adv.id,
    adventureVersion: adv.version,
    maxPlayers: adv.maxPlayers,
    hostAccountId: accountId,
    name: input.name,
    status: "open" as const,
  };
  await db.batch([
    db.insert(party).values(row),
    db.insert(partyMember).values({ partyId: id, accountId, color: input.color }),
  ]);
  const stored = await loadPartyRow(db, id);
  if (!stored) throw new Error("not_found: party vanished mid-create");
  return toStored(stored);
}

export async function listPublicParties(db: Db): Promise<PartyListing[]> {
  const rows = await db
    .select({
      id: party.id,
      name: party.name,
      adventureId: party.adventureId,
      adventureTitle: adventure.title,
      maxPlayers: party.maxPlayers,
      status: party.status,
      hostAccountId: party.hostAccountId,
    })
    .from(party)
    .innerJoin(adventure, eq(party.adventureId, adventure.id));
  if (rows.length === 0) return [];
  const members = await db
    .select({ partyId: partyMember.partyId, color: partyMember.color })
    .from(partyMember)
    .where(inArray(partyMember.partyId, rows.map((row) => row.id)));
  const coloursByParty = new Map<string, PartyColor[]>();
  for (const member of members) {
    const list = coloursByParty.get(member.partyId) ?? [];
    list.push(member.color);
    coloursByParty.set(member.partyId, list);
  }
  return rows.map((row) => ({ ...row, colors: coloursByParty.get(row.id) ?? [] }));
}

export async function joinParty(
  db: Db,
  accountId: string,
  partyId: string,
  color: PartyColor,
): Promise<void> {
  const row = await loadPartyRow(db, partyId);
  if (!row) throw new Error("not_found: no such party");
  const members = await db
    .select({ accountId: partyMember.accountId, color: partyMember.color })
    .from(partyMember)
    .where(eq(partyMember.partyId, partyId));
  if (members.some((member) => member.accountId === accountId)) {
    throw new Error("already_member: already in this party");
  }
  if (members.length >= row.maxPlayers) throw new Error("full: party is full");
  if (members.some((member) => member.color === color)) {
    throw new Error("color_taken: that colour is taken");
  }
  await db.insert(partyMember).values({ partyId, accountId, color });
}

export async function deleteParty(db: Db, accountId: string, partyId: string): Promise<void> {
  const row = await loadPartyRow(db, partyId);
  if (!row || row.hostAccountId !== accountId) throw new Error("not_found: no such party");
  await db.batch([
    db.delete(partyMember).where(eq(partyMember.partyId, partyId)),
    db.delete(party).where(eq(party.id, partyId)),
  ]);
}
```

**`src/server/adventures.ts`** — add the referenced-by-party guard in `deleteAdventure`. Add `party` to the `./db/index.js` import (it currently imports `adventure`, `adventureMap`, `type Db`, `map`). Then in `deleteAdventure`, after the ownership check (`const row = await ownedRow(db, accountId, id); if (!row) throw new Error("not_found: no such adventure");`) and before the delete batch:

```ts
  const used = await db
    .select({ partyId: party.id })
    .from(party)
    .where(eq(party.adventureId, id))
    .limit(1);
  if (used.length > 0) throw new Error("referenced: a party still uses this adventure");
```

(`eq` is already imported in `adventures.ts`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/parties.test.ts` and `npm test -- test/adventures.test.ts` (the existing adventure suite must stay green — the new guard only fires when a party exists).
Expected: PASS.

- [ ] **Step 6: Check and commit**

```bash
npm run check
git add src/server/db/schema.ts migrations src/server/parties.ts src/server/adventures.ts test/parties.test.ts
git commit -m "feat store parties with colour slots and an adventure delete guard"
```

---

### Task 3: /api/parties routes

Four routes, session-gated, machine codes throughout. Mirrors the adventures handlers.

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/client/api.ts` (`ERROR_KEYS`), `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts`
- Test: `test/parties-api.test.ts` (new)

**Interfaces:**
- Consumes: `parseCreatePartyInput`, `parseJoinPartyInput` (Task 1); `createParty`/`listPublicParties`/`joinParty`/`deleteParty` (Task 2); existing `requireSession`, `readJson`, `json`.
- Produces the wire API the launch-UI bite will call:
  - `GET /api/parties` → 200 `PartyListing[]`
  - `POST /api/parties` → 201 `StoredParty` | 400 `party_invalid` | 404 `party_adventure`
  - `POST /api/parties/:id/join` → 204 | 400 `party_invalid` | 404 `party_not_found` | 409 `party_already_member|party_full|party_color_taken`
  - `DELETE /api/parties/:id` → 204 | 404 `party_not_found`
  - plus `DELETE /api/adventures/:id` now also answers 409 `adventure_referenced`

- [ ] **Step 1: Write the failing test** — create `test/parties-api.test.ts`:

```ts
/**
 * The parties CRUD API over SELF.fetch: session gate, create-from-owned-adventure, join fencing,
 * host-only delete, and the wire codes. Register-and-cookie pattern from adventures-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/server/session.js";

const ORIGIN = "https://lindocara.test";
const COLS = 20;
const ROWS = 15;

function blocks(): string[] {
  const rows: string[] = [];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function mapBody(name: string): Record<string, unknown> {
  return {
    name,
    blocks: blocks(),
    elements: [],
    spawn: { col: 0, row: 0 },
    markers: {
      entries: [{ id: "door", col: 5, row: 5 }],
      exits: [{ id: "gate", col: 7, row: 7 }],
      monsterSpawns: [],
    },
  };
}

let userCount = 0;

async function register(): Promise<string> {
  userCount += 1;
  const response = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `partyapi${userCount}`, password: "12345678" }),
  });
  const value = (response.headers.get("Set-Cookie") ?? "").split(";")[0]?.split("=")[1];
  if (!value) throw new Error("expected a session cookie");
  return `${SESSION_COOKIE}=${value}`;
}

function authed(path: string, cookie: string, init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookie, ...(init.headers ?? {}) },
  });
}

async function seedAdventure(cookie: string, maxPlayers = 4): Promise<string> {
  const a = await authed("/api/maps", cookie, { method: "POST", body: JSON.stringify(mapBody("A")) });
  const b = await authed("/api/maps", cookie, { method: "POST", body: JSON.stringify(mapBody("B")) });
  const mapA = ((await a.json()) as { id: string }).id;
  const mapB = ((await b.json()) as { id: string }).id;
  const created = await authed("/api/adventures", cookie, {
    method: "POST",
    body: JSON.stringify({
      title: "Donjon",
      maxPlayers,
      mapIds: [mapA, mapB],
      graph: {
        start: { mapId: mapA, entryId: "door" },
        links: [
          { mapId: mapA, exitId: "gate", dest: { mapId: mapB, entryId: "door" } },
          { mapId: mapB, exitId: "gate", dest: "end" },
        ],
      },
    }),
  });
  return ((await created.json()) as { id: string }).id;
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
});

describe("session gate", () => {
  it("401s the party routes without a cookie", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/parties"],
      ["POST", "/api/parties"],
      ["POST", "/api/parties/some-id/join"],
      ["DELETE", "/api/parties/some-id"],
    ];
    for (const [method, path] of routes) {
      expect((await SELF.fetch(`${ORIGIN}${path}`, { method })).status).toBe(401);
    }
  });
});

describe("party lifecycle over the wire", () => {
  it("creates, lists, is joined by another account, then host-deletes", async () => {
    const host = await register();
    const adventureId = await seedAdventure(host, 2);

    const createRes = await authed("/api/parties", host, {
      method: "POST",
      body: JSON.stringify({ adventureId, name: "Chez Nico", color: "blue" }),
    });
    expect(createRes.status).toBe(201);
    const party = (await createRes.json()) as { id: string };
    expect(party).toMatchObject({ maxPlayers: 2, hostAccountId: expect.any(String), status: "open" });

    const guest = await register();
    const listRes = await authed("/api/parties", guest, {});
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { id: string; colors: string[] }[];
    expect(list.find((row) => row.id === party.id)).toMatchObject({ colors: ["blue"] });

    const takenRes = await authed(`/api/parties/${party.id}/join`, guest, {
      method: "POST",
      body: JSON.stringify({ color: "blue" }),
    });
    expect(takenRes.status).toBe(409);
    expect(await takenRes.json()).toEqual({ error: "party_color_taken" });

    const joinRes = await authed(`/api/parties/${party.id}/join`, guest, {
      method: "POST",
      body: JSON.stringify({ color: "red" }),
    });
    expect(joinRes.status).toBe(204);

    // guest is not the host → cannot delete
    const forbidden = await authed(`/api/parties/${party.id}`, guest, { method: "DELETE" });
    expect(forbidden.status).toBe(404);

    const deleteRes = await authed(`/api/parties/${party.id}`, host, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);
  });

  it("answers machine codes for a bad body and a foreign adventure", async () => {
    const host = await register();
    const invalid = await authed("/api/parties", host, {
      method: "POST",
      body: JSON.stringify({ color: "black" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "party_invalid" });

    const missing = await authed("/api/parties", host, {
      method: "POST",
      body: JSON.stringify({ adventureId: "no-such-adventure" }),
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "party_adventure" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/parties-api.test.ts`
Expected: FAIL — the party routes fall through to 404 `{ error: "not found" }`.

- [ ] **Step 3: Implement**

**`src/server/index.ts`:**

Imports: add `parseCreatePartyInput, parseJoinPartyInput` from `../shared/party.js` and `createParty, deleteParty, joinParty, listPublicParties` from `./parties.js`.

Error mapper beside `adventureErrorResponse`:

```ts
/** `parties.ts` throws "prefix: message" — the prefix is the machine code. */
function partyErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") return json({ error: "party_not_found" }, { status: 404 });
  if (code === "adventure") return json({ error: "party_adventure" }, { status: 404 });
  if (code === "already_member" || code === "full" || code === "color_taken") {
    return json({ error: `party_${code}` }, { status: 409 });
  }
  throw error;
}
```

Extend `adventureErrorResponse` with the referenced case (beside its `not_found` line):

```ts
  if (code === "referenced") return json({ error: "adventure_referenced" }, { status: 409 });
```

Handlers, mirroring the adventure handlers:

```ts
async function handleListParties(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  return json(await listPublicParties(createDb(env.DB)));
}

async function handleCreateParty(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const input = parseCreatePartyInput(parsed.value);
  if (!input) return json({ error: "party_invalid" }, { status: 400 });
  try {
    return json(await createParty(createDb(env.DB), auth.session.id, input), { status: 201 });
  } catch (error) {
    return partyErrorResponse(error);
  }
}

async function handleJoinParty(request: Request, env: Env, url: URL, id: string): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const input = parseJoinPartyInput(parsed.value);
  if (!input) return json({ error: "party_invalid" }, { status: 400 });
  try {
    await joinParty(createDb(env.DB), auth.session.id, id, input.color);
    return new Response(null, { status: 204 });
  } catch (error) {
    return partyErrorResponse(error);
  }
}

async function handleDeleteParty(request: Request, env: Env, url: URL, id: string): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  try {
    await deleteParty(createDb(env.DB), auth.session.id, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return partyErrorResponse(error);
  }
}
```

Routing, after the adventures block in `fetch` (join route before the bare-id route so it matches first):

```ts
    if (url.pathname === "/api/parties" && request.method === "GET") {
      return handleListParties(request, env, url);
    }
    if (url.pathname === "/api/parties" && request.method === "POST") {
      return handleCreateParty(request, env, url);
    }
    const partyJoinRoute = url.pathname.match(/^\/api\/parties\/([A-Za-z0-9-]{1,64})\/join$/);
    if (partyJoinRoute?.[1] && request.method === "POST") {
      return handleJoinParty(request, env, url, partyJoinRoute[1]);
    }
    const partyRoute = url.pathname.match(/^\/api\/parties\/([A-Za-z0-9-]{1,64})$/);
    if (partyRoute?.[1] && request.method === "DELETE") {
      return handleDeleteParty(request, env, url, partyRoute[1]);
    }
```

**`src/client/api.ts`** — add to `ERROR_KEYS`:

```ts
  party_invalid: "party.error.invalid",
  party_not_found: "party.error.not_found",
  party_adventure: "party.error.adventure",
  party_color_taken: "party.error.color_taken",
  party_full: "party.error.full",
  party_already_member: "party.error.already_member",
  adventure_referenced: "adventure.error.referenced",
```

**`src/shared/i18n/en.ts`:**

```ts
  "party.error.invalid": "That party data is invalid.",
  "party.error.not_found": "That party no longer exists.",
  "party.error.adventure": "That adventure no longer exists.",
  "party.error.color_taken": "That colour is already taken.",
  "party.error.full": "That party is full.",
  "party.error.already_member": "You are already in that party.",
  "adventure.error.referenced": "A party still uses this adventure.",
```

**`src/shared/i18n/fr.ts`:**

```ts
  "party.error.invalid": "Ces données de partie sont invalides.",
  "party.error.not_found": "Cette partie n'existe plus.",
  "party.error.adventure": "Cette aventure n'existe plus.",
  "party.error.color_taken": "Cette couleur est déjà prise.",
  "party.error.full": "Cette partie est complète.",
  "party.error.already_member": "Tu es déjà dans cette partie.",
  "adventure.error.referenced": "Une partie utilise encore cette aventure.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/parties-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

```bash
npm run check
git add src/server/index.ts src/client/api.ts src/shared/i18n/en.ts src/shared/i18n/fr.ts test/parties-api.test.ts
git commit -m "feat expose session gated parties api"
```

---

## Deliberate scope notes

- **No heroes yet.** A party has members (accounts + colours) but no heroes; `hero` + `/api/heroes` is the next bite. The running game keeps using `character`.
- **No runtime/admission/presence change**, no launch UI, no colour rendering, no removals.
- **Membership is durable and there is no leave endpoint** — you keep your colour; only the host deleting the party removes you. Leaving, if ever needed, is a later decision.
- **A completed party is still joinable** (the spec keeps finished parties playable); status is stored but does not gate joining in this bite.
- **`adventure_referenced` (409)** now protects adventures the same way `map_referenced` protects maps — the spec's "refuse deleting an adventure with existing parties" becomes real here.
