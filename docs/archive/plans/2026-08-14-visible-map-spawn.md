# Visible Map Spawn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the map's one hero start cell persistently on the editor stage, in every mode, and rename the copy that calls it a fallback.

**Architecture:** `Hd2dEditorOverlay` gains an optional `spawn` point; `map-editor-stage.ts` fills it from `map.spawn`; `Hd2dVisualLayer` draws a cached flag-pin group at it. Moving the spawn already works end to end — this adds the feedback that was missing and fixes the copy. No schema, no migration, no protocol, nothing in `packages/server`.

**Tech Stack:** TypeScript, three.js (`@lindocara/hd2d` + `packages/renderer/src/hd2d`), React 19 + `@alepha/ui` for the editor chrome, Vitest (jsdom for `renderer` and `editor`), Biome.

Increment 1 of [`docs/archive/specs/2026-08-14-spawn-and-start-map-design.md`](../specs/2026-08-14-spawn-and-start-map-design.md). Increment 2 (`adventures.startMapId`, retiring the `spawn` event kind) is **out of scope here** and earns its own plan.

## Global Constraints

- **English only** — code, comments, commit messages, test names, docs. This holds even where surrounding French identifiers exist (`packages/engine/src/hd2d/` keeps its French names deliberately; do not rename any, and do not add new French).
- **No `Co-authored-by` trailer** on any commit. No AI attribution of any kind.
- **Every player-facing string lives in both dictionaries** — `packages/engine/src/i18n/en.ts` and `fr.ts`. `packages/engine/test/i18n.test.ts` asserts parity and non-empty values; a key added to one and not the other fails the suite.
- **Collision comes only from the heightfield.** This overlay is appearance. Never derive walkability from `layers`, `elements` or `events`.
- **`setEditorOverlay` runs on every hover.** Anything expensive built inside it must be cached — see `#gridLines`/`#gridKey` (`packages/renderer/src/hd2d/visual-layer.ts:1381-1393`) and commit `c690d0c2`, which was spent fixing a stall of exactly this shape.
- **Two component trees:** creator surfaces use `@alepha/ui`, never `ui/tiny-swords/`. No chrome changes in this plan, but do not import a Tiny component if you touch one.
- Run `npm run check` before the final commit of each task (lint + typecheck + tests). `npm run lint:fix` applies Biome formatting.

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `packages/renderer/src/hd2d/visual-layer.ts` | Modify | `Hd2dEditorOverlay.spawn` field (`:124-146`); `#spawnMarker` cache field beside `#gridLines` (`:322`); `#buildSpawnMarker()` beside `#buildEditorGrid` (`:1336`); draw + position in `setEditorOverlay` (`:1367`); dispose (`:1660`) |
| `packages/editor/src/game/map-editor-stage.ts` | Modify | Fill `spawn` in the `setEditorOverlay` payload (`:300`) |
| `packages/engine/src/i18n/en.ts` | Modify | `editor.tool.spawn`, `editor.tool.spawn.hint`, `editor.inspector.spawn`, `editor.error.spawn` |
| `packages/engine/src/i18n/fr.ts` | Modify | The same four keys |
| `packages/editor/src/ui/editor/AdventureSettingsDialog.tsx` | Modify | Stale comment at `:48` |
| `packages/renderer/test/hd2d-visual-layer.test.ts` | Modify | Marker presence, position, and cache-identity across hovers |
| `packages/editor/test/map-editor-stage.test.tsx` | Modify | Overlay payload carries the spawn, in every mode, and follows a move |

Three tasks. Task 1 is the data contract (no pixels), Task 2 the drawing, Task 3 the copy. Each ends green and committable on its own.

---

### Task 1: The overlay carries the spawn

**Files:**
- Modify: `packages/renderer/src/hd2d/visual-layer.ts:124-146`
- Modify: `packages/editor/src/game/map-editor-stage.ts:300-320`
- Test: `packages/editor/test/map-editor-stage.test.tsx`

**Interfaces:**
- Consumes: `Hd2dEditorOverlay` (`packages/renderer/src/hd2d/visual-layer.ts:124`), `GroundVector` (`@lindocara/engine/ground.js`, already imported there for `hover`), `editorMapSize(map)` → `{cols, rows}` (`packages/editor/src/game/editor-state.ts:795`).
- Produces: `Hd2dEditorOverlay.spawn?: GroundVector | null` — world coordinates of the map's spawn CELL CENTRE, computed as `col + 0.5 - size / 2` / `row + 0.5 - size / 2` where `size = Math.max(cols, rows)`. Task 2 draws it.

- [ ] **Step 1: Write the failing test**

Add to `packages/editor/test/map-editor-stage.test.tsx`, after the existing `"the overlay carries the derived save rect…"` test (`:106-126`):

```tsx
  it("the overlay carries the map's spawn, in every mode and after it moves", async () => {
    // blankMap(20, 15) spawns dead centre at col 10 / row 7; the stage's world origin is the
    // canvas centre, so size = max(20, 15) = 20 and the cell centre is (0.5, -2.5).
    const map = blankMap("Map", 20, 15);
    const stage = await openMapEditorStage(map, vi.fn());
    expect(mock.renderer.setEditorOverlay.mock.lastCall?.[0].spawn).toEqual({ x: 0.5, z: -2.5 });

    // A fact about the map, not a Field-mode tool artefact: it must survive into the two modes
    // where an author can bury it under scenery or an event without noticing.
    stage.setActiveMode("element");
    expect(mock.renderer.setEditorOverlay.mock.lastCall?.[0].spawn).toEqual({ x: 0.5, z: -2.5 });
    stage.setActiveMode("event");
    expect(mock.renderer.setEditorOverlay.mock.lastCall?.[0].spawn).toEqual({ x: 0.5, z: -2.5 });

    stage.replaceMap({ ...stage.current(), spawn: { col: 3, row: 4 } });
    expect(mock.renderer.setEditorOverlay.mock.lastCall?.[0].spawn).toEqual({ x: -6.5, z: -5.5 });
    stage.dispose();
  });
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --project editor test/map-editor-stage.test.tsx -t "carries the map's spawn"
```

Expected: FAIL — `expected undefined to deeply equal { x: 0.5, z: -2.5 }`.

- [ ] **Step 3: Add the field to the overlay contract**

In `packages/renderer/src/hd2d/visual-layer.ts`, inside `interface Hd2dEditorOverlay`, immediately after the `saveRect` field (`:143-145`):

```ts
  /** The map's one hero start cell, as a world-space cell centre. Drawn persistently rather than
   *  as a selection: it is a fact about the map, like `saveRect`, and an author who cannot see it
   *  buries it under scenery and then meets `keepsSpawnClear`'s refusal with no visible cause. */
  spawn?: GroundVector | null;
```

- [ ] **Step 4: Fill it from the stage**

In `packages/editor/src/game/map-editor-stage.ts`, inside the `renderer.setEditorOverlay({ … })` call (`:300`), add after the `saveRect` block (`:309-314`):

```ts
        spawn: {
          x: map.spawn.col + 0.5 - size / 2,
          z: map.spawn.row + 0.5 - size / 2,
        },
```

`size` is already in scope on the line above (`const size = Math.max(cols, rows);`, `:291`).

- [ ] **Step 5: Run the test and the two suites**

```bash
npx vitest run --project editor test/map-editor-stage.test.tsx
```

Expected: PASS, whole file green.

```bash
npm run typecheck:renderer && npm run typecheck:editor
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/hd2d/visual-layer.ts packages/editor/src/game/map-editor-stage.ts packages/editor/test/map-editor-stage.test.tsx
git commit -m "feat(renderer,editor): the editor overlay carries the map's spawn cell"
```

---

### Task 2: Draw the spawn, built once

**Files:**
- Modify: `packages/renderer/src/hd2d/visual-layer.ts` — field at `:322`, builder beside `:1336`, draw in `setEditorOverlay` `:1367-1485`, dispose at `:1655-1665`
- Test: `packages/renderer/test/hd2d-visual-layer.test.ts`

**Interfaces:**
- Consumes: `Hd2dEditorOverlay.spawn` from Task 1; `disposeObject(object)` (`visual-layer.ts:148`); `transparentMaterial(color, opacity)` (`:163`); the private `#groundY(x, z, lift)` and `#editorRoot` (a `THREE.Group` named `"editor-overlay"`, added to the scene at `:349-351`).
- Produces: a `THREE.Group` named `"editor-spawn"` under `"editor-overlay"`, positioned at the spawn's ground point. Tests reach it with `root.getObjectByName("editor-spawn")`.

The colour is **`0x6fe08a` (green)** — deliberately none of the four already in use: hover `0xffd66b`, selection and save rect `0x57d6ff`, collision `0xd84b3e`.

- [ ] **Step 1: Write the failing test**

Add to `packages/renderer/test/hd2d-visual-layer.test.ts`:

```ts
describe("Hd2dVisualLayer spawn marker", () => {
  const base = {
    cols: 20,
    rows: 15,
    showGrid: false,
    showCollisions: false,
    dim: false,
    colliders: [],
  };

  it("draws the spawn where the overlay puts it, and nothing when there is none", () => {
    const { layer, root } = harness();
    layer.setEditorOverlay({ ...base, spawn: { x: 0.5, z: -2.5 } });
    const marker = root.getObjectByName("editor-spawn");
    expect(marker).toBeDefined();
    expect(marker?.position.x).toBeCloseTo(0.5);
    expect(marker?.position.z).toBeCloseTo(-2.5);

    layer.setEditorOverlay({ ...base, spawn: null });
    expect(root.getObjectByName("editor-spawn")).toBeUndefined();
  });

  it("reuses the same marker across hovers instead of rebuilding it", () => {
    // `setEditorOverlay` runs on every pointer move. Rebuilding a pin's geometry there is the
    // stall `c690d0c2` paid for once already — the grid is cached for the same reason.
    const { layer, root } = harness();
    layer.setEditorOverlay({ ...base, spawn: { x: 0.5, z: -2.5 }, hover: { x: 1.5, z: 1.5 } });
    const first = root.getObjectByName("editor-spawn");
    layer.setEditorOverlay({ ...base, spawn: { x: 0.5, z: -2.5 }, hover: { x: 2.5, z: 2.5 } });
    expect(root.getObjectByName("editor-spawn")).toBe(first);

    // And it follows the spawn when the spawn actually moves, without being replaced.
    layer.setEditorOverlay({ ...base, spawn: { x: -6.5, z: -5.5 } });
    const moved = root.getObjectByName("editor-spawn");
    expect(moved).toBe(first);
    expect(moved?.position.x).toBeCloseTo(-6.5);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --project renderer test/hd2d-visual-layer.test.ts -t "spawn marker"
```

Expected: FAIL — `expected undefined to be defined`.

- [ ] **Step 3: Add the cache field**

In `packages/renderer/src/hd2d/visual-layer.ts`, beside `#gridLines` (`:322`):

```ts
  /** Built once and repositioned, never rebuilt: `setEditorOverlay` runs on every hover. Unlike
   *  `#gridLines` this needs no cache key — its geometry does not depend on the map at all, only
   *  its position does. */
  #spawnMarker: THREE.Group | null = null;
```

- [ ] **Step 4: Write the builder**

Immediately after `#buildEditorGrid` (`:1365`):

```ts
  /** The hero start marker: a tinted cell so the exact square is unambiguous, and a pole with a
   *  camera-facing head so it still reads when the authoring camera is orbited or pulled back.
   *  A `Sprite` rather than a quad because the editor camera turns (`[`/`]` and right-drag) and a
   *  flat flag would vanish edge-on at two of the four quarter turns. Deliberately NOT the Warrior
   *  sprite the palette previews with: that reads as a placed element, and the stage refuses to
   *  select or delete this one. */
  #buildSpawnMarker(): THREE.Group {
    const group = new THREE.Group();
    group.name = "editor-spawn";

    const cell = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), transparentMaterial(0x6fe08a, 0.3));
    cell.rotation.x = -Math.PI / 2;
    group.add(cell);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1, 6),
      transparentMaterial(0xf2fbf3, 0.95),
    );
    pole.position.y = 0.5;
    group.add(pole);

    const head = new THREE.Sprite(
      new THREE.SpriteMaterial({ color: 0x6fe08a, transparent: true, opacity: 0.95, toneMapped: false }),
    );
    head.scale.set(0.42, 0.42, 1);
    head.position.y = 1.05;
    group.add(head);

    return group;
  }
```

- [ ] **Step 5: Draw it, detaching it from the clear loop**

Two edits in `setEditorOverlay`.

First, beside the existing grid detach (`:1371`), so the clear loop below does not dispose the cached marker:

```ts
    if (this.#gridLines) this.#gridLines.removeFromParent();
    if (this.#spawnMarker) this.#spawnMarker.removeFromParent();
```

Second, after the `saveRect` block closes (`:1439`) and before the `cursorCells` line (`:1443`):

```ts
    if (overlay.spawn) {
      this.#spawnMarker ??= this.#buildSpawnMarker();
      const { x, z } = overlay.spawn;
      this.#spawnMarker.position.set(x, this.#groundY(x, z, lift + 0.02), z);
      this.#editorRoot.add(this.#spawnMarker);
    }
```

- [ ] **Step 6: Dispose it**

In `dispose()`, beside the `#gridLines` teardown (`:1660-1663`):

```ts
    if (this.#spawnMarker) {
      disposeObject(this.#spawnMarker);
      this.#spawnMarker = null;
    }
```

`disposeObject` (`:148`) already traverses `Mesh`, `Line` and `Sprite`, so both the pole/cell meshes and the sprite head are covered.

- [ ] **Step 7: Run the tests**

```bash
npx vitest run --project renderer test/hd2d-visual-layer.test.ts
```

Expected: PASS, whole file green.

```bash
npm run typecheck:renderer
```

Expected: exit 0.

- [ ] **Step 8: See it**

The dev server is pinned to port **5273** (`strictPort`). If it is already up, use it; a collision means a stale server is running — stop that one, do not start a second on another port.

```bash
playwright-cli -s=spawn open http://localhost:5273/editor
```

Then: `playwright-cli -s=spawn screenshot --filename=/tmp/spawn.png` and look at it. The green pin must be visible at the map centre without anything being selected, and must stay visible after switching to Scenery and Events mode (`playwright-cli -s=spawn click "getByRole('radio', { name: 'Scenery' })"`). Close with `playwright-cli -s=spawn close`.

CSS and 3D output are not covered by tests (`css: false`, and no test renders a frame) — this step is the only thing that can catch a marker that is technically present and visually useless.

- [ ] **Step 9: Commit**

```bash
git add packages/renderer/src/hd2d/visual-layer.ts packages/renderer/test/hd2d-visual-layer.test.ts
git commit -m "feat(renderer): draw the map spawn as a cached pin on the editor stage"
```

---

### Task 3: Stop calling it a fallback

**Files:**
- Modify: `packages/engine/src/i18n/en.ts:1158-1160`, `:1178`, `:1258`
- Modify: `packages/engine/src/i18n/fr.ts:1173-1175` and the matching two keys
- Modify: `packages/editor/src/ui/editor/AdventureSettingsDialog.tsx:48`
- Test: `packages/engine/test/i18n.test.ts` (existing parity test — no new test needed; `packages/editor/test/editor-shell.test.tsx:525` reads the key through `t()` and follows automatically)

**Interfaces:**
- Consumes: nothing new.
- Produces: no new keys — four existing values change. Key names stay identical, so no call site moves.

- [ ] **Step 1: Rewrite the English values**

In `packages/engine/src/i18n/en.ts`:

```ts
  "editor.tool.spawn": "Hero start point",
  "editor.tool.spawn.hint":
    "Where a hero lands on this map — the adventure start, an exit from another map, a teleport or a playtest all arrive here. One per map.",
```

and:

```ts
  "editor.inspector.spawn": "Hero start point",
```

and:

```ts
  "editor.error.spawn": "The hero start point must be on walkable ground.",
```

- [ ] **Step 2: Rewrite the French values**

In `packages/engine/src/i18n/fr.ts`, the same four keys:

```ts
  "editor.tool.spawn": "Point d'arrivée du héros",
  "editor.tool.spawn.hint":
    "Où un héros arrive sur cette carte — le départ de l'aventure, une sortie depuis une autre carte, une téléportation ou un test y arrivent tous. Un seul par carte.",
```

```ts
  "editor.inspector.spawn": "Point d'arrivée du héros",
```

```ts
  "editor.error.spawn": "Le point d'arrivée du héros doit être sur un sol praticable.",
```

- [ ] **Step 3: Fix the stale comment**

The docblock at `packages/editor/src/ui/editor/AdventureSettingsDialog.tsx:40-50` ends its
membership sentence with a claim that is only half true. Replace exactly this clause on `:48`:

```
 * add/remove/reorder), and where a hero spawns is derived server-side from a placed spawn event.
```

with:

```
 * add/remove/reorder). A placed spawn EVENT picks which map the adventure starts on; the landing
 * CELL is always that map's own hero start point, compiled into its heightfield — the event's own
 * cell is never read (`HeroService.startOn`).
```

Only the sentence changes — no behaviour, no imports. (The event kind's fate is increment 2.)

- [ ] **Step 4: Run the suites that read these strings**

```bash
npm run test:engine && npx vitest run --project editor test/editor-shell.test.tsx
```

Expected: PASS. The i18n test proves en/fr parity and non-empty values; `editor-shell.test.tsx:525` finds the palette button through `t("editor.tool.spawn")`, so it follows the rename without editing.

- [ ] **Step 5: Full check**

```bash
npm run check
```

Expected: catalog/map checks, lint, typecheck and all 279 test files green.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/i18n/en.ts packages/engine/src/i18n/fr.ts packages/editor/src/ui/editor/AdventureSettingsDialog.tsx
git commit -m "fix(editor): the hero start point is not a fallback, so stop calling it one"
```

---

## Out of scope, on purpose

- `adventures.startMapId`, the maps-panel star, and retiring the `spawn` event kind — increment 2, its own plan.
- `maps.isFirst` and `POST /api/maps/:id/first`. Account-scoped, client-dead, and confusable with the start map. Removing them is a separate schema change and must not ride in this migration-free increment.
- Dragging the spawn marker with the pointer. `moveSelection` (`packages/editor/src/game/editor-state.ts:466`) already supports it and the Field-palette click already moves the spawn; adding a second gesture is not what "I want to move the spawn" was missing.
