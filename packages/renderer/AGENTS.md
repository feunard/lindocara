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
  `heightfield.elements`/`heightfield.events` as static scenery. Their visuals never derive gameplay
  geometry: `compileAuthoredMap` has already baked prop footprints, building tops and walkable bridge
  platforms into the same heightfield document read by the client and server. Combat presentation is
  also on this one path: actor attack strips, authored Tiny Swords
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
yarn typecheck:renderer        # tsc, DOM lib, no React types needed
yarn workspace @lindocara/renderer run test   # or: yarn test:renderer â€” jsdom
```

## Rules

- No React. If a change needs a hook or JSX, it belongs in `client` or `editor`.
- One render engine. `three`, through `@lindocara/hd2d`. Two coexisting render paths is the
  arrangement S3 spent an increment ending; do not start a second one.
- **A new placeable 3D model must preserve the building manipulation contract.** Its renderer API
  must consume saved position, size, free orientation and the authored destructible/indestructible
  choice; destructible content must expose its required visual states. Do not bake a transform into
  geometry or add a renderer-only option that the editor, map compiler and runtime collision cannot
  reproduce. The model is incomplete until enlarge, shrink, move, rotate and destruction-state
  round trips are covered at their owning boundaries.
- **Catalogue sheets outlive the scene.** `Hd2dRenderer.#assetTextures` is a `createTextureCache`
  holding every scenery, world-event, editor-preview and spawn-knight texture the instance has
  decoded; `#disposeScene` must never dispose it, and only `destroy()` frees it. It exists because
  `configureMapTerrain` is a map-TRANSITION path that the editor calls on every terrain edit, and
  the old per-scene registries made each edit re-download and re-decode unchanged art (~100 ms,
  warm cache) with the props missing from the screen throughout â€” that gap is what made painting
  blink. A load that loses its token now simply returns: the sheets stay cached, because the map
  that lost the race is usually the same map one edit later.
- **An edit of the map on screen keeps its scene.** `configureMapTerrain` takes the in-place branch
  — `Hd2dScene.updateTerrain` — when the zone id is unchanged and the sea plane still matches, which
  is every brush stroke in the editor; a different map, or a different sea plane, still gets a whole
  new scene (the day-cycle seed is per scene, and a transition should reset the camera rather than
  inherit the previous framing). `updateTerrain` swaps the terrain mesh, the stairs, the foam, the
  `TerrainQuery` and the sea's gradient; the scene graph, camera, lights, sky, post-fx pipeline and
  `Hd2dContext` all survive. Two consequences to respect: `Hd2dScene.query` is a **getter** because
  the query is replaced — capture it and you answer heights for terrain that no longer exists — and
  everything parented in from outside (billboards, scenery, the visual layer) is placed against the
  OLD ground, so `#disposeSceneContents` drops exactly that much and it is rebuilt after the call.
  Keeping the context across an edit is only safe because every billboard unregisters itself from
  its yaw registry on dispose; measured stable at 66 entries across a dozen strokes.
- **So does the sea.** `Hd2dRenderer.#water` is handed to each `createHd2dScene` through its `reuse`
  argument and freed only when `waterPlaneKey` (extent + sea level) changes or the renderer dies;
  `Hd2dScene.dispose()` deliberately does not touch it. The plane is 385x385 vertices and costs
  17-23 ms to allocate while depending on nothing the terrain edits move — only `aShallow` follows
  the coast, and `Water.setField` refreshes just that, in ~1 ms. Re-adding `water.dispose()` to the
  scene's teardown would silently put the whole cost back.
- Never import client glue (`net`, `store`, `session`, `i18n`): the graph is `client -> renderer`,
  never the reverse. Shared view types (`SceneSample`) live here and are re-exported downstream.
- Collision comes only from the welcome's compiled `heightfield`, through
  `zoneTerrainFromHeightfield` + `canStand` (`@lindocara/engine/terrain-access.js`). Terrain,
  authored element footprints and walkable platform tops are compiled into that document before it
  reaches the renderer; never infer collision from a sprite or Three.js volume at draw time.

See the root [`AGENTS.md`](../../AGENTS.md) for the renderer/editor stage-sharing contract.
