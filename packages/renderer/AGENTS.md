# @lindocara/renderer

The browser-side game core: rendering, local input and the locale runtime. **React-free by
design** — the running game builds on it, and does not pull React in through here.

**The renderer is `hd2d/` and nothing else** since S3's first increment retired PixiJS
(2026-08-04). `renderer.ts` (5 378 lines), `stage-application.ts`, `catalog-element-render.ts`,
`editor-asset-art.ts`, `world-event-art.ts` and `tiny-swords-art.ts`'s three `slice*` helpers were
deleted with it, and `pixi.js` left this package's dependencies. What that file knew that was not
obvious from reading it lives in [`docs/hd2d-rendering.md`](../../docs/hd2d-rendering.md) — read it
before touching the render path; it is the only artefact that survived the deletion. The editor's
authoring stage was built on those modules and is quarantined until it is rebuilt here (see
`packages/editor/AGENTS.md`).

## Responsibility

- `world-view`/`world-layout`/`minimap`/`map-render-cache`/`terrain-visuals`/`interiors`/`tile-draw`
  — framework-free draw arithmetic and world description. These survived the PixiJS deletion because
  none of them ever imported it; `tile-draw.ts` is still the one copy of the per-cell tile
  arithmetic the editor's stage must draw from when it returns.
- All `*-art` (`character-art`, `enemy-art`, `combat-art`, `portrait-art`, `tiny-swords-art`,
  `tiny-swords-assets`) — sprite/texture *resolution*: which sheet, which frame, how big. Data and
  arithmetic, no engine types.
- `input`/`input-settings` — keyboard tracking. `locale.ts` — the non-React locale core (`t`,
  `onLocaleChange`, `applyLocale`); the client's i18n adds the React hook on top.
- `scene-sample.ts` — the interpolated-frame view type (built from engine snapshot types); the
  client's `net` re-exports it. `server-clock`, `display-settings`.
- `renderer-api.ts` — `RendererLike` (and `RenderContext`, which moved here when `renderer.ts` was
  deleted), the contract `client/game/session.ts` consumes. `Hd2dRenderer` is its only implementation
  today; it stays an interface because it is the seam the session is written against and an editor
  preview is expected to satisfy it next. Adding a method the session calls means adding it here
  first.
- `hd2d/` — the renderer, on `@lindocara/hd2d` + `three`. `scene.ts` is the composition root,
  transcribed from `apps/lab/src/main.ts`; `billboards.ts` is the actor registry, synced every frame;
  `static-content.ts` places the map's own scenery once per map (its own file for that reason — the
  actor registry has a lifecycle, scenery has none); `game-renderer.ts` is the `RendererLike` around
  them and owns which sheet an actor or a catalogue asset draws with. Snapshots arrive in the
  scene's own TILE units since S3's wire task — `x`/`z` on the ground, `y` elevation — so there is
  no conversion anywhere in this package any more: the `tile-pixel-bridge` and its `TILE→PIXEL
  BRIDGE` markers are deleted, and a `pixelToTile` reappearing here would mean the wire went
  backwards. It draws terrain, sea, foam, sky and light from `WorldInfo.heightfield`,
  the actors as billboards the camera follows — frame-zero idle art, but with vertical motion:
  `ActorView` carries `airborne`/`swimming`/`gliding`, `vy` and
  the reported elevation, so a swimmer is drawn at the water line and an airborne or gliding hero at
  its own `y` rather than snapped to the ground under it (`elevationOf`, `billboards.ts`).
  `vy` drives bounded stretch/squash and `gliding` opens the generated canopy billboard. Since S3
  moved movement to the client, a remote hero's elevation is a fact only its owner computed, and
  ground-snapping it would make every other player's jump invisible without failing anything —
  `hd2d-remote-state.test.ts` is the guard. Monsters and guards are stepped by the room, on the
  ground, so all three flags are false for them. It also draws
  `heightfield.elements`/`heightfield.events` as static billboards, appearance only: no
  element or event ever contributes a collider, because the server bakes collision from the terrain
  alone. Grep `NOT YET DRAWN ON THE HD-2D PATH` for what is still owed visually, and
  `NOT YET WIRED ON THE HD-2D PATH` for the one gap that is not visual at all: `screenToWorld` is
  the only member whose return value leaves the client (the session makes the peasant's bomb
  direction out of it and sends it), so it answers `null` — "I cannot answer" — instead of a
  placeholder point, and the session sends nothing rather than a direction it invented.
  Read
  [`docs/hd2d-rendering.md`](../../docs/hd2d-rendering.md) before touching it.

The raw Tiny Swords art is bundled via a Vite glob over `../../catalog/assets/**` (see
`tiny-swords-assets.ts`); the atlas/equipment art is served from the client's `public/`.

## Graph

- **Depends on:** `engine`, `hd2d` (+ `three`; raw art from the `catalog` package's `assets/`).
  **No `pixi.js`** — it left with the PixiJS path and must not come back.
- **Depended on by:** `client` (and `editor`, once it is rebuilt).

## Commands

```bash
npm run typecheck:renderer        # tsc, DOM lib, no React types needed
npm test -w @lindocara/renderer   # or: npm run test:renderer — jsdom
```

## Rules

- No React. If a change needs a hook or JSX, it belongs in `client` or `editor`.
- One render engine. `three`, through `@lindocara/hd2d`. Two coexisting render paths is the
  arrangement S3 spent an increment ending; do not start a second one.
- Never import client glue (`net`, `store`, `session`, `i18n`): the graph is `client -> renderer`,
  never the reverse. Shared view types (`SceneSample`) live here and are re-exported downstream.
- Collision comes only from the welcome's `heightfield`, through `zoneTerrainFromHeightfield` +
  `canStand` (`@lindocara/engine/terrain-access.js`) — the same function the server bakes with;
  never derive it
  from `layers`/`elements`/`events` (appearance only).

See the root [`AGENTS.md`](../../AGENTS.md) for the renderer/editor stage-sharing contract.
