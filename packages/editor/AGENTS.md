# @lindocara/editor

> **BROKEN ON PURPOSE (S3, 2026-08-04).** This package does not typecheck: its stage imports the
> PixiJS renderer, which S3's first increment deleted. It is excluded from the verify pipeline and
> is rebuilt on `@lindocara/hd2d` in its own S3 piece. You did not cause this.
>
> Concretely: `game/map-editor-stage.ts` and `game/map-preview.ts` import
> `@lindocara/renderer/renderer.js`, `stage-application.js`, `catalog-element-render.js`,
> `editor-asset-art.js` and `tiny-swords-art.js`'s three `slice*` helpers — all gone. The exclusions
> that keep the pipeline honest, each carrying a comment pointing back here:
>
> - the root `package.json`'s `typecheck` script no longer chains `typecheck:editor` (the script
>   itself still exists and still fails — that is the point, it is how you check your progress);
> - the root `vitest.config.ts` `projects` list excludes `packages/editor/vitest.config.ts`, and
>   `test:editor` was dropped from the root scripts along with `test:ui`'s editor project;
> - `packages/client/src/ui/AppRouter.tsx`'s `editor` route renders a notice instead of lazy-loading
>   `AdventureEditorScreen`, and carries the exact code to restore;
> - `packages/client/src/dev/preview-route.ts` (`?preview`) is quarantined the same way, for the same
>   reason — it drew through this package's `startMapPreview`.
>
> **A second wave of debt landed on 2026-08-05** (S3, client-owned movement), invisible to every
> check because this package typechecks nowhere. `game/map-preview.ts` is the whole of it, and it
> needs rebuilding rather than patching:
>
> - it imported `@lindocara/engine/prediction.js`, which was **deleted** — `MAX_ACCUMULATED_SECONDS`
>   is now inlined at the top of the file under a banner, purely so the reference does not point at a
>   file that no longer exists;
> - its frame loop runs `step()` and `movementSpeedAt()`, both **retired**, and collides through the
>   pixel `resolveTerrain`. The replacement is `packages/client/src/game/hero-controller.ts`, which
>   owns a `HeroState` and runs `stepHero` against a `ZoneTerrain` baked from a heightfield;
> - its `PlayerSnapshot` literal (`map-preview.ts:339`) still sets `ack: 0`, a field the wire no
>   longer has, and is missing the three required locomotion flags
>   (`airborne`/`swimming`/`gliding`);
> - its positions are pixel `Vec2` with a `{x, y}` facing; the world is tile units, `x`/`z` on the
>   ground and `y` for elevation.
>
> Restoring the package means rebuilding the stage on `@lindocara/hd2d`, rebuilding the preview loop
> on `hero-controller.ts`, and then undoing all five exclusions above.
> The prose below still describes the PixiJS stage, because that is what has to be replaced.

The creator tools: the adventure/map editor UI and its PixiJS authoring stage. Browser + React. It
sits **on top of** the client base (i18n, api, store, shadcn components) and the renderer (the shared
draw layer). The client App lazy-`import()`s it, so there is no static `client -> editor` cycle.

## Responsibility

- `ui/editor/` — the editor shell as menu bar / toolbar / three resizable panes (shadcn `TerrainPalette`
  left, the WYSIWYG PixiJS stage centre, `MapListPanel` right) / status bar. All chrome is stock
  shadcn from `@lindocara/ui`; `AdventureSettingsDialog`/registry/event dialogs live here too.
- `game/map-editor-stage.ts` — the authoring stage (shares draw rules with the runtime renderer).
  `game/editor-state.ts` — the editor's map/mode/selection/tool state. `game/map-preview.ts` — the
  in-editor Test preview (a mini game-loop using `step` + input + the renderer). `game/event-command-tree`.

The editor works in three modes (Field/Element/Event), each with its own mode-scoped palette; every
tool has a keyboard shortcut gated off while a dialog is open or the stage isn't ready.

## Graph

- **Depends on:** `engine`, `renderer`, `client`, `ui`.
- **Depended on by:** nobody statically — the client App lazy-loads it (`@lindocara/editor/ui/editor/
  AdventureEditorScreen.js`).

## Commands

```bash
npm run typecheck:editor        # tsc, DOM + React (maps @/* to the client source)
npm test -w @lindocara/editor   # or: npm run test:editor — jsdom
```

## Rules

- Creator surfaces stay dense, sober and keyboard-efficient with stock shadcn (`@lindocara/ui`) — Tiny
  Swords only for previews and restrained accents. Never import a Tiny component here.
- The editor authors appearance only. **Nothing executes**: an authored event/element is invisible to
  a running party until the server evaluates it. Collision is baked server-side, never inferred here.
- The pointer-events contract is load-bearing: `.editor-root` is a `pointer-events: none` layer over
  the canvas; each chrome island opts back in. Get it backwards and clicks or strokes are eaten.

See the root [`AGENTS.md`](../../AGENTS.md) and `docs/superpowers/specs/` for the editor shell + map/event models.
