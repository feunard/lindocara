# @lindocara/editor contributor guide

The creator-tools package is active and verified. Its map stage and playable preview both use the
same HD-2D renderer and terrain compiler as the shipped game. PixiJS is not a supported fallback.

## Responsibility

- `src/ui/editor/` owns the adventure and map authoring screens.
- `src/game/map-editor-stage.ts` owns the imperative WYSIWYG stage: paint, erase, elevation,
  selection, event placement, pan/zoom, grid/collision overlays and undo/redo integration.
- `src/game/map-preview.ts` owns playable preview and runs the real client hero controller.
- `src/game/editor-state.ts` owns pure editor mutations and serialization.
- The package composes `@lindocara/engine`, `@lindocara/renderer`, `@lindocara/client` and
  `@alepha/ui`; it must not duplicate their movement, terrain or rendering rules.
- Entering the editor opens an **unsaved local sandbox** (`createSandboxSession()` in
  `src/ui/editor/adventure-session.ts`) and WRITES NOTHING. There is no landing/picker page:
  reaching an existing adventure is `File → Open`, and starting another sandbox is
  `File → New adventure`. The sandbox's map comes from the engine's `defaultMapInput` — the SAME
  template `MapService.createMap` uses, so it is born on terrain the server would have produced —
  and the first save creates the adventure and that map in one `POST /api/adventures` carrying the
  map. This replaced a `POST` on entry that left one untitled row per visit behind, never cleaned
  up; the trade is that a sandbox is memory-only, so closing the tab loses it.
- **`adventureId === null` means "sandbox"**, and every server-backed surface must read it rather
  than assume a row exists: Test routes through the first-save popup and continues into the launch,
  the settings dialog saves through `onSaveDraft` (the create seam) and hides Delete, New map is
  disabled, the maps panel lists the sandbox's own map without rename/delete, and the status bar
  says "Not saved yet" rather than showing the green `saved` tick — `saved` only means "no unsaved
  EDITS", which is vacuously true for a map that has never been written at all.
- **`AdventureEditorInner` is keyed by `draftId`, never `adventureId`.** The first save gives the
  session an id, and keying on that would remount the whole editor — stage, history, camera — in
  the middle of the save. `draftId` changes only on a genuine session swap (File → New / Open),
  which is exactly when that reset is wanted, so `refreshSession()` must PRESERVE it: a map
  create/rename/delete refresh is the same session, and minting a new id there remounts on every
  one.
- Leaving the editor goes through `AdventureEditorScreen`'s `leave()` (passed to the inner screen as
  `onLeave`), never a bare `setSession(null)`: the route swap lands AFTER this render, so clearing
  the session on the way out would otherwise drop straight into the bootstrap and open a sandbox the
  author never asked for. Clearing the session to STAY in the editor (the open adventure was just
  deleted) still calls `setSession(null)` directly and still wants a fresh sandbox: the two are
  different intents.
- The entry bootstrap keeps ONE ref: `startedRef`, the fire-once latch against strict mode's
  double-invoked effect — drop it and the second invocation replaces the sandbox with a different
  one, discarding the first's map id while the draft still points at it. Its former twin `aliveRef`
  (cancellation, reasserted per effect run) died with the request it guarded: minting a sandbox is
  synchronous, so there is nothing in flight for a synthetic cleanup to discard. Do not reintroduce
  a `POST` here without bringing that ref back — the docblock above the component records why a
  per-closure `cancelled` flag is not equivalent.

- The authoring camera can turn: `[`/`]` step a quarter turn (snapping to the nearest quarter
  first, so they also straighten a freely-orbited view), and **right**-drag orbits to any angle with
  no snap-back while **middle**-drag pans — the split every 3D editor uses. Right used to be a
  second pan trigger beside middle, which left the camera's two movements sharing one button and
  rotation with none. Picking needs nothing for this — `screenToWorld` raycasts the live camera — and neither
  does the overlay, which is handed to the renderer in world coordinates. **Panning does**: its drag
  is screen-space and must be rotated into world space by the current yaw, or a turned camera sends
  the map sideways under the cursor. `map-editor-stage.test.tsx` guards exactly that.
- Distance fog is off while authoring (`setFogEnabled(false)`), because the play-tuned band tightens
  as the camera pulls back and zooming out is how an author inspects a whole map.

## Commands

- `npm run typecheck:editor` checks this package.
- `npm run test:editor` runs its jsdom Vitest project.
- Root `npm run typecheck`, `npm test` and `npm run check` include the editor.

## Rendering and data rules

- Build the visual stage with `Hd2dRenderer`; never add a second renderer or reintroduce PixiJS.
- Compile authoring documents with `compileAuthoredMap`. The saved heightfield and event coordinates
  must come from that one compiler so editor, runtime and startup backfill cannot drift.
- Keep preview movement on `createHeroController` and the shared `stepHero` rule.
- Treat the editor stage as an imperative resource: construct once for a mounted canvas, update it
  through its handle, and destroy it on unmount.
- Keep editor chrome dense, sober and keyboard-efficient. Use the existing React/Radix primitives;
  Tiny Swords art belongs in the stage, previews and restrained accents.
- Preserve the existing handle API and editor history semantics when adding tools.
- Markers remain deliberately quarantined in the legacy map model. Entries, exits and monsters are
  typed map events. Peasant resources are curated native scenery assets defined by
  `@lindocara/engine/harvest-presets`; the Event palette must not author new harvestable events.
  Legacy harvestable events remain readable/editable only for saved-map compatibility.

## Tests

- Pure state changes belong in `test/editor-state.test.ts`.
- Stage commands and coordinate transforms belong in the map-stage tests.
- UI workflows belong in jsdom component tests.
- Preview behavior must discriminate the real movement/collision behavior rather than a visual stub.
