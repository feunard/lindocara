# Runtime Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a map a row in D1 instead of a TypeScript constant, and route the world off it.

**Architecture:** A map is `blocks` (one char per cell, grass/water) plus `elements` (tree/bush/stone on grid cells). Both travel in `welcome`, and **one shared pure function** turns that payload into the `TileMap` the simulation collides against — client and server call the same function, so prediction stays correct. Colliding elements are *baked* into the tilemap at load, leaving `step`, `isWalkableBox` and `prediction.ts` untouched.

**Tech Stack:** TypeScript, Drizzle + D1, Cloudflare Durable Objects, Vitest in workerd, PixiJS.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-16-runtime-maps-design.md`.
- **The invariant:** client and server derive collision from the same payload through one shared pure function. Never two decoders.
- `step()`, `isWalkableBox()`, `resolveTerrain()` and `prediction.ts` are NOT modified by this sub-project.
- Monsters, quests, guards, loot and skills are NOT deleted.
- Map ids are server-minted UUIDs. Never client-supplied.
- Placement rules are enforced server-side: tree/bush on grass only; stone on grass or water.
- Every player-facing string lands in both `src/shared/i18n/en.ts` and `fr.ts`.
- Biome: `noNonNullAssertion` is on. No `!`; narrow properly.
- `npm run check` must pass before each commit.
- Never trust a client message: malformed terrain drops the frame, it does not throw.

---

### Task 1: The map model, as pure rules

**Files:**
- Create: `src/shared/map-data.ts`
- Test: `test/map-data.test.ts`

**Interfaces:**
- Consumes: `TileMap`, `TileKind`, `decodeTileMap` from `src/shared/tilemap.js` / `tilemap-codec.js`.
- Produces: `ElementKind`, `MapElement`, `MapData`, `ELEMENT_RULES`, `canPlaceElement()`, `bakeCollision()`, `parseMapData()`.

This file is platform-free and is the **only** place that turns a map payload into collision. Both `net.ts` (client) and `world.ts` (server) call `bakeCollision`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  bakeCollision,
  canPlaceElement,
  type MapData,
  parseMapData,
} from "../src/shared/map-data.js";
import { isSolidKind, kindAt } from "../src/shared/tilemap.js";

const MAP: MapData = {
  blocks: ["....", ".##.", "....", "...."],
  elements: [],
  spawn: { col: 0, row: 0 },
};

describe("baking a map's collision", () => {
  it("keeps grass walkable and water solid", () => {
    const tiles = bakeCollision(MAP);
    expect(kindAt(tiles, 0, 0)).toBe("grass");
    expect(isSolidKind(kindAt(tiles, 1, 1))).toBe(true);
  });

  it("bakes a tree solid but leaves a bush walkable", () => {
    const tiles = bakeCollision({
      ...MAP,
      elements: [
        { col: 0, row: 0, kind: "tree", variant: 0 },
        { col: 3, row: 0, kind: "bush", variant: 0 },
      ],
    });
    expect(isSolidKind(kindAt(tiles, 0, 0))).toBe(true);
    expect(isSolidKind(kindAt(tiles, 3, 0))).toBe(false);
  });

  it("leaves a stone on water solid — it was already water", () => {
    const tiles = bakeCollision({
      ...MAP,
      elements: [{ col: 1, row: 1, kind: "stone", variant: 0 }],
    });
    expect(isSolidKind(kindAt(tiles, 1, 1))).toBe(true);
  });
});

describe("placement rules", () => {
  it("refuses a tree on water and allows a stone there", () => {
    expect(canPlaceElement("tree", "water")).toBe(false);
    expect(canPlaceElement("bush", "water")).toBe(false);
    expect(canPlaceElement("stone", "water")).toBe(true);
  });

  it("allows all three on grass", () => {
    for (const kind of ["tree", "bush", "stone"] as const) {
      expect(canPlaceElement(kind, "grass")).toBe(true);
    }
  });
});

describe("parsing a map off the wire", () => {
  it("accepts a well-formed map", () => {
    expect(parseMapData({ blocks: ["..", "##"], elements: [], spawn: { col: 0, row: 0 } })).not.toBe(
      null,
    );
  });

  // Every one of these used to reach decodeTileMap and throw on the first paint.
  it("rejects malformed terrain instead of throwing", () => {
    const bad: unknown[] = [
      null,
      { blocks: [], elements: [], spawn: { col: 0, row: 0 } },
      { blocks: ["..", "###"], elements: [], spawn: { col: 0, row: 0 } }, // ragged
      { blocks: ["xx"], elements: [], spawn: { col: 0, row: 0 } }, // unknown char
      { blocks: [".."], elements: [{ col: 0, row: 0, kind: "dragon", variant: 0 }], spawn: { col: 0, row: 0 } },
      { blocks: [".."], elements: [{ col: 99, row: 0, kind: "tree", variant: 0 }], spawn: { col: 0, row: 0 } },
      { blocks: [".."], elements: [], spawn: { col: 99, row: 0 } }, // spawn out of bounds
    ];
    for (const value of bad) {
      expect(parseMapData(value), JSON.stringify(value)).toBe(null);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/map-data.test.ts`
Expected: FAIL — cannot find module `../src/shared/map-data.js`.

- [ ] **Step 3: Write the module**

```ts
/**
 * What a map IS, as pure rules.
 *
 * This is the only place a map payload becomes collision, and that is the point. The terrain now
 * arrives over the wire instead of being imported, so the old guarantee — client and server read
 * the same compile-time constant — has to be replaced by a deliberate one: both sides call
 * `bakeCollision` on the same payload. Two decoders that "should" agree is how prediction becomes
 * unfixable; see `step()`'s doc comment for the same argument about movement.
 */
import { decodeTileMap } from "./tilemap-codec.js";
import { type TileKind, type TileMap } from "./tilemap.js";

export const ELEMENT_KINDS = ["tree", "bush", "stone"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export interface MapElement {
  col: number;
  row: number;
  kind: ElementKind;
  variant: number;
}

export interface MapData {
  blocks: readonly string[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
}

/** What an element may stand on, and whether you collide with it. */
export const ELEMENT_RULES: Readonly<
  Record<ElementKind, { on: readonly TileKind[]; collides: boolean }>
> = {
  tree: { on: ["grass"], collides: true },
  bush: { on: ["grass"], collides: false },
  // A stone in the shallows. Water is already solid, so this changes nothing about collision —
  // it is a placement permission, not a collision rule.
  stone: { on: ["grass", "water"], collides: true },
};

export function isElementKind(value: unknown): value is ElementKind {
  return typeof value === "string" && (ELEMENT_KINDS as readonly string[]).includes(value);
}

export function canPlaceElement(kind: ElementKind, on: TileKind): boolean {
  return ELEMENT_RULES[kind].on.includes(on);
}

/**
 * The ground, plus everything standing on it that you bump into.
 *
 * Colliding elements are baked into the tilemap rather than taught to the collision code, so
 * `isWalkableBox`, `step` and `prediction.ts` never learn that elements exist. On the day terrain
 * starts arriving over the wire, exactly one thing changes.
 *
 * A colliding element becomes `forest` — the existing kind for "land you cannot walk through" —
 * and never overwrites water, which is already solid and should keep looking like water.
 */
export function bakeCollision(map: MapData): TileMap {
  const tiles = decodeTileMap(map.blocks);
  const kinds = [...tiles.kinds];
  for (const element of map.elements) {
    if (!ELEMENT_RULES[element.kind].collides) continue;
    const index = element.row * tiles.cols + element.col;
    if (kinds[index] !== "grass") continue;
    kinds[index] = "forest";
  }
  return { ...tiles, kinds };
}

const BLOCK_CHARS = new Set([".", "#"]);

/** Defensive, exactly like client intent already is. A map that reaches `decodeTileMap` malformed
 *  throws on the first paint; this returns null and the frame is dropped instead. */
export function parseMapData(value: unknown): MapData | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { blocks, elements, spawn } = record;
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  const first = blocks[0];
  if (typeof first !== "string" || first.length === 0) return null;
  const cols = first.length;
  for (const row of blocks) {
    if (typeof row !== "string" || row.length !== cols) return null;
    for (const char of row) if (!BLOCK_CHARS.has(char)) return null;
  }
  const rows = blocks.length;
  if (!Array.isArray(elements)) return null;
  const parsed: MapElement[] = [];
  for (const raw of elements) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    if (!Number.isSafeInteger(item.col) || !Number.isSafeInteger(item.row)) return null;
    if (!Number.isSafeInteger(item.variant)) return null;
    if (!isElementKind(item.kind)) return null;
    const col = item.col as number;
    const row = item.row as number;
    if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
    parsed.push({ col, row, kind: item.kind, variant: item.variant as number });
  }
  if (typeof spawn !== "object" || spawn === null) return null;
  const spawnRecord = spawn as Record<string, unknown>;
  if (!Number.isSafeInteger(spawnRecord.col) || !Number.isSafeInteger(spawnRecord.row)) return null;
  const spawnCol = spawnRecord.col as number;
  const spawnRow = spawnRecord.row as number;
  if (spawnCol < 0 || spawnCol >= cols || spawnRow < 0 || spawnRow >= rows) return null;
  return {
    blocks: blocks as string[],
    elements: parsed,
    spawn: { col: spawnCol, row: spawnRow },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/map-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx biome check --write src/ test/
git add src/shared/map-data.ts test/map-data.test.ts
git commit -m "Add the pure map model: blocks, elements, and one baking rule"
```

---

### Task 2: A grass/water map must autotile and grow foam

**Files:**
- Test: `test/map-terrain.test.ts`

**Interfaces:**
- Consumes: `bakeCollision`, `MapData` from Task 1; `landTile`, `landMask`, `needsFoam` from `src/client/game/autotile.js`.

This task is a test and nothing else. It exists because "the tileset must be mapped correctly — when water | grass, we expect the flood animation" is a requirement, and the cheapest way for it to silently break is for everyone to assume it works because it works for Verdant Reach.

It should pass immediately: `landMask` reads only whether neighbours are land, and `needsFoam` reads only whether any of eight neighbours is water. Neither knows where the `TileMap` came from. If it fails, something has hard-coded a zone.

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { landMask, needsFoam } from "../src/client/game/autotile.js";
import { bakeCollision, type MapData } from "../src/shared/map-data.js";

/** A grass island in open water — the shape every shoreline rule cares about. */
const ISLAND: MapData = {
  blocks: ["######", "#....#", "#....#", "#....#", "######"],
  elements: [],
  spawn: { col: 2, row: 2 },
};

describe("a D1 map's shoreline", () => {
  it("autotiles its edges instead of drawing one flat mask", () => {
    const tiles = bakeCollision(ISLAND);
    // The island's middle has land on all four sides; its edges do not. If every cell returned the
    // same mask, the autotiler would draw one tile everywhere and there would be no rim.
    expect(landMask(tiles, 2, 2)).toBe(0b1111);
    const masks = new Set<number>();
    for (let row = 1; row <= 3; row++) {
      for (let col = 1; col <= 4; col++) masks.add(landMask(tiles, col, row));
    }
    expect(masks.size).toBeGreaterThan(1);
  });

  it("foams every shore cell and nothing inland", () => {
    const tiles = bakeCollision(ISLAND);
    let foamed = 0;
    for (let row = 0; row < tiles.rows; row++) {
      for (let col = 0; col < tiles.cols; col++) if (needsFoam(tiles, col, row)) foamed++;
    }
    // Every land cell of a 4x3 island touches water somewhere — it is all shore.
    expect(foamed).toBe(12);
    // Water never foams: the blob is drawn under land and clipped by it.
    expect(needsFoam(tiles, 0, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run test/map-terrain.test.ts`
Expected: PASS. If it fails, read the failure before touching the test — it means a terrain rule is reading a zone rather than a tilemap, which is exactly what this pins.

- [ ] **Step 3: Commit**

```bash
git add test/map-terrain.test.ts
git commit -m "Pin that a D1 map autotiles and foams like any other terrain"
```

---

### Task 3: The `map` and `map_element` tables

**Files:**
- Modify: `src/server/db/schema.ts`
- Create (generated): `migrations/0011_*.sql`
- Test: `test/db.test.ts`

**Interfaces:**
- Produces: `map`, `mapElement` Drizzle tables.

- [ ] **Step 1: Add the tables**

Append to `src/server/db/schema.ts`, following the existing `sqliteTable` style:

```ts
/**
 * A map is terrain, not a zone: blocks, the things standing on them, and where you arrive.
 *
 * `blocks` is one character per cell, row-major, joined by newlines — the same encoding
 * `tilemap-codec.ts` already reads, so there is no second format to keep in step. A 40x30 map is
 * about 1.2 KB of text.
 */
export const map = sqliteTable("map", {
  /** Server-minted uuid. A client never supplies this. */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  cols: integer("cols").notNull(),
  rows: integer("rows").notNull(),
  blocks: text("blocks").notNull(),
  spawnCol: integer("spawn_col").notNull(),
  spawnRow: integer("spawn_row").notNull(),
  /** Exactly one map carries this. It is where a hero lands when their own map is gone. */
  isFirst: integer("is_first").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

/**
 * One element per cell — and that is the primary key, not a check somebody has to remember.
 * "You can't set another tree on it" is enforced by the database.
 */
export const mapElement = sqliteTable(
  "map_element",
  {
    mapId: text("map_id")
      .notNull()
      .references(() => map.id, { onDelete: "cascade" }),
    col: integer("col").notNull(),
    row: integer("row").notNull(),
    kind: text("kind").notNull(),
    variant: integer("variant").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.mapId, table.col, table.row] })],
);
```

Check the file's existing imports for `primaryKey` — `characterItem` or `characterEquipment` almost certainly already uses it. Add it to the `drizzle-orm/sqlite-core` import if not.

- [ ] **Step 2: Generate and apply the migration**

```bash
npm run db:generate
npm run db:migrate
```

Expected: a new `migrations/0011_*.sql` creating both tables. Commit the SQL file — drizzle-kit never talks to D1, the migration files are the only migration system.

- [ ] **Step 3: Write the failing test**

Add to `test/db.test.ts`, following the file's existing style (it truncates in `afterEach` — the pool does not isolate storage between tests):

```ts
it("refuses two elements on one cell", async () => {
  const db = createDb(env.DB);
  await db.insert(schema.map).values({
    id: "map-test",
    name: "Test",
    cols: 4,
    rows: 4,
    blocks: "....\n....\n....\n....",
    spawnCol: 0,
    spawnRow: 0,
  });
  await db
    .insert(schema.mapElement)
    .values({ mapId: "map-test", col: 1, row: 1, kind: "tree", variant: 0 });
  await expect(
    db
      .insert(schema.mapElement)
      .values({ mapId: "map-test", col: 1, row: 1, kind: "bush", variant: 0 }),
  ).rejects.toThrow();
});

it("takes a map's elements with it when the map goes", async () => {
  const db = createDb(env.DB);
  await db.insert(schema.map).values({
    id: "map-cascade",
    name: "Cascade",
    cols: 2,
    rows: 2,
    blocks: "..\n..",
    spawnCol: 0,
    spawnRow: 0,
  });
  await db
    .insert(schema.mapElement)
    .values({ mapId: "map-cascade", col: 0, row: 0, kind: "tree", variant: 0 });
  await db.delete(schema.map).where(eq(schema.map.id, "map-cascade"));
  const left = await db
    .select()
    .from(schema.mapElement)
    .where(eq(schema.mapElement.mapId, "map-cascade"));
  expect(left).toEqual([]);
});
```

- [ ] **Step 4: Run**

Run: `npx vitest run test/db.test.ts`
Expected: PASS. If the cascade test fails, D1 needs `PRAGMA foreign_keys=ON`; check whether the generated migration emits it, and if the platform does not honour it, delete elements explicitly in the repository layer and change this test to pin that instead. Do not leave a cascade the database is not actually performing.

- [ ] **Step 5: Commit**

```bash
git add src/server/db/schema.ts migrations/ test/db.test.ts
git commit -m "Store maps and their elements in D1, one element per cell"
```

---

### Task 4: The map repository, the built-in floor, and the first-map flag

**Files:**
- Create: `src/server/maps.ts`
- Test: `test/maps.test.ts`

**Interfaces:**
- Consumes: `map`, `mapElement` from Task 3; `MapData`, `canPlaceElement` from Task 1.
- Produces: `BUILTIN_MAP_ID`, `BUILTIN_MAP`, `loadMap(db, id)`, `listMaps(db)`, `firstMap(db)`, `createMap(db, input)`, `updateMap(db, id, input)`, `deleteMap(db, id)`, `resolveMapFor(db, zoneId)`.

- [ ] **Step 1: Write the failing test**

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/server/db/index.js";
import {
  BUILTIN_MAP_ID,
  createMap,
  deleteMap,
  firstMap,
  resolveMapFor,
} from "../src/server/maps.js";

const SMALL = { name: "Small", blocks: ["....", ".##.", "....", "...."], elements: [], spawn: { col: 0, row: 0 } };

describe("the map floor", () => {
  it("falls back to the built-in when the database has no maps at all", async () => {
    const db = createDb(env.DB);
    const resolved = await resolveMapFor(db, "anything");
    expect(resolved.id).toBe(BUILTIN_MAP_ID);
  });

  it("refuses to delete the last map", async () => {
    const db = createDb(env.DB);
    const only = await createMap(db, SMALL);
    await expect(deleteMap(db, only.id)).rejects.toThrow(/last_map/);
  });

  it("moves the first-map flag to a survivor when the first map is deleted", async () => {
    const db = createDb(env.DB);
    const one = await createMap(db, SMALL);
    const two = await createMap(db, { ...SMALL, name: "Second" });
    expect((await firstMap(db))?.id).toBe(one.id);
    await deleteMap(db, one.id);
    expect((await firstMap(db))?.id).toBe(two.id);
  });

  it("sends a hero whose map is gone to the first map", async () => {
    const db = createDb(env.DB);
    const one = await createMap(db, SMALL);
    const resolved = await resolveMapFor(db, "a-map-that-was-deleted");
    expect(resolved.id).toBe(one.id);
  });
});

describe("placement is enforced on write, not in the browser", () => {
  it("refuses a tree on water and accepts a stone there", async () => {
    const db = createDb(env.DB);
    await expect(
      createMap(db, { ...SMALL, elements: [{ col: 1, row: 1, kind: "tree", variant: 0 }] }),
    ).rejects.toThrow(/placement/);
    const ok = await createMap(db, {
      ...SMALL,
      elements: [{ col: 1, row: 1, kind: "stone", variant: 0 }],
    });
    expect(ok.id).toBeTruthy();
  });

  it("refuses a spawn nobody could stand on", async () => {
    const db = createDb(env.DB);
    await expect(createMap(db, { ...SMALL, spawn: { col: 1, row: 1 } })).rejects.toThrow(/spawn/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/maps.test.ts`
Expected: FAIL — cannot find module `../src/server/maps.js`.

- [ ] **Step 3: Write the repository**

Key decisions to implement exactly:

- `BUILTIN_MAP_ID = "builtin"`. `BUILTIN_MAP` is a hardcoded `MapData`: a grass field with a little water and one spawn. It is never inserted, never listed, never editable.
- `createMap` mints `crypto.randomUUID()`, validates every element against `canPlaceElement` (reading the block char under it) and the spawn against being walkable, then inserts map + elements in one `db.batch`. If no map has `is_first`, the new one takes it.
- `deleteMap` counts first: `if (count <= 1) throw new Error("last_map")`. If the target held `is_first`, move the flag to the oldest survivor **in the same batch** as the delete.
- `resolveMapFor(db, zoneId)` returns the map for `zoneId`; if it is missing, the `is_first` map; if there are none, `BUILTIN_MAP`. It never throws.

```ts
export const BUILTIN_MAP_ID = "builtin";

/**
 * The floor. Not a map you can edit, list or delete — the thing that exists so the world can always
 * start.
 *
 * Reachable only on an empty database: `deleteMap` refuses the last map, so nobody can delete their
 * way down to zero. It is the fresh-install case, not a delete outcome.
 */
export const BUILTIN_MAP: MapData = {
  blocks: [
    "################",
    "#..............#",
    "#..............#",
    "#....######....#",
    "#....######....#",
    "#..............#",
    "#..............#",
    "################",
  ],
  elements: [],
  spawn: { col: 2, row: 2 },
};
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/maps.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx biome check --write src/ test/
git add src/server/maps.ts test/maps.test.ts
git commit -m "Load, create and delete maps, with a floor that cannot be deleted away"
```

---

### Task 5: Send the terrain over the wire

**Files:**
- Modify: `src/shared/protocol.ts` (`WorldInfo`, `parseServerMessage`)
- Modify: `src/server/world.ts` (the `welcome` payload, around line 409)
- Modify: `src/client/game/net.ts:134,228`
- Modify: `src/client/game/renderer.ts:741` and `configureZone`
- Test: `test/protocol.test.ts`

**Interfaces:**
- Consumes: `parseMapData`, `bakeCollision` from Task 1.

This is the task that can break prediction. Both sides must end up calling `bakeCollision` on the **same** payload.

- [ ] **Step 1: Write the failing protocol test**

```ts
it("drops a welcome whose terrain is malformed rather than throwing on the first paint", () => {
  const base = validWelcomeFixture(); // reuse whatever this file already builds
  const ragged = structuredClone(base);
  ragged.world.blocks = ["..", "###"];
  expect(parseServerMessage(JSON.stringify(ragged))).toBe(null);

  const unknownChar = structuredClone(base);
  unknownChar.world.blocks = ["xx", "xx"];
  expect(parseServerMessage(JSON.stringify(unknownChar))).toBe(null);

  const badElement = structuredClone(base);
  badElement.world.elements = [{ col: 0, row: 0, kind: "dragon", variant: 0 }];
  expect(parseServerMessage(JSON.stringify(badElement))).toBe(null);
});

it("keeps a well-formed terrain payload", () => {
  const message = parseServerMessage(JSON.stringify(validWelcomeFixture()));
  expect(message).not.toBe(null);
});
```

Read `test/protocol.test.ts` first and reuse its existing welcome fixture rather than inventing a second one.

- [ ] **Step 2: Add the fields to `WorldInfo`**

In `src/shared/protocol.ts`:

```ts
export interface WorldInfo {
  zoneId: string;
  zoneNameKey: string;
  /** The terrain itself, because it can no longer be imported. One string per row, one char per
   *  cell. `parseServerMessage` validates this before anything decodes it. */
  blocks: string[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  // ...the existing fields stay
}
```

`zoneId` becomes `string` rather than the `ZoneId` union — a map id is a uuid now.

In `parseServerMessage`'s welcome branch, replace the zone-id check with:

```ts
    const map = parseMapData({
      blocks: (value.world as Record<string, unknown>).blocks,
      elements: (value.world as Record<string, unknown>).elements,
      spawn: (value.world as Record<string, unknown>).spawn,
    });
    if (map === null) return null;
```

- [ ] **Step 3: Send it from the server**

In `src/server/world.ts`, where `welcome`'s `world` is built (near the existing `portals:` mapping around line 409), add `blocks`, `elements` and `spawn` from the loaded map.

- [ ] **Step 4: Read it on the client**

`src/client/game/net.ts` — replace the compile-time lookup:

```ts
// was: this.#geometry = zoneDefinition(message.world.zoneId).terrain;
this.#geometry = geometryFromWelcome(message.world);
```

where `geometryFromWelcome` builds a `TerrainGeometry` whose `tiles` come from `bakeCollision(...)` — the same call the server makes. Do **not** write a second decoder here; import Task 1's function.

`src/client/game/renderer.ts` — `configureZone` takes the map data instead of looking it up, and sets `#tiles` from the same baked result.

- [ ] **Step 5: Run everything**

Run: `npm run check`
Expected: PASS, including `prediction.test.ts` — that suite is the real gate here. If it fails, the client and server are not baking the same payload.

- [ ] **Step 6: Commit**

```bash
npx biome check --write src/ test/
git add src/shared/protocol.ts src/server/world.ts src/client/game/net.ts src/client/game/renderer.ts test/protocol.test.ts
git commit -m "Send the terrain in the welcome instead of importing it"
```

---

### Task 6: Route off D1, seed the world, delete the build pipeline

**Files:**
- Modify: `src/server/index.ts:187`
- Modify: `src/shared/zones.ts`
- Delete: `scripts/build-map.ts`, `src/shared/zones/verdant-reach-tiles.ts`, `src/shared/zones/mmo-test-zone-tiles.ts`, `src/shared/zones/sunken-isles-tiles.ts`
- Modify: `package.json` (drop `map:build`, `map:check`, and `map:check` from `check`)
- Create: `src/server/db/seed-maps.ts`
- Test: `test/world.test.ts`

**Interfaces:**
- Consumes: `resolveMapFor` from Task 4.

- [ ] **Step 1: Seed the existing worlds into D1**

Write `src/server/db/seed-maps.ts`, which converts today's `VERDANT_REACH_TILES` and `SUNKEN_ISLES_TILES` into `map` rows **before** the generated files are deleted: every `forest` cell becomes a `tree` element on grass, every `water` cell stays water, everything else becomes grass. `building` cells become grass with no element — the editor has no houses, and the landmarks still draw from `world-layout.ts`.

Run it once and commit the resulting SQL as a data migration, so a fresh database has the world.

- [ ] **Step 2: Route off D1**

`src/server/index.ts`, replacing line 187:

```ts
  // was: const location = resolveZoneLocation(profile.zoneId, profile.instanceId);
  const resolved = await resolveMapFor(createDb(env.DB), profile.zoneId);
  const location = {
    zoneId: resolved.id,
    instanceId: profile.instanceId,
    roomKey: `${resolved.id}:${profile.instanceId}`,
  };
```

Room keys keep their `zoneId:instanceId` shape, so presence, the 30-second lease, epoch fencing and handoff are untouched — they only ever saw an opaque string.

- [ ] **Step 3: Delete the build pipeline**

```bash
git rm scripts/build-map.ts src/shared/zones/verdant-reach-tiles.ts src/shared/zones/mmo-test-zone-tiles.ts src/shared/zones/sunken-isles-tiles.ts
```

Remove `map:build` and `map:check` from `package.json`, including `map:check &&` from the `check` script. Their whole job — keeping a generated file in step with its source — no longer exists, because there is no generated file.

- [ ] **Step 4: Write the failing integration test**

In `test/world.test.ts`, following the file's existing real-Durable-Object style (real WebSockets against real workerd; assert on *which* character ids are present, never how many):

```ts
it("loads a D1 map, walks, and comes back to the same place", async () => {
  // 1. seed a map via createMap
  // 2. point a character's zone_id at it
  // 3. connect; expect welcome.world.blocks to match the seeded blocks
  // 4. walk; disconnect; reconnect
  // 5. expect the same map id and the saved position, epoch fence intact
  // Mirror the existing handoff/reconnect tests' helpers rather than inventing new ones.
});

it("sends a hero whose map was deleted to the first map's spawn", async () => {
  // 1. two maps; character on the second
  // 2. delete the second
  // 3. connect; expect the first map's id and its spawn cell
});
```

- [ ] **Step 5: Run the full gate**

Run: `npm run check`
Expected: PASS. `map:check` is gone from the script, so this is now lint + typecheck + test + test:ui.

- [ ] **Step 6: Drive it in the real game**

Run `npm run dev`, log in, and confirm: the world loads from D1, the grass/water edges are autotiled, and the shoreline foam animates. Tests do not tell you the tileset is mapped correctly — that was the explicit requirement.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Route the world off D1 maps and delete the build-time tile pipeline"
```

---

## Self-review

**Spec coverage:** pure model + baking → Task 1; autotile/foam requirement → Task 2; schema + one-element-per-cell → Task 3; built-in floor, first-map flag, last-map refusal, placement + spawn validation → Task 4; terrain over the wire + defensive parsing + prediction parity → Task 5; routing, seeding, pipeline deletion, real-DO round trip → Task 6.

**Deliberately deferred to sub-project 2 (editor):** the CRUD HTTP API, the launch-screen button, the editor scene, the palette, and what a running room does when its map is edited underneath it. Task 4 builds the repository those endpoints will call, so the API is a thin layer over tested functions.

**Known softness:** Tasks 5 (Step 1) and 6 (Step 4) describe tests against fixtures and harnesses I have not read (`protocol.test.ts`'s welcome fixture, `world.test.ts`'s connect/reconnect helpers). Both say to read the file and reuse what is there rather than invent a parallel harness — that is deliberate, but those steps need judgement rather than transcription.

**Riskiest task:** 5. If `prediction.test.ts` goes red, stop and fix the shared-decode invariant rather than adjusting the test.
