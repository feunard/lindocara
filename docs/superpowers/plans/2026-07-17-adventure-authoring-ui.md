# Adventure Authoring UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authors can place entry/exit/monster-spawn markers in the map editor and assemble complete adventures (maps, start, exit bindings, max players) in a new adventure editor screen — without ever being able to wipe markers or orphan a stored adventure graph.

**Architecture:** Plan 2 of 5 for `docs/superpowers/specs/2026-07-17-adventures-parties-design.md`, building on plan 1's shared marker format and `/api/adventures` API. Task 1 closes the data-loss hole flagged by plan 1's final review: the editor save path (`MapPayload`/`EditorMap`/`toMapData`) must round-trip `markers` before any tool exists. Task 2 adds the server-side mutation policy: removing a marker that a stored adventure graph binds is **refused** (same philosophy and same `map_referenced` wire code as the delete guard). Tasks 3–4 add pure marker tools to `editor-state.ts` and their rendering/palette. Tasks 5–6 add the adventure client API, a pure `adventure-draft.ts` state module (mirroring the editor-state/MapEditor split), and the `AdventureEditor` React screen. Nothing runtime-facing changes: `zoneFromMap` still emits `monsters: []` (plan 4 hydrates).

**Tech Stack:** TypeScript, React + zustand (`src/client/ui`, `src/client/store.ts`), PixiJS v8 (`map-editor-stage.ts`), Drizzle/D1 (guard only), Vitest (workerd suite for shared/server/pure-client, jsdom suite for UI via `vitest.ui.config.ts`).

## Global Constraints

- `npm run check` must pass before every commit. Biome `noNonNullAssertion`: no `!`.
- UI is React; game code under `src/client/game/` must not import React. Pure state modules (`editor-state.ts`, new `adventure-draft.ts`) import no React and no PixiJS.
- Every player-facing string lives in BOTH `src/shared/i18n/en.ts` and `fr.ts` (parity test). i18n in components: `import { t, useLocale } from "../i18n.js"`, call `useLocale()` once at the top, `t("key")`/`t("key", { params })` for labels.
- Server error style `throw new Error("prefix: detail")`; the marker-mutation guard reuses the existing `referenced` prefix → wire `map_referenced` (409) → `editor.error.referenced` (already in both dictionaries — zero new error i18n).
- Screen navigation is the zustand store: extend `UiState.screen` union, add an `App.tsx` render branch, navigate with `setScreen(...)`.
- Client API wrappers follow the exact `api<T>(path, init)` shape in `src/client/api.ts`; error surfacing via `errorCode`/`authErrorText`/`isSessionError` (session errors → `setScreen("auth")`).
- Shared constants are the single source: `MAX_MAP_ENTRIES = 8`, `MAX_MAP_EXITS = 8`, `MAX_MAP_MONSTER_SPAWNS = 32`, `MIN_PATROL_RADIUS = 32`, `MAX_PATROL_RADIUS = 768` (`shared/map-data.ts`); `ADVENTURE_TITLE_MAX = 48`, `MAX_ADVENTURE_MAPS = 16` (`shared/adventure.ts`); species labels reuse existing `monster.<species>` i18n keys.
- Editor validation must mirror server `validateMapInput` marker rules exactly: markers on walkable ground of the fully-baked map; an exit never shares a cell with the spawn or an entry.
- Repo compiles with `exactOptionalPropertyTypes: true`. Commits: `feat <lowercase>` (no colon). Tests: `npm test -- test/<file>.test.ts` (workerd) and `npm run test:ui -- test/ui/<file>.test.tsx` (jsdom).

---

### Task 1: Markers round-trip through the editor save path

Today `MapPayload`, `EditorMap` and `toMapData` all drop `markers`, so opening + saving a marker-carrying map would erase its markers (and, after Task 2, be refused if referenced). Thread the field through; no tools yet.

**Files:**
- Modify: `src/client/api.ts` (`MapPayload`)
- Modify: `src/client/game/editor-state.ts` (`EditorMap`, `blankMap`, `toMapData`)
- Modify: `src/client/ui/MapEditor.tsx` (`toEditorMap`)
- Test: `test/editor-state.test.ts` (append), `test/ui/map-editor.test.tsx` (fixtures + one save assertion)

**Interfaces:**
- Consumes: `MapMarkers`, `EMPTY_MARKERS` from `src/shared/map-data.ts`; server GET/PUT already carry `markers` (plan 1).
- Produces: `MapPayload.markers: MapMarkers` (so `MapSaveInput = Omit<MapPayload, "id">` carries it); `EditorMap.markers: MapMarkers` (required — threading cannot be forgotten); `toMapData` forwards it. Tasks 3–6 rely on all three.

- [ ] **Step 1: Write the failing tests**

Append to `test/editor-state.test.ts` (add `EMPTY_MARKERS` to the `shared/map-data.js` import):

```ts
describe("markers on the editor map", () => {
  it("blankMap starts with empty markers", () => {
    expect(blankMap("m", 20, 15).markers).toEqual(EMPTY_MARKERS);
  });

  it("every tool application preserves markers it did not touch", () => {
    const base = blankMap("m", 20, 15);
    const withMarkers: EditorMap = {
      ...base,
      markers: { entries: [{ id: "door", col: 2, row: 2 }], exits: [{ id: "gate", col: 4, row: 4 }], monsterSpawns: [] },
    };
    const painted = applyTool(withMarkers, { kind: "block", block: "water" }, 9, 9);
    expect(painted?.markers).toEqual(withMarkers.markers);
    const moved = applyTool(withMarkers, { kind: "spawn" }, 8, 8);
    expect(moved?.markers).toEqual(withMarkers.markers);
  });
});
```

In `test/ui/map-editor.test.tsx`: add `markers` to the `edited` fixture of the save test and to the `payloadFor` fixture helper —

```ts
const MARKERS = {
  entries: [{ id: "door", col: 1, row: 1 }],
  exits: [{ id: "gate", col: 2, row: 2 }],
  monsterSpawns: [],
};
// in payloadFor(...): markers: MARKERS,
// in the save test's `edited` object: markers: MARKERS,
```

The existing save assertion `body: JSON.stringify(edited)` now proves markers reach the PUT body.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/editor-state.test.ts`
Expected: FAIL — `blankMap(...).markers` is `undefined`; the `EditorMap` literal with `markers` fails typecheck at test build.

- [ ] **Step 3: Implement**

`src/client/api.ts` — add to imports `import type { MapMarkers } from "../shared/map-data.js";` and extend:

```ts
export interface MapPayload {
  id: string;
  name: string;
  blocks: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
}
```

(`MapSaveInput = Omit<MapPayload, "id">` is unchanged and now carries markers.)

`src/client/game/editor-state.ts` — add `EMPTY_MARKERS, type MapMarkers` to the `shared/map-data.js` import and:

```ts
export interface EditorMap {
  name: string;
  blocks: string[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
}
```

In `blankMap`, add `markers: EMPTY_MARKERS` to the returned literal. In `toMapData`:

```ts
function toMapData(map: EditorMap): MapData {
  return { blocks: map.blocks, elements: map.elements, spawn: map.spawn, markers: map.markers };
}
```

`src/client/ui/MapEditor.tsx` — `toEditorMap` forwards defensively (add `EMPTY_MARKERS` to its `shared/map-data.js` import):

```ts
function toEditorMap(map: MapPayload): EditorMap {
  return { name: map.name, blocks: map.blocks, elements: map.elements, spawn: map.spawn, markers: map.markers ?? EMPTY_MARKERS };
}
```

All `applyTool` cases build results by spreading `map`, so markers ride along; the stage's `setName` spread does too. The stage's internal `bakeCollision({ blocks, elements, spawn })` literal needs no change — markers never affect collision.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/editor-state.test.ts` then `npm run test:ui -- test/ui/map-editor.test.tsx`
Expected: PASS (all pre-existing tests too — fixtures updated, field threaded).

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/client/api.ts src/client/game/editor-state.ts src/client/ui/MapEditor.tsx test/editor-state.test.ts test/ui/map-editor.test.tsx
git commit -m "feat round trip map markers through the editor save path"
```

---

### Task 2: Refuse marker mutations a stored adventure graph still binds

Policy (decided): like map deletion, mutation under reference is **refused, predictably**. `updateMap` rejects a payload that removes an entry/exit id still used by any referencing adventure's graph — where "used" for map `M` means: the graph's start entry on `M`, a link's exit on `M`, or a link destination entry on `M`. Adding markers is always allowed. Renaming = remove + add, so it is refused while bound.

**Files:**
- Modify: `src/server/maps.ts` (`updateMap` + imports)
- Test: `test/adventures.test.ts` (append)

**Interfaces:**
- Consumes: `adventure`, `adventureMap` tables (`./db/index.js`), `parseAdventureGraph` (`../shared/adventure.js`), the validated result of `validateMapInput` (local `data`, whose `.markers` is always set).
- Produces: `updateMap` throws `"referenced: ..."` → existing wire `map_referenced` (409) via `mapErrorResponse` — no index.ts/i18n change.

- [ ] **Step 1: Write the failing test** — append to `test/adventures.test.ts` (add `updateMap` to the `../src/server/maps.js` import):

```ts
describe("marker reference guard", () => {
  it("refuses removing bound markers from a referenced map, allows additions", async () => {
    const db = createDb(env.DB);
    await seedAccount("owner");
    const mapA = await createMap(db, mapInput("A"));
    const mapB = await createMap(db, mapInput("B"));
    const created = await createAdventure(db, "owner", inputFor([mapA.id, mapB.id]));

    // removing A's bound exit "gate" → refused
    await expect(
      updateMap(db, mapA.id, { ...mapInput("A"), markers: { entries: [{ id: "door", col: 5, row: 5 }], exits: [], monsterSpawns: [] } }),
    ).rejects.toThrow(/^referenced:/);

    // removing B's entry "door" (destination of A's gate) → refused
    await expect(
      updateMap(db, mapB.id, { ...mapInput("B"), markers: { entries: [], exits: [{ id: "gate", col: 7, row: 7 }], monsterSpawns: [] } }),
    ).rejects.toThrow(/^referenced:/);

    // adding a marker while keeping the bound ones → allowed
    const grown = await updateMap(db, mapA.id, {
      ...mapInput("A"),
      markers: {
        entries: [{ id: "door", col: 5, row: 5 }, { id: "side", col: 3, row: 3 }],
        exits: [{ id: "gate", col: 7, row: 7 }],
        monsterSpawns: [],
      },
    });
    expect(grown.markers?.entries).toHaveLength(2);

    // once the adventure is gone, removal is free
    await deleteAdventure(db, "owner", created.id);
    const bare = await updateMap(db, mapA.id, { ...mapInput("A"), markers: { entries: [], exits: [], monsterSpawns: [] } });
    expect(bare.markers).toEqual({ entries: [], exits: [], monsterSpawns: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/adventures.test.ts`
Expected: FAIL — the removal updates succeed instead of rejecting.

- [ ] **Step 3: Implement the guard** — in `src/server/maps.ts`:

Add imports: `adventure` beside the existing `adventureMap` import from `./db/index.js`, and `import { type AdventureGraph, parseAdventureGraph } from "../shared/adventure.js";`.

In `updateMap`, insert this right after the existence check (`if (!existing) throw new Error("not_found: no such map");`, ~line 282) and before the `updateRow` builder — it only reads, and rejecting before building the write avoids wasted work. It uses the validated `const data = validateMapInput(input)` already in scope:

```ts
  const references = await db
    .select({ title: adventure.title, graph: adventure.graph })
    .from(adventureMap)
    .innerJoin(adventure, eq(adventureMap.adventureId, adventure.id))
    .where(eq(adventureMap.mapId, id));
  if (references.length > 0) {
    const markers = data.markers ?? EMPTY_MARKERS;
    const entryIds = new Set(markers.entries.map((marker) => marker.id));
    const exitIds = new Set(markers.exits.map((marker) => marker.id));
    for (const row of references) {
      let graph: AdventureGraph | null = null;
      try {
        graph = parseAdventureGraph(JSON.parse(row.graph));
      } catch {
        graph = null;
      }
      if (!graph) continue;
      if (graph.start.mapId === id && !entryIds.has(graph.start.entryId)) {
        throw new Error(`referenced: adventure "${row.title}" starts at entry ${graph.start.entryId}`);
      }
      for (const link of graph.links) {
        if (link.mapId === id && !exitIds.has(link.exitId)) {
          throw new Error(`referenced: adventure "${row.title}" binds exit ${link.exitId}`);
        }
        if (link.dest !== "end" && link.dest.mapId === id && !entryIds.has(link.dest.entryId)) {
          throw new Error(`referenced: adventure "${row.title}" arrives at entry ${link.dest.entryId}`);
        }
      }
    }
  }
```

(`EMPTY_MARKERS` and `eq` are already imported in `maps.ts`.) A corrupt stored graph is skipped — the guard protects live graphs, and corrupt ones already degrade elsewhere.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/adventures.test.ts` — also `npm test -- test/maps.test.ts test/map-markers.test.ts test/maps-api.test.ts` (unreferenced-map updates must stay free).
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/server/maps.ts test/adventures.test.ts
git commit -m "feat refuse removing markers a stored adventure graph binds"
```

---

### Task 3: Marker tools in editor-state (pure rules)

Three new tools plus eraser/paint integration. Marker rules mirror the server: markers live on walkable ground of the full bake; an exit never shares a cell with the spawn or an entry. Because markers are load-bearing (graphs bind them), a paint or placement that would invalidate one is **refused** (`null`), unlike decorative elements which are dropped.

**Files:**
- Modify: `src/client/game/editor-state.ts`
- Test: `test/editor-state.test.ts` (append)

**Interfaces:**
- Consumes: `EditorMap.markers` (Task 1); shared `MAX_MAP_ENTRIES`, `MAX_MAP_EXITS`, `MAX_MAP_MONSTER_SPAWNS`, `MIN_PATROL_RADIUS`, `MAX_PATROL_RADIUS`; `MonsterSpecies` from `shared/game.js`.
- Produces (Task 4 depends on these):

```ts
export type EditorTool = /* existing */ 
  | { kind: "marker-entry" }
  | { kind: "marker-exit" }
  | { kind: "marker-monster"; species: MonsterSpecies; patrolRadius: number };
export function mintMarkerId(prefix: "entry" | "exit", taken: readonly string[]): string;
```

- [ ] **Step 1: Write the failing tests** — append to `test/editor-state.test.ts` (import `mintMarkerId` too; add `MAX_MAP_ENTRIES` to the shared import):

```ts
describe("applyTool: markers", () => {
  const base = blankMap("m", 20, 15);

  it("places entries and exits with minted unique ids", () => {
    const one = applyTool(base, { kind: "marker-entry" }, 2, 2);
    expect(one?.markers.entries).toEqual([{ id: "entry-1", col: 2, row: 2 }]);
    const two = applyTool(one as EditorMap, { kind: "marker-entry" }, 3, 3);
    expect(two?.markers.entries.map((e) => e.id)).toEqual(["entry-1", "entry-2"]);
    const exit = applyTool(two as EditorMap, { kind: "marker-exit" }, 5, 5);
    expect(exit?.markers.exits).toEqual([{ id: "exit-1", col: 5, row: 5 }]);
  });

  it("mints the smallest free suffix", () => {
    expect(mintMarkerId("entry", ["entry-1", "entry-3"])).toBe("entry-2");
    expect(mintMarkerId("exit", [])).toBe("exit-1");
  });

  it("refuses markers on water, exits on spawn or entry cells, and duplicates on one cell", () => {
    const wet = applyTool(base, { kind: "block", block: "water" }, 2, 2);
    expect(applyTool(wet as EditorMap, { kind: "marker-entry" }, 2, 2)).toBeNull();
    expect(applyTool(base, { kind: "marker-exit" }, base.spawn.col, base.spawn.row)).toBeNull();
    const entry = applyTool(base, { kind: "marker-entry" }, 4, 4) as EditorMap;
    expect(applyTool(entry, { kind: "marker-exit" }, 4, 4)).toBeNull();
    expect(applyTool(entry, { kind: "marker-entry" }, 4, 4)).toBeNull();
  });

  it("enforces the entry cap", () => {
    let map: EditorMap = base;
    for (let i = 0; i < MAX_MAP_ENTRIES; i += 1) {
      map = applyTool(map, { kind: "marker-entry" }, i + 1, 1) as EditorMap;
    }
    expect(applyTool(map, { kind: "marker-entry" }, 1, 5)).toBeNull();
  });

  it("places monster spawns, replaces on the same cell, validates the radius", () => {
    const placed = applyTool(base, { kind: "marker-monster", species: "spear_goblin", patrolRadius: 96 }, 6, 6);
    expect(placed?.markers.monsterSpawns).toEqual([{ col: 6, row: 6, species: "spear_goblin", patrolRadius: 96 }]);
    const replaced = applyTool(placed as EditorMap, { kind: "marker-monster", species: "mire_troll", patrolRadius: 128 }, 6, 6);
    expect(replaced?.markers.monsterSpawns).toEqual([{ col: 6, row: 6, species: "mire_troll", patrolRadius: 128 }]);
    expect(applyTool(base, { kind: "marker-monster", species: "spear_goblin", patrolRadius: 8 }, 6, 6)).toBeNull();
  });

  it("eraser removes markers, spawn and paint refuse to invalidate them", () => {
    const entry = applyTool(base, { kind: "marker-entry" }, 4, 4) as EditorMap;
    const erased = applyTool(entry, { kind: "eraser" }, 4, 4);
    expect(erased?.markers.entries).toEqual([]);
    expect(applyTool(entry, { kind: "eraser" }, 9, 9)).toBe(entry); // no-op keeps the same reference
    expect(applyTool(entry, { kind: "block", block: "water" }, 4, 4)).toBeNull(); // would drown the entry
    const exit = applyTool(base, { kind: "marker-exit" }, 7, 7) as EditorMap;
    expect(applyTool(exit, { kind: "spawn" }, 7, 7)).toBeNull(); // spawn may not land on an exit
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/editor-state.test.ts`
Expected: FAIL — `mintMarkerId` not exported; marker tool kinds hit the `default: throw` branch.

- [ ] **Step 3: Implement** — in `src/client/game/editor-state.ts`:

Add to imports: `MAX_MAP_ENTRIES, MAX_MAP_EXITS, MAX_MAP_MONSTER_SPAWNS, MIN_PATROL_RADIUS, MAX_PATROL_RADIUS` from `../../shared/map-data.js`; `import type { MonsterSpecies } from "../../shared/game.js";`.

Extend `EditorTool` with the three variants from the Interfaces block. Add:

```ts
export function mintMarkerId(prefix: "entry" | "exit", taken: readonly string[]): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${prefix}-${n}`)) n += 1;
  return `${prefix}-${n}`;
}

function cellTaken(list: readonly { col: number; row: number }[], col: number, row: number): boolean {
  return list.some((item) => item.col === col && item.row === row);
}

/**
 * Markers are load-bearing (adventure graphs bind their ids), so unlike decorative elements they
 * are never silently dropped: any result that would leave a marker on solid ground, or an exit on
 * the spawn or an entry cell, is refused outright. Mirrors the server's validateMapInput rules.
 */
function keepsMarkersValid(map: EditorMap): boolean {
  const tiles = bakeCollision(toMapData(map));
  const markers = map.markers;
  const all = [...markers.entries, ...markers.exits, ...markers.monsterSpawns];
  if (all.some((marker) => isSolidKind(kindAt(tiles, marker.col, marker.row)))) return false;
  const blocked = new Set(markers.entries.map((entry) => `${entry.col},${entry.row}`));
  blocked.add(`${map.spawn.col},${map.spawn.row}`);
  return markers.exits.every((exit) => !blocked.has(`${exit.col},${exit.row}`));
}
```

New `applyTool` cases (before `default`):

```ts
    case "marker-entry": {
      const markers = map.markers;
      if (cellTaken(markers.entries, col, row)) return null;
      if (markers.entries.length >= MAX_MAP_ENTRIES) return null;
      const entry = { id: mintMarkerId("entry", markers.entries.map((m) => m.id)), col, row };
      const next = { ...map, markers: { ...markers, entries: [...markers.entries, entry] } };
      return keepsMarkersValid(next) ? next : null;
    }
    case "marker-exit": {
      const markers = map.markers;
      if (cellTaken(markers.exits, col, row)) return null;
      if (markers.exits.length >= MAX_MAP_EXITS) return null;
      const exit = { id: mintMarkerId("exit", markers.exits.map((m) => m.id)), col, row };
      const next = { ...map, markers: { ...markers, exits: [...markers.exits, exit] } };
      return keepsMarkersValid(next) ? next : null;
    }
    case "marker-monster": {
      if (
        !Number.isSafeInteger(tool.patrolRadius) ||
        tool.patrolRadius < MIN_PATROL_RADIUS ||
        tool.patrolRadius > MAX_PATROL_RADIUS
      ) {
        return null;
      }
      const markers = map.markers;
      const retained = markers.monsterSpawns.filter((s) => s.col !== col || s.row !== row);
      if (retained.length >= MAX_MAP_MONSTER_SPAWNS) return null;
      const spawn = { col, row, species: tool.species, patrolRadius: tool.patrolRadius };
      const next = { ...map, markers: { ...markers, monsterSpawns: [...retained, spawn] } };
      return keepsMarkersValid(next) ? next : null;
    }
```

Rework the `eraser` case to remove markers too, preserving the same-reference no-op signal:

```ts
    case "eraser": {
      const elements = withoutElementAt(map.elements, col, row);
      const markers = map.markers;
      const entries = markers.entries.filter((m) => m.col !== col || m.row !== row);
      const exits = markers.exits.filter((m) => m.col !== col || m.row !== row);
      const monsterSpawns = markers.monsterSpawns.filter((m) => m.col !== col || m.row !== row);
      const untouched =
        elements.length === map.elements.length &&
        entries.length === markers.entries.length &&
        exits.length === markers.exits.length &&
        monsterSpawns.length === markers.monsterSpawns.length;
      return untouched ? map : { ...map, elements, markers: { entries, exits, monsterSpawns } };
    }
```

Gate the existing cases: in `block` and `element`, change the final return to `return keepsSpawnClear(next) && keepsMarkersValid(next) ? next : null;`. In `spawn`, change `return { ...map, spawn: { col, row } };` to:

```ts
      const next = { ...map, spawn: { col, row } };
      return keepsMarkersValid(next) ? next : null;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/editor-state.test.ts`
Expected: PASS, including all pre-existing describe blocks.

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/client/game/editor-state.ts test/editor-state.test.ts
git commit -m "feat add entry exit and monster spawn tools to the editor rules"
```

---

### Task 4: Marker rendering on the stage and palette controls

Editor-only overlays: colored diamonds in the existing `markerLayer` (green entry, violet exit, red monster + patrol ring), drawn exactly like `drawSpawnMarker`. Palette gains three tool buttons; the monster tool gets species/radius controls.

**Files:**
- Modify: `src/client/game/map-editor-stage.ts`
- Modify: `src/client/ui/MapEditor.tsx`
- Modify: `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts`
- Test: `test/ui/map-editor.test.tsx` (append)

**Interfaces:**
- Consumes: Task 3's `EditorTool` variants and shared radius bounds; `MONSTER_SPECIES_KIND` (`shared/game.js`); existing `monster.<species>` i18n keys.
- Produces: `TOOL_KEYS = ["grass", "water", "eraser", "spawn", "entry", "exit", "monster", "pan"]`; i18n keys `editor.tool.entry`, `editor.tool.exit`, `editor.tool.monster`, `editor.markers.species`, `editor.markers.radius`.

- [ ] **Step 1: Write the failing UI tests** — append to `test/ui/map-editor.test.tsx`:

```tsx
it("selects marker tools and forwards monster species and radius to the stage", async () => {
  vi.stubGlobal("fetch", fetchMock());
  render(<MapEditor />);
  await openFirstMap();

  await userEvent.click(screen.getByRole("button", { name: "Entry" }));
  expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "marker-entry" });

  await userEvent.click(screen.getByRole("button", { name: "Exit" }));
  expect(stageMock.setTool).toHaveBeenLastCalledWith({ kind: "marker-exit" });

  await userEvent.click(screen.getByRole("button", { name: "Monster" }));
  expect(stageMock.setTool).toHaveBeenLastCalledWith({
    kind: "marker-monster",
    species: "spear_goblin",
    patrolRadius: 96,
  });

  await userEvent.selectOptions(screen.getByLabelText("Species"), "mire_troll");
  expect(stageMock.setTool).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: "marker-monster", species: "mire_troll" }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:ui -- test/ui/map-editor.test.tsx`
Expected: FAIL — no "Entry" button.

- [ ] **Step 3: Implement**

**`src/client/game/map-editor-stage.ts`** — beside `SPAWN_MARKER_COLOR`:

```ts
const ENTRY_MARKER_COLOR = 0x6fd44c;
const EXIT_MARKER_COLOR = 0x9a6cf0;
const MONSTER_MARKER_COLOR = 0xd9484a;
```

Refactor `drawSpawnMarker` into a shared diamond helper and add `drawMarkers`, both writing to `markerLayer` (same Graphics idiom as today):

```ts
  function drawDiamond(col: number, row: number, color: number): void {
    const cx = col * TILE_SIZE + TILE_SIZE / 2;
    const cy = row * TILE_SIZE + TILE_SIZE / 2;
    const marker = new Graphics();
    marker
      .moveTo(cx, cy - 22)
      .lineTo(cx + 17, cy)
      .lineTo(cx, cy + 22)
      .lineTo(cx - 17, cy)
      .closePath()
      .fill({ color, alpha: 0.85 })
      .stroke({ width: 3, color: SPAWN_MARKER_OUTLINE, alpha: 0.9 });
    markerLayer.addChild(marker);
  }

  function drawSpawnMarker(): void {
    drawDiamond(map.spawn.col, map.spawn.row, SPAWN_MARKER_COLOR);
  }

  /** Editor-only overlays: adventure graphs bind these cells, so they must be visible while editing. */
  function drawMarkers(): void {
    for (const entry of map.markers.entries) drawDiamond(entry.col, entry.row, ENTRY_MARKER_COLOR);
    for (const exit of map.markers.exits) drawDiamond(exit.col, exit.row, EXIT_MARKER_COLOR);
    for (const spawn of map.markers.monsterSpawns) {
      drawDiamond(spawn.col, spawn.row, MONSTER_MARKER_COLOR);
      const ring = new Graphics();
      ring
        .circle(spawn.col * TILE_SIZE + TILE_SIZE / 2, spawn.row * TILE_SIZE + TILE_SIZE / 2, spawn.patrolRadius)
        .stroke({ width: 2, color: MONSTER_MARKER_COLOR, alpha: 0.35 });
      markerLayer.addChild(ring);
    }
  }
```

Call `drawMarkers();` immediately after `drawSpawnMarker();` in `redraw()`.

**`src/client/ui/MapEditor.tsx`** — extend the palette (imports: `MONSTER_SPECIES_KIND, type MonsterSpecies` from `../../shared/game.js`; `MIN_PATROL_RADIUS, MAX_PATROL_RADIUS` from `../../shared/map-data.js`):

```ts
const TOOL_KEYS = ["grass", "water", "eraser", "spawn", "entry", "exit", "monster", "pan"] as const;
```

In `MapEditorStage`, add state and rework `toolFor` into a closure over it:

```tsx
const [species, setSpecies] = useState<MonsterSpecies>("spear_goblin");
const [radius, setRadius] = useState(96);

function toolFor(key: ToolKey): EditorTool {
  switch (key) {
    case "grass": return { kind: "block", block: "grass" };
    case "water": return { kind: "block", block: "water" };
    case "eraser": return { kind: "eraser" };
    case "spawn": return { kind: "spawn" };
    case "entry": return { kind: "marker-entry" };
    case "exit": return { kind: "marker-exit" };
    case "monster": return { kind: "marker-monster", species, patrolRadius: radius };
    case "pan": return { kind: "pan" };
  }
}
```

Re-push the tool when the monster parameters change while the monster tool is active:

```tsx
useEffect(() => {
  if (toolKey === "monster") {
    handleRef.current?.setTool({ kind: "marker-monster", species, patrolRadius: radius });
  }
}, [species, radius, toolKey]);
```

Below the tool buttons, monster controls (shown only for the monster tool):

```tsx
{toolKey === "monster" && (
  <div className="map-editor-toolbar__monster">
    <Label htmlFor="editor-species">{t("editor.markers.species")}</Label>
    <select
      id="editor-species"
      value={species}
      onChange={(event) => setSpecies(event.currentTarget.value as MonsterSpecies)}
    >
      {(Object.keys(MONSTER_SPECIES_KIND) as MonsterSpecies[]).map((option) => (
        <option key={option} value={option}>
          {t(`monster.${option}`)}
        </option>
      ))}
    </select>
    <Label htmlFor="editor-radius">{t("editor.markers.radius")}</Label>
    <Input
      id="editor-radius"
      type="number"
      min={MIN_PATROL_RADIUS}
      max={MAX_PATROL_RADIUS}
      value={radius}
      onChange={(event) => setRadius(Number(event.currentTarget.value))}
    />
  </div>
)}
```

**i18n** — `src/shared/i18n/en.ts` (beside the other `editor.tool.*` keys):

```ts
  "editor.tool.entry": "Entry",
  "editor.tool.exit": "Exit",
  "editor.tool.monster": "Monster",
  "editor.markers.species": "Species",
  "editor.markers.radius": "Patrol radius",
```

`src/shared/i18n/fr.ts`:

```ts
  "editor.tool.entry": "Entrée",
  "editor.tool.exit": "Sortie",
  "editor.tool.monster": "Monstre",
  "editor.markers.species": "Espèce",
  "editor.markers.radius": "Rayon de patrouille",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:ui -- test/ui/map-editor.test.tsx`
Expected: PASS (all existing tests too — the added TOOL_KEYS keep old keys and order for prior assertions).

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/client/game/map-editor-stage.ts src/client/ui/MapEditor.tsx src/shared/i18n/en.ts src/shared/i18n/fr.ts test/ui/map-editor.test.tsx
git commit -m "feat render map markers and add marker palette tools"
```

---

### Task 5: Adventure client API and the pure draft module

`adventure-draft.ts` mirrors `editor-state.ts`: pure functions over an immutable draft, `null` = refused. The screen (Task 6) stays thin. The draft tracks members (with their marker ids), the start anchor, and one binding row per member exit; completeness gates the Save button client-side while the server remains the authority.

**Files:**
- Modify: `src/client/api.ts`
- Create: `src/client/adventure-draft.ts`
- Test: `test/adventure-draft.test.ts` (new)

**Interfaces:**
- Consumes: `AdventureGraph`, `AdventureInput`, `ExitDestination`, `ADVENTURE_TITLE_MAX`, `MAX_ADVENTURE_MAPS` from `shared/adventure.js`.
- Produces (Task 6 depends on all of these):

```ts
// api.ts
export interface AdventureSummary { id: string; title: string; maxPlayers: number }
export interface AdventurePayload {
  id: string; accountId: string; title: string; maxPlayers: number; version: number;
  mapIds: string[]; graph: AdventureGraph;
}
export const fetchAdventures: () => Promise<AdventureSummary[]>;
export const fetchAdventure: (id: string) => Promise<AdventurePayload>;
export const createAdventureApi: (input: AdventureInput) => Promise<AdventurePayload>;
export const updateAdventureApi: (id: string, input: AdventureInput) => Promise<AdventurePayload>;
export const deleteAdventureApi: (id: string) => Promise<void>;
// adventure-draft.ts
export interface DraftMemberInfo { mapId: string; name: string; entryIds: readonly string[]; exitIds: readonly string[] }
export interface DraftBinding { mapId: string; exitId: string; dest: ExitDestination | null }
export interface AdventureDraft {
  title: string; maxPlayers: number; members: DraftMemberInfo[];
  start: { mapId: string; entryId: string } | null; bindings: DraftBinding[];
}
export function emptyDraft(): AdventureDraft;
export function addMember(draft: AdventureDraft, info: DraftMemberInfo): AdventureDraft | null;
export function removeMember(draft: AdventureDraft, mapId: string): AdventureDraft;
export function setStart(draft: AdventureDraft, mapId: string, entryId: string): AdventureDraft | null;
export function bindExit(draft: AdventureDraft, mapId: string, exitId: string, dest: ExitDestination | null): AdventureDraft | null;
export function draftComplete(draft: AdventureDraft): boolean;
export function toAdventureInput(draft: AdventureDraft): AdventureInput | null;
export function draftFromAdventure(
  payload: { title: string; maxPlayers: number; mapIds: readonly string[]; graph: AdventureGraph },
  infos: ReadonlyMap<string, DraftMemberInfo>,
): AdventureDraft;
```

- [ ] **Step 1: Write the failing tests** — create `test/adventure-draft.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  addMember,
  type AdventureDraft,
  bindExit,
  draftComplete,
  draftFromAdventure,
  type DraftMemberInfo,
  emptyDraft,
  removeMember,
  setStart,
  toAdventureInput,
} from "../src/client/adventure-draft.js";

const A: DraftMemberInfo = { mapId: "map-a", name: "A", entryIds: ["door"], exitIds: ["east"] };
const B: DraftMemberInfo = { mapId: "map-b", name: "B", entryIds: ["west"], exitIds: ["boss"] };

function fullDraft(): AdventureDraft {
  let draft = emptyDraft();
  draft = { ...draft, title: "Donjon", maxPlayers: 2 };
  draft = addMember(draft, A) as AdventureDraft;
  draft = addMember(draft, B) as AdventureDraft;
  draft = setStart(draft, "map-a", "door") as AdventureDraft;
  draft = bindExit(draft, "map-a", "east", { mapId: "map-b", entryId: "west" }) as AdventureDraft;
  draft = bindExit(draft, "map-b", "boss", "end") as AdventureDraft;
  return draft;
}

describe("adventure draft", () => {
  it("adding a member creates one unbound binding row per exit", () => {
    const draft = addMember(emptyDraft(), A);
    expect(draft?.bindings).toEqual([{ mapId: "map-a", exitId: "east", dest: null }]);
    expect(addMember(draft as AdventureDraft, A)).toBeNull(); // duplicate refused
  });

  it("completes only when start, every binding and one end are set", () => {
    const draft = fullDraft();
    expect(draftComplete(draft)).toBe(true);
    expect(draftComplete({ ...draft, start: null })).toBe(false);
    expect(draftComplete({ ...draft, title: "  " })).toBe(false);
    const unbound = bindExit(draft, "map-a", "east", null) as AdventureDraft;
    expect(draftComplete(unbound)).toBe(false);
    const endless = bindExit(draft, "map-b", "boss", { mapId: "map-a", entryId: "door" }) as AdventureDraft;
    expect(draftComplete(endless)).toBe(false); // no end left
  });

  it("produces the exact AdventureInput wire shape", () => {
    expect(toAdventureInput(fullDraft())).toEqual({
      title: "Donjon",
      maxPlayers: 2,
      mapIds: ["map-a", "map-b"],
      graph: {
        start: { mapId: "map-a", entryId: "door" },
        links: [
          { mapId: "map-a", exitId: "east", dest: { mapId: "map-b", entryId: "west" } },
          { mapId: "map-b", exitId: "boss", dest: "end" },
        ],
      },
    });
    expect(toAdventureInput(emptyDraft())).toBeNull();
  });

  it("removing a member clears its bindings, dangling destinations and the start", () => {
    const removed = removeMember(fullDraft(), "map-b");
    expect(removed.members.map((m) => m.mapId)).toEqual(["map-a"]);
    expect(removed.bindings).toEqual([{ mapId: "map-a", exitId: "east", dest: null }]);
    const noStart = removeMember(fullDraft(), "map-a");
    expect(noStart.start).toBeNull();
  });

  it("refuses starts and destinations that name unknown maps or entries", () => {
    const draft = fullDraft();
    expect(setStart(draft, "map-c", "door")).toBeNull();
    expect(setStart(draft, "map-a", "ghost")).toBeNull();
    expect(bindExit(draft, "map-a", "east", { mapId: "map-b", entryId: "ghost" })).toBeNull();
    expect(bindExit(draft, "map-a", "ghost", "end")).toBeNull();
  });

  it("rebuilds a draft from a stored adventure", () => {
    const stored = toAdventureInput(fullDraft());
    if (!stored) throw new Error("expected a complete draft");
    const infos = new Map([["map-a", A], ["map-b", B]]);
    const rebuilt = draftFromAdventure({ ...stored, mapIds: [...stored.mapIds] }, infos);
    expect(rebuilt).toEqual(fullDraft());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/adventure-draft.test.ts`
Expected: FAIL — module `src/client/adventure-draft.ts` does not exist.

- [ ] **Step 3: Implement**

**`src/client/api.ts`** — add `import type { AdventureGraph, AdventureInput } from "../shared/adventure.js";` and, beside the map wrappers:

```ts
export interface AdventureSummary {
  id: string;
  title: string;
  maxPlayers: number;
}

export interface AdventurePayload {
  id: string;
  accountId: string;
  title: string;
  maxPlayers: number;
  version: number;
  mapIds: string[];
  graph: AdventureGraph;
}

export const fetchAdventures = () => api<AdventureSummary[]>("/api/adventures");
export const fetchAdventure = (id: string) => api<AdventurePayload>(`/api/adventures/${id}`);
export const createAdventureApi = (input: AdventureInput) =>
  api<AdventurePayload>("/api/adventures", { method: "POST", body: JSON.stringify(input) });
export const updateAdventureApi = (id: string, input: AdventureInput) =>
  api<AdventurePayload>(`/api/adventures/${id}`, { method: "PUT", body: JSON.stringify(input) });
export const deleteAdventureApi = (id: string) =>
  api<void>(`/api/adventures/${id}`, { method: "DELETE" });
```

**`src/client/adventure-draft.ts`** (new file):

```ts
/**
 * A client-side adventure under construction, as pure rules — the AdventureEditor screen's
 * counterpart to editor-state.ts. A draft may be incomplete (unbound exits, no start); the server
 * only ever sees a complete AdventureInput, and remains the validation authority. Convention
 * follows applyTool: a returned null means "refused", an unchanged input is never mutated.
 */
import {
  ADVENTURE_TITLE_MAX,
  type AdventureGraph,
  type AdventureInput,
  type ExitDestination,
  MAX_ADVENTURE_MAPS,
} from "../shared/adventure.js";

export interface DraftMemberInfo {
  mapId: string;
  name: string;
  entryIds: readonly string[];
  exitIds: readonly string[];
}

export interface DraftBinding {
  mapId: string;
  exitId: string;
  dest: ExitDestination | null;
}

export interface AdventureDraft {
  title: string;
  maxPlayers: number;
  members: DraftMemberInfo[];
  start: { mapId: string; entryId: string } | null;
  bindings: DraftBinding[];
}

export function emptyDraft(): AdventureDraft {
  return { title: "", maxPlayers: 4, members: [], start: null, bindings: [] };
}

export function addMember(draft: AdventureDraft, info: DraftMemberInfo): AdventureDraft | null {
  if (draft.members.length >= MAX_ADVENTURE_MAPS) return null;
  if (draft.members.some((member) => member.mapId === info.mapId)) return null;
  const added: DraftBinding[] = info.exitIds.map((exitId) => ({ mapId: info.mapId, exitId, dest: null }));
  return { ...draft, members: [...draft.members, info], bindings: [...draft.bindings, ...added] };
}

export function removeMember(draft: AdventureDraft, mapId: string): AdventureDraft {
  const members = draft.members.filter((member) => member.mapId !== mapId);
  const bindings = draft.bindings
    .filter((binding) => binding.mapId !== mapId)
    .map((binding) =>
      binding.dest !== null && binding.dest !== "end" && binding.dest.mapId === mapId
        ? { ...binding, dest: null }
        : binding,
    );
  const start = draft.start?.mapId === mapId ? null : draft.start;
  return { ...draft, members, bindings, start };
}

function entryExists(draft: AdventureDraft, mapId: string, entryId: string): boolean {
  const member = draft.members.find((candidate) => candidate.mapId === mapId);
  return member !== undefined && member.entryIds.includes(entryId);
}

export function setStart(draft: AdventureDraft, mapId: string, entryId: string): AdventureDraft | null {
  if (!entryExists(draft, mapId, entryId)) return null;
  return { ...draft, start: { mapId, entryId } };
}

export function bindExit(
  draft: AdventureDraft,
  mapId: string,
  exitId: string,
  dest: ExitDestination | null,
): AdventureDraft | null {
  if (!draft.bindings.some((binding) => binding.mapId === mapId && binding.exitId === exitId)) return null;
  if (dest !== null && dest !== "end" && !entryExists(draft, dest.mapId, dest.entryId)) return null;
  const bindings = draft.bindings.map((binding) =>
    binding.mapId === mapId && binding.exitId === exitId ? { ...binding, dest } : binding,
  );
  return { ...draft, bindings };
}

export function draftComplete(draft: AdventureDraft): boolean {
  const title = draft.title.trim();
  return (
    title.length >= 1 &&
    title.length <= ADVENTURE_TITLE_MAX &&
    Number.isSafeInteger(draft.maxPlayers) &&
    draft.maxPlayers >= 1 &&
    draft.maxPlayers <= 4 &&
    draft.members.length >= 1 &&
    draft.start !== null &&
    draft.bindings.every((binding) => binding.dest !== null) &&
    draft.bindings.some((binding) => binding.dest === "end")
  );
}

export function toAdventureInput(draft: AdventureDraft): AdventureInput | null {
  if (!draftComplete(draft) || draft.start === null) return null;
  const links = draft.bindings.flatMap((binding) =>
    binding.dest === null ? [] : [{ mapId: binding.mapId, exitId: binding.exitId, dest: binding.dest }],
  );
  return {
    title: draft.title.trim(),
    maxPlayers: draft.maxPlayers,
    mapIds: draft.members.map((member) => member.mapId),
    graph: { start: draft.start, links },
  };
}

export function draftFromAdventure(
  payload: { title: string; maxPlayers: number; mapIds: readonly string[]; graph: AdventureGraph },
  infos: ReadonlyMap<string, DraftMemberInfo>,
): AdventureDraft {
  const members = payload.mapIds.flatMap((mapId) => {
    const info = infos.get(mapId);
    return info ? [info] : [];
  });
  const links = new Map(
    payload.graph.links.map((link) => [`${link.mapId} ${link.exitId}`, link.dest] as const),
  );
  const bindings = members.flatMap((member) =>
    member.exitIds.map((exitId) => ({
      mapId: member.mapId,
      exitId,
      dest: links.get(`${member.mapId} ${exitId}`) ?? null,
    })),
  );
  return {
    title: payload.title,
    maxPlayers: payload.maxPlayers,
    members,
    start: payload.graph.start,
    bindings,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/adventure-draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/client/api.ts src/client/adventure-draft.ts test/adventure-draft.test.ts
git commit -m "feat add adventure api client and pure draft rules"
```

---

### Task 6: AdventureEditor screen and navigation

List + form screen following `MapEditor.tsx`'s structure exactly (roster cards, delete-confirm alertdialog, `errorCode`/`isSessionError` handling). Creation and editing share the form; Save is disabled until the draft is complete; the server revalidates.

**Files:**
- Modify: `src/client/store.ts` (screen union), `src/client/ui/App.tsx` (branch), `src/client/ui/CharacterSelect.tsx` (nav button)
- Create: `src/client/ui/AdventureEditor.tsx`
- Modify: `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts`
- Test: `test/ui/adventure-editor.test.tsx` (new)

**Interfaces:**
- Consumes: everything Task 5 produces; `fetchMaps`, `fetchMap`, `MapSummary` from `api.ts`; existing keys `editor.back`, `editor.save`, `editor.delete`, `editor.delete.cancel`, `editor.delete.confirm`.
- Produces: screen literal `"adventures"`; i18n keys listed in Step 3.

- [ ] **Step 1: Write the failing UI tests** — create `test/ui/adventure-editor.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { AdventureEditor } from "../../src/client/ui/AdventureEditor.js";

const MAP_A = {
  id: "m1",
  name: "Verdant",
  blocks: ["...."],
  elements: [],
  spawn: { col: 0, row: 0 },
  markers: { entries: [{ id: "door", col: 1, row: 1 }], exits: [{ id: "east", col: 2, row: 2 }], monsterSpawns: [] },
};
const MAP_B = {
  id: "m2",
  name: "Frostfen",
  blocks: ["...."],
  elements: [],
  spawn: { col: 0, row: 0 },
  markers: { entries: [{ id: "west", col: 1, row: 1 }], exits: [{ id: "boss", col: 2, row: 2 }], monsterSpawns: [] },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchMock(): ReturnType<typeof vi.fn> {
  const adventures: Record<string, unknown>[] = [];
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url === "/api/maps" && method === "GET") {
      return jsonResponse([
        { id: "m1", name: "Verdant", isFirst: true },
        { id: "m2", name: "Frostfen", isFirst: false },
      ]);
    }
    if (url === "/api/maps/m1") return jsonResponse(MAP_A);
    if (url === "/api/maps/m2") return jsonResponse(MAP_B);
    if (url === "/api/adventures" && method === "GET") {
      return jsonResponse(adventures.map((a) => ({ id: a.id, title: a.title, maxPlayers: a.maxPlayers })));
    }
    if (url === "/api/adventures" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const stored = { ...body, id: "adv-1", accountId: "acct", version: 1 };
      adventures.push(stored);
      return jsonResponse(stored, 201);
    }
    const one = url.match(/^\/api\/adventures\/([A-Za-z0-9-]+)$/);
    if (one) {
      const found = adventures.find((a) => a.id === one[1]);
      if (!found) return jsonResponse({ error: "adventure_not_found" }, 404);
      if (method === "GET") return jsonResponse(found);
      if (method === "DELETE") {
        adventures.splice(adventures.indexOf(found), 1);
        return jsonResponse(undefined, 204);
      }
    }
    return jsonResponse({ error: "not found" }, 404);
  });
}

describe("AdventureEditor", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ screen: "adventures", characters: null });
  });

  it("builds and saves a complete adventure", async () => {
    const mock = fetchMock();
    vi.stubGlobal("fetch", mock);
    render(<AdventureEditor />);

    await userEvent.click(await screen.findByRole("button", { name: "New adventure" }));
    await userEvent.type(screen.getByLabelText("Title"), "Donjon");

    await userEvent.selectOptions(await screen.findByLabelText("Add a map"), "m1");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText("Verdant");
    await userEvent.selectOptions(screen.getByLabelText("Add a map"), "m2");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText("Frostfen");

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Starting map"), "m1");
    await userEvent.selectOptions(screen.getByLabelText("Entry"), "door");
    await userEvent.selectOptions(screen.getByLabelText("east"), "m2::west");
    await userEvent.selectOptions(screen.getByLabelText("boss"), "end");

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith(
        "/api/adventures",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            title: "Donjon",
            maxPlayers: 4,
            mapIds: ["m1", "m2"],
            graph: {
              start: { mapId: "m1", entryId: "door" },
              links: [
                { mapId: "m1", exitId: "east", dest: { mapId: "m2", entryId: "west" } },
                { mapId: "m2", exitId: "boss", dest: "end" },
              ],
            },
          }),
        }),
      ),
    );
    expect(await screen.findByText("Donjon")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting", async () => {
    const mock = fetchMock();
    vi.stubGlobal("fetch", mock);
    render(<AdventureEditor />);
    // seed one adventure through the same mock backend
    await mock("/api/adventures", {
      method: "POST",
      body: JSON.stringify({ title: "Donjon", maxPlayers: 4, mapIds: ["m1"], graph: { start: { mapId: "m1", entryId: "door" }, links: [] } }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Refresh" }));
    await screen.findByText("Donjon");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Delete Donjon?");
    await userEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(screen.queryByText("Donjon")).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:ui -- test/ui/adventure-editor.test.tsx`
Expected: FAIL — `AdventureEditor.js` does not exist.

- [ ] **Step 3: Implement**

**`src/client/store.ts`** — extend the union:

```ts
  screen: "boot" | "auth" | "characters" | "game" | "map-editor" | "adventures";
```

**`src/client/ui/App.tsx`** — add beside the map-editor branch: `{screen === "adventures" && <AdventureEditor />}` (+ import).

**`src/client/ui/CharacterSelect.tsx`** — beside the map-editor button:

```tsx
<Button type="button" variant="secondary" onClick={() => setScreen("adventures")}>
  {t("chars.adventures")}
</Button>
```

**`src/client/ui/AdventureEditor.tsx`** (new). Full component:

```tsx
import { useEffect, useState } from "react";
import type { ExitDestination } from "../../shared/adventure.js";
import {
  type AdventureSummary,
  authErrorText,
  createAdventureApi,
  deleteAdventureApi,
  errorCode,
  fetchAdventure,
  fetchAdventures,
  fetchMap,
  fetchMaps,
  type MapSummary,
  updateAdventureApi,
} from "../api.js";
import {
  addMember,
  type AdventureDraft,
  bindExit,
  draftComplete,
  draftFromAdventure,
  type DraftMemberInfo,
  emptyDraft,
  removeMember,
  setStart,
  toAdventureInput,
} from "../adventure-draft.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { Button } from "./pixelact-ui/button/index.js";
import { Input } from "./pixelact-ui/input.js";
import { Label } from "./pixelact-ui/label.js";

function isSessionError(code: string): boolean {
  return code === "session_expired" || code === "unauthorized";
}

async function memberInfo(mapId: string): Promise<DraftMemberInfo> {
  const payload = await fetchMap(mapId);
  return {
    mapId,
    name: payload.name,
    entryIds: payload.markers.entries.map((marker) => marker.id),
    exitIds: payload.markers.exits.map((marker) => marker.id),
  };
}

/** "end" or "mapId::entryId" — both id alphabets exclude ":". */
function encodeDest(dest: ExitDestination | null): string {
  if (dest === null) return "";
  if (dest === "end") return "end";
  return `${dest.mapId}::${dest.entryId}`;
}

function decodeDest(value: string): ExitDestination | null {
  if (value === "") return null;
  if (value === "end") return "end";
  const [mapId, entryId] = value.split("::");
  if (!mapId || !entryId) return null;
  return { mapId, entryId };
}

export function AdventureEditor() {
  useLocale();
  const setScreen = useUiStore((state) => state.setScreen);
  const [adventures, setAdventures] = useState<AdventureSummary[] | null>(null);
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: AdventureDraft } | null>(null);
  const [addingMapId, setAddingMapId] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only fetch
  useEffect(() => {
    void refresh();
  }, []);

  function fail(caught: unknown): boolean {
    const code = errorCode(caught);
    if (isSessionError(code)) {
      setScreen("auth");
      return true;
    }
    setError(code);
    return false;
  }

  async function refresh(): Promise<void> {
    setError(null);
    try {
      const [list, library] = await Promise.all([fetchAdventures(), fetchMaps()]);
      setAdventures(list);
      setMaps(library);
    } catch (caught) {
      if (!fail(caught)) {
        setAdventures((current) => current ?? []);
        setMaps((current) => current ?? []);
      }
    }
  }

  async function openExisting(id: string): Promise<void> {
    setError(null);
    try {
      const payload = await fetchAdventure(id);
      const infos = new Map<string, DraftMemberInfo>();
      for (const mapId of payload.mapIds) infos.set(mapId, await memberInfo(mapId));
      setEditing({ id, draft: draftFromAdventure(payload, infos) });
    } catch (caught) {
      fail(caught);
    }
  }

  async function addMap(): Promise<void> {
    if (!editing || !addingMapId) return;
    setError(null);
    try {
      const info = await memberInfo(addingMapId);
      const draft = addMember(editing.draft, info);
      if (draft) setEditing({ ...editing, draft });
      setAddingMapId("");
    } catch (caught) {
      fail(caught);
    }
  }

  async function save(): Promise<void> {
    if (!editing || saving) return;
    const input = toAdventureInput(editing.draft);
    if (!input) return;
    setSaving(true);
    setError(null);
    try {
      if (editing.id === null) await createAdventureApi(input);
      else await updateAdventureApi(editing.id, input);
      setEditing(null);
      await refresh();
    } catch (caught) {
      fail(caught);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await deleteAdventureApi(id);
      setConfirmingId(null);
      await refresh();
    } catch (caught) {
      fail(caught);
      setConfirmingId(null);
    }
  }

  function update(draft: AdventureDraft | null): void {
    if (editing && draft) setEditing({ ...editing, draft });
  }

  if (adventures === null || maps === null) return null;

  if (editing) {
    const draft = editing.draft;
    const available = maps.filter((map) => !draft.members.some((member) => member.mapId === map.id));
    const startMap = draft.members.find((member) => member.mapId === draft.start?.mapId);
    return (
      <main className="roster-shell">
        <header className="roster-header">
          <div>
            <span className="eyebrow">{t("adventure.title")}</span>
            <h1>{draft.title.trim() || t("adventure.new")}</h1>
          </div>
          <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
            {t("editor.back")}
          </Button>
        </header>
        {error && <p role="alert">{authErrorText(error)}</p>}

        <section className="roster-card framed" aria-label={t("adventure.name")}>
          <Label htmlFor="adventure-title">{t("adventure.name")}</Label>
          <Input
            id="adventure-title"
            type="text"
            value={draft.title}
            onChange={(event) => update({ ...draft, title: event.currentTarget.value })}
          />
          <Label htmlFor="adventure-players">{t("adventure.players")}</Label>
          <Input
            id="adventure-players"
            type="number"
            min={1}
            max={4}
            value={draft.maxPlayers}
            onChange={(event) => update({ ...draft, maxPlayers: Number(event.currentTarget.value) })}
          />
        </section>

        <section className="roster-card framed" aria-label={t("adventure.maps.title")}>
          <h2>{t("adventure.maps.title")}</h2>
          {draft.members.map((member) => (
            <div key={member.mapId} className="adventure-member">
              <span>{member.name}</span>
              <Button type="button" variant="secondary" onClick={() => update(removeMember(draft, member.mapId))}>
                {t("adventure.maps.remove")}
              </Button>
            </div>
          ))}
          <Label htmlFor="adventure-add-map">{t("adventure.maps.add.label")}</Label>
          <select
            id="adventure-add-map"
            value={addingMapId}
            onChange={(event) => setAddingMapId(event.currentTarget.value)}
          >
            <option value="">—</option>
            {available.map((map) => (
              <option key={map.id} value={map.id}>
                {map.name}
              </option>
            ))}
          </select>
          <Button type="button" onClick={() => void addMap()}>
            {t("adventure.maps.add")}
          </Button>
        </section>

        <section className="roster-card framed" aria-label={t("adventure.start.title")}>
          <h2>{t("adventure.start.title")}</h2>
          <Label htmlFor="adventure-start-map">{t("adventure.start.map")}</Label>
          <select
            id="adventure-start-map"
            value={draft.start?.mapId ?? ""}
            onChange={(event) => {
              const member = draft.members.find((m) => m.mapId === event.currentTarget.value);
              const first = member?.entryIds[0];
              if (member && first) update(setStart(draft, member.mapId, first));
            }}
          >
            <option value="">—</option>
            {draft.members
              .filter((member) => member.entryIds.length > 0)
              .map((member) => (
                <option key={member.mapId} value={member.mapId}>
                  {member.name}
                </option>
              ))}
          </select>
          <Label htmlFor="adventure-start-entry">{t("adventure.start.entry")}</Label>
          <select
            id="adventure-start-entry"
            value={draft.start?.entryId ?? ""}
            onChange={(event) => {
              if (draft.start) update(setStart(draft, draft.start.mapId, event.currentTarget.value));
            }}
          >
            <option value="">—</option>
            {(startMap?.entryIds ?? []).map((entryId) => (
              <option key={entryId} value={entryId}>
                {entryId}
              </option>
            ))}
          </select>
        </section>

        <section className="roster-card framed" aria-label={t("adventure.bindings.title")}>
          <h2>{t("adventure.bindings.title")}</h2>
          {draft.bindings.map((binding) => {
            const owner = draft.members.find((member) => member.mapId === binding.mapId);
            const selectId = `binding-${binding.mapId}-${binding.exitId}`;
            return (
              <div key={selectId} className="adventure-binding">
                <span>{owner?.name}</span>
                <Label htmlFor={selectId}>{binding.exitId}</Label>
                <select
                  id={selectId}
                  value={encodeDest(binding.dest)}
                  onChange={(event) =>
                    update(bindExit(draft, binding.mapId, binding.exitId, decodeDest(event.currentTarget.value)))
                  }
                >
                  <option value="">{t("adventure.bindings.unbound")}</option>
                  <option value="end">{t("adventure.bindings.end")}</option>
                  {draft.members.flatMap((member) =>
                    member.entryIds.map((entryId) => (
                      <option key={`${member.mapId}::${entryId}`} value={`${member.mapId}::${entryId}`}>
                        {member.name} · {entryId}
                      </option>
                    )),
                  )}
                </select>
              </div>
            );
          })}
        </section>

        {!draftComplete(draft) && <p>{t("adventure.incomplete")}</p>}
        <Button type="button" disabled={!draftComplete(draft) || saving} onClick={() => void save()}>
          {t("editor.save")}
        </Button>
      </main>
    );
  }

  const deleting = adventures.find((adventure) => adventure.id === confirmingId);
  return (
    <main className="roster-shell">
      <header className="roster-header">
        <div>
          <span className="eyebrow">{t("adventure.title")}</span>
          <h1>{t("adventure.title")}</h1>
        </div>
        <div>
          <Button type="button" variant="secondary" onClick={() => void refresh()}>
            {t("adventure.refresh")}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setScreen("characters")}>
            {t("editor.back")}
          </Button>
        </div>
      </header>
      {error && <p role="alert">{authErrorText(error)}</p>}
      <section className="roster-grid" aria-label={t("adventure.title")}>
        {adventures.map((adventure) => (
          <article key={adventure.id} className="roster-card framed">
            <div className="roster-card__identity">
              <h2>{adventure.title}</h2>
              <span>{t("adventure.players.count", { count: adventure.maxPlayers })}</span>
            </div>
            <div className="roster-card__actions">
              <Button type="button" onClick={() => void openExisting(adventure.id)}>
                {t("adventure.edit")}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirmingId(adventure.id)}>
                {t("editor.delete")}
              </Button>
            </div>
          </article>
        ))}
      </section>
      <Button type="button" onClick={() => setEditing({ id: null, draft: emptyDraft() })}>
        {t("adventure.new")}
      </Button>
      {deleting && (
        <div className="delete-dialog-backdrop">
          <section
            className="delete-dialog parchment framed"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-adventure-title"
          >
            <h2 id="delete-adventure-title">{t("adventure.delete.title", { name: deleting.title })}</h2>
            <div className="delete-dialog__actions">
              <Button type="button" variant="secondary" onClick={() => setConfirmingId(null)}>
                {t("editor.delete.cancel")}
              </Button>
              <Button type="button" className="danger" onClick={() => void remove(deleting.id)}>
                {t("editor.delete.confirm")}
              </Button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
```

**i18n** — `src/shared/i18n/en.ts`:

```ts
  "chars.adventures": "Adventures",
  "adventure.title": "Adventure editor",
  "adventure.new": "New adventure",
  "adventure.name": "Title",
  "adventure.players": "Max players",
  "adventure.players.count": "{count} players max",
  "adventure.edit": "Edit",
  "adventure.refresh": "Refresh",
  "adventure.delete.title": "Delete {name}?",
  "adventure.maps.title": "Maps",
  "adventure.maps.add": "Add",
  "adventure.maps.add.label": "Add a map",
  "adventure.maps.remove": "Remove",
  "adventure.start.title": "Start",
  "adventure.start.map": "Starting map",
  "adventure.start.entry": "Entry",
  "adventure.bindings.title": "Exits",
  "adventure.bindings.end": "End of the adventure",
  "adventure.bindings.unbound": "Choose a destination",
  "adventure.incomplete": "Set a start, bind every exit, and end the adventure at least once.",
```

`src/shared/i18n/fr.ts`:

```ts
  "chars.adventures": "Aventures",
  "adventure.title": "Éditeur d'aventures",
  "adventure.new": "Nouvelle aventure",
  "adventure.name": "Titre",
  "adventure.players": "Joueurs max",
  "adventure.players.count": "{count} joueurs max",
  "adventure.edit": "Modifier",
  "adventure.refresh": "Actualiser",
  "adventure.delete.title": "Supprimer {name} ?",
  "adventure.maps.title": "Cartes",
  "adventure.maps.add": "Ajouter",
  "adventure.maps.add.label": "Ajouter une carte",
  "adventure.maps.remove": "Retirer",
  "adventure.start.title": "Départ",
  "adventure.start.map": "Carte de départ",
  "adventure.start.entry": "Entrée",
  "adventure.bindings.title": "Sorties",
  "adventure.bindings.end": "Fin de l'aventure",
  "adventure.bindings.unbound": "Choisir une destination",
  "adventure.incomplete": "Définis un départ, relie chaque sortie et termine l'aventure au moins une fois.",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:ui -- test/ui/adventure-editor.test.tsx` then the full `npm run test:ui` (CharacterSelect snapshot-ish tests must absorb the new button).
Expected: PASS.

- [ ] **Step 5: Check and commit**

```bash
npm run check
git add src/client/store.ts src/client/ui/App.tsx src/client/ui/CharacterSelect.tsx src/client/ui/AdventureEditor.tsx src/shared/i18n/en.ts src/shared/i18n/fr.ts test/ui/adventure-editor.test.tsx
git commit -m "feat add adventure editor screen with map membership start and exit bindings"
```

---

## Deliberate scope notes

- **Mutation policy is refusal** (Task 2), mirroring the delete guard the user chose in the spec ("refus, plus prévisible"). Unbinding in the adventure editor first, then editing the map, is the intended workflow.
- **No map reordering UI** in the adventure editor: membership order = add order = `position`. Reordering arrives if a real need appears.
- **No canvas labels for marker ids**: the bindings panel names exits; on-canvas diamonds are color-coded only.
- **Runtime untouched**: placed monster spawns render as editor overlays but spawn nothing in play until plan 4 hydrates them.
- The delete-adventure test seeds through the mock backend and uses a "Refresh" button rather than re-rendering — that button is product-visible and harmless.
