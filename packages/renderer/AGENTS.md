# @lindocara/renderer

The browser-side game core: rendering, local input and the locale runtime. **React-free by
design** — both the running game and the editor's WYSIWYG stage build on it, and neither pulls React
in through here.

Two renderers live here for the length of S3's first increment: the PixiJS one (`renderer.ts`) the
game ships, and the HD-2D one (`hd2d/`) behind `?hd2d=1`. They satisfy one contract,
`renderer-api.ts`'s `RendererLike`. The flag and the PixiJS path die together.

## Responsibility

- `renderer.ts` — the running-game renderer. `world-view`/`world-layout`/`minimap`/`map-render-cache`
  /`terrain-visuals`/`interiors`/`stage-application` — the draw layer, shared with the editor stage.
- `catalog-element-render`/`tile-draw` — per-cell + catalog draw arithmetic (shared with the editor
  so the two cannot drift). All `*-art` (`character-art`, `enemy-art`, `combat-art`, `portrait-art`,
  `tiny-swords-art`, `tiny-swords-assets`, `editor-asset-art`) — sprite/texture resolution.
- `input`/`input-settings` — keyboard tracking. `locale.ts` — the non-React locale core (`t`,
  `onLocaleChange`, `applyLocale`); the client's i18n adds the React hook on top.
- `scene-sample.ts` — the interpolated-frame view type (built from engine snapshot types); the
  client's `net` re-exports it. `server-clock`, `display-settings`.
- `renderer-api.ts` — `RendererLike`, the contract `client/game/session.ts` consumes. Both renderers
  implement it; adding a method the session calls means adding it here first.
- `hd2d/` — the **second** renderer, on `@lindocara/hd2d` + `three` rather than PixiJS, selected by
  a temporary `?hd2d=1` (S3's first increment). `scene.ts` is the composition root, transcribed from
  `apps/lab/src/main.ts`; `billboards.ts` is the actor registry, synced every frame;
  `static-content.ts` places the map's own scenery once per map (its own file for that reason — the
  actor registry has a lifecycle, scenery has none); `game-renderer.ts` is the `RendererLike` around
  them and owns which sheet an actor or a catalogue asset draws with. Snapshots arrive in PIXELS
  and the scene is in TILE units — the conversion is `engine/hd2d/tile-pixel-bridge.ts`, and every
  site here carries its `TILE→PIXEL BRIDGE` marker (`sync` in `billboards.ts`, `focusOn` in
  `scene.ts`, and nowhere else; the heightfield's own elements and events are ALREADY in tile units
  and need no conversion). It draws terrain, sea, foam, sky and light from `WorldInfo.heightfield`,
  the actors as billboards the camera follows — drawn at rest, since no clip crosses `ActorView`
  yet — and `heightfield.elements`/`heightfield.events` as static billboards, appearance only: no
  element or event ever contributes a collider, because the server bakes collision from the terrain
  alone. Grep `NOT YET DRAWN ON THE HD-2D PATH` for what is still owed.
  Read
  [`docs/hd2d-rendering.md`](../../docs/hd2d-rendering.md) before touching it.

The raw Tiny Swords art is bundled via a Vite glob over `../../catalog/assets/**` (see
`tiny-swords-assets.ts`); the atlas/equipment art is served from the client's `public/`.

## Graph

- **Depends on:** `engine`, `hd2d` (the `hd2d/` renderer only) (+ `pixi.js` and `three`; raw art
  from the `catalog` package's `assets/`).
- **Depended on by:** `client`, `editor`.

## Commands

```bash
npm run typecheck:renderer        # tsc, DOM lib, no React types needed
npm test -w @lindocara/renderer   # or: npm run test:renderer — jsdom
```

## Rules

- No React. If a change needs a hook or JSX, it belongs in `client` or `editor`.
- Never import client glue (`net`, `store`, `session`, `i18n`): the graph is `client -> renderer`,
  never the reverse. Shared view types (`SceneSample`) live here and are re-exported downstream.
- Collision comes only from `tiles`/`colliders` via `isWalkable`/`resolveTerrain`; never derive it
  from `layers`/`elements`/`events` (appearance only).

See the root [`AGENTS.md`](../../AGENTS.md) for the renderer/editor stage-sharing contract.
