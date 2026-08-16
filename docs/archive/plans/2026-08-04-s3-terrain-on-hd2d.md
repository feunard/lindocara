# S3 first increment — the world becomes a heightfield, end to end — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the game's terrain as a heightfield on the wire and render it through
`@lindocara/hd2d`, retiring the PixiJS render path.

**Architecture:** The server keeps being the only baker. It loads a map whose terrain is stored as
an encoded `MapData` heightfield, ships that heightfield in `WorldInfo`, and — for the length of
this increment only — also ships the pixel-unit collision bake its own simulation still runs on.
The client decodes the heightfield with the same total parser `apps/lab` already uses, meshes it
with `@lindocara/hd2d`, and draws sprites as billboards. The seam in `packages/client/src/game/`
does not move: `net.ts` still owns prediction, `session.ts` still owns store writes.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Three.js via `@lindocara/hd2d`, Alepha
(ORM `$entity`, `$room`), Vitest, Biome.

---

## Global Constraints

- **Nothing in production is protected.** No migration path, no back-compat shim, no rollback
  branch, no converter that exists to keep old content alive. A task that finds itself writing one
  has misread the increment.
- **The server is the only baker.** The client decodes exactly the bytes the authority sent and
  collides against them. Never derive collision on the client from appearance data
  (`elements`, `events`, `layers`, materials).
- **`@lindocara/hd2d` never learns the game's domain.** It takes numbers and hands them to shaders.
  No `MapData`, no monster, no quest, no biome inside that package. Game knowledge lives in the
  adapter.
- **Units.** `@lindocara/engine/hd2d/*` is **tile units**, and its world origin is the grid
  **centre** (`createTerrainQuery`: `toCell = floor(w + size/2)`). `simulation.ts`/`game.ts`/
  `collider.ts` are **pixels** with origin at the top-left corner. `TILE_SIZE = 64`
  (`packages/engine/src/tilemap.ts`). Every conversion between the two is a marked bridge — see
  the banner convention in Task 5.
- **Two coordinate systems on the server are deliberate and bounded.** Every conversion site carries
  the exact banner comment from Task 5 so `grep -rn "TILE→PIXEL BRIDGE"` finds all of them the day
  the server-geometry piece deletes them.
- **Language.** All code, comments, commit messages and docs in **English**. The one exception is
  pre-existing French identifiers under `packages/engine/src/hd2d/` and `apps/lab/` — do not rename
  them, and match their language when editing those files (see `packages/engine/CLAUDE.md`).
- **Read before touching the render path:** [`docs/hd2d-rendering.md`](../../hd2d-rendering.md) —
  the rendering-pitfall registry, already paid for once.
- **The reference implementation is `apps/lab/src/main.ts`.** Prefer copying its structure to
  inventing one.
- **Every task leaves the game runnable.** `npm run dev`, log in, enter a party, see a world.
- Biome: `noNonNullAssertion` is on — no `!`, narrow properly. Alepha classes use no TypeScript
  `private`; JSDoc is `/** … */` blocks.
- Verify with `npm run check` before each commit (`npm run v --fast` if the change touched
  migrations or the build).

## Decisions this plan makes that the spec left implicit

These were settled while decomposing. They are inside the spec's constraints, not a relitigation of
them — but an implementer should know they were chosen, not inherited.

1. **The wire carries both bakes for the duration.** The spec says the server holds two coordinate
   systems and its own geometry does not move. It follows that `WorldInfo` keeps `tiles`/`colliders`
   (pixels, what the server simulates and the client predicts against) *and* gains `heightfield`
   (tile units, what the client draws). This is not dual truth: **one source — the stored
   heightfield — projected twice by the one authority**, with the pixel projection produced by a
   marked bridge. It dies with the server-geometry piece.
2. **The PixiJS surface is five files, not ten thousand lines.** Only `renderer.ts`,
   `stage-application.ts`, `tiny-swords-art.ts`, `catalog-element-render.ts` and
   `editor-asset-art.ts` import pixi. The rest of `packages/renderer` (art data, `feedback.ts`,
   `interiors.ts`, `locale.ts`, `input.ts`, `server-clock.ts`, `display-settings.ts`,
   `minimap*.ts`, `world-layout.ts`) is framework-free and **survives**. The client imports 16
   renderer modules; only `renderer.js` is on the pixi path. Scope the deletion accordingly.
3. **The editor's breakage is quarantined, not left red.** A permanently failing
   `npm run typecheck` would make every later task's verification meaningless. Task 9 removes
   `@lindocara/editor` from the verify pipeline behind an explicit marker and says so in its
   `AGENTS.md`.
4. **The proving map is generated, not authored.** The editor breaks in this increment, so no one
   can author a heightfield map. The map is produced by a script reusing `apps/lab`'s island
   generator and stored on the map row.
5. **A temporary `?hd2d=1` flag sequences the work.** Tasks 6–8 build the new path beside the old
   one so each task leaves the game runnable; Task 9 deletes the flag and the old path together.
   This is an in-branch sequencing device, not the permanent coexistence the spec rejected — if it
   survives Task 9, the increment is not done.

## File Structure

**Created**
- `packages/hd2d/src/terrain/height-field-from-grid.ts` — grid arrays → `HeightField`. Primitives
  only, no `MapData`, so hd2d stays domain-free.
- `packages/hd2d/test/height-field-from-grid.test.ts`
- `packages/server/src/world/heightfield-pixel-bridge.ts` — the marked TILE→PIXEL bridge.
- `packages/server/test-api/heightfield-pixel-bridge.test.ts`
- `scripts/build-proving-map.ts` — generates and stores the one proving map.
- `packages/renderer/src/hd2d/scene.ts` — composition root: context, pipeline, terrain, lights, sky.
- `packages/renderer/src/hd2d/billboards.ts` — actor/element/event billboard registry.
- `packages/renderer/src/hd2d/game-renderer.ts` — `Hd2dRenderer`, the `RendererLike` implementation.
- `packages/renderer/src/renderer-api.ts` — `RendererLike`, the interface `session.ts` consumes.
- `packages/renderer/test/hd2d-*.test.ts`
- `apps/main/migrations/sqlite/<generated>` — the `maps.heightfield` column.

**Modified**
- `packages/engine/src/hd2d/map-data.ts` — `MapData` grows `elements` and `events`.
- `packages/engine/src/protocol.ts` — `WorldInfo.heightfield` + validator.
- `packages/server/src/api/entities/maps.ts` — the `heightfield` column.
- `packages/server/src/api/services/MapService.ts` — read/write passthrough.
- `packages/server/src/api/realtime/worldState.ts` — `MapPayload.heightfield`, zone definition.
- `packages/server/src/api/realtime/WorldRoom.ts` — `worldInfo()` ships the heightfield.
- `packages/client/src/game/session.ts` — renderer selection, welcome wiring.
- `packages/renderer/package.json` — `three` + `@lindocara/hd2d`, drop `pixi.js` (Task 9).
- `apps/lab/src/world/island.ts` — delegates to the shared `heightFieldFromGrid`.

**Deleted (Task 9)**
- `packages/renderer/src/renderer.ts`, `stage-application.ts`, `catalog-element-render.ts`,
  `editor-asset-art.ts`, and the pixi half of `tiny-swords-art.ts`.

---

### Task 1: `MapData` carries the game's elements and events

The lab's map format has terrain only. The game has decoration and authored events, and both are
appearance-only — exactly as `WorldInfo.elements`/`WorldInfo.events` carry them today. Two new
fields, no more (per the spec: no markers, no tileset indirection, no quest metadata).

**Files:**
- Modify: `packages/engine/src/hd2d/map-data.ts`
- Test: `packages/engine/test/hd2d-map-data-content.test.ts`

**Interfaces:**
- Consumes: `MapData`, `decodeMap`, `encodeMap` (existing).
- Produces: `HeightfieldElement { assetId: string; x: number; z: number }`,
  `HeightfieldEvent { id: string; x: number; z: number; graphicAssetId: string | null }`, and
  `MapData.elements` / `MapData.events`, both `readonly` arrays. Names are deliberately NOT
  `MapElement`/`MapEvent` — those already exist in `packages/engine/src/map-data.ts` (the tile
  model) and a collision across two files named `map-data.ts` would be a permanent trip hazard.
  `x`/`z` are **tile units, grid-centred**, matching every other coordinate in this file.

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/test/hd2d-map-data-content.test.ts
import { describe, expect, it } from "vitest";
import { decodeMap, encodeMap, type MapData } from "../src/hd2d/map-data.js";

const base: MapData = {
  version: 1,
  size: 2,
  levelHeight: 0.5,
  waterLevel: 0,
  levels: [0, 0, 0, null],
  materials: ["herbe", "herbe", "sable", "herbe"],
  colliders: [],
  spawns: [],
  elements: [],
  events: [],
};

describe("MapData content", () => {
  it("round-trips elements and events", () => {
    const map: MapData = {
      ...base,
      elements: [{ assetId: "tree_01", x: -0.5, z: 0.25 }],
      events: [{ id: "ev-1", x: 0, z: 0, graphicAssetId: "chest_closed" }],
    };
    expect(decodeMap(encodeMap(map))).toEqual(map);
  });

  it("defaults both collections to empty for a map that predates them", () => {
    const { elements: _e, events: _v, ...withoutContent } = base;
    expect(decodeMap(JSON.stringify(withoutContent))).toEqual(base);
  });

  it("rejects a malformed element rather than dropping it silently", () => {
    const broken = { ...base, elements: [{ assetId: 42, x: 0, z: 0 }] };
    expect(decodeMap(JSON.stringify(broken))).toBeNull();
  });

  it("rejects a non-finite event coordinate", () => {
    const broken = { ...base, events: [{ id: "e", x: "0", z: 0, graphicAssetId: null }] };
    expect(decodeMap(JSON.stringify(broken))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm test -w @lindocara/engine -- hd2d-map-data-content
```

Expected: FAIL — `elements` is not a property of `MapData` (typecheck), and the round-trip drops
both fields.

- [ ] **Step 3: Add the two fields and their validators**

In `packages/engine/src/hd2d/map-data.ts`, beside the existing `toCollider`/`toSpawn` helpers:

```ts
/** Decoration, appearance only. Collision comes from `colliders`, never from this list — the
 *  same rule `WorldInfo.elements` follows on the wire. Coordinates are tile units, grid-centred. */
export interface HeightfieldElement {
  assetId: string;
  x: number;
  z: number;
}

/** An authored event's active page, appearance only. Mirrors `WorldInfo.events`. */
export interface HeightfieldEvent {
  id: string;
  x: number;
  z: number;
  graphicAssetId: string | null;
}

function toElement(value: unknown): HeightfieldElement | null {
  if (
    !isRecord(value) ||
    typeof value.assetId !== "string" ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.z)
  )
    return null;
  return { assetId: value.assetId, x: value.x, z: value.z };
}

function toEvent(value: unknown): HeightfieldEvent | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.z) ||
    !(value.graphicAssetId === null || typeof value.graphicAssetId === "string")
  )
    return null;
  return { id: value.id, x: value.x, z: value.z, graphicAssetId: value.graphicAssetId };
}
```

Add to the `MapData` interface:

```ts
  /** Decoration. Appearance only. */
  elements: readonly HeightfieldElement[];
  /** Authored events' active page. Appearance only. */
  events: readonly HeightfieldEvent[];
```

And inside `decodeMap`, after the `spawns` block — **absent means empty, malformed means `null`**.
That asymmetry is deliberate and matches the file's existing "a newer editor may add fields"
comment: a map written before these fields existed is readable, a corrupt one is not.

```ts
  const rawElements = Array.isArray(value.elements) ? value.elements : [];
  if (value.elements !== undefined && !Array.isArray(value.elements)) return null;
  const decodedElements = rawElements.map(toElement);
  if (decodedElements.some((e) => e === null)) return null;

  const rawEvents = Array.isArray(value.events) ? value.events : [];
  if (value.events !== undefined && !Array.isArray(value.events)) return null;
  const decodedEvents = rawEvents.map(toEvent);
  if (decodedEvents.some((e) => e === null)) return null;
```

and in the returned object:

```ts
    elements: decodedElements as HeightfieldElement[],
    events: decodedEvents as HeightfieldEvent[],
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npm test -w @lindocara/engine -- hd2d-map-data-content
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Fix the fallout in the existing callers**

`MapData` is constructed in `apps/lab/scripts/build-map.ts` and in `apps/lab/test/map-parite.test.ts`.
Both now need `elements: []`, `events: []`.

```bash
npm run typecheck:engine && npm run typecheck:lab
```

Expected: clean. Add the two empty fields wherever it is not.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/hd2d/map-data.ts packages/engine/test/hd2d-map-data-content.test.ts apps/lab
git commit -m "feat(engine): the heightfield map carries elements and events"
```

---

### Task 2: `heightFieldFromGrid`, shared by the lab and the game

`mapToHeightField` lives in `apps/lab/src/world/island.ts`. The game's renderer needs exactly the
same adapter, and an app is not a dependency. It moves into `@lindocara/hd2d` — but taking
**primitive grid arrays**, not `MapData`, so the package still knows nothing about the game's data
model. The material→atlas-key mapping stays with the caller as a callback, because it is art
direction, not geometry.

**Files:**
- Create: `packages/hd2d/src/terrain/height-field-from-grid.ts`
- Create: `packages/hd2d/test/height-field-from-grid.test.ts`
- Modify: `apps/lab/src/world/island.ts` (delegate), `apps/lab/src/main.ts` (import site)

**Interfaces:**
- Consumes: `HeightField` from `packages/hd2d/src/terrain/field.ts` (`cols`, `rows`, `levelAt`,
  `materialAt`).
- Produces: `heightFieldFromGrid(opts: HeightFieldGridOptions): HeightField` where

```ts
export interface HeightFieldGridOptions {
  /** Grid side, in cells. The field is square. */
  size: number;
  /** `size * size`, row-major (index = j * size + i). `null` = water. */
  levels: readonly (number | null)[];
  /** `size * size`. Meaningless wherever `levels` is `null`. */
  materials: readonly string[];
  /** Material + level -> atlas key. Art direction, so it stays with the caller. */
  materialKey(material: string, level: number): string;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/hd2d/test/height-field-from-grid.test.ts
import { describe, expect, it } from "vitest";
import { heightFieldFromGrid } from "../src/terrain/height-field-from-grid.js";

const field = heightFieldFromGrid({
  size: 2,
  levels: [0, 1, null, 0],
  materials: ["herbe", "herbe", "herbe", "sable"],
  materialKey: (material, level) => (material === "herbe" ? `lvl${level}` : material),
});

describe("heightFieldFromGrid", () => {
  it("reads levels row-major", () => {
    expect(field.levelAt(0, 0)).toBe(0);
    expect(field.levelAt(1, 0)).toBe(1);
    expect(field.levelAt(0, 1)).toBeNull();
    expect(field.levelAt(1, 1)).toBe(0);
  });

  it("returns null off the grid rather than reading a neighbouring row", () => {
    expect(field.levelAt(-1, 0)).toBeNull();
    expect(field.levelAt(2, 0)).toBeNull();
    expect(field.materialAt(0, -1)).toBeNull();
  });

  it("routes the material through the caller's key function", () => {
    expect(field.materialAt(1, 0)).toBe("lvl1");
    expect(field.materialAt(1, 1)).toBe("sable");
  });

  it("has no material where there is water", () => {
    expect(field.materialAt(0, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm test -w @lindocara/hd2d -- height-field-from-grid
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/hd2d/src/terrain/height-field-from-grid.ts
// A serialized grid, adapted into the `HeightField` the mesher reads. Takes PRIMITIVE arrays, not
// a map object: this package must not learn what a map is (see `packages/hd2d/AGENTS.md`). The
// material -> atlas key mapping is art direction and stays with the caller for the same reason.

import type { HeightField } from "./field.js";

export interface HeightFieldGridOptions {
  size: number;
  levels: readonly (number | null)[];
  materials: readonly string[];
  materialKey(material: string, level: number): string;
}

export function heightFieldFromGrid(opts: HeightFieldGridOptions): HeightField {
  const { size, levels, materials, materialKey } = opts;
  const inBounds = (i: number, j: number) => i >= 0 && j >= 0 && i < size && j < size;
  return {
    cols: size,
    rows: size,
    levelAt(i, j) {
      if (!inBounds(i, j)) return null;
      return levels[j * size + i] ?? null;
    },
    materialAt(i, j) {
      if (!inBounds(i, j)) return null;
      const level = levels[j * size + i];
      if (level === null || level === undefined) return null;
      const material = materials[j * size + i];
      return material === undefined ? null : materialKey(material, level);
    },
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
npm test -w @lindocara/hd2d -- height-field-from-grid
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Make the lab delegate to it**

In `apps/lab/src/world/island.ts`, replace `mapToHeightField`'s body with a delegation, keeping
its existing signature and its French comments so `apps/lab/test/map-parite.test.ts` still passes
unchanged:

```ts
export function mapToHeightField(m: MapData): HeightField {
  return heightFieldFromGrid({
    size: m.size,
    levels: m.levels,
    materials: m.materials,
    materialKey: (material, level) => renderMaterialAt(material as TerrainMaterial, level),
  });
}
```

- [ ] **Step 6: Prove the lab is unchanged**

```bash
npm run test:lab && npm run typecheck:lab && npm run typecheck:hd2d
```

Expected: PASS. `map-parite.test.ts` is the parity oracle here — if it goes red, the delegation
changed behaviour and the fix belongs in `heightFieldFromGrid`, not in the test.

- [ ] **Step 7: Commit**

```bash
git add packages/hd2d apps/lab
git commit -m "refactor(hd2d): share the grid-to-heightfield adapter with the game"
```

---

### Task 3: The wire learns to carry a heightfield

`WorldInfo` gains one field. The server does not fill it yet, so nothing observable changes — this
task exists on its own because a wire change deserves its own reviewable gate and its own
defensive-parsing proof.

The field is the **encoded** map (`encodeMap`'s string), not a structured object: `decodeMap` is
already a total, tested parser, and reusing it means the wire has exactly one validator instead of
a second hand-written one that can drift from it.

**Files:**
- Modify: `packages/engine/src/protocol.ts` (`WorldInfo`, `isWorldInfo`)
- Test: `packages/engine/test/protocol-heightfield.test.ts`

**Interfaces:**
- Consumes: `decodeMap` from `./hd2d/map-data.js`, `WorldInfo` (existing).
- Produces: `WorldInfo.heightfield: string | null` — `null` on a map that has no heightfield.
  Consumers decode it with `decodeMap` and MUST treat `null` as "this room has no HD-2D terrain".

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/test/protocol-heightfield.test.ts
import { describe, expect, it } from "vitest";
import { encodeMap, type MapData } from "../src/hd2d/map-data.js";
import { parseServerMessage } from "../src/protocol.js";
import { welcomeFixture } from "@lindocara/testing/map-fixtures.js";

const map: MapData = {
  version: 1,
  size: 2,
  levelHeight: 0.5,
  waterLevel: 0,
  levels: [0, 0, 0, 0],
  materials: ["herbe", "herbe", "herbe", "herbe"],
  colliders: [],
  spawns: [],
  elements: [],
  events: [],
};

describe("WorldInfo.heightfield", () => {
  it("accepts a welcome carrying a valid encoded heightfield", () => {
    const message = welcomeFixture({ heightfield: encodeMap(map) });
    const parsed = parseServerMessage(JSON.stringify(message));
    expect(parsed?.t).toBe("welcome");
  });

  it("accepts an explicit null", () => {
    const parsed = parseServerMessage(JSON.stringify(welcomeFixture({ heightfield: null })));
    expect(parsed?.t).toBe("welcome");
  });

  it("drops a frame whose heightfield does not decode", () => {
    const message = welcomeFixture({ heightfield: '{"version":1,"size":-4}' });
    expect(parseServerMessage(JSON.stringify(message))).toBeNull();
  });

  it("drops a frame whose heightfield is not a string", () => {
    const message = welcomeFixture({ heightfield: 7 });
    expect(parseServerMessage(JSON.stringify(message))).toBeNull();
  });
});
```

If `@lindocara/testing/map-fixtures.js` has no `welcomeFixture`, add one there in this task: it
builds a minimal valid `welcome` message and shallow-merges the given `world` overrides. Read the
file first and follow its existing fixture style rather than inventing a second one.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm test -w @lindocara/engine -- protocol-heightfield
```

Expected: FAIL — the valid case passes vacuously while both rejection cases pass the frame through,
because nothing validates the field yet.

- [ ] **Step 3: Add the field and its validation**

In the `WorldInfo` interface, directly under the `colliders` docblock:

```ts
  /**
   * The terrain as a heightfield — the encoded `MapData` (`hd2d/map-data.ts`), in TILE units,
   * grid-centred. This is what the client DRAWS.
   *
   * `tiles`/`colliders` above stay the collision truth for as long as the server simulates in
   * pixels: one stored source, projected twice by the one authority (see the TILE→PIXEL BRIDGE in
   * `packages/server/src/world/heightfield-pixel-bridge.ts`). Both projections die together when
   * the server's own geometry migrates — this field is not a second world model, it is the same
   * one in the units the renderer needs.
   *
   * `null` means the room has no heightfield and nothing HD-2D can be drawn for it.
   */
  heightfield: string | null;
```

In `isWorldInfo`, alongside the existing `parseTileMap`/`parseWorldColliders` guards:

```ts
  if (value.heightfield !== null) {
    if (typeof value.heightfield !== "string" || decodeMap(value.heightfield) === null) return false;
  }
```

Import `decodeMap` at the top of `protocol.ts` from `./hd2d/map-data.js`.

- [ ] **Step 4: Run the test and watch it pass**

```bash
npm test -w @lindocara/engine -- protocol-heightfield
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Fix every `WorldInfo` construction site**

The field is required, so the compiler now names each one:

```bash
npm run typecheck:engine && npm run typecheck:server && npm run typecheck:client
```

Add `heightfield: null` to each — including `WorldRoom.worldInfo()`. Do not fill it here; Task 5
does that.

- [ ] **Step 6: Commit**

```bash
git add packages/engine packages/server packages/testing
git commit -m "feat(protocol): WorldInfo carries the terrain heightfield"
```

---

### Task 4: The map row stores its heightfield

**Files:**
- Modify: `packages/server/src/api/entities/maps.ts`
- Modify: `packages/server/src/api/services/MapService.ts`
- Modify: `packages/server/src/api/realtime/worldState.ts` (`MapPayload`, `zoneFromMapPayload`)
- Create: `apps/main/migrations/sqlite/<generated>`
- Test: `packages/server/test-api/map-heightfield.test.ts`

**Interfaces:**
- Consumes: `maps` `$entity`, `MapPayload` (existing).
- Produces: `maps.heightfield` — `db.default(z.string(), "")`, the encoded `MapData`; empty string
  means "no heightfield", matching the `audio`/`heroSettings` sentinel convention already in this
  entity. `MapPayload.heightfield: string | null` (the empty sentinel is normalised to `null` at
  the payload boundary so nothing downstream has to know about it), and
  `ZoneDefinition.heightfield: string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/test-api/map-heightfield.test.ts
import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

describe("map heightfield storage", () => {
  it("round-trips a stored heightfield through the map payload", async () => {
    const app = await createTestApp();
    const encoded = '{"version":1,"size":1,"levelHeight":0.5,"waterLevel":0,"levels":[0],"materials":["herbe"],"colliders":[],"spawns":[],"elements":[],"events":[]}';
    const map = await app.mapService.createMap({ /* follow the file's existing fixture helper */ });
    await app.mapService.saveHeightfield(map.id, map.userId, encoded);
    const payload = await app.mapService.loadMapPayload(map.id);
    expect(payload?.heightfield).toBe(encoded);
  });

  it("reports no heightfield as null, not as an empty string", async () => {
    const app = await createTestApp();
    const map = await app.mapService.createMap({ /* same helper */ });
    const payload = await app.mapService.loadMapPayload(map.id);
    expect(payload?.heightfield).toBeNull();
  });
});
```

**Read `packages/server/test-api/helpers.ts` and an existing `MapService` test first** and match
their harness: this package boots the real Alepha app and talks real HTTP/WebSocket — no `vi.mock`.
Name the service methods to match what is already there (`loadMapPayload` may be called something
else); the two assertions are what matter, not the helper names.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm run test:server -- map-heightfield
```

Expected: FAIL — no `heightfield` column, no `saveHeightfield`.

- [ ] **Step 3: Add the column**

In `packages/server/src/api/entities/maps.ts`, inside the schema, after `heroSettings`:

```ts
    /**
     * JSON-encoded `MapData` (`engine/hd2d/map-data.ts`) — the terrain as a heightfield, in tile
     * units. Empty string is the "no heightfield" sentinel, same convention as `audio` above.
     * Written today only by `scripts/build-proving-map.ts`; the editor gains this in its own piece.
     */
    heightfield: db.default(z.string(), ""),
```

- [ ] **Step 4: Generate and inspect the migration**

```bash
npm run db:generate -w @lindocara/main
```

Read the generated SQL before committing it — it must be one `ALTER TABLE maps ADD COLUMN`, nothing
else. Then:

```bash
npm run check:migrations -w @lindocara/main
```

Expected: no drift.

- [ ] **Step 5: Thread it through the service and the payload**

In `MapService`, add the write (epoch/ownership fenced the same way its siblings are — copy the
neighbouring update method rather than inventing a new guard) and include `heightfield` in the
payload read, normalising the sentinel:

```ts
      heightfield: row.heightfield === "" ? null : row.heightfield,
```

In `worldState.ts`, add `heightfield: string | null` to `MapPayload`, and carry it into the
`ZoneDefinition` returned by `zoneFromMapPayload`:

```ts
    heightfield: payload.heightfield,
```

Add the matching optional field to `ZoneDefinition` where it is declared.

- [ ] **Step 6: Run the test and watch it pass**

```bash
npm run test:server -- map-heightfield && npm run typecheck:server
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/server apps/main/migrations
git commit -m "feat(server): maps store their terrain heightfield"
```

---

### Task 5: The server bakes and ships the heightfield

The increment's hinge. Three things land together because none of them is independently
observable: a generated proving map, the marked TILE→PIXEL bridge that lets the existing pixel
simulation run on it, and `worldInfo()` shipping the heightfield.

**Files:**
- Create: `packages/server/src/world/heightfield-pixel-bridge.ts`
- Create: `packages/server/test-api/heightfield-pixel-bridge.test.ts`
- Create: `scripts/build-proving-map.ts`
- Modify: `packages/server/src/api/realtime/worldState.ts`, `WorldRoom.ts`

**Interfaces:**
- Consumes: `MapData`, `decodeMap` (Task 1/3), `MapPayload.heightfield` (Task 4), `TerrainGeometry`
  and `TILE_SIZE` from `@lindocara/engine`.
- Produces:
  - `pixelTerrainFromHeightfield(map: MapData): TerrainGeometry` — the bridge.
  - `tileToPixel(v: number, size: number): number` — the one coordinate conversion, exported so
    the client seam in Task 7 uses the identical arithmetic instead of a second copy of it.

- [ ] **Step 1: Write the failing test for the bridge**

The conversion has both a **scale** and an **origin shift**, and the origin shift is the part that
silently produces a world offset by half a map if it is forgotten. Pin it first.

```ts
// packages/server/test-api/heightfield-pixel-bridge.test.ts
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import { describe, expect, it } from "vitest";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  pixelTerrainFromHeightfield,
  tileToPixel,
} from "../src/world/heightfield-pixel-bridge.js";

const map: MapData = {
  version: 1,
  size: 4,
  levelHeight: 0.5,
  waterLevel: 0,
  // row 1 is water; everything else is walkable ground.
  levels: [0, 0, 0, 0, null, null, null, null, 0, 0, 0, 0, 0, 0, 0, 0],
  materials: new Array(16).fill("herbe"),
  colliders: [{ x: -2, z: 0, w: 1, h: 1 }],
  spawns: [{ name: "start", x: 0, z: 0 }],
  elements: [],
  events: [],
};

describe("the TILE->PIXEL bridge", () => {
  it("maps the grid's centred origin onto the pixel world's corner", () => {
    // -size/2 is the map's west edge, which is pixel 0.
    expect(tileToPixel(-2, 4)).toBe(0);
    expect(tileToPixel(0, 4)).toBe(2 * TILE_SIZE);
    expect(tileToPixel(2, 4)).toBe(4 * TILE_SIZE);
  });

  it("sizes the pixel world from the grid", () => {
    const terrain = pixelTerrainFromHeightfield(map);
    expect(terrain.width).toBe(4 * TILE_SIZE);
    expect(terrain.height).toBe(4 * TILE_SIZE);
  });

  it("turns water into impassable cells and ground into walkable ones", () => {
    const terrain = pixelTerrainFromHeightfield(map);
    expect(terrain.tiles.rows).toBe(4);
    expect(terrain.tiles.cols).toBe(4);
    // Row 1 is water: not walkable. Row 0 is ground: walkable.
    expect(isWalkableCell(terrain, 1, 0)).toBe(true);
    expect(isWalkableCell(terrain, 1, 1)).toBe(false);
  });

  it("converts a collider rect into pixel space, origin included", () => {
    const terrain = pixelTerrainFromHeightfield(map);
    const rects = [...terrain.colliders.all()];
    expect(rects).toContainEqual({ x: 0, y: 2 * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE });
  });
});
```

`isWalkableCell` is a two-line local helper over the terrain's `tiles` — write it in the test file
rather than exporting a new production helper for it. If `ColliderIndex` has no `all()`, read
`packages/engine/src/hd2d/collider-index.ts` and assert through whatever query it does expose.

- [ ] **Step 2: Run the test and watch it fail**

```bash
npm run test:server -- heightfield-pixel-bridge
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the bridge**

```ts
// packages/server/src/world/heightfield-pixel-bridge.ts
//
// ============================ TILE→PIXEL BRIDGE ============================
// TEMPORARY, AND DELIBERATELY SO. The map is stored and shipped as a heightfield in TILE units,
// grid-centred; the server's own simulation (`simulation.ts`, `collider.ts`, the fourteen world
// systems) still runs in PIXELS with a top-left origin. This file is the only place the two meet.
//
// It exists for exactly as long as that migration takes. When the server's geometry moves to tile
// units, DELETE this file and every call site — `grep -rn "TILE→PIXEL BRIDGE"` finds them all.
// Do not grow it, do not make it two-way, and do not let a caller convert coordinates by hand
// instead of going through `tileToPixel`.
// ===========================================================================

import { createColliderIndex } from "@lindocara/engine/hd2d/collider-index.js";
import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import { TILE_SIZE } from "@lindocara/engine/tilemap.js";
import type { TerrainGeometry } from "@lindocara/engine/game.js";

/** Grid-centred tile units -> top-left pixel units. The origin shift is the half that gets
 *  forgotten; keeping it in one exported function is why this is not inlined at each site. */
export function tileToPixel(value: number, size: number): number {
  return (value + size / 2) * TILE_SIZE;
}

/**
 * Projects the stored heightfield into the pixel-unit `TerrainGeometry` the current simulation
 * collides against. Water and off-map are impassable; every ground cell is walkable, and the
 * authored collider rects ride across unchanged apart from their units.
 */
export function pixelTerrainFromHeightfield(map: MapData): TerrainGeometry {
  // Build the tile grid, then the collider index, then assemble — mirroring `terrainFromMap`
  // (`engine/map-data.ts`) so the two bakes stay recognisably the same shape.
  // …implementation follows the existing `TerrainGeometry`/`TileMap` constructors; read
  // `packages/engine/src/map-data.ts:214` (`terrainFromMap`) and copy its assembly.
}
```

Fill the body against `terrainFromMap`'s existing shape — do not invent a new `TerrainGeometry`
assembly. Colliders convert as
`{ x: tileToPixel(c.x, size), y: tileToPixel(c.z, size), width: c.w * TILE_SIZE, height: c.h * TILE_SIZE }`.

- [ ] **Step 4: Run the bridge test and watch it pass**

```bash
npm run test:server -- heightfield-pixel-bridge
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Use the bridge in the zone definition**

In `zoneFromMapPayload`, when `payload.heightfield` decodes, the heightfield becomes the terrain
source; otherwise the existing tile path stands:

```ts
  const heightfield = payload.heightfield === null ? null : decodeMap(payload.heightfield);
  // TILE→PIXEL BRIDGE — see packages/server/src/world/heightfield-pixel-bridge.ts
  const terrain = heightfield === null ? terrainFromMap(data) : pixelTerrainFromHeightfield(heightfield);
```

A stored heightfield that fails to decode must **not** silently fall back to the tile path — that
would be a corrupt map presenting as a working one. Log it and keep `heightfield` `null` so the
room is honestly heightfield-less.

- [ ] **Step 6: Ship it in the welcome**

In `WorldRoom.worldInfo()`, replace the `heightfield: null` placeholder from Task 3:

```ts
      heightfield: definition.heightfield ?? null,
```

- [ ] **Step 7: Write the proving map generator**

`scripts/build-proving-map.ts` reuses the lab's island generator — the same one
`apps/lab/scripts/build-map.ts` calls — writes an encoded `MapData` and stores it on a named map
row. Model it directly on `apps/lab/scripts/build-map.ts`, including its non-finite-height guard
(`JSON.stringify` turns `NaN` into `null`, which would read back as water, silently). Add an npm
script for it and document the invocation in `packages/server/AGENTS.md`.

- [ ] **Step 8: Prove the welcome carries it end to end**

Add to `packages/server/test-api/map-heightfield.test.ts` a test that joins a room whose map has a
heightfield over a real WebSocket and asserts `welcome.world.heightfield` decodes to a `MapData`
with the expected `size`. This is the increment's central claim — the wire carries the
heightfield — so it gets an assertion against the real app, not a unit test.

```bash
npm run test:server && npm run typecheck:server
```

- [ ] **Step 9: Commit**

```bash
git add packages/server
git commit -m "feat(server): bake and ship the terrain heightfield on the wire"
```

---

### Task 6: The HD-2D scene draws the world's ground

First visible task. A new renderer beside the old one, selected by `?hd2d=1`, drawing terrain,
water, sky and lights from the welcome's heightfield. No actors yet — the world is bare ground and
that is the honest state of it.

**Files:**
- Create: `packages/renderer/src/renderer-api.ts`
- Create: `packages/renderer/src/hd2d/scene.ts`
- Create: `packages/renderer/src/hd2d/game-renderer.ts`
- Create: `packages/renderer/test/hd2d-scene.test.ts`
- Modify: `packages/renderer/package.json`, `packages/client/src/game/session.ts`

**Interfaces:**
- Consumes: `createHd2dContext`, `createPipeline`, `createSky`, `createWater`, `createFoam`,
  `meshTerrain`, `createTextureRegistry`, `fetchAll` (all `@lindocara/hd2d`);
  `heightFieldFromGrid` (Task 2); `createTerrainQuery`, `mapToQuerySource`, `decodeMap` (engine).
- Produces:
  - `RendererLike` — the interface `session.ts` consumes, extracted from today's `Renderer` so
    both implementations satisfy one named contract instead of duck-typing.
  - `createHd2dScene(canvas: HTMLCanvasElement, map: MapData): Hd2dScene` with
    `{ render(now: number): void; resize(): void; dispose(): void; ctx: Hd2dContext; scene: THREE.Scene; camera: THREE.PerspectiveCamera; query: TerrainQuery }`.
  - `class Hd2dRenderer implements RendererLike` with `static create(canvas, serverClock)`.

- [ ] **Step 1: Extract `RendererLike`**

Write `packages/renderer/src/renderer-api.ts` declaring every method `session.ts` calls — the list
is exactly:

`configureZone`, `configureMapTerrain`, `configureMerchant`, `destroy`, `diagnostics`,
`hidePeasantBombAim`, `hideQuestSite`, `onFrame`, `playCombatAnimation`, `playCombatImpact`,
`playHealingImpact`, `playInteraction`, `playLumenPortal`, `playLumenTrail`, `playMonsterImpact`,
`playMonsterSpecialImpact`, `playPeasantBombImpact`, `playPolarityOrb`, `playRoguePoisonImpact`,
`playShadowDance`, `playTeleportEffect`, `preloadWorldEventAssets`, `removePeasantCamp`, `render`,
`screenToWorld`, `setAuthoredQuestMarkers`, `setSelfId`, `showPeasantBombAim`, `showPeasantCamp`,
`showWorldEvent`.

Copy each signature verbatim from `packages/renderer/src/renderer.ts`, then make the existing
`Renderer` declare `implements RendererLike`.

```bash
npm run typecheck:renderer
```

Expected: clean — if it is not, the extracted signature does not match and the extraction is wrong.

- [ ] **Step 2: Write the failing scene test**

`packages/renderer` runs jsdom, and `three` builds geometry and materials fine without WebGL, so
mesh a small map and assert its geometry — the same thing `packages/hd2d/test/terrain-mesh.test.ts`
already does. Read that test and follow it.

```ts
// packages/renderer/test/hd2d-scene.test.ts
import { describe, expect, it } from "vitest";
import { terrainGroupFor } from "../src/hd2d/scene.js";

describe("the HD-2D scene's terrain", () => {
  it("meshes one group per material atlas present in the map", () => { /* … */ });
  it("skips water cells rather than meshing them flat", () => { /* … */ });
  it("centres the grid on the world origin, matching createTerrainQuery", () => { /* … */ });
});
```

Export `terrainGroupFor(map: MapData, atlases)` from `scene.ts` as the pure, testable half of the
composition root — the half that needs neither a canvas nor a GL context.

- [ ] **Step 3: Run it and watch it fail**

```bash
npm test -w @lindocara/renderer -- hd2d-scene
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the scene**

`packages/renderer/src/hd2d/scene.ts` is a near-transcription of `apps/lab/src/main.ts` lines
127–330 and 481–520: context, terrain mesh, water, foam, sky, hemisphere + directional + rim
lights, pipeline. **Read `apps/lab/src/main.ts` first and copy its structure**, including its
comments' reasoning where it still applies. Do not invent a different composition order — the lab's
order is load-bearing (lights before pipeline, `RIM_LAYER` on the rim light, `shadow.normalBias`).

Add `three` and `@lindocara/hd2d` to `packages/renderer/package.json` dependencies. Leave `pixi.js`
there for now; Task 9 removes it.

- [ ] **Step 5: Write `Hd2dRenderer`**

`game-renderer.ts` implements `RendererLike`. Terrain methods are real; every effect method is an
explicit no-op carrying the same marker so they are greppable:

```ts
  /** NOT YET DRAWN ON THE HD-2D PATH — wired in a later S3 piece. */
  playCombatImpact(): void {}
```

`configureMapTerrain` gains the heightfield: change its signature on `RendererLike` to take the
decoded `MapData | null` alongside what it already takes, and have the pixi `Renderer` ignore it.

- [ ] **Step 6: Select it in `session.ts`**

```ts
// Temporary: sequences S3's first increment so each task leaves the game runnable. DELETE with the
// PixiJS path — if this flag outlives that deletion, the increment is not finished.
const useHd2d = new URLSearchParams(location.search).get("hd2d") === "1";
const renderer: RendererLike = useHd2d
  ? await Hd2dRenderer.create(canvas, serverClock)
  : await Renderer.create(canvas, serverClock);
```

- [ ] **Step 7: Run the tests, then look at it**

```bash
npm run check
```

Then, using the `playwright-cli` skill (never the Chrome extension): `npm run dev`, log in, enter a
party, and load the game route with `?hd2d=1`. Expect lit ground with real elevation and no actors.
Screenshot it. Compare against `docs/hd2d-rendering.md`'s pitfall list before calling it right —
particularly sprite/terrain z-fighting and the tilt-shift zoom coupling.

- [ ] **Step 8: Commit**

```bash
git add packages/renderer packages/client
git commit -m "feat(renderer): draw the game's terrain through hd2d behind ?hd2d=1"
```

---

### Task 7: Actors become billboards

**Files:**
- Create: `packages/renderer/src/hd2d/billboards.ts`
- Create: `packages/renderer/test/hd2d-billboards.test.ts`
- Modify: `packages/renderer/src/hd2d/game-renderer.ts`

**Interfaces:**
- Consumes: `makeBillboard`, `RIM_LAYER` (`@lindocara/hd2d/billboard.js`); `tileToPixel` (Task 5);
  `PlayerSnapshot`/`MonsterSnapshot` (`engine/protocol.js`).
- Produces:
  - `pixelToTile(value: number, size: number): number` — the inverse of Task 5's `tileToPixel`,
    exported from `packages/renderer/src/hd2d/billboards.ts` and carrying the same TILE→PIXEL
    BRIDGE banner. Snapshots arrive in pixels; the scene is in tile units.
  - `createBillboardRegistry(ctx, scene, textures): BillboardRegistry` with
    `sync(actors: readonly ActorView[]): void` and `dispose(): void`, where
    `ActorView = { id: string; kind: "player" | "monster" | "guard"; x: number; y: number; textureKey: string }`
    — **x/y in pixels**, converted inside `sync`, so exactly one place knows about the two unit
    systems.

- [ ] **Step 1: Write the failing test**

```ts
describe("the billboard registry", () => {
  it("creates one billboard per actor and reuses it across frames", () => { /* … */ });
  it("removes the billboard of an actor that left the view", () => { /* … */ });
  it("places an actor on the ground height under its position", () => { /* … */ });
  it("round-trips pixelToTile against tileToPixel", () => { /* … */ });
});
```

The round-trip assertion is the one that matters: it is the guard against the half-map offset the
origin shift causes when only one direction is implemented.

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -w @lindocara/renderer -- hd2d-billboards
```

- [ ] **Step 3: Implement the registry**

Follow `apps/lab/src/world/hero.ts` for the billboard shape (`height`, `aspect`, `foot`, `pitch`)
and `props.ts` for registry-style bulk placement. Ground height comes from the scene's
`TerrainQuery.heightAt`.

- [ ] **Step 4: Run it and watch it pass**

```bash
npm test -w @lindocara/renderer -- hd2d-billboards
```

- [ ] **Step 5: Drive it from the frame loop**

In `Hd2dRenderer.render`, map the interpolated view's players/monsters/guards into `ActorView[]`
and call `sync`. The camera follows the self player, using `apps/lab/src/main.ts`'s `updateCamera`
as the reference — including the exponential damping (framerate-independent, unlike a fixed lerp)
and the tilt-shift zoom coupling.

- [ ] **Step 6: Verify in the browser**

`npm run check`, then the app with `?hd2d=1` via the `playwright-cli` skill: walk around, confirm
the hero is drawn on the ground at the right place, the camera follows, and a second window's hero
appears. Screenshot.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer
git commit -m "feat(renderer): draw players, monsters and guards as hd2d billboards"
```

---

### Task 8: Elements and events are drawn

The scene stops being bare ground. `MapData.elements`/`events` from Task 1 arrive inside the
heightfield and are drawn as static billboards — appearance only, and no collider is derived from
either (collision is already in the terrain).

**Files:**
- Modify: `packages/renderer/src/hd2d/scene.ts`, `billboards.ts`
- Test: `packages/renderer/test/hd2d-content.test.ts`

**Interfaces:**
- Consumes: `HeightfieldElement`, `HeightfieldEvent` (Task 1); the registry (Task 7).
- Produces: `placeStaticContent(registry, map, resolveTexture): void`, where
  `resolveTexture(assetId: string) => THREE.Texture | null` — an unknown asset id yields `null` and
  is skipped with a console warning, never a thrown error that blanks the world.

- [ ] **Step 1: Write the failing test**

```ts
describe("static map content", () => {
  it("places one billboard per element at its tile position", () => { /* … */ });
  it("skips an element whose asset id resolves to nothing, and keeps the rest", () => { /* … */ });
  it("places events with a graphic and ignores those without one", () => { /* … */ });
  it("adds no collider — collision comes only from the terrain", () => { /* … */ });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -w @lindocara/renderer -- hd2d-content
```

- [ ] **Step 3: Implement, then run it and watch it pass**

- [ ] **Step 4: Fill the proving map with content**

Extend `scripts/build-proving-map.ts` to emit a handful of elements and one event,
so the increment has something to look at and the wiring is exercised end to end. Regenerate the
map.

- [ ] **Step 5: Verify in the browser, then commit**

```bash
npm run check
git add packages/renderer packages/server
git commit -m "feat(renderer): draw map elements and authored events as billboards"
```

---

### Task 9: The PixiJS path is deleted

**Files:**
- Delete: `packages/renderer/src/renderer.ts`, `stage-application.ts`,
  `catalog-element-render.ts`, `editor-asset-art.ts`; the pixi half of `tiny-swords-art.ts`
- Modify: `packages/renderer/package.json` (drop `pixi.js`), `packages/client/src/game/session.ts`
  (drop the flag), `packages/client/src/ui/AppRouter.tsx` (the editor route)
- Modify: `package.json` root scripts (quarantine the editor), `packages/editor/AGENTS.md`,
  `packages/renderer/AGENTS.md`, `AGENTS.md`, `docs/hd2d-rendering.md`

- [ ] **Step 1: Make hd2d the only path**

Remove the `?hd2d=1` branch from `session.ts`; `Hd2dRenderer` is what `session.ts` constructs.

- [ ] **Step 2: Delete the five pixi files and the dependency**

```bash
git rm packages/renderer/src/renderer.ts packages/renderer/src/stage-application.ts packages/renderer/src/catalog-element-render.ts packages/renderer/src/editor-asset-art.ts
npm pkg delete dependencies.pixi.js -w @lindocara/renderer
npm install
```

Everything else in `packages/renderer/src/` is framework-free and **stays** — art data, `feedback.ts`,
`interiors.ts`, `locale.ts`, `input.ts`, `server-clock.ts`, `display-settings.ts`, the minimap and
`world-layout.ts`. Deleting them is out of scope and would break the client for no reason.

- [ ] **Step 3: Quarantine the editor, loudly**

`packages/editor/src/game/map-preview.ts` and `map-editor-stage.ts` import files that no longer
exist. Per the spec the editor breaks here rather than keeping a second render path alive.

Remove `@lindocara/editor` from the aggregate `typecheck` and `test` scripts in the root
`package.json`, each with an inline comment naming the reason and the piece that restores it. Stub
the `editor` route in `AppRouter.tsx` so the build still succeeds and the route renders an explicit
"the editor is being rebuilt on HD-2D" message rather than a stack trace.

Add to the top of `packages/editor/AGENTS.md`:

```markdown
> **BROKEN ON PURPOSE (S3, 2026-08-04).** This package does not typecheck: its stage imports the
> PixiJS renderer, which S3's first increment deleted. It is excluded from the verify pipeline and
> is rebuilt on `@lindocara/hd2d` in its own S3 piece. You did not cause this.
```

- [ ] **Step 4: Write down what `renderer.ts` knew**

The spec warns that 5 378 lines held rules nobody wrote down — camera clamping, draw ordering,
feedback effects. Whatever surfaced across Tasks 6–8 goes into `docs/hd2d-rendering.md` now, while
it is still fresh. This step is not optional bookkeeping: it is the only artefact that survives the
deletion.

- [ ] **Step 5: Update the architecture docs**

Root `AGENTS.md` describes `@lindocara/renderer` as "browser, React-free (PixiJS)" and the render
path as "PixiJS through S3". Both are now false. Update them, plus `packages/renderer/AGENTS.md`.

- [ ] **Step 6: Full verification**

```bash
npm run v
```

Expected: green, with the editor excluded. Then the browser pass via the `playwright-cli` skill:
log in, enter a party, walk the world, confirm terrain + actors + elements render with no console
errors. Screenshot.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(renderer): retire the PixiJS render path"
```

---

## Self-review notes

Checked against the spec, section by section.

**Covered:** the wire carries the heightfield (Tasks 3, 5); `MapData` grows by exactly two fields
and no more (Task 1); the renderer follows `apps/lab/src/main.ts` (Tasks 6, 7); the client seam
does not move (Task 6 Step 6 changes only what `session.ts` hands the renderer); hd2d stays
domain-free (Task 2 takes primitives, not `MapData`); the server's own geometry does not move
(Task 5's bridge exists precisely so it does not); conversion sites are marked and greppable
(Task 5's banner, reused in Task 7); the editor breaks and says so (Task 9 Step 3); one proving
map, adventures not ported (Task 5 Step 7); each task leaves the game runnable (the `?hd2d=1` flag,
deleted in Task 9); `docs/hd2d-rendering.md` is read before the render path (Global Constraints)
and written back to (Task 9 Step 4).

**Deliberately not covered**, matching the spec's out-of-scope list: the server's geometry
migration, the movement-protocol change and `prediction.ts`'s retirement, the editor's rebuild,
porting the five authored adventures, markers/tileset/quest metadata in the map format.

**Known soft spots an implementer should expect to sharpen:**

- Task 4's test names service methods that may not exist under those names. The test asserts the
  right behaviour; the harness details come from reading `test-api/helpers.ts` first.
- Task 5 Step 3 leaves `pixelTerrainFromHeightfield`'s body as an instruction to copy
  `terrainFromMap`'s assembly rather than transcribing it. That is intentional — transcribing a
  constructor blind is how the two bakes drift — but it is the one place this plan asks the
  implementer to read production code before writing.
- Tasks 6–8's tests are named rather than fully written. Their shape is fixed by
  `packages/hd2d/test/terrain-mesh.test.ts`, which is the pattern to copy; writing them blind here
  would have invented an API that the lab's actual composition root contradicts.
- The welcome grows by roughly the size of the encoded heightfield (a 64² map is ~60 KB of JSON).
  The 2 KiB frame cap is client→server only, so nothing rejects it — but if the first browser pass
  shows a slow join, that is the cause, and `tile-layer-codec.ts` is the precedent for compressing
  it (with the same round-trip and malformed-input proofs it carries).
