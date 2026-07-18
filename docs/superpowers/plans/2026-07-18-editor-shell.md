# Editor Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-screen map/adventure editor with the wireframe's single shell — menu bar, toolbar, palette, stage, map tree, status bar — and expose the rectangle, fill and ramp tools the tranche-1 model already supports.

**Architecture:** All chrome is stock shadcn in a new `src/client/ui/editor/`; the Pixi stage keeps its handle API underneath. New brushes are pure functions in `shared/tile-brush.ts`, tested against `resolveWholeLayer` as the oracle. The `adventures` and `map-editor` screens merge into one `adventure-editor` screen.

**Spec:** `docs/superpowers/specs/2026-07-18-editor-shell-design.md` — read it first; its Decisions section governs anything this plan leaves ambiguous.

**Tech Stack:** React + stock shadcn (Base UI, base-nova), zustand, PixiJS, Vitest.

## Global Constraints

- Relative imports carry `.js`. Biome semicolons. `noNonNullAssertion` ON — no `!`. `noUncheckedIndexedAccess` ON — indexing yields `T | undefined`; narrow or use a throwing helper. `noUnusedParameters` ON.
- Two component trees, one rule each: everything in `src/client/ui/editor/` imports from `ui/components/` (stock shadcn) only — never `ui/tiny-swords/`, never hand-edited components.
- `src/client/game/` must not import React. The store is the only bridge; the `GameHandle`/stage handle is the boundary.
- `src/shared/` imports nothing from Cloudflare or the DOM; must compile under both client and worker tsconfigs.
- All brush functions are pure: new layers out, no mutation in.
- `npm run typecheck` green before every commit. `npm run check` fully green at the final task.
- **Every test added by this plan carries a mutation proof in the implementer's report: break the guarded thing, watch the named test fail, restore, watch it pass.** Tranche 1 shipped six tests that passed against broken code; this plan specifies tests as contracts with exact values rather than verbatim code, and the proof is what makes them real.
- Player-facing wording is i18n keys in both languages; editor chrome is creator tooling and follows the existing editor's convention (check how `MapEditor.tsx` handles labels today and match it).

---

### Task 1: The nine shadcn components

**Files:**
- Create (generated): `src/client/ui/components/{dialog,select,tabs,checkbox,tooltip,dropdown-menu,menubar,resizable,scroll-area}.tsx`
- Test: none (generated code; the gate is typecheck + lint + existing suites)

**Steps:** run `npm run ui:add -- dialog select tabs checkbox tooltip dropdown-menu menubar resizable scroll-area`, then `npm run lint:fix` (stock output has no semicolons). Do NOT call `npx shadcn` directly — the alias resolution breaks outside `npm run ui:add` (see CLAUDE.md). Do not hand-edit the generated files; if Biome flags something `lint:fix` cannot fix, stop and report rather than editing. Note: `ui/Tabs.tsx` (hand-rolled, player-tree, one consumer `AuthScreen.tsx`) coexists with `ui/components/tabs.tsx` by design — add a one-line comment to `ui/Tabs.tsx` naming the distinction. Verify `npm run check` stays green (the UI suite renders screens that must not be broken by new files). Commit.

---

### Task 2: Wall upkeep never overwrites a fixed tile

**Files:**
- Modify: `src/shared/tile-brush.ts` (`syncWall`)
- Test: `test/tile-elevation-brush.test.ts` (extend)

**Interfaces:** `syncWall` stays private; the observable contract is via `paintElevation`.

**Contract to implement and pin:** a cell holding a **fixed tile** (ramp) is never written by wall upkeep — neither painted with a wall nor erased — regardless of what the elevation above demands. Cells that are empty or hold `CLIFF_WALL_SLOT` keep today's behaviour exactly.

**Tests (exact scenarios):** (1) place a fixed tile id (`fixedId(0)` = 1025) at `(2,3)` on layer 1, then `paintElevation(level 1, 2, 2)` — layer 1 at `(2,3)` still holds 1025, not a wall. (2) the existing wall tests all still pass unchanged — that is the regression net for "empty and wall cells behave as before". Mutation proof: revert the guard, test (1) fails with a wall id at `(2,3)`.

TDD: write the failing test, see it fail (today the ramp is stomped), implement, pass, typecheck, commit.

---

### Task 3: Rectangle brush

**Files:**
- Modify: `src/shared/tile-brush.ts`
- Test: `test/tile-rect-brush.test.ts`

**Interfaces produced:**
```ts
paintRectAutotile(layer: TileLayer, tileset: Tileset, slot: number,
  c0: number, r0: number, c1: number, r1: number): TileLayer
eraseRect(layer: TileLayer, tileset: Tileset,
  c0: number, r0: number, c1: number, r1: number): TileLayer
```
Corners in either order; the region is clamped to the map; cells outside are untouched. Fixed tiles inside the region ARE overwritten (an explicit rectangle is an explicit intent, unlike ambient wall upkeep). After the write, every cell whose variant can have changed is re-resolved — that is the whole region plus its one-cell border.

**Tests (exact scenarios):** (1) a 3×2 grass rect on an empty 8×6 layer: interior cell variant = mask 15, corner variants match `edge16Mask` for their position (top-left = mask E+S = 6). (2) rect painted flush against `col 0`: no out-of-bounds write, left edge variants correct. (3) corners given as `(4,3)-(1,1)` equal `(1,1)-(4,3)`. (4) **the oracle property test:** seeded-PRNG sequence of ~200 random rects and erases on an 8×6 layer, asserting after every step that the layer equals `resolveWholeLayer` of itself — use mulberry32, NOT a hand-rolled LCG (tranche 1's LCG overflowed and made the walk degenerate; the fix is recorded in `.superpowers/sdd/progress.md`). Mutation proof: skip the border re-resolution, the property test must fail within the run; report the failing step.

---

### Task 4: Flood fill

**Files:**
- Modify: `src/shared/tile-brush.ts`
- Test: `test/tile-fill-brush.test.ts`

**Interfaces produced:**
```ts
floodFill(layer: TileLayer, tileset: Tileset, slot: number,
  col: number, row: number): TileLayer
```
Fills the contiguous 4-neighbour region sharing the start cell's *slot* (empty counts as a slot of its own; a fixed tile is a region of one and is replaced). Filling with the region's own slot is a no-op returning the same reference. Bounded by the map; no recursion (explicit stack — a 100×100 map is 10,000 cells and workerd's stack is not yours to spend).

**Tests (exact scenarios):** (1) donut: a grass ring around an empty hole on 8×8; filling the hole writes only the hole (count the changed cells: exactly the hole's size), and the ring's inner-edge variants re-resolve to close around it. (2) filling the outside of the donut does not leak into the hole. (3) fill on a 100×100 uniform layer completes (the stack test) and equals `resolveWholeLayer`. (4) no-op same-slot fill returns the same reference. (5) oracle property test as in Task 3, mixing fills into the walk. Mutation proofs: (a) drop the visited-set — test 3 must hang or fail, use a step cap to make it fail; (b) drop neighbour re-resolution — donut test fails on the ring's inner edge.

---

### Task 5: The stairs stamp

**Files:**
- Modify: `src/shared/tile-brush.ts`
- Test: `test/tile-stairs-brush.test.ts`

**Interfaces produced:**
```ts
paintStairs(layers: readonly TileLayer[], tileset: Tileset,
  col: number, row: number): TileLayer[]
```
Writes the tileset's four ramp fixed tiles (`fixedId(0..3)`, the 2×2 stamp: 0=top-left, 1=bottom-left, 2=top-right, 3=bottom-right per the sheet crop) onto **layer 1** at `(col,row)..(col+1,row+1)`, replacing whatever is there including cliff walls. Rejects (returns layers unchanged) if any of the four cells is out of bounds. After placement, re-resolve wall runs adjacent to the replaced cells so a run4 wall row closes correctly beside the stamp.

**Tests (exact scenarios):** (1) stamp on a wall row: the two wall cells under the stamp become `fixedId(1)`/`fixedId(3)`, the wall cells either side re-resolve their run ends (left neighbour becomes mask-1 "right end"). (2) stamp at `col = cols-1` is refused, layers unchanged, same reference. (3) with Task 2 in place: painting elevation beside the stamp leaves all four stamp cells intact. (4) bake: a cell under the stamp is walkable (`bakeCollision` yields non-solid) even when the ground beneath is a wall-casting drop — this is the "ramps join levels" acceptance test, phrased on the bake because the engine has no other observable. Mutation proof: make the stamp write to layer 0 — tests 1 and 4 fail.

---

### Task 6: `activeLayer` and the new tool kinds

**Files:**
- Modify: `src/client/game/editor-state.ts`
- Test: `test/editor-state.test.ts` (extend)

**Interfaces produced:** `EditorTool` gains `{ kind: "rect" }`, `{ kind: "fill" }`, `{ kind: "stairs" }`; the editor state gains `activeLayer: 0 | 1 | 2` (default 0) and a setter; tool application signatures thread it. Targeting follows the spec's rule: terrain selections always target ground + wall upkeep; stairs target layer 1; rect/fill/eraser use `activeLayer` when the selection is layer-free. Rect needs drag anchoring in state (`strokeAnchor`), applied on release via `paintRectAutotile`/`eraseRect`; fill applies on click.

**Tests:** rect tool anchors on stroke start and commits the rectangle on release as ONE undo entry; fill on click is one undo entry; `activeLayer` routes an eraser stroke to layer 2 when active layer is 2 and the cell has no element/marker; terrain selection on active layer 2 still writes ground. Mutation proofs per test (e.g. commit the rect per-cell instead of once — the undo-entry test fails).

---

### Task 7: The shell — layout, toolbar, menu bar, status bar

**Files:**
- Create: `src/client/ui/editor/AdventureEditorScreen.tsx`, `EditorMenuBar.tsx`, `EditorToolbar.tsx`, `EditorStatusBar.tsx`
- Modify: `src/client/store.ts` (screen union), `src/client/ui/App.tsx`, `src/client/ui/PartiesScreen.tsx`
- Test: `test/ui/editor-shell.test.tsx`

The screen union replaces `"adventures" | "map-editor"` with `"adventure-editor"`; `PartiesScreen`'s creator button routes there. The screen renders: menubar row (shadcn `menubar`), toolbar row, a `resizable` three-pane body (palette | stage mount | map panel placeholder), status bar. The stage mounts exactly as `MapEditorStage` does today — same handle, same lifecycle; lift that mounting code, do not rewrite it. Menus per the spec; actions without a backing implementation this tranche (Base de données…, clear layer if unimplemented) render `disabled`. Toolbar buttons dispatch the same store/tool updates the old toolbar did, plus the three new tools and the layer selector (shadcn `select` or a three-button group matching the wireframe). Status bar shows map name, `cols×rows`, cursor `(—,—)` until Task 9 wires it, saved flag, layer, tool, zoom.

**Tests:** clicking each tool button updates the store's tool; the layer selector sets `activeLayer`; disabled menu items do not dispatch; the screen mounts without a network round-trip beyond what the old screens made (assert on the mocked fetch count staying equal — regression net for the merge). Mutation proof: wire one tool button to the wrong tool kind — the dispatch test fails.

Old screens are NOT deleted yet — Task 8 does that once the map panel replaces their remaining duties.

---

### Task 8: Map panel, adventure settings dialog, screen deletion

**Files:**
- Create: `src/client/ui/editor/MapListPanel.tsx`, `src/client/ui/editor/AdventureSettingsDialog.tsx`
- Delete: `src/client/ui/AdventureEditor.tsx`, `src/client/ui/MapEditor.tsx` (the screen shells; keep any extracted stage-mount helper)
- Test: `test/ui/editor-shell.test.tsx` (extend), migrate surviving assertions from `test/ui/map-editor.test.tsx`

MapListPanel lists the adventure's maps (name + dims badge, wireframe-style), switches the stage's map on select (through the existing load path — dirty guard included), and hosts new-map (dialog with name/cols/rows, the fields the current `MapEditor` list screen has). AdventureSettingsDialog absorbs `AdventureEditor.tsx`'s remaining duties: title, max players, map membership, exit→entry links, validation display, save. Reached from menu Fichier and a panel button. Delete the two old screens; migrate their tests' surviving intents rather than deleting them — each migrated test keeps its name and its reason.

**Tests:** switching maps with unsaved changes raises the dirty guard (assert the confirm path and the cancel path); new-map creates through the same API call the old screen made; the settings dialog round-trips title/maxPlayers; validation messages render for a graph with an unbound exit. Mutation proofs on the dirty guard (remove the guard call — test fails) and one migrated test of your choice, named in the report.

---

### Task 9: Palette, dim, cursor cell

**Files:**
- Create: `src/client/ui/editor/TerrainPalette.tsx`
- Modify: `src/client/game/map-editor-stage.ts` (dim + cursor reporting), `src/client/ui/editor/EditorStatusBar.tsx`
- Test: `test/ui/editor-shell.test.tsx` (extend), `test/ui/map-editor-stage.test.tsx` (extend)

TerrainPalette: terrains section (grass, water as the wireframe shows them; the three elevation levels as the level selector the current toolbar has, folded into the palette per the wireframe's "Élévation de l'herbe" row), the stairs stamp entry, decorations from the existing catalogue palette (lift `EditorAssetPalette`'s data source, restyle in shadcn — do not fork its catalogue logic). Selecting a palette entry sets the brush; the toolbar's tool and the palette's selection compose per the spec's targeting rule.

Stage: "dim other layers" renders non-active layers at `alpha 0.35` (editor-only); cursor cell reported through the handle (`onCursorCell(col|null, row|null)`) and shown in the status bar as `Curseur (c, r)` / `(—,—)` off-canvas.

**Tests:** palette selection updates the brush in the store; dim toggle sets alpha on the non-active layer containers (the stage test file has the fixture-tileset pattern for container assertions); cursor callback updates the status bar text. Mutation proofs: dim applied to the active layer instead — container test fails; cursor callback dropped — status test fails.

---

### Task 10: Keyboard shortcuts

**Files:**
- Modify: `src/client/ui/editor/AdventureEditorScreen.tsx`
- Test: `test/ui/editor-shell.test.tsx` (extend)

⌘S save (preventDefault), ⌘Z/⇧⌘Z undo/redo, 1/2/3 layer, P/R/F/E/S tools, G grid. Bound on the screen's container, not `document`; inert while any input, textarea or open dialog has focus (check `event.target` and the dialog state — the shadcn dialog renders a portal, so target-checking alone is insufficient; gate on the dialog-open state too).

**Tests:** each shortcut dispatches; typing "r" into the new-map name input does NOT switch tools; ⌘S with the settings dialog open does not double-fire save. Mutation proof: remove the input gate — the name-input test fails.

---

### Task 11: Browser pass and docs

**Files:**
- Modify: `CLAUDE.md` (the editor section: one screen now, shell layout, where the code lives), `docs/adventure-editor-roadmap.md` (mark tranche 2, note anything discovered)
- Test: none new; `npm run check` fully green is the gate.

The UI suite runs `css: false` and mocks the stage — no test in this repo sees pixels. Drive the real app (`npm run dev`, Playwright or the Chrome extension): create an adventure and a map through the new shell; paint grass, a rectangle, a fill region, elevation, a stairs stamp; switch layers and paint a decoration on layer 2; toggle dim and grid; resize the panes; save; hard-reload; reopen — everything survives, console clean of errors throughout. Screenshot each stage of that walk for the report. Then update the docs and commit.

The definition of done for the whole plan is this task's walk, not the suite.
