# @lindocara/renderer

The browser-side game core: PixiJS rendering, local input and the locale runtime. **React-free by
design** — both the running game and the editor's WYSIWYG stage build on it, and neither pulls React
in through here. Depends only on `engine`.

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

The raw Tiny Swords art is bundled via a Vite glob over `../../catalog/assets/**` (see
`tiny-swords-assets.ts`); the atlas/equipment art is served from the client's `public/`.

## Graph

- **Depends on:** `engine` (+ `pixi.js`; raw art from the `catalog` package's `assets/`).
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
