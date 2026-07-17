# Adventure Authoring Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maps gain functional markers (entries, exits, monster spawns) and D1 gains owned `adventure` / `adventure_map` tables with a validated graph API — while the current game keeps running untouched.

**Architecture:** This is plan 1 of 5 for the approved spec
`docs/superpowers/specs/2026-07-17-adventures-parties-design.md`. Markers are a new optional
collection on the shared `MapData` payload (parsed/validated in `shared/map-data.ts`, persisted as
one JSON column on `map`), deliberately separate from decorative `MapElement`s. Adventures are
account-owned D1 rows whose JSON `graph` binds each placed exit to a destination (map + entry) or
`"end"`; a pure validator in `shared/adventure.ts` enforces completeness. Nothing reaches the
runtime/wire yet: `zoneFromMap` still emits `monsters: []` and `WorldInfo` is unchanged (plan 4).
Editor UI (plan 2), parties/heroes (plan 3), GameSession runtime (plan 4) and removals (plan 5)
follow.

**Tech Stack:** TypeScript (three tsconfigs — everything in `src/shared/` must compile under both DOM and workerd), Drizzle ORM + D1, drizzle-kit migrations, Vitest in workerd (`cloudflare:test`, real `SELF.fetch`), Biome.

## Global Constraints

- `npm run check` (lint, typecheck, test) must pass before every commit.
- Biome `noNonNullAssertion` is on: no `!`, narrow properly.
- Never trust a client message: every new parser returns `null` on malformed input, never throws.
- Server error style: `throw new Error("prefix: human detail")` — the prefix is the machine code; `index.ts` maps prefixes to `{ error: "wire_code" }` JSON + status. Every new prefix must be added to the response mapper or it becomes a 500.
- Every new wire error code gets an entry in `ERROR_KEYS` (`src/client/api.ts`) and in **both** `src/shared/i18n/en.ts` and `fr.ts` (the parity test enforces both).
- `src/shared/` imports nothing from Cloudflare or the DOM.
- Identifiers minted by the server are UUIDs (`crypto.randomUUID()`); clients never supply row ids.
- Migrations: edit `src/server/db/schema.ts`, then `npm run db:generate` (writes `migrations/NNNN_*.sql` — commit it), then `npm run db:migrate` (local). Tests apply migrations automatically via `test/setup.ts`.
- Single test file: `npm test -- test/<file>.test.ts`.
- Commit messages follow repo style: `feat <lowercase description>` / `docs ...` (no colon).

**New shared constants introduced by this plan (single source, `src/shared/map-data.ts` unless noted):**
`MAX_MAP_ENTRIES = 8`, `MAX_MAP_EXITS = 8`, `MAX_MAP_MONSTER_SPAWNS = 32`,
`MIN_PATROL_RADIUS = 32`, `MAX_PATROL_RADIUS = 768`, `MARKER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/`;
in `src/shared/adventure.ts`: `ADVENTURE_TITLE_MAX = 48`, `MAX_ADVENTURE_MAPS = 16`, `MAX_ADVENTURE_LINKS = 64`;
in `src/server/index.ts`: `MAX_ADVENTURE_JSON_BYTES = 16_384`.

---

### Task 1: Species→kind table in shared/game.ts

The monster-spawn marker stores a `MonsterSpecies`; its `MonsterKind` (stats row) must be derivable, not authored twice. Today the pairing exists only implicitly inside `MONSTER_SPAWNS`.

**Files:**
- Modify: `src/shared/game.ts` (beside the existing `MonsterSpecies` type, ~line 45)
- Test: `test/game.test.ts` (append a describe block)

**Interfaces:**
- Consumes: existing `MonsterKind`, `MonsterSpecies`, `MONSTER_SPAWNS` from `shared/game.ts`.
- Produces: `export const MONSTER_SPECIES_KIND: Record<MonsterSpecies, MonsterKind>` and `export function isMonsterSpecies(value: unknown): value is MonsterSpecies`. Task 2 imports both.

- [ ] **Step 1: Write the failing test** — append to `test/game.test.ts`:

```ts
describe("monster species table", () => {
  it("maps every species to the kind used by the compiled spawns", () => {
    for (const spawn of MONSTER_SPAWNS) {
      expect(MONSTER_SPECIES_KIND[spawn.species]).toBe(spawn.kind);
    }
  });

  it("recognizes species and rejects everything else", () => {
    expect(isMonsterSpecies("mire_troll")).toBe(true);
    expect(isMonsterSpecies("dragon")).toBe(false);
    expect(isMonsterSpecies(7)).toBe(false);
    expect(isMonsterSpecies(null)).toBe(false);
  });
});
```

Add `MONSTER_SPECIES_KIND, isMonsterSpecies, MONSTER_SPAWNS` to the file's existing `shared/game.js` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/game.test.ts`
Expected: FAIL — `MONSTER_SPECIES_KIND` is not exported.

- [ ] **Step 3: Write minimal implementation** — in `src/shared/game.ts`, directly under the `MonsterSpecies` type:

```ts
/** One authored field (species) decides the stats row (kind). Markers store only the species. */
export const MONSTER_SPECIES_KIND: Record<MonsterSpecies, MonsterKind> = {
  spear_goblin: "goblin",
  torch_goblin: "goblin",
  gnoll_marauder: "gnoll",
  skull_guard: "skull",
  skull_crusader: "skull",
  skull_warden: "skull",
  minotaur_brute: "minotaur",
  mire_troll: "troll",
  gate_troll: "troll",
};

export function isMonsterSpecies(value: unknown): value is MonsterSpecies {
  return typeof value === "string" && value in MONSTER_SPECIES_KIND;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/game.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/shared/game.ts test/game.test.ts
git commit -m "feat derive monster kind from species in one shared table"
```

---

### Task 2: Marker types and parsing in shared/map-data.ts

Markers are functional collections, not `MapElement`s with asset ids (architecture-doc rule). Absent key = empty (legacy maps stay valid); malformed key = whole payload rejected.

**Files:**
- Modify: `src/shared/map-data.ts`
- Test: `test/map-data.test.ts` (append)

**Interfaces:**
- Consumes: `isMonsterSpecies`, `MonsterSpecies` from Task 1.
- Produces (Tasks 3–7 rely on these exact names):

```ts
export interface EntryMarker { id: string; col: number; row: number }
export interface ExitMarker { id: string; col: number; row: number }
export interface MonsterSpawnMarker { col: number; row: number; species: MonsterSpecies; patrolRadius: number }
export interface MapMarkers {
  entries: readonly EntryMarker[];
  exits: readonly ExitMarker[];
  monsterSpawns: readonly MonsterSpawnMarker[];
}
export const EMPTY_MARKERS: MapMarkers;
export const MAX_MAP_ENTRIES = 8;
export const MAX_MAP_EXITS = 8;
export const MAX_MAP_MONSTER_SPAWNS = 32;
export const MIN_PATROL_RADIUS = 32;
export const MAX_PATROL_RADIUS = 768;
export const MARKER_ID_PATTERN: RegExp;
export function parseMapMarkers(value: unknown, cols: number, rows: number): MapMarkers | null;
// MapData gains: markers?: MapMarkers  (parseMapData always sets it, EMPTY_MARKERS when absent)
```

- [ ] **Step 1: Write the failing test** — append to `test/map-data.test.ts`:

```ts
describe("map markers", () => {
  const GOOD = {
    entries: [{ id: "front-door", col: 1, row: 1 }],
    exits: [{ id: "cave", col: 2, row: 2 }],
    monsterSpawns: [{ col: 3, row: 1, species: "spear_goblin", patrolRadius: 96 }],
  };

  it("parses a well-formed marker collection", () => {
    expect(parseMapMarkers(GOOD, 4, 4)).toEqual(GOOD);
  });

  it("defaults an absent collection to empty", () => {
    expect(parseMapMarkers(undefined, 4, 4)).toEqual(EMPTY_MARKERS);
  });

  it("rejects malformed markers instead of throwing", () => {
    const bad: unknown[] = [
      null,
      "markers",
      { entries: [{ id: "x", col: 9, row: 0 }], exits: [], monsterSpawns: [] }, // out of bounds
      { entries: [{ id: "UPPER", col: 0, row: 0 }], exits: [], monsterSpawns: [] }, // id pattern
      { entries: [{ id: "a", col: 0, row: 0 }, { id: "a", col: 1, row: 1 }], exits: [], monsterSpawns: [] }, // dup id
      { entries: [], exits: [], monsterSpawns: [{ col: 0, row: 0, species: "dragon", patrolRadius: 96 }] },
      { entries: [], exits: [], monsterSpawns: [{ col: 0, row: 0, species: "mire_troll", patrolRadius: 8 }] },
      { entries: [], exits: [], monsterSpawns: [{ col: 0, row: 0, species: "mire_troll", patrolRadius: 4096 }] },
      { entries: Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, col: 0, row: 0 })), exits: [], monsterSpawns: [] },
    ];
    for (const value of bad) expect(parseMapMarkers(value, 4, 4)).toBeNull();
  });

  it("rides through parseMapData and defaults when absent", () => {
    const base = { blocks: ["....", "....", "....", "...."], elements: [], spawn: { col: 0, row: 0 } };
    expect(parseMapData(base)?.markers).toEqual(EMPTY_MARKERS);
    expect(parseMapData({ ...base, markers: GOOD })?.markers).toEqual(GOOD);
    expect(parseMapData({ ...base, markers: { entries: "no" } })).toBeNull();
  });
});
```

Add `parseMapMarkers, EMPTY_MARKERS` to the file's `shared/map-data.js` import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/map-data.test.ts`
Expected: FAIL — `parseMapMarkers` is not exported.

- [ ] **Step 3: Write minimal implementation** — in `src/shared/map-data.ts`:

Add to the imports: `import { isMonsterSpecies, type MonsterSpecies } from "./game.js";`

Below the `MapElement` types:

```ts
export interface EntryMarker {
  id: string;
  col: number;
  row: number;
}

export interface ExitMarker {
  id: string;
  col: number;
  row: number;
}

export interface MonsterSpawnMarker {
  col: number;
  row: number;
  species: MonsterSpecies;
  patrolRadius: number;
}

/**
 * Functional markers are deliberately not MapElements: they carry no catalogue asset, no
 * footprint and no collision. Entries/exits are spatial anchors whose meaning (destinations)
 * lives in the adventure graph, never here.
 */
export interface MapMarkers {
  entries: readonly EntryMarker[];
  exits: readonly ExitMarker[];
  monsterSpawns: readonly MonsterSpawnMarker[];
}

export const EMPTY_MARKERS: MapMarkers = { entries: [], exits: [], monsterSpawns: [] };

export const MAX_MAP_ENTRIES = 8;
export const MAX_MAP_EXITS = 8;
export const MAX_MAP_MONSTER_SPAWNS = 32;
export const MIN_PATROL_RADIUS = 32;
export const MAX_PATROL_RADIUS = 768;
export const MARKER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function parseAnchoredMarkers(
  value: unknown,
  max: number,
  cols: number,
  rows: number,
): { id: string; col: number; row: number }[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const seen = new Set<string>();
  const parsed: { id: string; col: number; row: number }[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const { id, col, row } = raw as Record<string, unknown>;
    if (typeof id !== "string" || !MARKER_ID_PATTERN.test(id) || seen.has(id)) return null;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    const c = col as number;
    const r = row as number;
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    seen.add(id);
    parsed.push({ id, col: c, row: r });
  }
  return parsed;
}

export function parseMapMarkers(value: unknown, cols: number, rows: number): MapMarkers | null {
  if (value === undefined) return EMPTY_MARKERS;
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const entries = parseAnchoredMarkers(record.entries, MAX_MAP_ENTRIES, cols, rows);
  const exits = parseAnchoredMarkers(record.exits, MAX_MAP_EXITS, cols, rows);
  if (!entries || !exits) return null;
  const spawnsRaw = record.monsterSpawns;
  if (!Array.isArray(spawnsRaw) || spawnsRaw.length > MAX_MAP_MONSTER_SPAWNS) return null;
  const monsterSpawns: MonsterSpawnMarker[] = [];
  for (const raw of spawnsRaw) {
    if (typeof raw !== "object" || raw === null) return null;
    const { col, row, species, patrolRadius } = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    const c = col as number;
    const r = row as number;
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    if (!isMonsterSpecies(species)) return null;
    if (!Number.isSafeInteger(patrolRadius)) return null;
    const radius = patrolRadius as number;
    if (radius < MIN_PATROL_RADIUS || radius > MAX_PATROL_RADIUS) return null;
    monsterSpawns.push({ col: c, row: r, species, patrolRadius: radius });
  }
  return { entries, exits, monsterSpawns };
}
```

Extend `MapData`:

```ts
export interface MapData {
  blocks: readonly string[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  /** Absent on legacy payloads; parseMapData always fills it (EMPTY_MARKERS when omitted). */
  markers?: MapMarkers;
}
```

In `parseMapData`, after the spawn checks and before the final `return`:

```ts
  const markers = parseMapMarkers(record.markers, cols, rows);
  if (!markers) return null;
```

and add `markers,` to the returned object literal.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/map-data.test.ts`
Expected: PASS (including the pre-existing describe blocks — `markers` is optional, so untouched fixtures still compile).

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/shared/map-data.ts test/map-data.test.ts
git commit -m "feat add functional entry exit and monster spawn markers to the map format"
```

---

### Task 3: Marker persistence and terrain validation in the maps boundary

Markers are stored as one JSON text column on `map` (they are few and bounded — no per-cell PK need, unlike `map_element`). `validateMapInput` gains terrain-dependent rules under a new `markers:` error prefix; the wire code is `map_markers`.

**Files:**
- Modify: `src/server/db/schema.ts` (add `markers` column to `map`)
- Create: `migrations/0012_*.sql` via `npm run db:generate`
- Modify: `src/server/maps.ts`
- Modify: `src/server/index.ts` (`parseMapBody`, `mapErrorResponse`)
- Modify: `src/client/api.ts` (`ERROR_KEYS`), `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts`
- Test: `test/map-markers.test.ts` (new file)

**Interfaces:**
- Consumes: `MapMarkers`, `EMPTY_MARKERS`, `parseMapMarkers` from Task 2.
- Produces: `MapInput.markers?: MapMarkers`; `StoredMap.markers?: MapMarkers` (set on every D1 read); `validateMapInput` throws `"markers: ..."`; wire error `map_markers` (400). Tasks 5 and 7 read `StoredMap.markers` to learn a map's entry/exit ids.

- [ ] **Step 1: Add the column and generate the migration**

In `src/server/db/schema.ts`, add to the `map` table between `spawnRow` and `isFirst`:

```ts
  /** JSON MapMarkers (entries/exits/monster spawns); NULL for maps saved before markers existed. */
  markers: text("markers"),
```

Run: `npm run db:generate` — expect a new `migrations/0012_*.sql` containing `ALTER TABLE \`map\` ADD \`markers\` text;`. Then `npm run db:migrate`.

- [ ] **Step 2: Write the failing test** — create `test/map-markers.test.ts`:

```ts
/**
 * Markers through the server boundary: validateMapInput's terrain rules, the JSON column
 * round-trip, and the map_markers wire code. Same SELF.fetch cookie pattern as maps-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { MapMarkers } from "../src/shared/map-data.js";
import { createDb } from "../src/server/db/index.js";
import { createMap, loadMap, validateMapInput, type MapInput } from "../src/server/maps.js";
import { SESSION_COOKIE } from "../src/server/session.js";

const ORIGIN = "https://lindocara.test";
const COLS = 20;
const ROWS = 15;

function blocks(): string[] {
  const rows = [".".repeat(COLS), `.##${".".repeat(COLS - 3)}`];
  while (rows.length < ROWS) rows.push(".".repeat(COLS));
  return rows;
}

function markers(overrides: Partial<MapMarkers> = {}): MapMarkers {
  return {
    entries: [{ id: "door", col: 5, row: 5 }],
    exits: [{ id: "cave", col: 6, row: 6 }],
    monsterSpawns: [{ col: 8, row: 8, species: "spear_goblin", patrolRadius: 96 }],
    ...overrides,
  };
}

function input(overrides: Partial<MapInput> = {}): MapInput {
  return { name: "Marked", blocks: blocks(), elements: [], spawn: { col: 0, row: 0 }, markers: markers(), ...overrides };
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
});

describe("validateMapInput marker rules", () => {
  it("accepts markers on walkable ground", () => {
    expect(() => validateMapInput(input())).not.toThrow();
  });

  it("rejects a marker on water", () => {
    expect(() =>
      validateMapInput(input({ markers: markers({ entries: [{ id: "wet", col: 1, row: 1 }] }) })),
    ).toThrow(/^markers:/);
    expect(() =>
      validateMapInput(input({ markers: markers({ monsterSpawns: [{ col: 2, row: 1, species: "mire_troll", patrolRadius: 96 }] }) })),
    ).toThrow(/^markers:/);
  });

  it("rejects an exit sharing a cell with the spawn or an entry", () => {
    expect(() =>
      validateMapInput(input({ markers: markers({ exits: [{ id: "onspawn", col: 0, row: 0 }] }) })),
    ).toThrow(/^markers:/);
    expect(() =>
      validateMapInput(input({ markers: markers({ exits: [{ id: "ondoor", col: 5, row: 5 }] }) })),
    ).toThrow(/^markers:/);
  });

  it("rejects a malformed marker payload wholesale", () => {
    const broken = { entries: "nope", exits: [], monsterSpawns: [] } as unknown as MapMarkers;
    expect(() => validateMapInput(input({ markers: broken }))).toThrow(/^markers:/);
  });
});

describe("marker persistence", () => {
  it("round-trips markers through D1 and defaults legacy rows to empty", async () => {
    const db = createDb(env.DB);
    const created = await createMap(db, input());
    const loaded = await loadMap(db, created.id);
    expect(loaded?.markers).toEqual(markers());

    const plain = await createMap(db, input({ name: "Plain", markers: undefined }));
    const loadedPlain = await loadMap(db, plain.id);
    expect(loadedPlain?.markers).toEqual({ entries: [], exits: [], monsterSpawns: [] });
  });
});

describe("markers over the wire", () => {
  let cookie = "";
  beforeAll(async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "markers1", password: "12345678" }),
    });
    const value = (response.headers.get("Set-Cookie") ?? "").split(";")[0]?.split("=")[1];
    if (!value) throw new Error("expected a session cookie");
    cookie = `${SESSION_COOKIE}=${value}`;
  });

  it("saves valid markers and answers map_markers for misplaced ones", async () => {
    const good = await SELF.fetch(`${ORIGIN}/api/maps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: "Wire", blocks: blocks(), elements: [], spawn: { col: 0, row: 0 }, markers: markers() }),
    });
    expect(good.status).toBe(201);
    expect(((await good.json()) as { markers: MapMarkers }).markers).toEqual(markers());

    const bad = await SELF.fetch(`${ORIGIN}/api/maps`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Wire",
        blocks: blocks(),
        elements: [],
        spawn: { col: 0, row: 0 },
        markers: markers({ entries: [{ id: "wet", col: 1, row: 1 }] }),
      }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "map_markers" });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/map-markers.test.ts`
Expected: FAIL — `validateMapInput` does not yet accept/validate `markers` (and the wire returns `map_invalid`... only after parseMapData accepts markers, which Task 2 already handles; the wire test fails on the missing `map_markers` mapping and the missing column write).

- [ ] **Step 4: Implement** — four touch points.

**`src/server/maps.ts`:**

Add to imports (from `../shared/map-data.js`): `EMPTY_MARKERS, type MapMarkers, parseMapMarkers` and keep existing imports.

Extend the two types:

```ts
export interface StoredMap extends MapData {
  id: string;
  name: string;
}

export interface MapInput {
  name: string;
  blocks: readonly string[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  markers?: MapMarkers;
}
```

(`StoredMap` needs no new field — `markers` rides on `MapData`.)

In `validateMapInput`, after the existing final spawn-walkability check and before `return { ...data, name };`:

```ts
  const markers = parseMapMarkers(input.markers, baked.cols, baked.rows);
  if (!markers) throw new Error("markers: malformed marker payload");
  const walkable = (col: number, row: number) => !isSolidKind(kindAt(baked, col, row));
  for (const entry of markers.entries) {
    if (!walkable(entry.col, entry.row)) throw new Error(`markers: entry ${entry.id} must stand on walkable ground`);
  }
  const blockedCells = new Set(markers.entries.map((m) => `${m.col},${m.row}`));
  blockedCells.add(`${input.spawn.col},${input.spawn.row}`);
  for (const exit of markers.exits) {
    if (!walkable(exit.col, exit.row)) throw new Error(`markers: exit ${exit.id} must stand on walkable ground`);
    if (blockedCells.has(`${exit.col},${exit.row}`)) {
      throw new Error(`markers: exit ${exit.id} may not share a cell with the spawn or an entry`);
    }
  }
  for (const spawn of markers.monsterSpawns) {
    if (!walkable(spawn.col, spawn.row)) throw new Error("markers: monster spawns must stand on walkable ground");
  }
```

and change the return to include the normalized collection:

```ts
  return { ...data, markers, name };
```

(`data` is built earlier without markers; keep it that way and let the explicit `markers` win.)

Persistence — add a helper beside `encodeBlocks`:

```ts
function markersJson(markers: MapMarkers | undefined): string | null {
  if (!markers || (markers.entries.length === 0 && markers.exits.length === 0 && markers.monsterSpawns.length === 0)) {
    return null;
  }
  return JSON.stringify(markers);
}
```

In `createMap` and `updateMap`, the result of `validateMapInput(input)` is what gets stored (both functions already call it and hold its return in a local). Add `markers: markersJson(<validated>.markers)` — where `<validated>` is that local — to the object passed to `db.insert(map).values({ ... })` in `createMap` and to `db.update(map).set({ ... })` in `updateMap`.

In `toStoredMap`, parse the column defensively (corrupt/unknown JSON degrades to empty, like `elementsOf` drops unknown kinds):

```ts
function storedMarkers(row: typeof map.$inferSelect): MapMarkers {
  if (!row.markers) return EMPTY_MARKERS;
  try {
    return parseMapMarkers(JSON.parse(row.markers), row.cols, row.rows) ?? EMPTY_MARKERS;
  } catch {
    return EMPTY_MARKERS;
  }
}
```

and include `markers: storedMarkers(row)` in the `StoredMap` literal `toStoredMap` returns. Give `BUILTIN_MAP` an explicit `markers: EMPTY_MARKERS` so every `StoredMap` in practice carries the field.

**`src/server/index.ts`:**

`parseMapBody` forwards the parsed collection:

```ts
function parseMapBody(body: unknown): MapInput | null {
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== "string") return null;
  const data = parseMapData(body);
  if (!data) return null;
  return { name, blocks: data.blocks, elements: data.elements, spawn: data.spawn, markers: data.markers };
}
```

`mapErrorResponse` learns the prefix — extend the 400 list:

```ts
  if (
    code === "placement" ||
    code === "spawn" ||
    code === "size" ||
    code === "name" ||
    code === "elements" ||
    code === "markers"
  ) {
    return json({ error: `map_${code}` }, { status: 400 });
  }
```

**`src/client/api.ts`** — add to `ERROR_KEYS`:

```ts
  map_markers: "editor.error.markers",
```

**`src/shared/i18n/en.ts`** (beside the other `editor.error.*` entries):

```ts
  "editor.error.markers": "A marker is misplaced or malformed.",
```

**`src/shared/i18n/fr.ts`:**

```ts
  "editor.error.markers": "Un marqueur est mal placé ou invalide.",
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/map-markers.test.ts`
Expected: PASS. Also run `npm test -- test/maps.test.ts test/maps-api.test.ts` — existing suites must stay green (markers are optional everywhere).

- [ ] **Step 6: Check and commit**

```bash
npm run check
git add src/server/db/schema.ts migrations src/server/maps.ts src/server/index.ts src/client/api.ts src/shared/i18n/en.ts src/shared/i18n/fr.ts test/map-markers.test.ts
git commit -m "feat persist and validate map markers behind the maps api"
```

---

### Task 4: Pure adventure graph validation in shared/adventure.ts

The graph binds every placed exit of every member map to a destination (member map + existing entry) or `"end"`. Completeness (start set, all exits bound, ≥1 end) is enforced at save, per the spec. Pure functions only — D1 access stays in Task 5.

**Files:**
- Create: `src/shared/adventure.ts`
- Test: `test/adventure.test.ts` (new file)

**Interfaces:**
- Consumes: `MARKER_ID_PATTERN` from `shared/map-data.ts`.
- Produces (Tasks 5 and 7 use these exact names):

```ts
export const ADVENTURE_TITLE_MAX = 48;
export const MAX_ADVENTURE_MAPS = 16;
export const MAX_ADVENTURE_LINKS = 64;
export type ExitDestination = { mapId: string; entryId: string } | "end";
export interface AdventureLink { mapId: string; exitId: string; dest: ExitDestination }
export interface AdventureGraph { start: { mapId: string; entryId: string }; links: readonly AdventureLink[] }
export interface AdventureInput { title: string; maxPlayers: number; mapIds: readonly string[]; graph: AdventureGraph }
export interface MapMarkerIds { entryIds: readonly string[]; exitIds: readonly string[] }
export function parseAdventureInput(value: unknown): AdventureInput | null;
export function parseAdventureGraph(value: unknown): AdventureGraph | null;
export function validateAdventure(input: AdventureInput, markersByMap: ReadonlyMap<string, MapMarkerIds>): void; // throws "title:|players:|maps:|graph:"
```

- [ ] **Step 1: Write the failing test** — create `test/adventure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  type AdventureInput,
  type MapMarkerIds,
  parseAdventureInput,
  validateAdventure,
} from "../src/shared/adventure.js";

const MARKERS = new Map<string, MapMarkerIds>([
  ["map-a", { entryIds: ["start"], exitIds: ["east"] }],
  ["map-b", { entryIds: ["west-door"], exitIds: ["boss-gate"] }],
]);

function goodInput(): AdventureInput {
  return {
    title: "Donjon",
    maxPlayers: 4,
    mapIds: ["map-a", "map-b"],
    graph: {
      start: { mapId: "map-a", entryId: "start" },
      links: [
        { mapId: "map-a", exitId: "east", dest: { mapId: "map-b", entryId: "west-door" } },
        { mapId: "map-b", exitId: "boss-gate", dest: "end" },
      ],
    },
  };
}

describe("parseAdventureInput", () => {
  it("round-trips a well-formed body", () => {
    expect(parseAdventureInput(goodInput())).toEqual(goodInput());
  });

  it("rejects malformed bodies instead of throwing", () => {
    const good = goodInput();
    const bad: unknown[] = [
      null,
      { ...good, title: 7 },
      { ...good, maxPlayers: "four" },
      { ...good, mapIds: "map-a" },
      { ...good, graph: { start: null, links: [] } },
      { ...good, graph: { ...good.graph, links: [{ mapId: "map-a", exitId: "east", dest: "nowhere" }] } },
    ];
    for (const value of bad) expect(parseAdventureInput(value)).toBeNull();
  });
});

describe("validateAdventure", () => {
  it("accepts a complete graph", () => {
    expect(() => validateAdventure(goodInput(), MARKERS)).not.toThrow();
  });

  it("enforces title, player count and map membership", () => {
    expect(() => validateAdventure({ ...goodInput(), title: " " }, MARKERS)).toThrow(/^title:/);
    expect(() => validateAdventure({ ...goodInput(), maxPlayers: 5 }, MARKERS)).toThrow(/^players:/);
    expect(() => validateAdventure({ ...goodInput(), mapIds: ["map-a", "ghost"] }, MARKERS)).toThrow(/^maps:/);
    expect(() => validateAdventure({ ...goodInput(), mapIds: [] }, MARKERS)).toThrow(/^maps:/);
    expect(() => validateAdventure({ ...goodInput(), mapIds: ["map-a", "map-a"] }, MARKERS)).toThrow(/^maps:/);
  });

  it("requires the start to name a member map and a real entry", () => {
    const input = goodInput();
    input.graph = { ...input.graph, start: { mapId: "map-b", entryId: "start" } };
    expect(() => validateAdventure(input, MARKERS)).toThrow(/^graph:/);
  });

  it("requires every exit bound exactly once, to a real entry", () => {
    const unbound = goodInput();
    unbound.graph = { ...unbound.graph, links: [unbound.graph.links[0] as never] };
    expect(() => validateAdventure(unbound, MARKERS)).toThrow(/^graph:/);

    const duplicate = goodInput();
    duplicate.graph = { ...duplicate.graph, links: [...duplicate.graph.links, duplicate.graph.links[0] as never] };
    expect(() => validateAdventure(duplicate, MARKERS)).toThrow(/^graph:/);

    const badEntry = goodInput();
    badEntry.graph = {
      ...badEntry.graph,
      links: [
        { mapId: "map-a", exitId: "east", dest: { mapId: "map-b", entryId: "no-such-door" } },
        { mapId: "map-b", exitId: "boss-gate", dest: "end" },
      ],
    };
    expect(() => validateAdventure(badEntry, MARKERS)).toThrow(/^graph:/);
  });

  it("requires at least one end", () => {
    const endless = goodInput();
    endless.graph = {
      ...endless.graph,
      links: [
        { mapId: "map-a", exitId: "east", dest: { mapId: "map-b", entryId: "west-door" } },
        { mapId: "map-b", exitId: "boss-gate", dest: { mapId: "map-a", entryId: "start" } },
      ],
    };
    expect(() => validateAdventure(endless, MARKERS)).toThrow(/^graph:/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/adventure.test.ts`
Expected: FAIL — module `src/shared/adventure.ts` does not exist.

- [ ] **Step 3: Write the implementation** — create `src/shared/adventure.ts`:

```ts
/**
 * An adventure is an authored graph over maps: exits (placed in maps) are bound here to a
 * destination map + entry, or to "end". Destinations belong to the adventure, never to the map —
 * a client can request "use this exit" but the server resolves where it leads from this graph.
 * Pure rules only: D1 lookups live in server/adventures.ts.
 */
import { MARKER_ID_PATTERN } from "./map-data.js";

export const ADVENTURE_TITLE_MAX = 48;
export const MAX_ADVENTURE_MAPS = 16;
export const MAX_ADVENTURE_LINKS = 64;

const MAP_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

export type ExitDestination = { mapId: string; entryId: string } | "end";

export interface AdventureLink {
  mapId: string;
  exitId: string;
  dest: ExitDestination;
}

export interface AdventureGraph {
  start: { mapId: string; entryId: string };
  links: readonly AdventureLink[];
}

export interface AdventureInput {
  title: string;
  maxPlayers: number;
  mapIds: readonly string[];
  graph: AdventureGraph;
}

/** The marker ids of one member map, as Task 5 reads them from the stored payload. */
export interface MapMarkerIds {
  entryIds: readonly string[];
  exitIds: readonly string[];
}

function parseAnchor(value: unknown): { mapId: string; entryId: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const { mapId, entryId } = value as Record<string, unknown>;
  if (typeof mapId !== "string" || !MAP_ID_PATTERN.test(mapId)) return null;
  if (typeof entryId !== "string" || !MARKER_ID_PATTERN.test(entryId)) return null;
  return { mapId, entryId };
}

export function parseAdventureGraph(value: unknown): AdventureGraph | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const start = parseAnchor(record.start);
  if (!start) return null;
  const linksRaw = record.links;
  if (!Array.isArray(linksRaw) || linksRaw.length > MAX_ADVENTURE_LINKS) return null;
  const links: AdventureLink[] = [];
  for (const raw of linksRaw) {
    if (typeof raw !== "object" || raw === null) return null;
    const { mapId, exitId, dest } = raw as Record<string, unknown>;
    if (typeof mapId !== "string" || !MAP_ID_PATTERN.test(mapId)) return null;
    if (typeof exitId !== "string" || !MARKER_ID_PATTERN.test(exitId)) return null;
    if (dest === "end") {
      links.push({ mapId, exitId, dest: "end" });
      continue;
    }
    const anchor = parseAnchor(dest);
    if (!anchor) return null;
    links.push({ mapId, exitId, dest: anchor });
  }
  return { start, links };
}

export function parseAdventureInput(value: unknown): AdventureInput | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { title, maxPlayers, mapIds } = record;
  if (typeof title !== "string") return null;
  if (!Number.isSafeInteger(maxPlayers)) return null;
  if (!Array.isArray(mapIds) || mapIds.length > MAX_ADVENTURE_MAPS) return null;
  for (const id of mapIds) {
    if (typeof id !== "string" || !MAP_ID_PATTERN.test(id)) return null;
  }
  const graph = parseAdventureGraph(record.graph);
  if (!graph) return null;
  return { title, maxPlayers: maxPlayers as number, mapIds: mapIds as string[], graph };
}

/** Throws "title:|players:|maps:|graph:" — the prefix is the machine code, per server convention. */
export function validateAdventure(
  input: AdventureInput,
  markersByMap: ReadonlyMap<string, MapMarkerIds>,
): void {
  const title = input.title.trim();
  if (title.length === 0 || title.length > ADVENTURE_TITLE_MAX) {
    throw new Error(`title: 1-${ADVENTURE_TITLE_MAX} characters`);
  }
  if (input.maxPlayers < 1 || input.maxPlayers > 4) {
    throw new Error("players: between 1 and 4");
  }
  if (input.mapIds.length === 0 || input.mapIds.length > MAX_ADVENTURE_MAPS) {
    throw new Error(`maps: 1 to ${MAX_ADVENTURE_MAPS} maps`);
  }
  const members = new Set(input.mapIds);
  if (members.size !== input.mapIds.length) throw new Error("maps: duplicate map");
  for (const mapId of input.mapIds) {
    if (!markersByMap.has(mapId)) throw new Error(`maps: unknown map ${mapId}`);
  }

  const entryExists = (mapId: string, entryId: string): boolean =>
    (markersByMap.get(mapId)?.entryIds ?? []).includes(entryId);

  const { start, links } = input.graph;
  if (!members.has(start.mapId) || !entryExists(start.mapId, start.entryId)) {
    throw new Error("graph: start must name a member map and one of its entries");
  }

  const bound = new Set<string>();
  let ends = 0;
  for (const link of links) {
    if (!members.has(link.mapId)) throw new Error(`graph: link from non-member map ${link.mapId}`);
    if (!(markersByMap.get(link.mapId)?.exitIds ?? []).includes(link.exitId)) {
      throw new Error(`graph: no exit ${link.exitId} on map ${link.mapId}`);
    }
    const key = `${link.mapId} ${link.exitId}`;
    if (bound.has(key)) throw new Error(`graph: exit ${link.exitId} on map ${link.mapId} bound twice`);
    bound.add(key);
    if (link.dest === "end") {
      ends += 1;
      continue;
    }
    if (!members.has(link.dest.mapId) || !entryExists(link.dest.mapId, link.dest.entryId)) {
      throw new Error(`graph: exit ${link.exitId} leads to a missing map or entry`);
    }
  }
  for (const mapId of input.mapIds) {
    for (const exitId of markersByMap.get(mapId)?.exitIds ?? []) {
      if (!bound.has(`${mapId} ${exitId}`)) {
        throw new Error(`graph: exit ${exitId} on map ${mapId} is unbound`);
      }
    }
  }
  if (ends === 0) throw new Error("graph: at least one exit must end the adventure");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/adventure.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/shared/adventure.ts test/adventure.test.ts
git commit -m "feat validate adventure graphs as pure shared rules"
```

---

### Task 5: Adventure tables and the server CRUD boundary

Account-owned rows; `graph` stored as JSON text; membership in `adventure_map` with `onDelete: "restrict"` on the map FK so the database itself refuses deleting a referenced map (Task 6 adds the legible guard).

**Files:**
- Modify: `src/server/db/schema.ts`
- Create: `migrations/0013_*.sql` via `npm run db:generate`
- Create: `src/server/adventures.ts`
- Test: `test/adventures.test.ts` (new file)

**Interfaces:**
- Consumes: `AdventureInput`, `MapMarkerIds`, `parseAdventureGraph`, `validateAdventure` (Task 4); `storedMarkers`-backed `loadMap`/`StoredMap.markers` (Task 3); `createDb`/`Db` (`src/server/db/index.ts`).
- Produces (Task 7 calls exactly these):

```ts
export interface StoredAdventure {
  id: string; accountId: string; title: string; maxPlayers: number; version: number;
  mapIds: string[]; graph: AdventureGraph;
}
export async function createAdventure(db: Db, accountId: string, input: AdventureInput): Promise<StoredAdventure>;
export async function listAdventures(db: Db, accountId: string): Promise<{ id: string; title: string; maxPlayers: number }[]>;
export async function loadAdventure(db: Db, accountId: string, id: string): Promise<StoredAdventure | null>;
export async function updateAdventure(db: Db, accountId: string, id: string, input: AdventureInput): Promise<StoredAdventure>; // throws "not_found: ..."
export async function deleteAdventure(db: Db, accountId: string, id: string): Promise<void>; // throws "not_found: ..."
```

- [ ] **Step 1: Add the tables and generate the migration**

In `src/server/db/schema.ts`, after the `mapElement` table:

```ts
export const adventure = sqliteTable(
  "adventure",
  {
    /** Server-minted uuid. A client never supplies this. */
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    maxPlayers: integer("max_players").notNull().default(4),
    /** Reserved seam for immutable published versions; always 1 until then. */
    version: integer("version").notNull().default(1),
    /** JSON AdventureGraph: start anchor plus one binding per placed exit. */
    graph: text("graph").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    index("adventure_account_idx").on(table.accountId),
    check("adventure_max_players_range", sql`${table.maxPlayers} BETWEEN 1 AND 4`),
  ],
);

export const adventureMap = sqliteTable(
  "adventure_map",
  {
    adventureId: text("adventure_id")
      .notNull()
      .references(() => adventure.id, { onDelete: "cascade" }),
    /** restrict: the database itself refuses deleting a map an adventure still uses. */
    mapId: text("map_id")
      .notNull()
      .references(() => map.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.adventureId, table.mapId] }),
    index("adventure_map_map_idx").on(table.mapId),
  ],
);
```

Add type exports at the bottom alongside the existing ones:

```ts
export type Adventure = typeof adventure.$inferSelect;
```

Run: `npm run db:generate` (expect `migrations/0013_*.sql` with both `CREATE TABLE`s), then `npm run db:migrate`.

- [ ] **Step 2: Write the failing test** — create `test/adventures.test.ts`:

```ts
/**
 * The adventures boundary: ownership-scoped CRUD, graph validation against member-map markers,
 * and membership rows kept in step. Same truncation discipline as db.test.ts (children first).
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { AdventureInput } from "../src/shared/adventure.js";
import {
  createAdventure,
  deleteAdventure,
  listAdventures,
  loadAdventure,
  updateAdventure,
} from "../src/server/adventures.js";
import { account, createDb } from "../src/server/db/index.js";
import { createMap, type MapInput } from "../src/server/maps.js";

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

function inputFor(mapIds: string[]): AdventureInput {
  const [a, b] = mapIds;
  if (!a || !b) throw new Error("expected two maps");
  return {
    title: "Donjon",
    maxPlayers: 2,
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

afterEach(async () => {
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
  await env.DB.exec("DELETE FROM character");
  await env.DB.exec("DELETE FROM account");
});

describe("adventure CRUD", () => {
  it("round-trips an adventure and scopes it to its owner", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    await seedAccount("rival");
    const mapA = await createMap(db, mapInput("A"));
    const mapB = await createMap(db, mapInput("B"));

    const created = await createAdventure(db, "owner", inputFor([mapA.id, mapB.id]));
    expect(created).toMatchObject({ accountId: "owner", title: "Donjon", maxPlayers: 2, version: 1 });
    expect(created.mapIds).toEqual([mapA.id, mapB.id]);

    expect(await listAdventures(db, "owner")).toEqual([
      { id: created.id, title: "Donjon", maxPlayers: 2 },
    ]);
    expect(await listAdventures(db, "rival")).toEqual([]);
    expect(await loadAdventure(db, "rival", created.id)).toBeNull();

    const loaded = await loadAdventure(db, "owner", created.id);
    expect(loaded?.graph.links).toHaveLength(2);
  });

  it("validates the graph against the member maps' markers", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const mapA = await createMap(db, mapInput("A"));
    const mapB = await createMap(db, mapInput("B"));
    const bad = inputFor([mapA.id, mapB.id]);
    bad.graph = { ...bad.graph, links: [bad.graph.links[0] as never] };
    await expect(createAdventure(db, "owner", bad)).rejects.toThrow(/^graph:/);
    await expect(createAdventure(db, "owner", { ...inputFor([mapA.id, mapB.id]), mapIds: [mapA.id, "ghost"] })).rejects.toThrow(/^maps:/);
  });

  it("updates in place and refuses foreign or missing adventures", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    await seedAccount("rival");
    const mapA = await createMap(db, mapInput("A"));
    const mapB = await createMap(db, mapInput("B"));
    const created = await createAdventure(db, "owner", inputFor([mapA.id, mapB.id]));

    const renamed = await updateAdventure(db, "owner", created.id, {
      ...inputFor([mapA.id, mapB.id]),
      title: "Renamed",
    });
    expect(renamed.title).toBe("Renamed");

    await expect(updateAdventure(db, "rival", created.id, inputFor([mapA.id, mapB.id]))).rejects.toThrow(/^not_found:/);
    await expect(deleteAdventure(db, "rival", created.id)).rejects.toThrow(/^not_found:/);

    await deleteAdventure(db, "owner", created.id);
    expect(await loadAdventure(db, "owner", created.id)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- test/adventures.test.ts`
Expected: FAIL — module `src/server/adventures.ts` does not exist.

- [ ] **Step 4: Write the implementation** — create `src/server/adventures.ts`:

```ts
/**
 * Adventures: account-owned authored graphs over library maps. This boundary owns the D1 reads
 * and writes; every rule about what a valid adventure IS lives in shared/adventure.ts, and every
 * marker fact comes from the stored map payloads — never from the client's body.
 */
import { asc, eq, inArray } from "drizzle-orm";
import {
  type AdventureGraph,
  type AdventureInput,
  type MapMarkerIds,
  parseAdventureGraph,
  validateAdventure,
} from "../shared/adventure.js";
import { EMPTY_MARKERS, parseMapMarkers } from "../shared/map-data.js";
import { adventure, adventureMap, type Db, map } from "./db/index.js";

export interface StoredAdventure {
  id: string;
  accountId: string;
  title: string;
  maxPlayers: number;
  version: number;
  mapIds: string[];
  graph: AdventureGraph;
}

async function markerIdsFor(db: Db, mapIds: readonly string[]): Promise<Map<string, MapMarkerIds>> {
  if (mapIds.length === 0) return new Map();
  const rows = await db.select().from(map).where(inArray(map.id, [...mapIds]));
  const byMap = new Map<string, MapMarkerIds>();
  for (const row of rows) {
    let markers = EMPTY_MARKERS;
    if (row.markers) {
      try {
        markers = parseMapMarkers(JSON.parse(row.markers), row.cols, row.rows) ?? EMPTY_MARKERS;
      } catch {
        markers = EMPTY_MARKERS;
      }
    }
    byMap.set(row.id, {
      entryIds: markers.entries.map((m) => m.id),
      exitIds: markers.exits.map((m) => m.id),
    });
  }
  return byMap;
}

function memberRows(adventureId: string, mapIds: readonly string[]) {
  return mapIds.map((mapId, position) => ({ adventureId, mapId, position }));
}

function toStored(row: typeof adventure.$inferSelect, mapIds: string[]): StoredAdventure {
  const graph = parseAdventureGraph(JSON.parse(row.graph));
  if (!graph) throw new Error("graph: stored graph is corrupt");
  return {
    id: row.id,
    accountId: row.accountId,
    title: row.title,
    maxPlayers: row.maxPlayers,
    version: row.version,
    mapIds,
    graph,
  };
}

async function ownedRow(db: Db, accountId: string, id: string) {
  const rows = await db
    .select()
    .from(adventure)
    .where(eq(adventure.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || row.accountId !== accountId) return null;
  return row;
}

export async function createAdventure(
  db: Db,
  accountId: string,
  input: AdventureInput,
): Promise<StoredAdventure> {
  validateAdventure(input, await markerIdsFor(db, input.mapIds));
  const id = crypto.randomUUID();
  const row = {
    id,
    accountId,
    title: input.title.trim(),
    maxPlayers: input.maxPlayers,
    graph: JSON.stringify(input.graph),
  };
  await db.batch([
    db.insert(adventure).values(row),
    db.insert(adventureMap).values(memberRows(id, input.mapIds)),
  ]);
  const stored = await loadAdventure(db, accountId, id);
  if (!stored) throw new Error("not_found: adventure vanished mid-create");
  return stored;
}

export async function listAdventures(
  db: Db,
  accountId: string,
): Promise<{ id: string; title: string; maxPlayers: number }[]> {
  const rows = await db
    .select({ id: adventure.id, title: adventure.title, maxPlayers: adventure.maxPlayers })
    .from(adventure)
    .where(eq(adventure.accountId, accountId))
    .orderBy(asc(adventure.createdAt));
  return rows;
}

export async function loadAdventure(
  db: Db,
  accountId: string,
  id: string,
): Promise<StoredAdventure | null> {
  const row = await ownedRow(db, accountId, id);
  if (!row) return null;
  const members = await db
    .select({ mapId: adventureMap.mapId })
    .from(adventureMap)
    .where(eq(adventureMap.adventureId, id))
    .orderBy(asc(adventureMap.position));
  return toStored(row, members.map((m) => m.mapId));
}

export async function updateAdventure(
  db: Db,
  accountId: string,
  id: string,
  input: AdventureInput,
): Promise<StoredAdventure> {
  const row = await ownedRow(db, accountId, id);
  if (!row) throw new Error("not_found: no such adventure");
  validateAdventure(input, await markerIdsFor(db, input.mapIds));
  await db.batch([
    db
      .update(adventure)
      .set({ title: input.title.trim(), maxPlayers: input.maxPlayers, graph: JSON.stringify(input.graph), updatedAt: new Date() })
      .where(eq(adventure.id, id)),
    db.delete(adventureMap).where(eq(adventureMap.adventureId, id)),
    db.insert(adventureMap).values(memberRows(id, input.mapIds)),
  ]);
  const stored = await loadAdventure(db, accountId, id);
  if (!stored) throw new Error("not_found: adventure vanished mid-update");
  return stored;
}

export async function deleteAdventure(db: Db, accountId: string, id: string): Promise<void> {
  const row = await ownedRow(db, accountId, id);
  if (!row) throw new Error("not_found: no such adventure");
  await db.batch([
    db.delete(adventureMap).where(eq(adventureMap.adventureId, id)),
    db.delete(adventure).where(eq(adventure.id, id)),
  ]);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- test/adventures.test.ts`
Expected: PASS.

- [ ] **Step 6: Check and commit**

```bash
npm run check
git add src/server/db/schema.ts migrations src/server/adventures.ts test/adventures.test.ts
git commit -m "feat store account owned adventures with validated graphs in d1"
```

---

### Task 6: Legible guard for deleting a referenced map

The FK `restrict` already refuses the delete at the database level, but surfaces as an opaque batch error. The guard makes it a machine code (`referenced` → wire `map_referenced`, 409), like `last_map`.

**Files:**
- Modify: `src/server/maps.ts` (`deleteMap`)
- Modify: `src/server/index.ts` (`mapErrorResponse`)
- Modify: `src/client/api.ts`, `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts`
- Test: `test/adventures.test.ts` (append)

**Interfaces:**
- Consumes: `adventureMap` table (Task 5), existing `deleteMap`.
- Produces: `deleteMap` throws `"referenced: ..."`; wire error `map_referenced` (409). Plan 2's editor UI surfaces `editor.error.referenced`.

- [ ] **Step 1: Write the failing test** — append to `test/adventures.test.ts`:

```ts
describe("map deletion guard", () => {
  it("refuses deleting a map an adventure still uses", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const mapA = await createMap(db, mapInput("A"));
    const mapB = await createMap(db, mapInput("B"));
    const spare = await createMap(db, mapInput("Spare"));
    const created = await createAdventure(db, "owner", inputFor([mapA.id, mapB.id]));

    await expect(deleteMap(db, mapA.id)).rejects.toThrow(/^referenced:/);
    await deleteMap(db, spare.id); // unreferenced maps still delete

    await deleteAdventure(db, "owner", created.id);
    await deleteMap(db, mapA.id); // and referenced ones do once the adventure is gone
  });
});
```

Add `deleteMap` to the `../src/server/maps.js` import of the test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/adventures.test.ts`
Expected: FAIL — the delete rejects, but with the raw D1 FK error, not `/^referenced:/`.

- [ ] **Step 3: Implement the guard** — in `src/server/maps.ts` `deleteMap`, before the existing raw-batch block; add `adventureMap` to the `./db/index.js` import and `eq` is already imported:

```ts
  const used = await db
    .select({ adventureId: adventureMap.adventureId })
    .from(adventureMap)
    .where(eq(adventureMap.mapId, id))
    .limit(1);
  if (used.length > 0) throw new Error("referenced: an adventure still uses this map");
```

In `src/server/index.ts` `mapErrorResponse`, beside the `last_map` line:

```ts
  if (code === "referenced") return json({ error: "map_referenced" }, { status: 409 });
```

In `src/client/api.ts` `ERROR_KEYS`:

```ts
  map_referenced: "editor.error.referenced",
```

In `src/shared/i18n/en.ts`:

```ts
  "editor.error.referenced": "An adventure still uses this map.",
```

In `src/shared/i18n/fr.ts`:

```ts
  "editor.error.referenced": "Une aventure utilise encore cette carte.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/adventures.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/server/maps.ts src/server/index.ts src/client/api.ts src/shared/i18n/en.ts src/shared/i18n/fr.ts test/adventures.test.ts
git commit -m "feat refuse deleting a map an adventure references"
```

---

### Task 7: /api/adventures routes

Five routes, session-gated, 16 KiB body cap, machine codes throughout. Mirrors the maps handlers exactly.

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/client/api.ts`, `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts`
- Test: `test/adventures-api.test.ts` (new file)

**Interfaces:**
- Consumes: `parseAdventureInput` (Task 4); `createAdventure`/`listAdventures`/`loadAdventure`/`updateAdventure`/`deleteAdventure` (Task 5); existing `requireSession`, `readJson`, `json`.
- Produces the wire API plan 2's UI will call:
  - `GET /api/adventures` → 200 `[{ id, title, maxPlayers }]` (own adventures only)
  - `POST /api/adventures` → 201 `StoredAdventure` | 400 `adventure_invalid|adventure_title|adventure_players|adventure_maps|adventure_graph`
  - `GET /api/adventures/:id` → 200 `StoredAdventure` | 404 `adventure_not_found`
  - `PUT /api/adventures/:id` → 200 | same 400s | 404
  - `DELETE /api/adventures/:id` → 204 | 404

- [ ] **Step 1: Write the failing test** — create `test/adventures-api.test.ts`:

```ts
/**
 * The adventures CRUD API over SELF.fetch: session gate, ownership scoping, graph validation
 * codes, and the not-found shape. Register-and-cookie pattern from maps-api.test.ts.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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

let cookie = "";
let userCount = 0;

async function register(): Promise<string> {
  userCount += 1;
  const response = await SELF.fetch(`${ORIGIN}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: `advapi${userCount}`, password: "12345678" }),
  });
  const value = (response.headers.get("Set-Cookie") ?? "").split(";")[0]?.split("=")[1];
  if (!value) throw new Error("expected a session cookie");
  return `${SESSION_COOKIE}=${value}`;
}

beforeAll(async () => {
  cookie = await register();
});

function authed(path: string, init: RequestInit = {}, asCookie = cookie): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: asCookie, ...(init.headers ?? {}) },
  });
}

async function createTwoMaps(): Promise<[string, string]> {
  const a = await authed("/api/maps", { method: "POST", body: JSON.stringify(mapBody("A")) });
  const b = await authed("/api/maps", { method: "POST", body: JSON.stringify(mapBody("B")) });
  const idA = ((await a.json()) as { id: string }).id;
  const idB = ((await b.json()) as { id: string }).id;
  return [idA, idB];
}

function adventureBody(mapA: string, mapB: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

afterEach(async () => {
  await env.DB.exec("DELETE FROM adventure_map");
  await env.DB.exec("DELETE FROM adventure");
  await env.DB.exec("DELETE FROM map_element");
  await env.DB.exec("DELETE FROM map");
});

describe("session gate", () => {
  it("401s every route without a cookie", async () => {
    const routes: [string, string][] = [
      ["GET", "/api/adventures"],
      ["POST", "/api/adventures"],
      ["GET", "/api/adventures/some-id"],
      ["PUT", "/api/adventures/some-id"],
      ["DELETE", "/api/adventures/some-id"],
    ];
    for (const [method, path] of routes) {
      const response = await SELF.fetch(`${ORIGIN}${path}`, { method });
      expect(response.status).toBe(401);
    }
  });
});

describe("adventure lifecycle over the wire", () => {
  it("round-trips create, list, get, update, delete", async () => {
    const [mapA, mapB] = await createTwoMaps();

    const createRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify(adventureBody(mapA, mapB)),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };
    expect(created).toMatchObject({ title: "Donjon", maxPlayers: 4, version: 1, mapIds: [mapA, mapB] });

    const listRes = await authed("/api/adventures");
    expect(await listRes.json()).toEqual([{ id: created.id, title: "Donjon", maxPlayers: 4 }]);

    const getRes = await authed(`/api/adventures/${created.id}`);
    expect(getRes.status).toBe(200);

    const updateRes = await authed(`/api/adventures/${created.id}`, {
      method: "PUT",
      body: JSON.stringify(adventureBody(mapA, mapB, { title: "Renamed" })),
    });
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()) as object).toMatchObject({ title: "Renamed" });

    const deleteRes = await authed(`/api/adventures/${created.id}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(204);
    const gone = await authed(`/api/adventures/${created.id}`);
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "adventure_not_found" });
  });

  it("answers machine codes for invalid bodies and graphs", async () => {
    const [mapA, mapB] = await createTwoMaps();

    const invalid = await authed("/api/adventures", { method: "POST", body: JSON.stringify({ nope: true }) });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "adventure_invalid" });

    const unbound = adventureBody(mapA, mapB);
    (unbound.graph as { links: unknown[] }).links = [
      { mapId: mapA, exitId: "gate", dest: { mapId: mapB, entryId: "door" } },
    ];
    const graphRes = await authed("/api/adventures", { method: "POST", body: JSON.stringify(unbound) });
    expect(graphRes.status).toBe(400);
    expect(await graphRes.json()).toEqual({ error: "adventure_graph" });

    const titleRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify(adventureBody(mapA, mapB, { title: " " })),
    });
    expect(await titleRes.json()).toEqual({ error: "adventure_title" });

    const playersRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify(adventureBody(mapA, mapB, { maxPlayers: 9 })),
    });
    expect(await playersRes.json()).toEqual({ error: "adventure_players" });

    const mapsRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify(adventureBody(mapA, mapB, { mapIds: [mapA, "ghost"] })),
    });
    expect(await mapsRes.json()).toEqual({ error: "adventure_maps" });
  });

  it("hides other accounts' adventures", async () => {
    const [mapA, mapB] = await createTwoMaps();
    const createRes = await authed("/api/adventures", {
      method: "POST",
      body: JSON.stringify(adventureBody(mapA, mapB)),
    });
    const created = (await createRes.json()) as { id: string };

    const rival = await register();
    expect(await (await authed("/api/adventures", {}, rival)).json()).toEqual([]);
    expect((await authed(`/api/adventures/${created.id}`, {}, rival)).status).toBe(404);
    expect((await authed(`/api/adventures/${created.id}`, { method: "DELETE" }, rival)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/adventures-api.test.ts`
Expected: FAIL — every `/api/adventures` call returns 404 `{ error: "not found" }`.

- [ ] **Step 3: Implement the routes** — in `src/server/index.ts`:

Imports: add `parseAdventureInput` from `../shared/adventure.js` and the five functions from `./adventures.js`.

Constant beside `MAX_MAP_JSON_BYTES`:

```ts
// An adventure body is ids and bindings only (no map payloads): 16 links × a few uuids each.
const MAX_ADVENTURE_JSON_BYTES = 16_384;
```

Error mapper beside `mapErrorResponse`:

```ts
/** `adventures.ts`/`shared/adventure.ts` throw "prefix: message" — prefix is the machine code. */
function adventureErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") return json({ error: "adventure_not_found" }, { status: 404 });
  if (code === "title" || code === "players" || code === "maps" || code === "graph") {
    return json({ error: `adventure_${code}` }, { status: 400 });
  }
  throw error;
}
```

Handlers, mirroring the map handlers:

```ts
async function handleListAdventures(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  return json(await listAdventures(createDb(env.DB), auth.session.id));
}

async function handleCreateAdventure(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request, MAX_ADVENTURE_JSON_BYTES);
  if (parsed instanceof Response) return parsed;
  const input = parseAdventureInput(parsed.value);
  if (!input) return json({ error: "adventure_invalid" }, { status: 400 });
  try {
    return json(await createAdventure(createDb(env.DB), auth.session.id, input), { status: 201 });
  } catch (error) {
    return adventureErrorResponse(error);
  }
}

async function handleGetAdventure(request: Request, env: Env, url: URL, id: string): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const stored = await loadAdventure(createDb(env.DB), auth.session.id, id);
  if (!stored) return json({ error: "adventure_not_found" }, { status: 404 });
  return json(stored);
}

async function handleUpdateAdventure(request: Request, env: Env, url: URL, id: string): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  const parsed = await readJson(request, MAX_ADVENTURE_JSON_BYTES);
  if (parsed instanceof Response) return parsed;
  const input = parseAdventureInput(parsed.value);
  if (!input) return json({ error: "adventure_invalid" }, { status: 400 });
  try {
    return json(await updateAdventure(createDb(env.DB), auth.session.id, id, input));
  } catch (error) {
    return adventureErrorResponse(error);
  }
}

async function handleDeleteAdventure(request: Request, env: Env, url: URL, id: string): Promise<Response> {
  const auth = await requireSession(request, env, url);
  if (auth instanceof Response) return auth;
  try {
    await deleteAdventure(createDb(env.DB), auth.session.id, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return adventureErrorResponse(error);
  }
}
```

Routing, after the maps block in `fetch`:

```ts
    if (url.pathname === "/api/adventures" && request.method === "GET") {
      return handleListAdventures(request, env, url);
    }
    if (url.pathname === "/api/adventures" && request.method === "POST") {
      return handleCreateAdventure(request, env, url);
    }
    const adventureRoute = url.pathname.match(/^\/api\/adventures\/([A-Za-z0-9-]{1,64})$/);
    if (adventureRoute?.[1]) {
      const id = adventureRoute[1];
      if (request.method === "GET") return handleGetAdventure(request, env, url, id);
      if (request.method === "PUT") return handleUpdateAdventure(request, env, url, id);
      if (request.method === "DELETE") return handleDeleteAdventure(request, env, url, id);
    }
```

**`src/client/api.ts`** — add to `ERROR_KEYS`:

```ts
  adventure_invalid: "adventure.error.invalid",
  adventure_title: "adventure.error.title",
  adventure_players: "adventure.error.players",
  adventure_maps: "adventure.error.maps",
  adventure_graph: "adventure.error.graph",
  adventure_not_found: "adventure.error.not_found",
```

**`src/shared/i18n/en.ts`:**

```ts
  "adventure.error.invalid": "That adventure data is invalid.",
  "adventure.error.title": "Adventure title must be 1-48 characters.",
  "adventure.error.players": "Player count must be between 1 and 4.",
  "adventure.error.maps": "An adventure needs 1 to 16 existing maps.",
  "adventure.error.graph": "Every exit must lead somewhere, and at least one must end the adventure.",
  "adventure.error.not_found": "That adventure no longer exists.",
```

**`src/shared/i18n/fr.ts`:**

```ts
  "adventure.error.invalid": "Ces données d'aventure sont invalides.",
  "adventure.error.title": "Le titre doit faire entre 1 et 48 caractères.",
  "adventure.error.players": "Le nombre de joueurs doit être entre 1 et 4.",
  "adventure.error.maps": "Une aventure demande de 1 à 16 cartes existantes.",
  "adventure.error.graph": "Chaque sortie doit mener quelque part, et au moins une doit conclure l'aventure.",
  "adventure.error.not_found": "Cette aventure n'existe plus.",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/adventures-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check and commit**

```bash
npm run check
git add src/server/index.ts src/client/api.ts src/shared/i18n/en.ts src/shared/i18n/fr.ts test/adventures-api.test.ts
git commit -m "feat expose session gated adventure crud api"
```

---

## Deliberate scope notes

- **Maps stay globally readable/writable** (no `account_id` on `map`), exactly as today; the spec's "account's library" phrasing becomes enforceable when parties/ownership arrive in plan 3. Adventures, by contrast, are ownership-scoped from day one.
- **Nothing runtime-facing changes:** `zoneFromMap` keeps `monsters: []`, `WorldInfo` and the welcome message are untouched, and markers are invisible in play. Plan 4 hydrates them.
- **No editor UI:** plan 2 adds the marker palette tools and the adventure editor over this API.
