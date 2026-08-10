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
  `@lindocara/ui`; it must not duplicate their movement, terrain or rendering rules.
- Entering the editor mints a fresh **unsaved scratch adventure** (`ensureScratchAdventure()` in
  `src/ui/editor/adventure-session.ts`) and opens it. There is no landing/picker page: reaching an
  existing adventure is `File → Open`, and starting another is `File → New adventure`. Abandoned
  scratches are deliberately NOT cleaned up — they are deleted by hand from the Open dialog, so no
  unsaved work can vanish unasked.
- The entry bootstrap's two refs (`AdventureEditorScreen.tsx`) each guard against strict mode's
  double-invoked effect, in different ways: `startedRef` is the fire-once latch — drop it and you
  get a silent second `POST`, two untitled adventures per visit. `aliveRef` owns cancellation,
  reasserted at the top of every effect run rather than a per-closure flag — drop it, or simplify
  it into one, and the screen instead hangs forever on "Preparing…" after the adventure WAS
  created, because the synthetic first-mount cleanup discards its own still-in-flight result. See
  the docblock above the component for the full strict-mode rationale.

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
- Markers remain deliberately quarantined in the legacy map model. Entries, exits, monsters and
  harvest nodes are authored as typed map events.

## Tests

- Pure state changes belong in `test/editor-state.test.ts`.
- Stage commands and coordinate transforms belong in the map-stage tests.
- UI workflows belong in jsdom component tests.
- Preview behavior must discriminate the real movement/collision behavior rather than a visual stub.
