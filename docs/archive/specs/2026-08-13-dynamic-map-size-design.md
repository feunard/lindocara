# Dynamic map size in the adventure editor — design

**Date:** 2026-08-13
**Status:** Approved

## Problem

The editor treats a map as a fixed `cols × rows` rect chosen at creation time. The author cannot
paint outside it: the pointer never produces an out-of-bounds cell
(`placementAt`, `packages/editor/src/game/map-editor-stage.ts`), every brush no-ops out of bounds
(`packages/engine/src/tile-brush.ts`), and the camera cannot even pan past the map square
(`packages/renderer/src/hd2d/scene.ts` focus clamp). The grid overlay stops at the map edge.

The desired authoring model: the grid is everywhere, a tile can be painted anywhere, the map's
size is **derived** from where tiles were painted, and a cell with no tile is ocean water.

## What the engine already gives us

Two findings make this feature far cheaper than it looks:

- **"No tile = ocean" is already the model.** `EMPTY_TILE = 0` is the void
  (`packages/engine/src/tileset.ts`), the editor's water brush is an eraser
  (`contentSlot` returns `null` for water, `editor-state.ts`), and `compileAuthoredMap`
  (`packages/engine/src/hd2d/authored-map.ts`) maps an empty ground cell to `level: null`, which
  IS water in the heightfield. There is no water tile id to invent.
- **The heightfield is already square and water-padded.** `compileAuthoredMap` uses
  `size = max(cols, rows)`; a 40×30 map already ships ten rows of ocean the author never painted.
  Every runtime consumer (room bounds, minimap, navigation, camera) reads the square
  `terrain.size`, not `cols/rows`.

The blockers are all editorial, plus the fact that tile layers are dense row-major
`cols × rows` arrays with no origin (`packages/engine/src/tile-layer-codec.ts`): growing a map
leftward or upward means re-indexing every id in all three layers.

## Decisions taken (with the user)

1. **Runtime scope: bounded rect + ocean margin.** The saved map is the bounding rect of painted
   content plus a small ocean margin. Heroes can swim the margin and stop at `withinRoomBounds`.
   No infinite playable ocean.
2. **Pure derivation.** Size is always the bounding rect of current content (+ margin). Erasing
   edge tiles shrinks the map on the next save.
3. **Legacy maps auto-trim on save.** Opening an old map and saving it trims never-painted
   borders. Exits are safe (they bind destination maps by event uuid, not coordinates); heroes
   persisted on a re-cropped map are covered by the join snap in §5.

## Chosen approach: fixed virtual canvas, crop at save

The editor session always works on a **256×256 canvas document**. 256 is the engine's existing
hard ceiling — `MAP_MAX_COLS/ROWS`, `MAX_MAP_CELLS`, `MAX_HEIGHTFIELD_SIZE` and
`MOVE_COORDINATE_LIMIT` are all coupled to it — so "infinite" honestly means "up to 256×256".

Rejected alternatives: growing/shrinking the dense document live during editing (requires camera
compensation for origin shifts mid-stroke and still needs an oversized grid/picking surface, i.e.
most of the canvas machinery plus re-indexing on top); a sparse document (forks the shared dense
brush layer in `tile-brush.ts` for no user-visible gain — the save is capped at 256 regardless).

### 1. Engine: canvas/crop primitives

New pure functions beside `map-template.ts`, unit-tested in `packages/engine/test/`:

- `padMapToCanvas(map)` — places a stored map's content **centered** in a 256×256 document,
  shifting layers, elements, events, markers and spawn by the pad offset. Used once at session
  open.
- `contentBounds(map)` — bounding rect of all authored content: non-empty tiles on **any** of the
  three layers, elements (their `col`/`row`), events, legacy anchored markers (they are
  bounds-validated at parse time, so leaving one outside the crop would fail the save), and the
  spawn cell. `null` for an empty document.
- `derivedMapRect(map)` — `contentBounds` grown by `MAP_OCEAN_MARGIN = 2` (new constant in
  `map-limits.ts`) on every side, floored to the existing `MAP_MIN_COLS × MAP_MIN_ROWS` (20×15,
  extra cells distributed evenly around content), clamped to the canvas.
- `cropMapToRect(map, rect)` — slices the three layers and shifts every coordinate by the rect
  origin. This is what gets saved.

The stored format does not change: `cols`/`rows` + dense RLE layers, water = absence of ground
tile. Round-trip property: `crop(pad(map))` reproduces the map modulo trimmed empty borders.

### 2. Editor session and UI

- Session open (`openAdventure` and the sandbox path in `adventure-session.ts`) pads the map into
  the canvas document. Coordinates never shift for the life of the session — no camera jumps, no
  history coordinate drift. After a save the session keeps its canvas coordinates; re-centering
  happens only on the next open.
- `toSaveInput` (`editor-state.ts`) crops to the derived rect first, then encodes layers and
  compiles the heightfield **from the cropped map**. What is saved is exactly what runs.
- The New-map dialog (`MapListPanel.tsx`) loses its cols/rows inputs. Every map is born from the
  single-source `defaultMapInput` (a small starter island with a walkable spawn) and grows by
  painting. The server's `createMap` path is untouched.
- The status bar shows the live derived size (e.g. `44×32`) instead of stored dims; the map list
  keeps showing stored dims.
- `commitEditorHistory` gains a depth cap (`EDITOR_HISTORY_LIMIT = 100`, oldest snapshots
  dropped). History is unbounded today and canvas-sized snapshots make that worth fixing now.
- i18n: en/fr entries for the removed size inputs, the derived-size label, and a short
  "empty = ocean" hint. No server-side strings (no `EventCode` involved).

### 3. Stage and renderer

Because the working document IS 256×256, the existing renderer clamps become the canvas bounds
with no renderer surgery: the camera focus clamp, `screenToWorld`/`pickGround` rejection and the
grid overlay all key off the document size, so grid, picking and pan cover the whole ocean
automatically. Remaining work, all in the editor stage and the overlay contract:

- A **save-rect outline** on the stage: new optional field on `Hd2dEditorOverlay`
  (`packages/renderer/src/hd2d/visual-layer.ts`) fed with `derivedMapRect` by
  `map-editor-stage.ts`, so the author always sees what will be saved.
- The red blocked-cell overlay (`blockedCells`) is restricted to the derived rect — marking 60k
  ocean cells is noise.
- `centreCamera` and session-open focus target the content rect, not the canvas center.
- The in-editor playable preview (`map-preview.ts`) compiles the **cropped** map so preview
  bounds match runtime exactly.

Performance: the per-stroke recompile touches 65 536 cells (array fills — trivial); grid lines
are ~514 segments; terrain mesh cost stays proportional to painted cells because ocean is the
water plane.

### 4. Server and runtime

No schema, wire, or validation changes. `validateMapInput` keeps enforcing 20×15..256×256 and
the editor's crop guarantees compliance. The three coupled size validators
(`validateMapInput`, `isWorldInfo`, `zoneFromMapPayload`) are untouched, so the
unjoinable-on-mismatch failure mode cannot be introduced by this feature.

### 5. Join snap (auto-trim safety)

On join, a persisted hero position that fails `canStand` or falls outside `withinRoomBounds`
snaps to `mapEntryPosition`. This covers heroes persisted on a since-re-cropped map, and is
independently correct today for "the author painted water where a hero stood". If the join path
already behaves this way, the design point reduces to a test that proves it.

### 6. Testing

- **Engine (node):** unit tests for the four primitives — round-trip, coordinate shifts on
  elements/events/spawn/markers, margin, min floor, canvas clamp, empty-document behavior,
  content on decoration/cliff layers counting toward bounds.
- **Editor (jsdom):** paint outside the old rect → save grows; erase edge tiles → save shrinks;
  derived size in the status bar; history cap; sandbox opens as ocean + starter island; New-map
  dialog has no size inputs.
- **Server (`packages/server/test-api/`, real app):** save a cropped map via the real PUT, join
  it over a real WebSocket, assert bounds/heightfield agree; join-snap coverage for a persisted
  position that is no longer standable.

## Out of scope

- Raising the 256 ceiling (couples `MOVE_COORDINATE_LIMIT`, `MAX_HEIGHTFIELD_BYTES`, AOI radii).
- Sparse layer storage.
- Scaling `MAX_MAP_ELEMENTS` / `MAX_EVENTS_PER_MAP` with map area.
- Any change to water gameplay (swim, breath, drowning untouched).
