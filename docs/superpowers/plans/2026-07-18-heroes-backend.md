# Heroes Backend (bouchée 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `hero` D1 table and a nested `/api/parties/:partyId/heroes` API (list/create/delete the caller's heroes in a party they belong to) — additive, TDD, no runtime/UI change; the running game keeps using `character`.

**Architecture:** Second backend bite of plan 3 from `docs/superpowers/specs/2026-07-17-adventures-parties-design.md`. A hero belongs to a party (not the account roster), carries only core stats for now (the normalized item/equipment/skill/quest tables stay on `character` until the admission cutover), and wears the colour of its owner's `party_member` slot — so colour is NOT stored on the hero. Creating a hero requires membership and is capped at 3 per (party, account). The hero's starting map + position are resolved at creation from the party's adventure graph start entry, so a later bite's admission can place it directly. Mirrors the parties backend: pure shared module (`src/shared/hero.ts`), a server boundary (`src/server/heroes.ts`), nested REST routes.

**Tech Stack:** TypeScript (three tsconfigs; `src/shared/` valid in browser and workerd), Drizzle ORM + D1, drizzle-kit migrations, Vitest in workerd (`cloudflare:test`, real `SELF.fetch`), Biome.

## Global Constraints

- `npm run check` (lint, typecheck, test, ui) must pass before every commit. Biome `noNonNullAssertion`: no `!`, narrow properly.
- Never trust a client message: every new parser returns `null` on malformed input, never throws.
- Server error style: `throw new Error("prefix: human detail")` — the prefix is the machine code; `index.ts` maps prefixes to `{ error: "wire_code" }` JSON + status. Every new prefix must be added to the response mapper or it becomes a 500.
- Every new wire error code gets an entry in `ERROR_KEYS` (`src/client/api.ts`) and in BOTH `src/shared/i18n/en.ts` and `fr.ts` (the parity test enforces both).
- `src/shared/` imports nothing from Cloudflare or the DOM. `src/client/` never imports `src/server/`.
- Identifiers minted by the server are UUIDs (`crypto.randomUUID()`); clients never supply row ids.
- Migrations: edit `src/server/db/schema.ts`, then `npm run db:generate` (writes `migrations/NNNN_*.sql` — commit it), then `npm run db:migrate`. Tests apply migrations automatically via `test/setup.ts`. The last migration is `0014`; the next is `0015`.
- Scoping: a hero is created only in a party the caller is a member of; list and delete are scoped to the caller's own heroes (foreign/missing → `not_found`, no existence leak). The party's adventure is loaded via the party's host (who owns it) to resolve the start position.
- Classes are the existing `PlayerClass` union (`warrior`/`ranger`/`priest`) from `src/shared/game.ts`; colour is never stored on a hero (it comes from `party_member.color`).
- Repo compiles with `exactOptionalPropertyTypes: true`. Commits: `feat <lowercase>` (no colon). Single test file: `npm test -- test/<file>.test.ts`.

**Shared constants introduced (single source, `src/shared/hero.ts`):**
`HERO_CLASSES = ["warrior", "ranger", "priest"] as const satisfies readonly PlayerClass[]`, `MAX_HEROES_PER_PARTY = 3`, `HERO_NAME_MAX = 24`.

---

### Task 1: Shared hero types and input parsing

Pure, platform-free. Class guard, cap/name constants, the create-body parser.

**Files:**
- Create: `src/shared/hero.ts`
- Test: `test/hero.test.ts` (new)

**Interfaces:**
- Consumes: `PlayerClass` from `./game.js`.
- Produces (Tasks 2–3 rely on these exact names):

```ts
export const HERO_CLASSES: readonly ["warrior", "ranger", "priest"];
export const MAX_HEROES_PER_PARTY = 3;
export const HERO_NAME_MAX = 24;
export function isHeroClass(value: unknown): value is PlayerClass;
export interface CreateHeroInput { name: string; class: PlayerClass }
export function parseCreateHeroInput(value: unknown): CreateHeroInput | null;
```

- [ ] **Step 1: Write the failing test** — create `test/hero.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HERO_CLASSES, isHeroClass, parseCreateHeroInput } from "../src/shared/hero.js";

describe("hero classes", () => {
  it("are exactly the three player classes", () => {
    expect([...HERO_CLASSES]).toEqual(["warrior", "ranger", "priest"]);
    expect(isHeroClass("priest")).toBe(true);
    expect(isHeroClass("necromancer")).toBe(false);
    expect(isHeroClass(3)).toBe(false);
    expect(isHeroClass(null)).toBe(false);
  });
});

describe("parseCreateHeroInput", () => {
  it("accepts a trimmed name and a valid class", () => {
    expect(parseCreateHeroInput({ name: "  Mira ", class: "ranger" })).toEqual({
      name: "Mira",
      class: "ranger",
    });
  });

  it("rejects malformed bodies", () => {
    const bad: unknown[] = [
      null,
      "hero",
      {},
      { name: "Mira" },
      { class: "warrior" },
      { name: "", class: "warrior" },
      { name: "   ", class: "warrior" },
      { name: "x".repeat(25), class: "warrior" },
      { name: "Mira", class: "necromancer" },
      { name: 7, class: "warrior" },
    ];
    for (const value of bad) expect(parseCreateHeroInput(value)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/hero.test.ts`
Expected: FAIL — module `src/shared/hero.ts` does not exist.

- [ ] **Step 3: Write the implementation** — create `src/shared/hero.ts`:

```ts
/**
 * A hero belongs to a party (not the account roster) and wears the colour of its owner's slot in
 * that party — so colour is never stored here. Pure rules only: D1 lives in server/heroes.ts.
 */
import type { PlayerClass } from "./game.js";

/** Kept in step with PlayerClass by `satisfies`: a new class must be added here to compile. */
export const HERO_CLASSES = ["warrior", "ranger", "priest"] as const satisfies readonly PlayerClass[];

export const MAX_HEROES_PER_PARTY = 3;
export const HERO_NAME_MAX = 24;

export function isHeroClass(value: unknown): value is PlayerClass {
  return typeof value === "string" && (HERO_CLASSES as readonly string[]).includes(value);
}

export interface CreateHeroInput {
  name: string;
  class: PlayerClass;
}

export function parseCreateHeroInput(value: unknown): CreateHeroInput | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { name, class: heroClass } = record;
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > HERO_NAME_MAX) return null;
  if (!isHeroClass(heroClass)) return null;
  return { name: trimmed, class: heroClass };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/hero.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/shared/hero.ts test/hero.test.ts
git commit -m "feat add shared hero classes and request parsing"
```

---

### Task 2: Hero table and the server boundary

The `hero` table (migration `0015`) and `src/server/heroes.ts` owning create (membership + cap + start-position resolution), list, and delete.

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `migrations/0015_*.sql` via `npm run db:generate`
- Create: `src/server/heroes.ts`
- Test: `test/heroes.test.ts` (new)

**Interfaces:**
- Consumes: `CreateHeroInput`, `MAX_HEROES_PER_PARTY` (Task 1); `loadAdventure` (`./adventures.js`); `loadMap` + `StoredMap` (`./maps.js`); `party`, `partyMember`, `hero`, `Db` (`./db/index.js`); `TILE_SIZE` (`../shared/tilemap.js`); `EMPTY_MARKERS`, `mapSpawnPoint` (`../shared/map-data.js`); `PlayerClass` (`../shared/game.js`).
- Produces (Task 3 calls exactly these):

```ts
export interface StoredHero {
  id: string; partyId: string; accountId: string; name: string; class: PlayerClass;
  mapId: string; x: number; y: number; level: number; xp: number; hp: number;
  life: "alive" | "corpse" | "ghost";
}
export async function createHero(db: Db, accountId: string, partyId: string, input: CreateHeroInput): Promise<StoredHero>; // throws "not_found:|not_member:|cap:"
export async function listHeroes(db: Db, accountId: string, partyId: string): Promise<StoredHero[]>;
export async function deleteHero(db: Db, accountId: string, partyId: string, heroId: string): Promise<void>; // throws "not_found:"
```

- [ ] **Step 1: Add the table and generate the migration**

In `src/server/db/schema.ts`, after the `partyMember` table:

```ts
export const hero = sqliteTable(
  "hero",
  {
    /** Server-minted uuid. A client never supplies this. */
    id: text("id").primaryKey(),
    partyId: text("party_id")
      .notNull()
      .references(() => party.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    class: text("class", { enum: ["warrior", "ranger", "priest"] })
      .notNull()
      .default("warrior"),
    /** The D1 map the hero is on; starts at the adventure's start map. */
    mapId: text("map_id").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),
    hp: integer("hp").notNull().default(100),
    sessionEpoch: integer("session_epoch").notNull().default(0),
    /** Death is persistent, mirroring `character`. `corpseX/Y` are null exactly when life is alive. */
    life: text("life", { enum: ["alive", "corpse", "ghost"] })
      .notNull()
      .default("alive"),
    corpseX: real("corpse_x"),
    corpseY: real("corpse_y"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [index("hero_party_account_idx").on(table.partyId, table.accountId)],
);
```

Add a type export beside the others at the bottom of the file:

```ts
export type Hero = typeof hero.$inferSelect;
```

Run: `npm run db:generate` (expect `migrations/0015_*.sql` with the `CREATE TABLE` and the index), then `npm run db:migrate`.

- [ ] **Step 2: Write the failing test** — create `test/heroes.test.ts`:

```ts
/**
 * The heroes boundary: create in a party you belong to (with the start position resolved from the
 * adventure), the 3-hero cap, non-member refusal, owner-scoped list and delete. The starting
 * position comes from the start map's entry marker (door at col 5,row 5 → pixel centre).
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { AdventureInput } from "../src/shared/adventure.js";
import { TILE_SIZE } from "../src/shared/tilemap.js";
import { createAdventure } from "../src/server/adventures.js";
import { account, createDb } from "../src/server/db/index.js";
import { createHero, deleteHero, listHeroes } from "../src/server/heroes.js";
import { createMap, type MapInput } from "../src/server/maps.js";
import { createParty, joinParty } from "../src/server/parties.js";

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

function adventureInput(mapIds: string[]): AdventureInput {
  const [a, b] = mapIds;
  if (!a || !b) throw new Error("expected two maps");
  return {
    title: "Donjon",
    maxPlayers: 4,
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

/** Returns the party id and the start map id. */
async function seedParty(hostId: string): Promise<{ partyId: string; startMapId: string }> {
  const db = createDb(env.DB);
  const mapA = await createMap(db, mapInput("A"));
  const mapB = await createMap(db, mapInput("B"));
  const adventure = await createAdventure(db, hostId, adventureInput([mapA.id, mapB.id]));
  const party = await createParty(db, hostId, { adventureId: adventure.id, name: null, color: "blue" });
  return { partyId: party.id, startMapId: mapA.id };
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM character");
  await env.DB.exec("DELETE FROM account");
});

describe("createHero", () => {
  it("creates a hero on the adventure's start entry and scopes the list to the owner", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    const { partyId, startMapId } = await seedParty("host");

    const hero = await createHero(db, "host", partyId, { name: "Mira", class: "priest" });
    expect(hero).toMatchObject({
      partyId,
      accountId: "host",
      name: "Mira",
      class: "priest",
      mapId: startMapId,
      x: 5 * TILE_SIZE + TILE_SIZE / 2,
      y: 5 * TILE_SIZE + TILE_SIZE / 2,
      level: 1,
      hp: 100,
      life: "alive",
    });

    const mine = await listHeroes(db, "host", partyId);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.id).toBe(hero.id);
  });

  it("refuses a non-member and caps at three heroes per player", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("outsider");
    const { partyId } = await seedParty("host");

    await expect(
      createHero(db, "outsider", partyId, { name: "Sneak", class: "warrior" }),
    ).rejects.toThrow(/^not_member:/);

    await createHero(db, "host", partyId, { name: "One", class: "warrior" });
    await createHero(db, "host", partyId, { name: "Two", class: "ranger" });
    await createHero(db, "host", partyId, { name: "Three", class: "priest" });
    await expect(
      createHero(db, "host", partyId, { name: "Four", class: "warrior" }),
    ).rejects.toThrow(/^cap:/);

    await expect(
      createHero(db, "host", "no-such-party", { name: "Ghost", class: "warrior" }),
    ).rejects.toThrow(/^not_found:/);
  });

  it("keeps each member's heroes separate", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("mate");
    const { partyId } = await seedParty("host");
    await joinParty(db, "mate", partyId, "red");

    await createHero(db, "host", partyId, { name: "Hostling", class: "warrior" });
    await createHero(db, "mate", partyId, { name: "Matey", class: "ranger" });

    expect(await listHeroes(db, "host", partyId)).toHaveLength(1);
    expect((await listHeroes(db, "mate", partyId))[0]?.name).toBe("Matey");
  });
});

describe("deleteHero", () => {
  it("deletes only the caller's own hero", async () => {
    const db = createDb(env.DB);
    await seedAccount("host");
    await seedAccount("mate");
    const { partyId } = await seedParty("host");
    await joinParty(db, "mate", partyId, "red");
    const mine = await createHero(db, "host", partyId, { name: "Mine", class: "warrior" });

    await expect(deleteHero(db, "mate", partyId, mine.id)).rejects.toThrow(/^not_found:/);
    await deleteHero(db, "host", partyId, mine.id);
    expect(await listHeroes(db, "host", partyId)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/heroes.test.ts`
Expected: FAIL — module `src/server/heroes.ts` does not exist.

- [ ] **Step 4: Implement** — create `src/server/heroes.ts`:

```ts
/**
 * Heroes: party-owned characters. This boundary owns the D1 reads and writes; a hero is created
 * only in a party the caller belongs to, capped per player, and placed at the party adventure's
 * start entry so a later admission step can spawn it directly. Colour is never stored — it comes
 * from the owner's party_member slot.
 */
import { and, eq } from "drizzle-orm";
import type { PlayerClass } from "../shared/game.js";
import type { CreateHeroInput } from "../shared/hero.js";
import { MAX_HEROES_PER_PARTY } from "../shared/hero.js";
import { EMPTY_MARKERS, mapSpawnPoint } from "../shared/map-data.js";
import { TILE_SIZE } from "../shared/tilemap.js";
import { loadAdventure } from "./adventures.js";
import { type Db, hero, party, partyMember } from "./db/index.js";
import { loadMap, type StoredMap } from "./maps.js";

export interface StoredHero {
  id: string;
  partyId: string;
  accountId: string;
  name: string;
  class: PlayerClass;
  mapId: string;
  x: number;
  y: number;
  level: number;
  xp: number;
  hp: number;
  life: "alive" | "corpse" | "ghost";
}

function toStored(row: typeof hero.$inferSelect): StoredHero {
  return {
    id: row.id,
    partyId: row.partyId,
    accountId: row.accountId,
    name: row.name,
    class: row.class,
    mapId: row.mapId,
    x: row.x,
    y: row.y,
    level: row.level,
    xp: row.xp,
    hp: row.hp,
    life: row.life,
  };
}

/** The pixel centre of the named entry cell, or the map's fallback spawn if the entry is gone. */
function entryPosition(map: StoredMap, entryId: string): { x: number; y: number } {
  const markers = map.markers ?? EMPTY_MARKERS;
  const entry = markers.entries.find((marker) => marker.id === entryId);
  if (!entry) return mapSpawnPoint(map);
  return { x: entry.col * TILE_SIZE + TILE_SIZE / 2, y: entry.row * TILE_SIZE + TILE_SIZE / 2 };
}

export async function createHero(
  db: Db,
  accountId: string,
  partyId: string,
  input: CreateHeroInput,
): Promise<StoredHero> {
  const [partyRow] = await db.select().from(party).where(eq(party.id, partyId)).limit(1);
  if (!partyRow) throw new Error("not_found: no such party");

  const membership = await db
    .select({ accountId: partyMember.accountId })
    .from(partyMember)
    .where(and(eq(partyMember.partyId, partyId), eq(partyMember.accountId, accountId)))
    .limit(1);
  if (membership.length === 0) throw new Error("not_member: not a member of this party");

  const existing = await db
    .select({ id: hero.id })
    .from(hero)
    .where(and(eq(hero.partyId, partyId), eq(hero.accountId, accountId)));
  if (existing.length >= MAX_HEROES_PER_PARTY) throw new Error("cap: too many heroes in this party");

  // The adventure is owned by the party host; load it through them to read the start entry.
  const adventure = await loadAdventure(db, partyRow.hostAccountId, partyRow.adventureId);
  if (!adventure) throw new Error("not_found: party adventure is unavailable");
  const startMap = await loadMap(db, adventure.graph.start.mapId);
  if (!startMap) throw new Error("not_found: start map is unavailable");
  const position = entryPosition(startMap, adventure.graph.start.entryId);

  const id = crypto.randomUUID();
  await db.insert(hero).values({
    id,
    partyId,
    accountId,
    name: input.name,
    class: input.class,
    mapId: startMap.id,
    x: position.x,
    y: position.y,
  });
  const [created] = await db.select().from(hero).where(eq(hero.id, id)).limit(1);
  if (!created) throw new Error("not_found: hero vanished mid-create");
  return toStored(created);
}

export async function listHeroes(db: Db, accountId: string, partyId: string): Promise<StoredHero[]> {
  const rows = await db
    .select()
    .from(hero)
    .where(and(eq(hero.partyId, partyId), eq(hero.accountId, accountId)));
  return rows.map(toStored);
}

export async function deleteHero(
  db: Db,
  accountId: string,
  partyId: string,
  heroId: string,
): Promise<void> {
  const result = await db.$client
    .prepare(`DELETE FROM hero WHERE id = ? AND party_id = ? AND account_id = ?`)
    .bind(heroId, partyId, accountId)
    .run();
  if ((result.meta.changes ?? 0) === 0) throw new Error("not_found: no such hero");
}
```

Note: the hero cap is a plain read-then-insert (deliberately not the atomic conditional insert used for party joins) — see the scope notes: this is a single account racing itself, and an over-cap of one extra hero is benign, unlike the multi-user party-join cap.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/heroes.test.ts` and `npm test -- test/parties.test.ts` (unchanged, must stay green).
Expected: PASS.

- [ ] **Step 6: Check and commit**

```bash
npm run check
git add src/server/db/schema.ts migrations src/server/heroes.ts test/heroes.test.ts
git commit -m "feat store party heroes placed at the adventure start"
```

---

### Task 3: Nested /api/parties/:partyId/heroes routes

Three routes, session-gated, machine codes. Nested under the party so membership scoping is natural.

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/client/api.ts` (`ERROR_KEYS`), `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts`
- Test: `test/heroes-api.test.ts` (new)

**Interfaces:**
- Consumes: `parseCreateHeroInput` (Task 1); `createHero`/`listHeroes`/`deleteHero` (Task 2); existing `requireSession`, `readJson`, `json`.
- Produces the wire API the launch-UI bite will call:
  - `GET /api/parties/:partyId/heroes` → 200 `StoredHero[]`
  - `POST /api/parties/:partyId/heroes` → 201 `StoredHero` | 400 `hero_invalid` | 403 `hero_not_member` | 404 `hero_not_found` | 409 `hero_cap`
  - `DELETE /api/parties/:partyId/heroes/:heroId` → 204 | 404 `hero_not_found`

- [ ] **Step 1: Write the failing test** — create `test/heroes-api.test.ts`:

```ts
/**
 * The nested heroes API over SELF.fetch: create in a party you joined, cap, non-member refusal,
 * owner-scoped list and delete. Register-and-cookie pattern from parties-api.test.ts.
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
    body: JSON.stringify({ username: `heroapi${userCount}`, password: "12345678" }),
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

/** Creates two maps + an adventure + a party owned by `cookie`, returns the party id. */
async function seedParty(cookie: string): Promise<string> {
  const a = await authed("/api/maps", cookie, { method: "POST", body: JSON.stringify(mapBody("A")) });
  const b = await authed("/api/maps", cookie, { method: "POST", body: JSON.stringify(mapBody("B")) });
  const mapA = ((await a.json()) as { id: string }).id;
  const mapB = ((await b.json()) as { id: string }).id;
  const adventure = await authed("/api/adventures", cookie, {
    method: "POST",
    body: JSON.stringify({
      title: "Donjon",
      maxPlayers: 4,
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
  const adventureId = ((await adventure.json()) as { id: string }).id;
  const party = await authed("/api/parties", cookie, {
    method: "POST",
    body: JSON.stringify({ adventureId, color: "blue" }),
  });
  return ((await party.json()) as { id: string }).id;
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM hero");
  await env.DB.exec("DELETE FROM party_member");
  await env.DB.exec("DELETE FROM party");
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
});

describe("session gate", () => {
  it("401s the hero routes without a cookie", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/parties/some-id/heroes"],
      ["POST", "/api/parties/some-id/heroes"],
      ["DELETE", "/api/parties/some-id/heroes/hero-id"],
    ];
    for (const [method, path] of routes) {
      expect((await SELF.fetch(`${ORIGIN}${path}`, { method })).status).toBe(401);
    }
  });
});

describe("hero lifecycle over the wire", () => {
  it("creates, lists and deletes the caller's heroes", async () => {
    const host = await register();
    const partyId = await seedParty(host);

    const createRes = await authed(`/api/parties/${partyId}/heroes`, host, {
      method: "POST",
      body: JSON.stringify({ name: "Mira", class: "priest" }),
    });
    expect(createRes.status).toBe(201);
    const heroRow = (await createRes.json()) as { id: string; mapId: string };
    expect(heroRow).toMatchObject({ name: "Mira", class: "priest", life: "alive" });

    const listRes = await authed(`/api/parties/${partyId}/heroes`, host, {});
    expect(listRes.status).toBe(200);
    expect((await listRes.json()) as unknown[]).toHaveLength(1);

    const deleteRes = await authed(`/api/parties/${partyId}/heroes/${heroRow.id}`, host, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(204);
    expect((await (await authed(`/api/parties/${partyId}/heroes`, host, {})).json()) as unknown[]).toHaveLength(0);
  });

  it("answers machine codes for a bad body, a non-member, and the cap", async () => {
    const host = await register();
    const partyId = await seedParty(host);

    const invalid = await authed(`/api/parties/${partyId}/heroes`, host, {
      method: "POST",
      body: JSON.stringify({ name: "", class: "warrior" }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "hero_invalid" });

    const outsider = await register();
    const forbidden = await authed(`/api/parties/${partyId}/heroes`, outsider, {
      method: "POST",
      body: JSON.stringify({ name: "Sneak", class: "warrior" }),
    });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "hero_not_member" });

    for (const name of ["One", "Two", "Three"]) {
      await authed(`/api/parties/${partyId}/heroes`, host, {
        method: "POST",
        body: JSON.stringify({ name, class: "warrior" }),
      });
    }
    const capped = await authed(`/api/parties/${partyId}/heroes`, host, {
      method: "POST",
      body: JSON.stringify({ name: "Four", class: "warrior" }),
    });
    expect(capped.status).toBe(409);
    expect(await capped.json()).toEqual({ error: "hero_cap" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/heroes-api.test.ts`
Expected: FAIL — the hero routes fall through to 404 `{ error: "not found" }`.

- [ ] **Step 3: Implement**

**`src/server/index.ts`:**

Imports: add `parseCreateHeroInput` from `../shared/hero.js` and `createHero, deleteHero, listHeroes` from `./heroes.js`.

Error mapper beside `partyErrorResponse`:

```ts
/** `heroes.ts` throws "prefix: message" — the prefix is the machine code. */
function heroErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") return json({ error: "hero_not_found" }, { status: 404 });
  if (code === "not_member") return json({ error: "hero_not_member" }, { status: 403 });
  if (code === "cap") return json({ error: "hero_cap" }, { status: 409 });
  throw error;
}
```

Handlers:

```ts
async function handleListHeroes(
  request: Request,
  env: Env,
  url: URL,
  partyId: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  return json(await listHeroes(createDb(env.DB), auth.session.id, partyId));
}

async function handleCreateHero(
  request: Request,
  env: Env,
  url: URL,
  partyId: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request);
  if (parsed instanceof Response) return parsed;
  const input = parseCreateHeroInput(parsed.value);
  if (!input) return json({ error: "hero_invalid" }, { status: 400 });
  try {
    return json(await createHero(createDb(env.DB), auth.session.id, partyId, input), { status: 201 });
  } catch (error) {
    return heroErrorResponse(error);
  }
}

async function handleDeleteHero(
  request: Request,
  env: Env,
  url: URL,
  partyId: string,
  heroId: string,
): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  try {
    await deleteHero(createDb(env.DB), auth.session.id, partyId, heroId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return heroErrorResponse(error);
  }
}
```

Routing, after the party routes block in `fetch` (the `/heroes/:heroId` DELETE route and the `/heroes` list/create route are distinct paths; add both):

```ts
    const heroListRoute = url.pathname.match(/^\/api\/parties\/([A-Za-z0-9-]{1,64})\/heroes$/);
    if (heroListRoute?.[1]) {
      const partyId = heroListRoute[1];
      if (request.method === "GET") return handleListHeroes(request, env, url, partyId);
      if (request.method === "POST") return handleCreateHero(request, env, url, partyId);
    }
    const heroItemRoute = url.pathname.match(
      /^\/api\/parties\/([A-Za-z0-9-]{1,64})\/heroes\/([A-Za-z0-9-]{1,64})$/,
    );
    if (heroItemRoute?.[1] && heroItemRoute[2] && request.method === "DELETE") {
      return handleDeleteHero(request, env, url, heroItemRoute[1], heroItemRoute[2]);
    }
```

**`src/client/api.ts`** — add to `ERROR_KEYS`:

```ts
  hero_invalid: "hero.error.invalid",
  hero_not_found: "hero.error.not_found",
  hero_not_member: "hero.error.not_member",
  hero_cap: "hero.error.cap",
```

**`src/shared/i18n/en.ts`:**

```ts
  "hero.error.invalid": "That hero data is invalid.",
  "hero.error.not_found": "That hero no longer exists.",
  "hero.error.not_member": "You are not a member of that party.",
  "hero.error.cap": "You already have three heroes in this party.",
```

**`src/shared/i18n/fr.ts`:**

```ts
  "hero.error.invalid": "Ces données de héros sont invalides.",
  "hero.error.not_found": "Ce héros n'existe plus.",
  "hero.error.not_member": "Tu n'es pas membre de cette partie.",
  "hero.error.cap": "Tu as déjà trois héros dans cette partie.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/heroes-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

```bash
npm run check
git add src/server/index.ts src/client/api.ts src/shared/i18n/en.ts src/shared/i18n/fr.ts test/heroes-api.test.ts
git commit -m "feat expose nested session gated heroes api"
```

---

## Deliberate scope notes

- **Core stats only.** A hero carries position, class, hp/level/xp, life/corpse and its epoch — no inventory, equipment, skills or quests yet. Those normalized tables stay on `character` until the admission cutover repoints them.
- **Colour is not stored on the hero** — it is the owner's `party_member.color`. The hero API returns hero columns only; a UI that needs the colour reads it from the party membership.
- **The hero cap is a plain read-then-insert, deliberately not atomic** (unlike the party-join cap). The party-join race is genuinely multi-user; the hero cap can only be raced by one account against itself, and an extra hero is a benign, recoverable over-count. If this ever matters it becomes the same atomic conditional insert.
- **Start position is resolved at creation** from the party adventure's graph start entry (via the host-owned adventure and the start map's marker), with `mapSpawnPoint` as a defensive fallback. Admission (a later bite) is still the authority and may re-resolve.
- **No runtime/admission/presence change**, no launch UI, no removals. The running game still uses `character`.
