# Map Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A logged-in player can draw a grass/water/tree/bush/stone map in a launch-screen editor, save it to D1, preview it with a throwaway warrior, and walk it for real — per `docs/superpowers/specs/2026-07-16-map-editor-design.md`.

**Architecture:** Hybrid routing — catalogue zone ids (`verdant-reach`, `mmo-test-zone`, `sunken-isles`) keep resolving compile-time so existing content and its 473 tests stay untouched; any other id is a D1 map id resolved **once at the front door** (`index.ts`), with fallback (own map → first map → builtin) persisted as an epoch-fenced relocation. `World` never re-resolves; it loads the exact map id it was admitted for. The client renders wire terrain for unknown zone ids through the same autotile/foam functions the game already uses. The editor is a React screen + a PixiJS painting stage; preview is a client-only sandbox over the shared `bakeCollision()`/`step()`.

**Tech Stack:** Cloudflare Workers + Durable Objects, D1 + Drizzle, React + zustand, PixiJS, Vitest (workerd pool + jsdom UI pool), Biome.

## Global Constraints

- The server decides outcomes; clients send intent only. Never let a client message select a room or supply an authoritative result.
- No React inside `src/client/game/`; React reaches game code only through handles in the zustand store.
- Every player-facing string goes in BOTH `src/shared/i18n/en.ts` and `fr.ts` (flat dotted keys; `test/i18n.test.ts` enforces parity). API errors are machine codes.
- Biome with `noNonNullAssertion`: no `!`, narrow properly. Run `npm run lint:fix` before committing.
- Three tsconfigs: `src/shared/` must typecheck under both DOM and workerd. `npm run typecheck` checks all three.
- Map size cap: cols 20–100, rows 15–100. Map API body cap: 32 KiB (`MAX_MAP_JSON_BYTES = 32_768`); all other routes keep 4 KiB.
- No schema migration is needed anywhere in this plan — `map`/`map_element` tables already exist (migration `0011`).
- Verify with `npm run check` (runs `map:check`, lint, typecheck, workerd tests, UI tests). Single file: `npx vitest run test/<file>.test.ts`; UI: `npx vitest run -c vitest.ui.config.ts test/ui/<file>.test.tsx`.
- Commit messages follow repo style: plain sentences ("Send the terrain in the welcome instead of importing it"), not conventional-commit prefixes.

## Confirmed diagnosis (do not re-derive)

Ran on `feature/d1-map-engine` (2026-07-16): every `world.test.ts` join fails with 409 from `world.ts`'s **"character location changed"** guard, NOT from `isAuthorized` and NOT from a test-storage race:

```json
{"dbg":"409_location_changed","profileZone":"verdant-reach","locationZone":"builtin","profileInstance":"main","locationInstance":"main"}
```

`resolveMapFor` silently falls back (no map row `verdant-reach` → builtin) but nothing persists the move, so the profile row still says `verdant-reach` and `World` correctly refuses the mismatch. Two consequences drive this plan: the fallback must be a persisted, fenced relocation (Tasks 2–3), and catalogue zones must keep resolving compile-time or every content test loses its monsters (Task 2).

## Milestones

1. **Engine** (Tasks 1–4, on `feature/d1-map-engine`, merged at Task 4) — invisible foundation.
2. **Wire rendering** (Task 5) — first visible payoff: the builtin island renders with real coastline.
3. **CRUD API** (Tasks 6–7).
4. **Editor** (Tasks 8–10).
5. **Preview + wrap-up** (Tasks 11–12).

---

### Task 1: Branch pickup, shared terrain builder, fenced relocation primitive

**Files:**
- Modify: `src/shared/map-data.ts` (add `terrainFromMap`, `mapSpawnPoint`)
- Modify: `src/shared/zones.ts` (add `isKnownZone`; keep the branch's `ZoneId = string` relaxation)
- Modify: `src/server/world/map-zone.ts` (use shared `terrainFromMap`; add `elements` passthrough)
- Modify: `src/server/profile.ts` (add `relocateProfile`)
- Test: `test/map-data.test.ts`, `test/profile-relocate.test.ts` (new)

**Interfaces:**
- Consumes: `bakeCollision(data: MapData): TileMap`, `TILE_SIZE` from `src/shared/tilemap.ts`, `TerrainGeometry`/`Rect` from `src/shared/game.ts`, drizzle `character` table.
- Produces: `terrainFromMap(data: MapData): TerrainGeometry`; `mapSpawnPoint(data: MapData): { x: number; y: number }`; `isKnownZone(value: unknown): value is ZoneId`; `relocateProfile(db, fenced: {id: string; sessionEpoch: number}, destination: {zoneId: string; instanceId: string; x: number; y: number}): Promise<boolean>`; `ZoneDefinition.elements?: readonly MapElement[]`.

- [ ] **Step 1: Sync the branch**

```bash
git checkout feature/d1-map-engine && git merge main --no-edit
```
Expected: clean merge (main has only added docs since the branch forked). `npx vitest run test/maps.test.ts` still passes (14 tests).

- [ ] **Step 2: Write failing tests for the shared terrain builder**

In `test/map-data.test.ts` add:

```ts
import { bakeCollision, mapSpawnPoint, terrainFromMap } from "../src/shared/map-data.js";
import { TILE_SIZE } from "../src/shared/tilemap.js";

describe("terrainFromMap", () => {
  const data = {
    blocks: ["####", "#..#", "#..#", "####"],
    elements: [{ col: 1, row: 1, kind: "tree" as const, variant: 0 }],
    spawn: { col: 2, row: 2 },
  };

  it("builds geometry whose tiles are the baked map", () => {
    const terrain = terrainFromMap(data);
    expect(terrain.width).toBe(4 * TILE_SIZE);
    expect(terrain.height).toBe(4 * TILE_SIZE);
    expect(terrain.tiles).toEqual(bakeCollision(data));
    expect(terrain.obstacles).toEqual([]);
    expect(terrain.safeZone).toEqual({ x: 0, y: 0, width: 4 * TILE_SIZE, height: 4 * TILE_SIZE });
    expect(terrain.spawnPoints).toEqual([mapSpawnPoint(data)]);
  });

  it("centres the spawn point on its cell", () => {
    expect(mapSpawnPoint(data)).toEqual({
      x: 2 * TILE_SIZE + TILE_SIZE / 2,
      y: 2 * TILE_SIZE + TILE_SIZE / 2,
    });
  });
});
```

- [ ] **Step 3: Run to verify failure** — `npx vitest run test/map-data.test.ts` → FAIL, `terrainFromMap` not exported.

- [ ] **Step 4: Implement in `src/shared/map-data.ts`** (type-only import of `game.js` — no runtime cycle):

```ts
import type { Rect, TerrainGeometry } from "./game.js";
import { TILE_SIZE } from "./tilemap.js";

/** Where a hero appears: the centre of the map's one spawn cell. */
export function mapSpawnPoint(data: MapData): { x: number; y: number } {
  return {
    x: data.spawn.col * TILE_SIZE + TILE_SIZE / 2,
    y: data.spawn.row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/**
 * A map as the world geometry both sides run on. Shared because the server builds rooms from it
 * and the preview sandbox walks it — one builder, so they cannot disagree.
 */
export function terrainFromMap(data: MapData): TerrainGeometry {
  const tiles = bakeCollision(data);
  const width = tiles.cols * TILE_SIZE;
  const height = tiles.rows * TILE_SIZE;
  const safeZone: Rect = { x: 0, y: 0, width, height };
  return { width, height, obstacles: [], spawnPoints: [mapSpawnPoint(data)], safeZone, tiles };
}
```

In `src/server/world/map-zone.ts`: delete its private `centreOf` and `terrainFromMap`; import both from `../../shared/map-data.js`. Add elements passthrough in `zoneFromMap` (after `navigation`): `elements: stored.elements,`. In `src/shared/zones.ts` add to `ZoneDefinition`: `readonly elements?: readonly MapElement[];` (import `type MapElement` from `./map-data.js`) — catalogue zones simply leave it undefined.

- [ ] **Step 5: Add `isKnownZone` to `src/shared/zones.ts`** (beside `isZoneId`):

```ts
/**
 * Whether this id names a compile-time catalogue zone. The hybrid routing rule hangs off this:
 * known ids resolve to the catalogue (content and all), anything else is a D1 map id.
 */
export function isKnownZone(value: unknown): value is ZoneId {
  return typeof value === "string" && Object.hasOwn(ZONES, value);
}
```

- [ ] **Step 6: Write failing test for `relocateProfile`** in new `test/profile-relocate.test.ts`, following `test/db.test.ts`'s setup (drizzle over `env.DB`, truncate in `afterEach`). Create an account + character via the real helpers, then:

```ts
it("moves the character only while the epoch matches", async () => {
  const moved = await relocateProfile(
    db,
    { id: characterId, sessionEpoch: 1 },
    { zoneId: "some-map-id", instanceId: "main", x: 96, y: 96 },
  );
  expect(moved).toBe(true);
  const profile = await loadProfile(db, characterId);
  expect(profile?.zoneId).toBe("some-map-id");
  expect(profile?.sessionEpoch).toBe(1); // relocation does NOT advance the epoch

  const stale = await relocateProfile(
    db,
    { id: characterId, sessionEpoch: 99 },
    { zoneId: "elsewhere", instanceId: "main", x: 0, y: 0 },
  );
  expect(stale).toBe(false);
  expect((await loadProfile(db, characterId))?.zoneId).toBe("some-map-id");
});
```

- [ ] **Step 7: Run to verify failure**, then implement in `src/server/profile.ts` beside `handoffProfileLocation`:

```ts
/**
 * Fenced location write for the front-door fallback. The caller already holds the lease at this
 * epoch, so unlike `handoffProfileLocation` this must NOT advance it — the room is about to
 * compare `profile.sessionEpoch` against the very lease that authorized the move.
 */
export async function relocateProfile(
  db: Db,
  fenced: { id: string; sessionEpoch: number },
  destination: { zoneId: string; instanceId: string; x: number; y: number },
): Promise<boolean> {
  const updated = await db
    .update(character)
    .set({
      zoneId: destination.zoneId,
      instanceId: destination.instanceId,
      x: destination.x,
      y: destination.y,
      lastSeenAt: new Date(),
    })
    .where(and(eq(character.id, fenced.id), eq(character.sessionEpoch, fenced.sessionEpoch)))
    .returning({ id: character.id })
    .get();
  return updated !== undefined;
}
```

- [ ] **Step 8: Run and commit**

```bash
npx vitest run test/map-data.test.ts test/profile-relocate.test.ts test/maps.test.ts
git add -A && git commit -m "Share the map terrain builder and add a fenced relocation write"
```

---

### Task 2: Hybrid admission — existing world tests green again

**Files:**
- Modify: `src/server/index.ts` (`handleJoin`)
- Modify: `src/server/world.ts` (admission in `fetch`, hibernation-wake loop, portal path)
- Test: existing `test/world.test.ts` (no assertion changes expected)

**Interfaces:**
- Consumes: `isKnownZone`, `resolveZoneLocation` (both `src/shared/zones.ts`), `loadMap`/`resolveMapFor`/`BUILTIN_MAP`/`BUILTIN_MAP_ID` (`src/server/maps.ts`), `locationFromMap` (`src/server/world/map-zone.ts`).
- Produces: `World.#locateRoom(zoneId: string | null, instanceId: string | null): Promise<ZoneLocation | null>` — the ONLY location resolution inside the room, exact-id, never `resolveMapFor`.

- [ ] **Step 1: Run one failing test to pin the baseline**

```bash
npx vitest run test/world.test.ts -t "welcomes a player with the world dimensions"
```
Expected: FAIL, `expected 409 to be 101`.

- [ ] **Step 2: Front door hybrid in `src/server/index.ts` `handleJoin`** — replace the branch's resolution block (currently `resolveMapFor` + `locationFromMap` around line 189) with:

```ts
if (!isValidInstanceId(profile.instanceId)) {
  return closedWebSocket(WS_CLOSE.INVALID_LOCATION, "invalid character location");
}
// Hybrid routing: a catalogue id keeps its compiled-in zone — content, quests, tests and all.
// Anything else is a D1 map id, resolved HERE and only here; the room trusts what it was
// admitted for. `resolveMapFor` never throws: own map, or the front door, or the built-in floor.
let location: ZoneLocation;
let fallbackMap: StoredMap | null = null;
if (isKnownZone(profile.zoneId)) {
  const legacy = resolveZoneLocation(profile.zoneId, profile.instanceId);
  if (!legacy) return closedWebSocket(WS_CLOSE.INVALID_LOCATION, "invalid character location");
  location = legacy;
} else {
  const stored = await resolveMapFor(createDb(env.DB), profile.zoneId);
  fallbackMap = stored.id !== profile.zoneId ? stored : null;
  location = locationFromMap(stored, fallbackMap ? "main" : profile.instanceId);
}
```

Imports: restore `resolveZoneLocation` and add `isKnownZone` from `../shared/zones.js`; add `type StoredMap` to the `./maps.js` import; add `type ZoneLocation` to the zones import. Immediately after the existing lease `acquire` succeeds (after `sessionEpoch` is set), add:

```ts
if (fallbackMap) {
  // The requirement "their map is gone → move to the first map" is a real move: persist it under
  // the lease we just acquired, or the room will (rightly) refuse the profile/location mismatch.
  const spawn = mapSpawnPoint(fallbackMap);
  const moved = await relocateProfile(
    createDb(env.DB),
    { id: owned.id, sessionEpoch },
    { zoneId: fallbackMap.id, instanceId: "main", x: spawn.x, y: spawn.y },
  );
  if (!moved) return closedWebSocket(WS_CLOSE.PRESENCE_ERROR, "relocation lost the lease");
}
```

Imports: `mapSpawnPoint` from `../shared/map-data.js`, `relocateProfile` from `./profile.js`.

- [ ] **Step 3: Room-side hybrid in `src/server/world.ts`** — add one private method and use it in BOTH the admission path and the hibernation-wake loop:

```ts
/**
 * Exact-id room location. Catalogue zones come from the compiled catalogue; a D1 map id loads
 * THAT map — never `resolveMapFor`. The fallback belongs at the front door: a room that silently
 * re-resolves is a room that can disagree with the lease it was admitted under.
 */
async #locateRoom(
  zoneId: string | null,
  instanceId: string | null,
): Promise<ZoneLocation | null> {
  if (zoneId === null || !isValidInstanceId(instanceId)) return null;
  if (isKnownZone(zoneId)) return resolveZoneLocation(zoneId, instanceId);
  const stored =
    zoneId === BUILTIN_MAP_ID ? BUILTIN_MAP : await loadMap(createDb(this.env.DB), zoneId);
  return stored === null ? null : locationFromMap(stored, instanceId);
}
```

In `fetch` admission, replace the branch's `resolveMapFor` block with `const location = await this.#locateRoom(zoneId, instanceId);` (keep the `!location || location.roomKey !== roomKey` refusal). In the constructor's `blockConcurrencyWhile` socket loop, replace its `resolveMapFor` block the same way (keep closing with `WS_CLOSE.PRESENCE_LOST` on null). In `#usePortal`, revert to main's pure code — portals only name catalogue zones this session:

```ts
const destination = resolveZoneLocation(portal.destination.zoneId, portal.destination.instanceId);
```

Imports in `world.ts`: swap `resolveMapFor` for `loadMap, BUILTIN_MAP, BUILTIN_MAP_ID` from `./maps.js`; add `isKnownZone, resolveZoneLocation` to the zones import.

- [ ] **Step 4: Run the pinned test, then the whole file**

```bash
npx vitest run test/world.test.ts -t "welcomes a player with the world dimensions"
npx vitest run test/world.test.ts
```
Expected: PASS (characters are created in `verdant-reach`, a known zone → legacy path, profile matches). If stragglers fail, read the failure — do not touch assertions for tests that passed on `main`.

- [ ] **Step 5: Full suite and commit**

```bash
npm run check
git add -A && git commit -m "Resolve a room's map once at the front door, and keep catalogue zones compiled in"
```

---

### Task 3: D1 maps end-to-end — join, persist, fall back

**Files:**
- Modify: `src/server/characters.ts` (creation location comes from D1 resolution)
- Modify: `src/server/world.ts` (welcome carries the map's elements)
- Modify: `test/support/world-harness.ts` (default characters to `verdant-reach` explicitly)
- Test: `test/map-world.test.ts` (new), `test/characters.test.ts`

**Interfaces:**
- Consumes: `resolveMapFor`, `mapSpawnPoint`, `createMap`, `deleteMap` from Task 1/existing; harness `testCharacter`/`joinCharacter`.
- Produces: new characters start on the resolved D1 map (first map, else builtin); `WorldInfo.elements` is the map's element list for D1 rooms.

- [ ] **Step 1: Harness first.** In `test/support/world-harness.ts` `testCharacter`, the `options.zoneId` block currently only runs when options are provided. Make the zone write unconditional with defaults, so existing world tests keep meaning `verdant-reach` after Step 3 changes creation:

```ts
const zoneId = options.zoneId ?? "verdant-reach";
const instanceId = options.instanceId ?? "main";
await env.DB.prepare("UPDATE character SET zone_id = ?, instance_id = ? WHERE id = ?")
  .bind(zoneId, instanceId, body.id)
  .run();
```

(Replace the existing conditional block; keep it running BEFORE the `options.position` write so an explicit position always survives.) Note: `options.position` already runs earlier in the function today — reorder so zone is written first, position second.

- [ ] **Step 2: Failing test — creation resolves through D1.** In `test/characters.test.ts` add:

```ts
it("creates a character on the built-in floor when no map exists", async () => {
  const created = await createCharacter(db, accountId, "Nova", appearance, "warrior");
  const profile = await loadProfile(db, created.id);
  expect(profile?.zoneId).toBe("builtin");
  expect(profile?.instanceId).toBe("main");
});

it("creates a character on the first map when one exists", async () => {
  const stored = await createMap(db, {
    name: "Home",
    blocks: Array.from({ length: 15 }, () => ".".repeat(20)),
    elements: [],
    spawn: { col: 3, row: 3 },
  });
  const created = await createCharacter(db, accountId, "Nova", appearance, "warrior");
  const profile = await loadProfile(db, created.id);
  expect(profile?.zoneId).toBe(stored.id);
});
```

(Adjust the `createCharacter` call shape to its actual signature in `src/server/characters.ts` — keep the existing test file's own helpers.) Run → FAIL (`verdant-reach`).

- [ ] **Step 3: Implement.** In `src/server/characters.ts`, replace the hardcoded location (lines ~179–180 plus whatever x/y it writes) with:

```ts
const stored = await resolveMapFor(db, "");
const spawn = mapSpawnPoint(stored);
// ...in the insert:
zoneId: stored.id,
instanceId: "main",
x: spawn.x,
y: spawn.y,
```

`""` is never a map id, so this is exactly "first map, else builtin". Imports: `resolveMapFor` from `./maps.js`, `mapSpawnPoint` from `../shared/map-data.js`. Run the two tests → PASS. Run `npx vitest run test/world.test.ts` → still green (harness now pins verdant explicitly).

- [ ] **Step 4: Welcome elements.** In `src/server/world.ts` the welcome currently sends `elements: []` (~line 408). Change to:

```ts
elements: location.definition.elements ?? [],
```

(or `this.#zone().elements ?? []` matching however that block reads the definition — mirror the neighbouring `tiles:` line's source).

- [ ] **Step 5: The engine test file.** New `test/map-world.test.ts`, using the harness plus direct `createMap`/`deleteMap` against the test D1 (mirror `test/maps.test.ts` for the drizzle setup). Cover, in order:

```ts
it("welcomes a character onto their D1 map with its tiles and elements", async () => {
  const stored = await createMap(db, islandInput); // grass island in water + one tree + one stone
  const player = await testCharacter("mapper", { zoneId: stored.id });
  const joined = await joinCharacter(player); // whatever the harness's join helper is named
  expect(joined.welcome.world.zoneId).toBe(stored.id);
  expect(joined.welcome.world.tiles).toEqual(encodeTileMap(bakeCollision(stored)));
  expect(joined.welcome.world.elements).toEqual(stored.elements);
});

it("relocates a character whose map was deleted to the first map, at its spawn", async () => {
  // two maps; character on map B; delete B; join → welcome is map A, position is A's spawn,
  // and the character ROW now says A (read it back through env.DB) — the move persisted.
});

it("falls back to the built-in floor on an empty database", async () => {
  // character with zoneId "no-such-map", zero maps → welcome zoneId "builtin".
});

it("returns to the same map and position across a disconnect", async () => {
  // join stored map, walk a few ticks, disconnect, rejoin → same zoneId, same x/y (epoch fence intact).
});

it("closes with INVALID_LOCATION when the map vanishes between admission and room load", async () => {
  // Hard to race honestly: instead, join once (room caches location), delete the map, join a
  // SECOND character pointed at the deleted map id via harness zoneId override → front door
  // falls back (relocation), so instead assert the fallback, not the close. If the close path
  // proves untestable without a real race, cover #locateRoom's null branch directly with
  // runInDurableObject and drop this case — note which you did in the commit message.
});
```

Adapt helper names to `test/support/world-harness.ts`'s real exports (`joinCharacter` exists — see `world-harness.ts:201`). Use fresh map ids per test (uuid-minted by `createMap`) — the DO is a singleton per test file, so never assert on player counts, only ids.

- [ ] **Step 6: Run, fix what the contentless zone surfaces.** `npx vitest run test/map-world.test.ts`. Expected trip points if joins fail inside the room rather than at admission: quest resolution on a zone with `quests: []` (`zone-runtime.ts` / `quest-system.ts`) and monster/guard init on empty lists. Fix by making the empty case a no-op at the narrowest point — never by seeding fake content.

- [ ] **Step 7: Full check and commit**

```bash
npm run check
git add -A && git commit -m "Run characters on D1 maps: creation, welcome elements, and the persisted fallback move"
```

---

### Task 4: Merge the engine

- [ ] **Step 1:** `npm run check` → green on `feature/d1-map-engine`.
- [ ] **Step 2:**

```bash
git checkout main && git merge feature/d1-map-engine --no-edit && npm run check
git push && git branch -d feature/d1-map-engine && git push origin --delete feature/d1-map-engine
```

Milestone 1 done — say so plainly: everything so far is invisible foundation; the next task is the first visible payoff.

---

### Task 5: Client renders wire terrain (unknown zones)

**Files:**
- Modify: `src/client/game/world-layout.ts` (add `EMPTY_ZONE_VISUALS`)
- Modify: `src/client/game/renderer.ts` (add `configureMapTerrain`; element sprites; suppress hash-trees in wire mode)
- Modify: `src/client/game/session.ts` (branch at line ~315)
- Test: manual via `npm run dev` (fresh DB → builtin island); existing `test/map-terrain.test.ts` stays the autotile/foam pin

**Interfaces:**
- Consumes: `decodeTileMap` (`src/shared/tilemap-codec.ts`), `isKnownZone`, `WorldInfo.tiles`/`.elements`, `TINY_SWORDS_TREES`/`TINY_SWORDS_BUSHES`/`TINY_SWORDS_ROCKS` (`tiny-swords-art.ts`), `TILE_SIZE`.
- Produces: `Renderer.configureMapTerrain(zoneId: string, tiles: TileMap, elements: readonly MapElement[]): void`.

- [ ] **Step 1: Neutral visuals.** In `src/client/game/world-layout.ts` export a constant of type `ZoneVisualConfig` with every collection empty / every flag off (the compiler enforces the exact fields — fill them all explicitly, no casts):

```ts
/** A D1 map has no authored roads, districts or signs — nothing but its own tiles and elements. */
export const EMPTY_ZONE_VISUALS: ZoneVisualConfig = {
  safeZone: null,
  landmarks: [],
  roads: [],
  decorRegions: [],
  pointsOfInterest: [],
  worldRegions: [],
  ambientRegions: [],
};
```

- [ ] **Step 2: `configureMapTerrain` in `renderer.ts`.** Read `configureZone` (renderer.ts:809) first; the new method must perform the SAME rebuild sequence after setting fields — extract that tail into one private helper both methods call (behaviour identical, no duplication):

```ts
configureMapTerrain(zoneId: string, tiles: TileMap, elements: readonly MapElement[]): void {
  if (zoneId === this.#currentZoneId) return;
  this.#currentZoneId = zoneId;
  this.#tiles = tiles;
  this.#portals = [];
  this.#visuals = EMPTY_ZONE_VISUALS;
  this.#zoneWidth = tiles.cols * TILE_SIZE;
  this.#zoneHeight = tiles.rows * TILE_SIZE;
  this.#mapElements = elements;
  // ...then exactly the rebuild calls configureZone makes after its field assignments.
}
```

Add a field `#mapElements: readonly MapElement[] | null = null;` (and reset it to `null` in `configureZone`, so catalogue zones keep today's behaviour).

- [ ] **Step 3: Element sprites, and no hash-trees on wire maps.** In the terrain/prop build path: where `#buildForestTrees` hashes `forest:${col}:${row}` (renderer.ts:987), branch — if `#mapElements !== null`, skip the forest hash pass AND the decor scatter passes entirely (a stone bakes to `forest`; the hash pass would grow a tree out of it), and instead draw each element:
  - `tree` → `TINY_SWORDS_TREES[element.variant % TINY_SWORDS_TREES.length]`, animated exactly as `#buildForestTrees` animates its sheets (same frame cadence, same foot offset handling);
  - `bush` → same treatment over `TINY_SWORDS_BUSHES`;
  - `stone` → static texture from `TINY_SWORDS_ROCKS[element.variant % TINY_SWORDS_ROCKS.length]` via the existing `createPropSprite` pattern (see renderer.ts:1127 for a stone example).
  - Position each at the centre of its cell, y-sorted with the existing prop layering.

- [ ] **Step 4: Session branch.** In `src/client/game/session.ts` `onWelcome` (line ~315):

```ts
if (isKnownZone(world.zoneId)) {
  renderer.configureZone(world.zoneId);
} else {
  renderer.configureMapTerrain(world.zoneId, decodeTileMap(world.tiles), world.elements);
}
```

Imports: `isKnownZone` from `../../shared/zones.js`, `decodeTileMap` from `../../shared/tilemap-codec.js`.

- [ ] **Step 5: Verify visually — this is the milestone's checkpoint.** Fresh local DB (delete `.wrangler/state` if needed), `npm run dev`, register, create a character → it spawns on the builtin floor: water border, grass island, autotiled rocky rim, animated foam along every coast. Walk into the water border → blocked. Screenshot-worthy; tell the user.

- [ ] **Step 6:** `npm run check` → green. Commit:

```bash
git add -A && git commit -m "Render wire terrain: autotiled D1 maps with authored elements instead of hash-grown props"
```

---

### Task 6: `setFirstMap` and input caps in `maps.ts`

**Files:**
- Modify: `src/server/maps.ts`
- Test: `test/maps.test.ts`

**Interfaces:**
- Produces: `setFirstMap(db: Db, id: string): Promise<void>` (throws `not_found:`); `validateMapInput` additionally throws `size:` and `name:` errors; exported constants `MAP_MIN_COLS = 20`, `MAP_MAX_COLS = 100`, `MAP_MIN_ROWS = 15`, `MAP_MAX_ROWS = 100`, `MAP_NAME_MAX = 48`.

- [ ] **Step 1: Failing tests** in `test/maps.test.ts`:

```ts
it("moves the first-map flag on demand", async () => {
  const a = await createMap(db, inputNamed("A")); // auto-flagged
  const b = await createMap(db, inputNamed("B"));
  await setFirstMap(db, b.id);
  const listed = await listMaps(db);
  expect(listed.find((m) => m.id === b.id)?.isFirst).toBe(true);
  expect(listed.filter((m) => m.isFirst)).toHaveLength(1);
});

it("refuses to flag a map that does not exist", async () => {
  await expect(setFirstMap(db, "nope")).rejects.toThrow(/^not_found:/);
});

it("refuses maps outside the size caps", async () => {
  const tiny = { ...validInput, blocks: Array.from({ length: 5 }, () => ".".repeat(5)) };
  await expect(createMap(db, tiny)).rejects.toThrow(/^size:/);
  const huge = { ...validInput, blocks: Array.from({ length: 101 }, () => ".".repeat(101)) };
  await expect(createMap(db, huge)).rejects.toThrow(/^size:/);
});

it("refuses a blank or oversized name", async () => {
  await expect(createMap(db, { ...validInput, name: "  " })).rejects.toThrow(/^name:/);
  await expect(createMap(db, { ...validInput, name: "x".repeat(49) })).rejects.toThrow(/^name:/);
});
```

Note: `validInput` must now be ≥20×15 — update the file's existing fixtures to 20×15 grass once, in this step.

- [ ] **Step 2: Run → FAIL. Implement.** In `validateMapInput`, before the element loop:

```ts
const name = input.name.trim();
if (name.length === 0 || name.length > MAP_NAME_MAX) {
  throw new Error("name: 1-48 characters");
}
const cols = input.blocks[0]?.length ?? 0;
const rows = input.blocks.length;
if (cols < MAP_MIN_COLS || cols > MAP_MAX_COLS || rows < MAP_MIN_ROWS || rows > MAP_MAX_ROWS) {
  throw new Error(`size: ${MAP_MIN_COLS}x${MAP_MIN_ROWS} to ${MAP_MAX_COLS}x${MAP_MAX_ROWS}`);
}
```

And:

```ts
/** Hand the front-door flag to a chosen map. Exactly one map carries it, before and after. */
export async function setFirstMap(db: Db, id: string): Promise<void> {
  const [row] = await db.select().from(map).where(eq(map.id, id)).limit(1);
  if (!row) throw new Error("not_found: no such map");
  await db.update(map).set({ isFirst: 0 }).where(eq(map.isFirst, 1));
  await db.update(map).set({ isFirst: 1 }).where(eq(map.id, id));
}
```

The builtin map (8 rows) is a constant, not input — it never passes through `validateMapInput`, so the caps don't reject it.

- [ ] **Step 3:** `npx vitest run test/maps.test.ts` → PASS (all, including the pre-existing 14 — fixture resize may touch several). Commit: `git add -A && git commit -m "Cap map size and name, and let the first-map flag be handed over"`.

---

### Task 7: The maps CRUD API

**Files:**
- Modify: `src/server/index.ts`
- Test: `test/maps-api.test.ts` (new)

**Interfaces:**
- Consumes: `requireSession`, `readJson`, `parseMapData`, everything from `maps.ts`.
- Produces: `GET /api/maps` → `{id,name,isFirst}[]`; `GET /api/maps/:id` → `{id,name,blocks,elements,spawn}` | 404 `{error:"map_not_found"}`; `POST /api/maps` (201) / `PUT /api/maps/:id` — body `{name, blocks, elements, spawn}`; `DELETE /api/maps/:id` → 204 | 409 `{error:"last_map"}`; `POST /api/maps/:id/first` → 204. Errors: 400 `{error:"map_invalid"|"map_placement"|"map_spawn"|"map_size"|"map_name"}`, 401 unauthenticated, 413 over 32 KiB.

- [ ] **Step 1: Failing tests** in `test/maps-api.test.ts`, following `test/worker.test.ts`'s register-and-cookie pattern (worker.test.ts:14-30). Cover: 401 without a cookie on every route; create → list → get → update → delete round trip; tree-on-water → 400 `map_placement`; 5×5 map → 400 `map_size`; deleting the last map → 409 `last_map`; deleting the flagged of two → survivor flagged; `POST /:id/first` moves the flag; a maximal 100×100 map (~10 KB) → 200; a body over 32 KiB (pad `name`… no — name is capped; pad `elements` with a long array) → 413. Run → FAIL (404s).

- [ ] **Step 2: Body-cap plumbing.** `readJson` (index.ts:47) gains a limit parameter — thread it through BOTH the declared-length check (line 49) and the byte-count check (line 60):

```ts
const MAX_MAP_JSON_BYTES = 32_768; // a 100x100 map is ~10 KB of blocks plus elements

async function readJson(
  request: Request,
  limit: number = MAX_API_JSON_BYTES,
): Promise<{ value: unknown } | Response> {
```

- [ ] **Step 3: Handlers.** Thin over `maps.ts`; one error mapper:

```ts
function mapErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : "";
  const code = message.split(":")[0];
  if (code === "not_found") return json({ error: "map_not_found" }, { status: 404 });
  if (code === "last_map") return json({ error: "last_map" }, { status: 409 });
  if (code === "placement" || code === "spawn" || code === "size" || code === "name") {
    return json({ error: `map_${code}` }, { status: 400 });
  }
  throw error;
}

function parseMapBody(body: unknown): MapInput | null {
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== "string") return null;
  const data = parseMapData(body);
  if (!data) return null;
  return { name, blocks: data.blocks, elements: data.elements, spawn: data.spawn };
}
```

`parseMapData` (shared/map-data.ts:110) already validates blocks/chars/bounds/spawn shape defensively — reuse it, don't re-validate in the handler; `validateMapInput` inside `createMap`/`updateMap` remains the single semantic gate. Each handler: `requireSession` → (`readJson(request, MAX_MAP_JSON_BYTES)` for POST/PUT → `parseMapBody` → 400 `map_invalid` on null) → try the `maps.ts` call, catch with `mapErrorResponse`. Dispatch (with the existing route ifs, before the 404 fallthrough):

```ts
if (url.pathname === "/api/maps" && request.method === "GET") { ... }
if (url.pathname === "/api/maps" && request.method === "POST") { ... } // 201 with the stored map
const mapRoute = url.pathname.match(/^\/api\/maps\/([A-Za-z0-9-]{1,64})$/);
if (mapRoute?.[1]) { /* GET | PUT | DELETE on mapRoute[1] */ }
const firstRoute = url.pathname.match(/^\/api\/maps\/([A-Za-z0-9-]{1,64})\/first$/);
if (firstRoute?.[1] && request.method === "POST") { ... } // 204
```

`GET /api/maps/:id` must 404 (`map_not_found`) for `BUILTIN_MAP_ID` too — the builtin is never listed and never editable.

- [ ] **Step 4:** `npx vitest run test/maps-api.test.ts` → PASS. `npm run check` → green. Commit: `git add -A && git commit -m "Expose maps over /api/maps, with their own body cap"`.

---

### Task 8: Editor state, pure

**Files:**
- Create: `src/client/game/editor-state.ts`
- Test: `test/editor-state.test.ts` (workerd suite — pure module, no DOM; `test/autotile.test.ts` is the precedent for testing `client/game` pure code there)

**Interfaces:**
- Consumes: `ELEMENT_RULES`, `canPlaceElement`, `bakeCollision`, `type MapData`, `type ElementKind` from `src/shared/map-data.ts`; `isSolidKind`, `kindAt` from `src/shared/tilemap.ts`.
- Produces:

```ts
export interface EditorMap {
  name: string;
  blocks: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
}
export type EditorTool =
  | { kind: "block"; block: "grass" | "water" }
  | { kind: "element"; element: ElementKind; variant: number }
  | { kind: "eraser" }
  | { kind: "spawn" };
export function blankMap(name: string, cols: number, rows: number): EditorMap; // all grass, spawn centred
export function applyTool(map: EditorMap, tool: EditorTool, col: number, row: number): EditorMap | null; // null = refused, unchanged
```

- [ ] **Step 1: Failing tests** in `test/editor-state.test.ts` for every rule, each a one-behaviour `it`:
  - `blankMap("m", 20, 15)` → 15 rows of 20 `"."`, spawn `{col: 10, row: 7}`.
  - block paint writes `"."`/`"#"` at the cell and nowhere else; returns a NEW object (input untouched).
  - painting water under a tree/bush removes that element (it can no longer stand); under a stone keeps it (stones stand on water).
  - painting water (or a colliding element) onto the spawn cell → `null`.
  - placing `tree` on water → `null`; `stone` on water → placed; placing on an occupied cell replaces the element (one per cell).
  - placing a colliding element on the spawn cell → `null`.
  - eraser removes the element at the cell; on an empty cell → returns the map unchanged (not null).
  - spawn tool onto a walkable cell moves the spawn; onto water or under a colliding element → `null`.
  - any out-of-bounds col/row → `null`.

- [ ] **Step 2: Run → FAIL. Implement** `applyTool` as pure copy-and-mutate over `EditorMap`, deciding walkability with `isSolidKind(kindAt(bakeCollision(next), col, row))` where the spawn is involved, and `canPlaceElement(kind, groundKind)` for placement (ground = the blocks-only bake, exactly as `validateMapInput` does at maps.ts:79-86 — same functions, same answers as the server).

- [ ] **Step 3:** `npx vitest run test/editor-state.test.ts` → PASS. Commit: `git add -A && git commit -m "The editor's painting rules, pure and server-identical"`.

---

### Task 9: The Map editor screen — list, create, delete, flag

**Files:**
- Modify: `src/client/store.ts` (screen union + `mapEditor` handle slot), `src/client/ui/App.tsx`, `src/client/ui/CharacterSelect.tsx`, `src/client/api.ts`, `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts`
- Create: `src/client/ui/MapEditor.tsx`
- Test: `test/ui/map-editor.test.tsx` (new)

**Interfaces:**
- Consumes: `api<T>` helper (api.ts:33), pixelact `Button`, `t()`/`useLocale()`, store patterns from `CharacterSelect.tsx`.
- Produces: screen `"map-editor"` in `UiState["screen"]`; api functions `fetchMaps(): Promise<MapSummary[]>`, `fetchMap(id): Promise<MapPayload>`, `createMapApi(input: MapSaveInput): Promise<MapPayload>`, `updateMapApi(id, input): Promise<MapPayload>`, `deleteMapApi(id): Promise<void>`, `flagFirstMapApi(id): Promise<void>` with `MapSummary {id; name; isFirst}`, `MapPayload {id; name; blocks: string[]; elements: MapElement[]; spawn: {col; row}}`, `MapSaveInput = Omit<MapPayload, "id">`; store slot `mapEditor: MapEditorStageHandle | null` (typed in Task 10, declare as placeholder interface here with `dispose(): void`).

- [ ] **Step 1: Failing UI tests** in `test/ui/map-editor.test.tsx`, following `test/ui/character-select.test.tsx` (stub `fetch`, seed the store, `render`, assert roles):
  - CharacterSelect shows a "Map editor" button; clicking it sets `screen` to `"map-editor"`.
  - MapEditor lists fetched maps with name + a first-map marker; shows a create form (name, cols, rows inputs defaulting 40×30).
  - Delete asks for confirmation before calling the API; deleting via the API mock refreshes the list.
  - "Make first" calls `POST /api/maps/:id/first` (assert on the stubbed fetch).
  - A Back button returns `screen` to `"characters"`.

- [ ] **Step 2: Run → FAIL. Implement:**
  - `store.ts`: screen union gains `"map-editor"` (line ~100); add `mapEditor: MapEditorStageHandle | null` + `setMapEditor` following the `game`/`setGame` pattern (store.ts:129, 154).
  - `App.tsx`: `{screen === "map-editor" && <MapEditor />}`.
  - `CharacterSelect.tsx`: a secondary `Button` beneath the roster — `onClick={() => setScreen("map-editor")}`, label `t("chars.mapEditor")`.
  - `api.ts`: the six functions via the `api<T>` helper; add map error codes to `ERROR_KEYS` (`map_placement`, `map_spawn`, `map_size`, `map_name`, `map_invalid`, `map_not_found`, `last_map`).
  - `MapEditor.tsx`: list mode only in this task (editing mode arrives in Task 10) — fetch on mount, create (POST a `blankMap` of the chosen size, then open it), delete-with-confirm (reuse the confirm pattern CharacterSelect uses for character deletion), flag toggle, Back.
  - i18n: `editor.*` keys in BOTH dictionaries (`editor.title`, `editor.new`, `editor.name`, `editor.cols`, `editor.rows`, `editor.open`, `editor.delete`, `editor.delete.confirm`, `editor.makeFirst`, `editor.first`, `editor.back`, `editor.save`, `editor.preview`, `editor.tool.grass`, `editor.tool.water`, `editor.tool.tree`, `editor.tool.bush`, `editor.tool.stone`, `editor.tool.eraser`, `editor.tool.spawn`, `editor.tool.variant`, plus `chars.mapEditor`).

- [ ] **Step 3:** `npx vitest run -c vitest.ui.config.ts test/ui/map-editor.test.tsx` then `npm run check` → green. Commit: `git add -A && git commit -m "A map editor screen: list, create, delete, and choose the front door"`.

---

### Task 10: The WYSIWYG painting stage

**Files:**
- Create: `src/client/game/map-editor-stage.ts`
- Modify: `src/client/ui/MapEditor.tsx` (editing mode), `src/client/store.ts` (real `MapEditorStageHandle` type)
- Test: `test/ui/map-editor.test.tsx` (toolbar behaviour with a mocked handle); the stage itself is verified manually + through Task 8's pure rules

**Interfaces:**
- Consumes: `applyTool`/`EditorMap`/`EditorTool` (Task 8), `landTile`/`needsFoam`/`tileVisual` (`autotile.ts`), `bakeCollision`, `TINY_SWORDS_TERRAIN`/`TREES`/`BUSHES`/`ROCKS` + `TINY_SWORDS_FOAM_FRAME(S)` (`tiny-swords-art.ts`), `TILE_SIZE`, PixiJS `Application`/`Assets`.
- Produces:

```ts
export interface MapEditorStageHandle {
  setTool(tool: EditorTool): void;
  current(): EditorMap;
  setName(name: string): void;
  dispose(): void;
}
export async function openMapEditorStage(
  initial: EditorMap,
  onChange: (map: EditorMap) => void,
): Promise<MapEditorStageHandle>;
```

- [ ] **Step 1: The stage.** New game-code module (no React):
  - `Application` on the `#stage` canvas (same acquisition as session.ts:45-51 — `document.querySelector<HTMLCanvasElement>("#stage")`).
  - Load textures with `Assets.load` from `TINY_SWORDS_TERRAIN.flat/.water/.foam` and the tree/bush/rock sheets. The flat sheet's 4×4 autotile slicing lives in the renderer's `loadArt` (renderer.ts ~500-530): extract that arithmetic into a small exported helper (natural home: `tiny-swords-art.ts`) and call it from BOTH `loadArt` and the stage — do not duplicate the slicing.
  - Draw pass over `bakeCollision(current)`: water cells → animated water; land cells → `landTexture` via `landTile(tiles, col, row)`; foam sprite behind any land cell where `needsFoam(tiles, col, row)`; elements from `current.elements` (tree/bush animated strips, stones static), y-sorted; a distinct marker sprite on the spawn cell (tint a tile corner — any clearly visible marker).
  - On any change, rebuild the tile container wholesale (≤10,000 sprites at 100×100 — acceptable; note a dirty-cell optimisation as a future follow-up in a comment only if measured slow).
  - Pointer: `pointerdown`/`pointermove` while pressed → cell = floor(worldPos / TILE_SIZE) → `next = applyTool(current, tool, col, row)`; if non-null and !== current, adopt it, redraw, call `onChange(next)`. A refused drop does nothing visible.
  - Camera: right-button (or space+drag) pans; wheel zooms 0.5–2×, clamped to the map bounds.
  - `dispose()` destroys the Application and removes listeners.

- [ ] **Step 2: Editing mode in `MapEditor.tsx`.** Opening a map (or after create) fetches the payload, calls `openMapEditorStage`, stores the handle via `setMapEditor`. Toolbar: one button per tool (labels via `t("editor.tool.*")`), a variant-cycle button for the selected element kind (increments `variant`; the stage wraps by pool size), a name input (`setName`), Save (POST/PUT `handle.current()` mapped to `MapSaveInput`; surface `ApiError` codes through the existing error-text pattern), Back (dispose + list mode). React never touches Pixi objects — only the handle.
- [ ] **Step 3: UI tests** (mock the stage: inject a fake handle into the store): tool buttons mark selection; Save calls the right endpoint with the handle's `current()`; Back disposes. Run UI suite → PASS.
- [ ] **Step 4: Manual verification** — `npm run dev`: create a 40×30 map, paint a lake, watch the shoreline autotile and foam LIVE while painting; place trees (refused on water), a stone IN the water (allowed), move the spawn, save, reopen — everything persisted. This is the WYSIWYG checkpoint from the spec.
- [ ] **Step 5:** `npm run check` → green. Commit: `git add -A && git commit -m "Paint maps against the real coastline: the WYSIWYG editor stage"`.

---

### Task 11: Preview — a sandbox walk with a throwaway warrior

**Files:**
- Create: `src/client/game/map-preview.ts`
- Modify: `src/client/ui/MapEditor.tsx` (Preview button + Esc), `src/client/store.ts` if a `previewing` flag helps the UI hide the toolbar
- Test: `test/ui/map-editor.test.tsx` (button + Esc with a mocked starter); movement parity is already pinned by `prediction.test.ts` — the sandbox calls the same functions

**Interfaces:**
- Consumes: `terrainFromMap`/`mapSpawnPoint` (Task 1), `step`/`TICK_DT`/`TICK_MS` (`shared/simulation.ts`), `resolveTerrain` (`shared/game.ts`), `trackInput` (`client/game/input.ts`), `Renderer.create`/`configureMapTerrain`/`setSelfId`/`onFrame`/`render`, `starterEquipmentFor` (`shared/character.ts`).
- Produces: `startMapPreview(data: MapData): Promise<{ stop(): void }>`.

- [ ] **Step 1: The sandbox.** The whole point: the position advance is **exactly** net.ts:113 —

```ts
position = resolveTerrain(position, step(position, input, TICK_DT, PLAYER_SPEED, geometry), geometry);
```

Build it:
  - dispose the editor stage first (one Pixi app on `#stage` at a time), `await Renderer.create(canvas)`, `configureMapTerrain("preview:" + a nonce, terrainFromMap(data).tiles, data.elements)`, `setSelfId(SELF_ID)`.
  - a synthetic level-1 warrior `PlayerSnapshot` (protocol.ts:55): `{ id: SELF_ID, nick: "Preview", x, y, ack: 0, hp: 100, maxHp: 100, level: 1, appearance: randomAppearance(), class: "warrior", equipment: starterEquipmentFor("warrior"), life: "alive" }` — `randomAppearance()` picks a random body/primaryColor from the catalogues in `shared/character.ts` ("a random level 1 warrior").
  - `trackInput()`; a fixed-step accumulator inside `renderer.onFrame((now, dt) => ...)` advancing by `TICK_DT` per accumulated `TICK_MS`, reading the tracker the same way session.ts's frame loop does (mirror its accessor).
  - each frame: `renderer.render({ players: [{ ...self, x: position.x, y: position.y }], monsters: [], guards: [], loot: [], corpses: [] }, context)` where `context` copies the benign defaults session.ts passes (`quest`, `healthBars`, `grid: false`, `attackRange: 0`, `attackCooldownUntil: 0`, `now`) — read session's `renderer.render` call and reuse its constant choices.
  - `stop()`: stop input, destroy the renderer's Application, and re-open the editor stage with the (unsaved) `EditorMap` — edits survive a preview round-trip.

- [ ] **Step 2: Wire the button.** Preview in `MapEditor.tsx` calls `startMapPreview` with `handle.current()` mapped to `MapData` (strip `name`); Esc (window keydown while previewing) calls `stop()`. UI test with a mocked starter: button starts, Esc stops, editor state identical after.
- [ ] **Step 3: Manual verification** — preview an unsaved lake: spawn on the spawn square, walk with WASD/arrows at living speed, bump into trees/stones/water exactly where painted, coastline foams. Esc returns with edits intact.
- [ ] **Step 4:** `npm run check` → green. Commit: `git add -A && git commit -m "Preview a map from inside the editor with a throwaway warrior"`.

---

### Task 12: Wrap-up

- [ ] **Step 1: CLAUDE.md** — add a short "Maps and the editor" paragraph under Architecture: maps live in D1 (`maps.ts`), hybrid routing (catalogue ids compile-time, anything else D1, fallback persisted at the front door), the editor screen + `/api/maps` (32 KiB cap), preview is a client sandbox over shared `bakeCollision`/`step`. Three-to-five sentences, matching the file's voice.
- [ ] **Step 2:** `npm run check` → green. `npm run loadtest -- --players=5 --duration=30 --scenario=mixed` against local dev as a smoke check that admission changes didn't regress throughput.
- [ ] **Step 3: Commit and push.**

```bash
git add -A && git commit -m "Document the map engine and editor" && git push
```

Out of scope (spec): deleting the catalogue zones (follow-up session), map resize, live-room reload, roles, more palette kinds.
