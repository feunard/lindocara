# The editor shell

Status: design, 2026-07-18. Tranche 2 of `docs/adventure-editor-roadmap.md`.

## Why

Tranche 1 gave the editor a real terrain model — three layers of frozen tile ids, elevation,
tilesets — but left its chrome untouched: a toolbar of ad-hoc buttons above a Pixi stage, reached
through two intermediate screens. The target is the dense, sober tool in
`wireframes/RPG Editor.dc.html`: menu bar, toolbar, palette, stage, map tree, status bar — one
screen that *is* the adventure editor.

This tranche is chrome plus the three tools the model already supports but no tool exposes:
rectangle, fill, and the ramp stamp. No new runtime behaviour; the game client is untouched.

## What the wireframe specifies, adopted as-is

One screen, five regions:

- **Menu bar** — Fichier (new map, save, delete map), Édition (undo, redo, clear layer), Mode
  (calque 1/2/3), Outils (pencil, rect, fill, eraser), Affichage (grid, dim other layers, zoom
  100/200%), Jeu (Tester, Base de données…), and the account menu on the right.
- **Toolbar** — new/save/delete · select, pencil, rect, fill, eraser · layer selector (1/2/3) ·
  grid toggle, dim toggle, zoom · Tester on the far right.
- **Left palette** — terrains (grass with the three elevation levels, water), the stairs stamp,
  decorations from the Tiny Swords catalogue. Replaces the current floating scenery palette.
- **Centre** — the existing Pixi painting stage, unchanged underneath.
- **Right panel** — the maps of the adventure being edited: select to switch, plus new-map. This
  folds the current AdventureEditor↔MapEditor two-screen dance into one surface.
- **Status bar** — current map, dimensions, cursor cell, saved flag, active layer, active tool,
  zoom.

Wireframe elements deliberately **not** in this tranche: the event dialog (tranche 3), the EV
layer button (tranche 3), Base de données… (tranche 6), a working Tester that launches the real
adventure (tranche 6 — the button triggers the existing map preview sandbox for now). Menu items
whose action does not exist yet render disabled, not hidden: the menu structure is the contract.

## Decisions

**Components.** Everything in the shell is stock shadcn from `ui/components/` — the two-tree rule
is absolute. Nine components are added via `npm run ui:add`: dialog, select, tabs, checkbox,
tooltip, dropdown-menu, menubar, resizable, scroll-area. The hand-rolled `ui/Tabs.tsx` is not a
conflict: its one consumer is `AuthScreen.tsx`, a player-facing surface that must keep the Tiny
Swords look. Both stay; they belong to different trees. A comment on each notes the other's
existence.

**One screen replaces two.** The `adventures` and `map-editor` screens merge into one
`adventure-editor` screen whose right panel owns map switching. Adventure-level metadata (title,
max players, exit→entry links, validation) moves into a dialog reached from the menu bar and the
right panel — it is secondary chrome, not a separate screen. The store's screen union changes
accordingly; `PartiesScreen`'s "Creator tools" button routes to the merged screen.

**The layer selector is real.** `EditorTool` application takes an `activeLayer`. What a stroke
writes depends on the palette selection, not the tool: a terrain selection (grass, water,
elevation) always targets the ground layer and its wall upkeep, whatever layer is active; the
stairs stamp targets layer 1 by its own rule; rect, fill and the eraser apply the current
selection's targeting over their region, on the active layer when the selection is layer-free.
`GROUND_LAYER = 0` stays the named seam. "Estomper les autres calques" (dim) renders non-active layers at reduced alpha in the stage —
editor-only, never in the game.

**Rectangle and fill are shared brushes, not UI gestures.** `paintRect` and `floodFill` (and their
erase duals) join `shared/tile-brush.ts` as pure functions with the same contract as `paintAutotile`:
return new layers, re-resolve every affected neighbour. Fill operates on contiguous same-slot
regions, bounded by the map. Both are tested against `resolveWholeLayer` as the oracle, with
mutation proofs — the property-test discipline that caught real bugs in tranche 1.

**The ramp stamp makes elevation climbable.** The tileset's four ramp fixed tiles (a 2×2 stamp)
finally get a tool. `paintStairs(layers, col, row)` writes the four fixed ids onto layer 1,
replacing cliff-wall tiles where present. Because ramp tiles are `passable: true` and the bake
takes "any impassable tile on any layer" as solid, a ramp cell is walkable by construction — no
engine change, same as tranche 1's elevation.

One interaction needs an explicit rule: `syncWall` currently writes a wall wherever the drop
demands one and the cell does not already hold a wall. A fixed tile reads as "no wall", so painting
elevation beside a ramp would stomp the ramp with a wall. The rule: **wall upkeep never overwrites
a fixed tile.** `syncWall` writes only into cells that are empty or hold the wall slot. An author
who wants the wall back erases the ramp first. This is a change to `shared/tile-brush.ts` with its
own test.

**Keyboard.** ⌘S save, ⌘Z/⇧⌘Z undo/redo, 1/2/3 active layer, P pencil, R rect, F fill, E eraser,
S select, G grid toggle. Shortcuts live on the shell component, not on `document`, and are
disabled while a dialog or input has focus.

## Structure

```
src/client/ui/editor/            the shell — all stock shadcn
  AdventureEditorScreen.tsx      layout: menubar / toolbar / [palette | stage | maps] / status
  EditorMenuBar.tsx              menus + account, actions dispatched to the store slice
  EditorToolbar.tsx              tool buttons, layer selector, toggles, zoom
  TerrainPalette.tsx             terrains, elevation levels, stairs, decorations
  MapListPanel.tsx               the adventure's maps; new-map dialog
  AdventureSettingsDialog.tsx    title, max players, links, validation (from AdventureEditor)
  EditorStatusBar.tsx            the wireframe's bottom strip
src/client/game/editor-state.ts  gains activeLayer, rect/fill/stairs tool kinds
src/shared/tile-brush.ts         gains paintRect, floodFill, eraseRect, paintStairs;
                                 syncWall learns the fixed-tile rule
```

The stage (`map-editor-stage.ts`) keeps its handle API; the shell talks to it exactly as the old
toolbar did. Cursor-cell reporting for the status bar is the one addition to the handle.

## Testing

- Brushes: property tests against `resolveWholeLayer`; fill on a donut-shaped region; rect
  spanning the map edge; stairs replacing a wall; wall upkeep refusing to overwrite a ramp. Every
  test mutation-proven.
- Shell: the UI suite covers menu/toolbar dispatch (tool selected → store updated → stage handle
  called), layer selector threading, disabled-item policy, and shortcut gating when an input has
  focus. Rendering fidelity is explicitly out of test scope (`css: false`) — the browser pass is
  part of the definition of done.
- The merged screen: navigating from parties → editor → back preserves the adventure list; the
  dirty-navigation guard survives the merge.

## Non-goals

Events and the EV layer (t3), switches/variables (t4), commands (t5), Base de données…, real
Tester, audio (t6). Four-face cliffs stay as inherited debt unless the ramp work makes the fix
incidental — decide in review, not by default.
