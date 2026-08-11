# @lindocara/renderer

The browser-side game core: rendering, local input and the locale runtime. **React-free by
design** â€” the running game builds on it, and does not pull React in through here.

**The renderer is `hd2d/` and nothing else** since S3's first increment retired PixiJS
(2026-08-04). `renderer.ts` (5 378 lines), `stage-application.ts`, `catalog-element-render.ts`,
`editor-asset-art.ts`, `world-event-art.ts` and `tiny-swords-art.ts`'s three `slice*` helpers were
deleted with it, and `pixi.js` left this package's dependencies. What that file knew that was not
obvious from reading it lives in [`docs/hd2d-rendering.md`](../../docs/hd2d-rendering.md) â€” read it
before touching the render path; it is the only artefact that survived the deletion. The editor's
authoring stage was rebuilt on `Hd2dRenderer` and shares this package's rendering contract (see
`packages/editor/AGENTS.md`).

## Responsibility

- `world-view`/`world-layout`/`minimap`/`map-render-cache`/`terrain-visuals`/`interiors`/`tile-draw`
  â€” framework-free draw arithmetic and world description. These survived the PixiJS deletion because
  none of them ever imported it; `tile-draw.ts` is still the one copy of the per-cell tile
  arithmetic the editor's stage must draw from when it returns.
- All `*-art` (`character-art`, `enemy-art`, `combat-art`, `portrait-art`, `tiny-swords-art`,
  `tiny-swords-assets`) â€” sprite/texture *resolution*: which sheet, which frame, how big. Data and
  arithmetic, no engine types.
- `input`/`input-settings` â€” keyboard and controller tracking. In gameplay, the left stick owns
  movement while keyboard arrows/the D-pad are reserved for remappable actions (quick items by
  default); do not add either directional pad back to the default movement bindings. Standard
  gamepad button 0 (the physical south face button) is contextual: interaction while one is in
  range, jump otherwise. `locale.ts` â€” the non-React locale core (`t`,
  `onLocaleChange`, `applyLocale`); the client's i18n adds the React hook on top.
- `scene-sample.ts` â€” the interpolated-frame view type (built from engine snapshot types); the
  client's `net` re-exports it. `server-clock`, `display-settings`.
- `renderer-api.ts` â€” `RendererLike` (and `RenderContext`, which moved here when `renderer.ts` was
  deleted), the contract `client/game/session.ts` consumes. `Hd2dRenderer` is its only implementation
  today; it stays an interface because it is the seam the session is written against and an editor
  preview is expected to satisfy it next. Adding a method the session calls means adding it here
  first.
- `hd2d/` â€” the renderer, on `@lindocara/hd2d` + `three`. `scene.ts` is the composition root,
  transcribed from `apps/lab/src/main.ts`; `billboards.ts` is the actor registry, synced every frame;
  `static-content.ts` places the map's own scenery once per map (its own file for that reason â€” the
  actor registry has a lifecycle, scenery has none); `game-renderer.ts` is the `RendererLike` around
  them and owns which sheet an actor or a catalogue asset draws with. Snapshots arrive in the
  scene's own TILE units since S3's wire task â€” `x`/`z` on the ground, `y` elevation â€” so there is
  no conversion anywhere in this package any more: the `tile-pixel-bridge` and its `TILEâ†’PIXEL
  BRIDGE` markers are deleted, and a `pixelToTile` reappearing here would mean the wire went
  backwards. It draws terrain, sea, foam, sky and light from `WorldInfo.heightfield`,
  the actors as billboards the camera follows â€” frame-zero idle art, but with vertical motion:
  `ActorView` carries `airborne`/`swimming`/`gliding`, `vy` and
  the reported elevation, so a swimmer is drawn at the water line and an airborne or gliding hero at
  its own `y` rather than snapped to the ground under it (`elevationOf`, `billboards.ts`).
  `vy` drives bounded stretch/squash and `gliding` opens the generated canopy billboard. Since S3
  moved movement to the client, a remote hero's elevation is a fact only its owner computed, and
  ground-snapping it would make every other player's jump invisible without failing anything â€”
  `hd2d-remote-state.test.ts` is the guard. Monsters and guards are stepped by the room, on the
  ground, so all three flags are false for them. It also draws
  `heightfield.elements`/`heightfield.events` as static billboards, appearance only: no
  element or event ever contributes a collider, because the server bakes collision from the terrain
  alone. Combat presentation is also on this one path: actor attack strips, authored Tiny Swords
  impacts and projectiles, hero mobility/stealth variants, loot, camps and transient accents all run
  through `game-renderer.ts` + `visual-layer.ts`. `screenToWorld` raycasts the visible authored
  ground and is the only renderer answer that leaves the client (the session turns it into the
  peasant bomb direction), so it must keep returning `null` when no real ground point was hit rather
  than inventing one.
  Read
  [`docs/hd2d-rendering.md`](../../docs/hd2d-rendering.md) before touching it.

The raw Tiny Swords art is bundled via a Vite glob over `../../catalog/assets/**` (see
`tiny-swords-assets.ts`); the atlas/equipment art is served from the client's `public/`.

## Graph

- **Depends on:** `engine`, `hd2d` (+ `three`; raw art from the `catalog` package's `assets/`).
  **No `pixi.js`** â€” it left with the PixiJS path and must not come back.
- **Depended on by:** `client` (and `editor`, once it is rebuilt).

## Commands

```bash
npm run typecheck:renderer        # tsc, DOM lib, no React types needed
npm test -w @lindocara/renderer   # or: npm run test:renderer â€” jsdom
```

## Rules

- No React. If a change needs a hook or JSX, it belongs in `client` or `editor`.
- One render engine. `three`, through `@lindocara/hd2d`. Two coexisting render paths is the
  arrangement S3 spent an increment ending; do not start a second one.
- Never import client glue (`net`, `store`, `session`, `i18n`): the graph is `client -> renderer`,
  never the reverse. Shared view types (`SceneSample`) live here and are re-exported downstream.
- Collision comes only from the welcome's `heightfield`, through `zoneTerrainFromHeightfield` +
  `canStand` (`@lindocara/engine/terrain-access.js`) â€” the same function the server bakes with;
  never derive it
  from `layers`/`elements`/`events` (appearance only).

See the root [`AGENTS.md`](../../AGENTS.md) for the renderer/editor stage-sharing contract.
