# Monorepo layout

Which package owns what, where a file from the old single `src/` tree lives now, and why the
TypeScript programs are split per package rather than shared. `AGENTS.md` carries the one-line
rule; this is the reasoning.

### Monorepo layout (yarn workspaces)

The old single `src/` is now **workspace packages under `packages/*` plus the deployable app under
`apps/*`**. The **repo root holds only project setup** â€” the workspace `package.json`, the shared
`tsconfig.json`, `.oxlintrc.json`/`.oxfmtrc.json`, the `vitest.config.ts` aggregator, docs, and the root `scripts/`.
Nothing deliverable lives at the root; a second site would be a sibling `apps/<name>`. **Each package
has its own `AGENTS.md`** (linked below) â€” read it before working inside that package. The old `src/â€¦`
prefixes in the file map further down map straight onto these homes:

| Package | Old path | Depends on | Runtime |
| --- | --- | --- | --- |
| [`@lindocara/engine`](../packages/engine/AGENTS.md) | `src/shared/`, plus `hd2d/` â€” the HD-2D witness's geometry and movement rule, moved in from `apps/lab` in S2 | â€” | pure (ni DOM ni Workers) |
| [`@lindocara/server`](../packages/server/AGENTS.md) | `src/server/` â€” now Alepha services/entities/controllers (`src/api/`), the realtime rooms (`src/api/realtime/`) and the world systems (`src/world/`) | engine, alepha | Node (dev) / workerd (prod) |
| [`@lindocara/renderer`](../packages/renderer/AGENTS.md) | drawing half of `src/client/game/` (+ `input`, `locale`, `scene-sample`) | engine, hd2d | browser, React-free (Three.js via `@lindocara/hd2d`) |
| [`@alepha/ui`](../.vendor/@alepha/ui) | the shared shadcn/Base-UI tree + `cn` + `styles.css` tokens - VENDORED from ../alepha, never hand-edited | npm only | browser + React |
| [`@lindocara/client`](../packages/client/AGENTS.md) | rest of `src/client/` + `public/` (app shell, HUD, Tiny-Swords tree, store, api, i18n, glue) | engine, renderer, ui | browser + React |
| [`@lindocara/editor`](../packages/editor/AGENTS.md) | `src/client/ui/editor/` + editor game files â€” HD-2D authoring stage and playable preview | engine, renderer, client, ui | browser + React |
| [`@lindocara/catalog`](../packages/catalog/AGENTS.md) | `assets/` (raw Tiny Swords art) + the catalogue codegen (was `scripts/tiny-swords-catalog-*`) | engine | node (dev) |
| [`@lindocara/testing`](../packages/testing/AGENTS.md) | shared test fixtures (`map-fixtures`, `tiles`, jsdom setup) | engine | node/jsdom (dev) |
| [`@lindocara/hd2d`](../packages/hd2d/AGENTS.md) | the HD-2D render engine (billboards, terrain mesh, lighting, post-fx) | three only | browser, framework-free (Three.js) |
| [`@lindocara/audio`](../packages/audio/AGENTS.md) | the shared sample bank + the movement samples the game and the lab both play (extracted from `apps/lab/src/core/audio.ts`) | nothing | browser, framework-free (WebAudio) |
| [`@lindocara/main`](../apps/main/AGENTS.md) | **the deployable app** â€” `alepha.config.ts`, the server/browser entries, `migrations/`, build/deploy | client, server | build â†’ Worker + assets |
| [`apps/lab`](../apps/lab/AGENTS.md) | the HD-2D render **witness** â€” reproduces the PoC on `hd2d`, not a game; see its own `AGENTS.md` | engine (`hd2d/` only), hd2d, three | browser (Vite dev app) |

`.vendor/alepha` is the vendored framework â€” a real workspace member, pinned by
`.vendor/vendor.json` to a commit of the sibling `../alepha` repo. **The dogfood loop for
framework work:** a framework fix is implemented in `../alepha` (its tests live there), verified
with `yarn v` upstream, committed and pushed, then pulled here with `yarn alepha vendor sync` â€” the
sync is its own commit. `yarn alepha vendor diff` shows any local patches; keep it clean.

> **Every valid authored map has a playable heightfield.** Map create/update/import compiles the
> tile-editor document and its events through `compileAuthoredMap`; `HeightfieldBackfillProvider`
> performs the same conversion once for historical database rows whose heightfield is empty. The
> owner-fenced `PUT /api/maps/:id/heightfield` remains the remote terrain-seeding escape hatch used by
> `yarn adventure:proving --target=â€¦ --allow-remote=true`. Malformed legacy authoring payloads
> are deliberately skipped by the startup backfill and remain unjoinable instead of being guessed at.
>
> **Heightfield rooms run authored events in heightfield coordinates.** `zoneFromMapPayload`
> (`packages/server/src/api/realtime/worldState.ts`) projects exits, teleporters, monsters and harvest
> nodes with the same compiler used for terrain. The client composes live harvest colliders into its
> movement terrain after welcome, delta and resync frames, so depleted resources stop blocking the
> hero without forking the shared movement rule.

**The game's render path IS `hd2d`** since S3's first increment (2026-08-04). `packages/renderer`
no longer contains a PixiJS renderer at all: `renderer.ts`, `stage-application.ts`,
`catalog-element-render.ts`, `editor-asset-art.ts`, `world-event-art.ts` and `tiny-swords-art.ts`'s
`slice*` helpers were deleted, and `pixi.js` has left both renderer and editor dependencies.
`packages/renderer/src/hd2d/`
is the whole renderer, `apps/lab` remains the witness that proves the engine outside the game, and
the two are the only consumers of `@lindocara/hd2d`. `apps/lab` also depends on `@lindocara/engine`,
but only its `hd2d/` subfolder (see `packages/engine/AGENTS.md`'s Responsibility section â€” the game
rule geometry, which the CLIENT now runs for real and the lab exercises in isolation, not the render
path). Before touching anything in the
render path, read [`docs/hd2d-rendering.md`](./hd2d-rendering.md) â€” what makes the HD-2D style,
the rendering pitfalls already paid for once, and what the deleted PixiJS renderer knew that nothing
else records. See also
[`docs/archive/specs/2026-08-02-hd2d-reboot-design.md`](./archive/specs/2026-08-02-hd2d-reboot-design.md)
for the staged plan this executed the first increment of.

**The editor uses the same HD-2D path as the game.** Its authoring stage implements paint, erase,
elevation, selection, events, pan/zoom, history, grid and collision overlays through `Hd2dRenderer`;
its playable preview runs the real client movement controller. It is included in root typecheck and
Vitest aggregation. Do not resurrect a parallel PixiJS path.

The graph is acyclic: `engine â† {server, renderer}`, `renderer â† {client, editor}`, `{client, ui} â†
editor`; `apps/main` composes `client` + `server` into one deploy. The client's `ui/AppRouter.tsx`
`editor` route lazy-`import()`ed the editor screen at runtime without declaring it, so there is no
`client â†’ editor` cycle. Cross-package imports use `@lindocara/<pkg>/<file>.js`; the `@` alias means
the client source root everywhere.

`yarn typecheck` runs every package `tsc`, including `typecheck:editor`, plus
`apps/main`'s own `tsconfig.json` (covers its
`main.ts`/`main.browser.ts` bootstrap entries, previously typechecked by no program at all â€” it
extends alepha's own base config, the same fix `packages/client/tsconfig.api.json` already needed,
because both entries import the alepha-flavored `AppRouter`) and the Node tooling program; `yarn
typecheck:<pkg>` (or `typecheck:main`) checks one â€” `typecheck:hd2d`/`typecheck:lab` follow the same
pattern for the two newest members. **Tests are co-located per package** in `packages/<pkg>/test/`
(the server's live in `packages/server/test-api/`; `apps/lab`'s in `apps/lab/test/`), each with its
own `vitest.config.ts` (engine/catalog/server/hd2d/lab = node, renderer/client/editor = jsdom â€” hd2d
and lab need no DOM because three itself builds geometry/material/color data identically outside a
browser, and the two packages' own pure logic â€” `tiltShiftRadius`/`fillAmount`/`sheetUv` in hd2d,
`island.ts` in lab (its sibling `terrain-query.ts` moved into `@lindocara/engine/hd2d/` in S2,
alongside the rest of the hero's movement rule) â€” is exactly what's left once anything
canvas/WebGL is excluded). The root `vitest.config.ts` aggregates them via `projects`, so `yarn test` runs everything
and `yarn workspace @lindocara/<pkg> run test` (or `yarn test:<pkg>`, e.g. `test:hd2d`/`test:lab`)
runs one.

**The app's config lives with the app:** `apps/main/alepha.config.ts` declares the production
platform (Bay adapter, public domain and bay-admin endpoint); `apps/main/migrations/`
holds the database migrations; `apps/main/src/main.ts`/`main.browser.ts` are the server and
browser entries. The deploy is one `alepha platform up -e production` in `apps/main`. See
[`docs/archive/specs/2026-07-22-monorepo-packages-design.md`](./archive/specs/2026-07-22-monorepo-packages-design.md)
and [`docs/archive/plans/2026-07-22-monorepo-packages.md`](./archive/plans/2026-07-22-monorepo-packages.md).
The file map below keeps its original `src/â€¦` prefixes; read them through the table above.

### Current party-adventure foundation

Before changing world routing, room ownership or hero location persistence, read
[`docs/adventure-runtime-architecture.md`](./adventure-runtime-architecture.md) and the
historical [`docs/mmo-migration-plan.md`](./mmo-migration-plan.md). Both predate the Alepha
migration (their `World`/`GameSession`/`HeroPresence` are today's `WorldRoom`/`PartyRoom`/
`PresenceRoom`), but their fencing and routing analysis remains the design record.

```
src/shared/     platform-free. Imports nothing from Cloudflare or the DOM.
  simulation.ts the simulation's clock and the shape of a movement intent, and nothing else:
                `TICK_HZ`/`TICK_MS`/`TICK_DT`/`NETWORK_SNAPSHOT_HZ`, the pixel-era
                `PLAYER_SIZE`/`WORLD_*`/`clampToWorld` the unconverted zone catalogue in `game.ts`
                still reads, and `Input`. `step()`/`PLAYER_SPEED` are deleted, and `prediction.ts`
                with them.
  hd2d/hero-step.ts pure stepHero(state, input, dt, deps). The single source of movement truth,
                in tile units, run by the CLIENT.
  terrain-access.ts the terrain junction: zoneTerrainFromHeightfield + canStand /
                resolveGroundMovement. Both sides bake the same ZoneTerrain from the same
                stored string with the same function.
  game.ts       map geometry, collision, combat/progression constants and pure rules.
  protocol.ts   the wire format, with defensive parsing of anything a client sends.
  i18n/         FR/EN dictionaries â€” data only; the server sends codes, never prose.
  zones.ts      typed zone catalogue, validation and deterministic room keys.
  tileset.ts    the tile id space (autotile band, fixed-tile band) and tileset types. A tile
                id's meaning â€” passable or not, drawn below or above characters â€” lives here,
                authored once per tile, not per map cell.
  autotile.ts   the `edge16` and `run4` neighbour-mask variant tables. Lives here rather than
                the client because the paint-time brush, the map migration and the tests all
                need the same tables the renderer uses.
  tile-layer-codec.ts run-length codec for one tile layer; `parseTileLayer` never throws.
  tile-brush.ts pure paint/erase/elevation brushes: they write an id and re-resolve the
                neighbours whose variant it can change. The stored id IS the neighbour mask â€”
                autotiling is a paint-time brush, not a storage format, so an author can freeze
                a single hand-picked tile without the renderer overwriting it.
  map-migrate.ts one-shot projection of the old `blocks` model into layers.
  tilesets/     the shipped Tiny Swords tileset, as data.

src/server/     the authoritative server, on Alepha. Node in dev, workerd in production.
  api/index.ts  LindocaraApi: registers every controller, service, provider and room.
  api/entities/ Alepha ORM `$entity` definitions, one file per table (heroes, parties, maps,
                adventures, the normalized hero-child tables, map events/elements, ...).
  api/services/ one `*Service.ts` per domain (every `$repository` read/write) + a matching
                pure `*Authoring.ts` (parsing/validation/error-mapping, unit-testable without
                booting the app). HeroSaveService/HeroEpochService own the fenced hero saves.
  api/controllers/ one `$action`-based controller per surface; `$action` auto-prefixes `/api`.
                JoinController + AdmissionService issue the `/api/join` room hint.
  api/providers/AppSecurityProvider.ts the app's `$realm()` (username+password credentials).
  api/realtime/ the running game: WorldRoom (`/ws/world`), PartyRoom, PresenceRoom,
                worldTick.ts (the tick order) and its world-*.ts siblings, channels.ts (the `$room` channel declarations).
  world/        explicit-dependency domain systems used by WorldRoom; no module-level mutable
                room state.

src/client/     runs in a browser.
  main.tsx      the shared pre-mount bootstrap, `bootClient()`: locale, theme, the `#stage`
                canvas (created imperatively, before anything mounts) and the DEV-only
                `?preview` route. The mount itself lives in `apps/main/src/main.browser.ts`,
                which runs `bootClient()`, boots Alepha and mounts `ui/AppRouter.tsx`.
  ui/AppRouter.tsx  the Alepha `$page` router: one typed route per
                screen (`title` `/`, `menu` `/menu`, `credits` `/credits`, `auth` `/auth`,
                `playContinue` `/play/continue`, `playNew` `/play/new`, `playJoin` `/play/join`,
                `game` `/game`, `editor` `/editor` â€” lazy-loaded). The root layout owns the chrome
                every route shares (StatusBar visibility, menu music; language lives in Settings)
                and installs
                `state/navigation.ts`'s seam on mount. Navigation is `useRouter().push("name")`,
                never a store write. Registered server-side too (`apps/main/src/main.ts`), which
                is what serves the HTML shell.
  ui/           the rest: screens, HUD, chat, overlays and creator tools.
    components/ stock shadcn (Base UI, base-nova). Generated by `shadcn add` â€” do not
                hand-edit. The vocabulary for creator tools and any non-game surface.
    tiny-swords/ the game superset: TinyButton/TinyInput/TinyLabel/TinyFieldSelect/TinyKbd
                plus panels and bars. Reads its own `--tiny-*` tokens from tokens.css and
                never a shadcn token, so the two trees can be restyled independently.
  state/atoms.ts  Alepha `$atom`s for application state that is read/written from React but is
                NOT part of the 60Hz game bridge: `activePartyAtom`, `adventureTestSessionAtom`,
                `adventureEditorSessionAtom`, `quickItemsAtom` (localStorage-persisted),
                `questTrackingAtom`. Atoms are deliberately NOT for the hot path: every
                `store.set` on one validates its zod schema and fires an unfiltered global event
                â€” fine for state a screen transition writes once, disqualifying for anything
                written 20-60x/s, which is why the game bridge below stays zustand.
  state/navigation.ts  the injected-callback seam `game/session.ts` uses to reach the router and
                the atoms above without importing React or `alepha`/`alepha/react` itself (see
                "Per-package tsconfigs" below for why that import boundary is load-bearing, not
                just style) â€” `ui/AppRouter.tsx`'s root layout installs the real implementation on
                mount and clears it on unmount; a test installs a plain fake by reassignment.
  store.ts      the zustand bridge, now REDUCED to exactly the 60Hz game bridge: `self`,
                `selfState`, cooldowns, `party`, chat, `events`, dialogue/overlay flags, the
                `GameHandle` and the equality helpers. `screen` (and every navigation write)
                died with the router; the fields above moved to `state/atoms.ts`. React reads it
                with the same hooks as before â€” only its scope shrank. Text state stays i18n keys
                + params, never rendered strings.
  api.ts        fetch client; machine-code errors mapped to dictionary keys.
  game/         the game loop: net.ts (the wire + the move report), hero-controller.ts (the
                client's own HeroState, fed to stepHero), the hd2d renderer, input.ts,
                sound.ts, session.ts (owns the store writes, navigates only through
                `state/navigation.ts`). No React, and no `alepha`/`alepha/react` import, in here â€”
                enforced by keeping `game/**` in the package's plain (non-alepha) `tsconfig.json`
                program, which fails loudly if an alepha import leaks in.
                tile-draw.ts holds the per-cell tile id â†’ draw instruction arithmetic, shared
                by the renderer and the editor stage so the two cannot drift.
  i18n.ts       locale state; useLocale() for React, t() for everyone.
```

### Per-package tsconfigs, not one

The DOM lib and the Workers/Node runtime types both declare `WebSocket`, `Response`, and `fetch`
with incompatible shapes â€” loading both into one program produces a blizzard of nonsense
errors. The **package boundary carries that split**: `engine` is pure (neither lib),
`renderer`/`client`/`editor`/`ui` are DOM, `server` extends alepha's base (below). Each package
has one `tsconfig.json` extending the root `tsconfig.json` base and typechecking its own `src`
**and** `test/`. The only root program is `tsconfig.tooling.json` (Node): the Vite/vitest
configs, the root `scripts/`, and the engine's tests (which use Node globals its pure src
config can't host). `yarn typecheck` runs each package's `tsc` then the tooling one;
`yarn typecheck:<pkg>` runs just one.

The Alepha migration added a second split inside `client` and `editor`: alepha's own package.json
points `types` at raw framework source rather than a compiled `.d.ts`, so any file importing
`alepha`/`alepha/react*` pulls the whole framework source tree into whichever program resolves it,
type-checked under THAT program's `compilerOptions` â€” and this repo's base is stricter than
alepha's own (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, â€¦), so alepha's internals
fail it by the hundreds. Each affected package therefore also has a `tsconfig.api.json`, extending
`.vendor/alepha/tsconfig.base.json` instead of the repo base, that owns only the files that import
alepha (`ui/AppRouter.tsx`, `state/atoms.ts` and their alepha-reading consumers for
`client`/`editor`) â€” each such file is `exclude`d from the package's plain `tsconfig.json` so it is
never checked under both regimes. `yarn typecheck:<pkg>` runs both programs for an affected
package. `apps/main/tsconfig.json` follows the same fix for its two bootstrap entries (`main.ts`,
`main.browser.ts`), which both import the alepha-flavored `AppRouter` â€” extending alepha's base
directly rather than needing a plain-vs-alepha split of its own, since neither entry has a
non-alepha half to keep separate. `server` needs no split at all: its sole `tsconfig.json`
extends alepha's base and covers all of `src` plus `test-api/` â€” one program,
`yarn typecheck:server`.
