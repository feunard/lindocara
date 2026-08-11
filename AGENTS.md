# lindocara â€” agent & contributor guide

A modern cooperative RPG adventure creator built on the [Alepha](./.vendor/alepha) framework â€”
Node + SQLite in dev and on the self-hosted Alepha Bay production instance
([lindocara.bay.alepha.dev](https://lindocara.bay.alepha.dev)) â€” targeting solo play through
four-player sessions. The current authoritative vertical slice contains players, terrain, Warden Mira,
roaming monsters, combat, loot, progression, quests, local chat and a database-backed map editor.
Those systems are foundations for authored multi-map adventures, not a commitment to MMO scale.

The primary UX is title â†’ login â†’ resumable parties/saves. Creating a new party then selects an
adventure; hero creation/selection happens inside that party. Adventure/map authoring is a secondary
creator-tools route. Never make `CharacterSelect` the post-login screen again. Player/game UI may
use strong Tiny Swords chrome; creator editors must stay dense, sober and keyboard-efficient using
the existing React/Radix primitives, with Tiny Swords limited to previews and restrained accents.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | `alepha dev` â€” the whole app on Node: auto-synced SQLite, `/api/*`, auth, the `/ws/*` realtime rooms and the SPA shell, always on **port 5273** (see below) |
| `npm run verify` (or `npm run v`, `npx alepha verify`) | the full verify pipeline: clean â†’ lint â†’ typecheck + tests (parallel) â†’ migrations drift check â†’ catalog/map/music content checks â†’ build â†’ boot smoke; `--fast` keeps the migrations check but skips content checks, the build and the smoke. There is no separate i18n check â€” en/fr parity, empty strings and per-`EventCode` templates are asserted by `packages/engine/test/i18n.test.ts`, so `npm test` covers it |
| `npm run clean` | remove every build output (`apps/main/dist`, `apps/lab/dist`, `apps/lab/dist-client`). `verify` runs it first so a green build cannot be a stale directory; it does NOT run it last, because the artifact is worth keeping |
| `npm run smoke` | boot the BUILT artifact and prove it runs (see below). Needs `npm run build` first â€” `verify` and CI both sequence it there |
| `npm run check` | catalog/map checks, lint, typecheck, test â€” run this before committing |
| `npm run check:runtime` | lint, typecheck, runtime server/player UI tests and build; skips creator map/adventure validation |
| `npx alepha vendor diff` / `sync` | show local patches to the vendored framework / re-sync `.vendor/alepha` from `../alepha` (each sync = its own commit, pinned in `.vendor/vendor.json`) |
| `npm run loadtest -- --players=10 --duration=60 --scenario=mixed` | authenticated local WebSocket load test (`/api/join` + `/ws/world`); remote targets require explicit opt-in |
| `npm run lab` | `vite dev` on `apps/lab` â€” the HD-2D render witness (`@lindocara/hd2d` + `three`), see below |
| `npm run deploy -w @lindocara/lab` | ship the witness to [lindocara-lab.bay.alepha.dev](https://lindocara-lab.bay.alepha.dev) as a **static site** â€” files with no process behind them, `target: "static"` + `static.source`; needs `LORE_API_KEY`, see [`apps/lab/AGENTS.md`](./apps/lab/AGENTS.md) |
| `npm run lint` / `lint:fix` | Biome |
| `npm run typecheck` | one tsc per package + `apps/main` + a Node tooling program (see below) |
| `npm test` | Vitest â€” every package's project (all Node/jsdom; the `server` project drives the real Alepha app over HTTP/WebSocket) |
| `npm run build` | `alepha build` â€” bundles `apps/main`; CI builds the production shape via `npm run build -w @lindocara/main -- --target bare` |
| `npm run deploy` | `alepha platform up -e production` â€” build, pack and upload to Bay; CI runs it on every push to `main` and migrations run at app boot |
| `npm run db:generate -w @lindocara/main` | diff the `$entity` schemas into a new `apps/main/migrations/sqlite/` migration â€” **currently broken repo-wide**, see below |
| `npm run check:migrations -w @lindocara/main` | fail on entity/migration drift (also part of `npm run v`) |
| `python3 studio/studio.py sprite\|sfx\|voice\|music` | generate a game asset locally, in this game's art direction â€” sprites, sound effects, voice lines, music. No API, no cloud, no key. See [Generating assets](#generating-assets) |
| `python3 studio/studio.py doctor` | check the asset studio's runtimes and weights, then generate one artifact per lane â€” run it first on a machine that has never generated anything |

Asset generation runs on macOS (Apple Silicon) and on Windows/Linux with an NVIDIA GPU; on
Windows the commands start with `python`, not `python3`.

### The dev server has a dedicated port: 5273

`npm run dev` always serves <http://localhost:5273>, pinned with `port` + `strictPort` in
[`apps/main/vite.config.ts`](./apps/main/vite.config.ts). **Use that address, never 5173.**

5173 is the Vite/Alepha default, shared by every Alepha project on the machine, and without a pin
`alepha dev` walks forward — 5173, 5174, 5175… — until it finds a free one, so the port changed run
to run. That drift is not cosmetic: every local tool that talks to the running app hardcodes a
target (`scripts/lib/adventure-api.ts`'s `DEFAULT_LOCAL_TARGET`, the seed and import/export CLIs,
`scripts/loadtest.mjs`, `.claude/launch.json`), and a drifting server silently pointed them at
whatever else was listening — most often another Alepha app answering the same auth routes with its
own realm rules, which reads like a lindocara bug and is not one. `scripts/loadtest.mjs`'s
`verifyTarget` exists because that already happened.

**5273 = the framework default + 100, deliberately far from 5173.** Adjacent is the crowded part:
Alepha Lore is itself a multi-app workspace, and one `alepha dev` there claims 5173..5179 in a
single run (`DevCommand.selectApps` hands out `basePort + i`). Any pin inside that band collides
whenever Lore is up — which is exactly what the old 5178 tooling default did. Keep out of a
neighbour's fleet, not merely off its first port.

`strictPort` is the half that makes it dedicated: boot now FAILS on a collision instead of walking
on. That failure is information — a stale dev server is still running. Stop it; do not start a
second one on another port. `SERVER_PORT` in the environment still overrides everything (Alepha
reads it first), which is how the framework's own multi-app runner assigns ports.

`apps/lab` is a separate app and still declares 5174 (`apps/lab/vite.config.ts`), with no
`strictPort` — inside Lore's band, so it drifts whenever Lore is running. Left as-is for now; it is
a witness, nothing targets it programmatically.

### History: the Alepha migration (2026-07-29 â†’ 2026-07-31)

lindocara is a pure Alepha app. The original hand-rolled stack â€” a Cloudflare Worker entry,
`World`/`GameSession`/`HeroPresence` Durable Objects, wrangler-managed D1 with Drizzle, a zustand
screen machine â€” was migrated in four tranches (API port, realtime rooms, React shell, deploy +
cleanup) and then fully retired: no legacy code, config or rollback path remains. Production later
moved from Cloudflare to Alepha Bay and now ships through `alepha platform up` at
[lindocara.bay.alepha.dev](https://lindocara.bay.alepha.dev). The
memory of the migration lives in git and in the
[spec](./docs/superpowers/specs/2026-07-29-alepha-migration-design.md) + plans
([tranches 0-1](./docs/superpowers/plans/2026-07-29-alepha-migration-tranches-0-1.md),
[realtime](./docs/superpowers/plans/2026-07-30-alepha-migration-realtime.md),
[react-shell](./docs/superpowers/plans/2026-07-30-alepha-migration-react-shell.md),
[deploy + cleanup](./docs/superpowers/plans/2026-07-30-alepha-migration-deploy-cleanup.md)).
Everything below describes the present.

## Architecture

The one rule that matters: **the server decides outcomes.** Damage, healing, loot, XP, quests,
deaths, monster AI and projectiles are all decided by the room and only relayed to a client.

**Exactly two decisions moved to the client, and no more: where a hero is, and where a mobility
skill puts it.** A client owns its own hero's movement â€” it runs the rule, reports the position it
reached (`{t:"move"}`) and applies a blink the server GRANTED. Everything in the first paragraph
stayed where it was, and a `ClientMessage` still cannot carry damage, health, a heal, an inventory
change, XP, a death, loot or a quest completion.

**The spec conceded AUTHORITY over movement, not VALIDITY.** The server no longer steps a hero, but
it still refuses one: `applyReportedMove` bounds a reported position against the real map
(`withinRoomBounds`), the wire caps every coordinate at `MOVE_COORDINATE_LIMIT`, and a mobility
grant is a server-issued distance with a server-issued deadline. A client that reports where it
wishes it were is dropped, not believed.

### Monorepo layout (npm workspaces)

The old single `src/` is now **workspace packages under `packages/*` plus the deployable app under
`apps/*`**. The **repo root holds only project setup** â€” the workspace `package.json`, the shared
`tsconfig.json`/`biome.json`, the `vitest.config.ts` aggregator, docs, and the root `scripts/`.
Nothing deliverable lives at the root; a second site would be a sibling `apps/<name>`. **Each package
has its own `AGENTS.md`** (linked below) â€” read it before working inside that package. The old `src/â€¦`
prefixes in the file map further down map straight onto these homes:

| Package | Old path | Depends on | Runtime |
| --- | --- | --- | --- |
| [`@lindocara/engine`](./packages/engine/AGENTS.md) | `src/shared/`, plus `hd2d/` â€” the HD-2D witness's geometry and movement rule, moved in from `apps/lab` in S2 | â€” | pure (ni DOM ni Workers) |
| [`@lindocara/server`](./packages/server/AGENTS.md) | `src/server/` â€” now Alepha services/entities/controllers (`src/api/`), the realtime rooms (`src/api/realtime/`) and the world systems (`src/world/`) | engine, alepha | Node (dev) / workerd (prod) |
| [`@lindocara/renderer`](./packages/renderer/AGENTS.md) | drawing half of `src/client/game/` (+ `input`, `locale`, `scene-sample`) | engine, hd2d | browser, React-free (Three.js via `@lindocara/hd2d`) |
| [`@alepha/ui`](./.vendor/@alepha/ui) | the shared shadcn/Base-UI tree + `cn` + `styles.css` tokens - VENDORED from ../alepha, never hand-edited | npm only | browser + React |
| [`@lindocara/client`](./packages/client/AGENTS.md) | rest of `src/client/` + `public/` (app shell, HUD, Tiny-Swords tree, store, api, i18n, glue) | engine, renderer, ui | browser + React |
| [`@lindocara/editor`](./packages/editor/AGENTS.md) | `src/client/ui/editor/` + editor game files â€” HD-2D authoring stage and playable preview | engine, renderer, client, ui | browser + React |
| [`@lindocara/catalog`](./packages/catalog/AGENTS.md) | `assets/` (raw Tiny Swords art) + the catalogue codegen (was `scripts/tiny-swords-catalog-*`) | engine | node (dev) |
| [`@lindocara/testing`](./packages/testing/AGENTS.md) | shared test fixtures (`map-fixtures`, `tiles`, jsdom setup) | engine | node/jsdom (dev) |
| [`@lindocara/hd2d`](./packages/hd2d/AGENTS.md) | the HD-2D render engine (billboards, terrain mesh, lighting, post-fx) | three only | browser, framework-free (Three.js) |
| [`@lindocara/audio`](./packages/audio/AGENTS.md) | the shared sample bank + the movement samples the game and the lab both play (extracted from `apps/lab/src/core/audio.ts`) | nothing | browser, framework-free (WebAudio) |
| [`@lindocara/main`](./apps/main/AGENTS.md) | **the deployable app** â€” `alepha.config.ts`, the server/browser entries, `migrations/`, build/deploy | client, server | build â†’ Worker + assets |
| [`apps/lab`](./apps/lab/AGENTS.md) | the HD-2D render **witness** â€” reproduces the PoC on `hd2d`, not a game; see its own `AGENTS.md` | engine (`hd2d/` only), hd2d, three | browser (Vite dev app) |

`.vendor/alepha` is the vendored framework â€” a real workspace member, pinned by
`.vendor/vendor.json` to a commit of the sibling `../alepha` repo. **The dogfood loop for
framework work:** a framework fix is implemented in `../alepha` (its tests live there), verified
with `yarn v` upstream, committed and pushed, then pulled here with `npx alepha vendor sync` â€” the
sync is its own commit. `npx alepha vendor diff` shows any local patches; keep it clean.

> **Every valid authored map has a playable heightfield.** Map create/update/import compiles the
> tile-editor document and its events through `compileAuthoredMap`; `HeightfieldBackfillProvider`
> performs the same conversion once for historical database rows whose heightfield is empty. The
> owner-fenced `PUT /api/maps/:id/heightfield` remains the remote terrain-seeding escape hatch used by
> `npm run adventure:proving -- --target=â€¦ --allow-remote=true`. Malformed legacy authoring payloads
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
render path, read [`docs/hd2d-rendering.md`](./docs/hd2d-rendering.md) â€” what makes the HD-2D style,
the rendering pitfalls already paid for once, and what the deleted PixiJS renderer knew that nothing
else records. See also
[`docs/superpowers/specs/2026-08-02-hd2d-reboot-design.md`](./docs/superpowers/specs/2026-08-02-hd2d-reboot-design.md)
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

`npm run typecheck` runs every package `tsc`, including `typecheck:editor`, plus
`apps/main`'s own `tsconfig.json` (covers its
`main.ts`/`main.browser.ts` bootstrap entries, previously typechecked by no program at all â€” it
extends alepha's own base config, the same fix `packages/client/tsconfig.api.json` already needed,
because both entries import the alepha-flavored `AppRouter`) and the Node tooling program; `npm run
typecheck:<pkg>` (or `typecheck:main`) checks one â€” `typecheck:hd2d`/`typecheck:lab` follow the same
pattern for the two newest members. **Tests are co-located per package** in `packages/<pkg>/test/`
(the server's live in `packages/server/test-api/`; `apps/lab`'s in `apps/lab/test/`), each with its
own `vitest.config.ts` (engine/catalog/server/hd2d/lab = node, renderer/client/editor = jsdom â€” hd2d
and lab need no DOM because three itself builds geometry/material/color data identically outside a
browser, and the two packages' own pure logic â€” `tiltShiftRadius`/`fillAmount`/`sheetUv` in hd2d,
`island.ts` in lab (its sibling `terrain-query.ts` moved into `@lindocara/engine/hd2d/` in S2,
alongside the rest of the hero's movement rule) â€” is exactly what's left once anything
canvas/WebGL is excluded). The root `vitest.config.ts` aggregates them via `projects`, so `npm test` runs everything
and `npm test -w @lindocara/<pkg>` (or `npm run test:<pkg>`, e.g. `test:hd2d`/`test:lab`) runs one.

**The app's config lives with the app:** `apps/main/alepha.config.ts` declares the production
platform (Bay adapter, public domain and bay-admin endpoint); `apps/main/migrations/`
holds the database migrations; `apps/main/src/main.ts`/`main.browser.ts` are the server and
browser entries. The deploy is one `alepha platform up -e production` in `apps/main`. See
[`docs/superpowers/specs/2026-07-22-monorepo-packages-design.md`](./docs/superpowers/specs/2026-07-22-monorepo-packages-design.md)
and [`docs/superpowers/plans/2026-07-22-monorepo-packages.md`](./docs/superpowers/plans/2026-07-22-monorepo-packages.md).
The file map below keeps its original `src/â€¦` prefixes; read them through the table above.

### Current party-adventure foundation

Before changing world routing, room ownership or hero location persistence, read
[`docs/adventure-runtime-architecture.md`](./docs/adventure-runtime-architecture.md) and the
historical [`docs/mmo-migration-plan.md`](./docs/mmo-migration-plan.md). Both predate the Alepha
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
                worldTick.ts (the tick order), channels.ts (the `$room` channel declarations).
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
                every route shares (LocaleToggle/StatusBar visibility, menu music) and installs
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

### Server world systems

`WorldRoom` (`packages/server/src/api/realtime/WorldRoom.ts`) is the room entry point and owns
every mutable room collection and timer; `worldTick.ts` composes the readable tick order it runs.
Modules under `packages/server/src/world/` are concrete domain systems, not an ECS:

- `world-runtime.ts` defines player, monster, guard, loot and room runtime types plus attachment
  hydration/serialization and entity factories.
- `connection-system.ts` maintains socket/player indexes and connection rate windows.
- `movement-system.ts` no longer moves anyone: the hero's rule runs on the client and
  `applyReportedMove` (`worldTick.ts`) is where a position changes. What it kept is the per-player
  beat that always sat beside movement â€” resource regeneration, the presence heartbeat, corpse
  reclaim, loot collection, the attachment write and the dirty flush.
- `combat-action-system.ts` owns the authoritative anticipation/impact/recovery timeline and
  guarantees one resolution per action. `projectile-system.ts` advances bounded swept projectiles,
  resolves terrain/entity contacts and removes them on impact, expiry or owner departure.
- `combat-system.ts` retains narrow damage helpers, while `skill-system.ts` owns
  collision-resolved mobility and line-of-sight helpers. Player combat never selects an entity.
- `monster-system.ts` advances monster AI, respawns and guards. Guard kills remain a separate path
  that cannot grant player rewards.
- `quest-system.ts` exposes zone-owned quest ordering; quest mutations and intermap handoff remain
  orchestrated by `WorldRoom` because they cross persistence, presence and connection boundaries.
- `loot-system.ts` collects and expires ground loot while keeping the non-authoritative grid in
  sync.
- `interest-system.ts` builds per-recipient AOI views; `snapshot-system.ts` turns those views into
  welcome state, deltas and resync responses.
- `event-run-system.ts` holds the room's live event runs: the `eventId`-keyed run lock, the
  budgeted per-tick drain with its working-copy read model, and the buffered per-triggerer
  dialogue. Trigger DETECTION and effect DISPATCH stay in `WorldRoom`/`worldTick.ts` (they own
  positions, sockets, the coordinator seam); this owns only the bookkeeping that must never touch
  a socket, a clock or the coordinator.
- the class-variant systems (`warrior/ranger/priest/rogue-*-system.ts`), the authored-content
  systems (`authored-monster/guard-system.ts` and the root `authored-quest-system.ts`),
  `peasant-harvest-system.ts`, `peasant-support-system.ts`, `damage-over-time-system.ts`,
  `npc-movement-system.ts` and `cheat-command-system.ts` follow the same explicit-dependency shape.
- `spatial-grid.ts` is the world-system import boundary for the existing non-authoritative grid.

Fenced hero persistence is not a world system: it lives in `api/services/HeroSaveService.ts` and
is called from `WorldRoom` on the periodic dirty-flush beat, disconnect and transitions.

Allowed dependency direction is `WorldRoom/worldTick -> world systems -> shared rules`. Systems
may import server persistence boundaries when that is their stated responsibility, but never
client code. Shared modules must not import server systems. Systems receive room collections,
grids, services and callbacks as arguments; do not add mutable module globals or hide room state
in a singleton.

To add a mechanic, first place platform-free rules in `src/shared/` when both client and server need
them. Add the authoritative mutation to the narrowest existing server system (or a small new domain
system), pass its dependencies from `WorldRoom`/`worldTick.ts`, add it explicitly to the readable
tick/action order, then cover the pure/system edge with a unit test and the authoritative flow with
the real-app harness in `packages/server/test-api/` (it boots the Alepha app and drives real HTTP
and WebSockets).

To add a network message, define and defensively parse its wire shape in `shared/protocol.ts`. For a
client intent, dispatch it in the connection/action boundary and pass only validated intent to the
responsible system. For a server message, emit a machine event code or typed snapshot change through
`snapshot-system.ts`; update both i18n dictionaries for player-facing wording, update client map
upsert/removal validation when the message changes world state, and add protocol plus resync/delta
integration coverage. Never let a new message select a room or supply an authoritative outcome.

### Two players, two rules

- **You** are drawn in the present, because you ARE the present. Your client runs the movement
  rule (`stepHero`) every animation frame and draws the result immediately. There is nothing to
  reconcile and nothing to smear: the position on your screen is not a guess at the server's
  answer, it is the answer, and the server's copy is the one that trails.
- **Everyone else** is drawn `INTERPOLATION_DELAY_MS` (150ms) in the past, interpolated
  between the two snapshots bracketing that instant. You cannot know where a remote player is
  *now*, and guessing looks worse than being slightly late.

Do not "fix" the interpolation delay by removing it. It is what buys smooth remote motion out
of a 10Hz delta stream, and it does not apply to your own hero â€” it never did, and moving movement
to the client changed nothing about that half.

**A remote hero is drawn in its reported STATE, not just at its reported point.** `PlayerSnapshot`
carries `airborne`, `swimming`, `gliding` and vertical velocity beside the position, and the
renderer reads them
(`packages/renderer/src/hd2d/billboards.ts`): a swimmer is drawn at the water line, an airborne or
gliding hero at its own reported elevation, and only a walking one is stood on the terrain under it.
The position stream cannot tell those three apart, so a renderer that ground-snapped everyone would
make every other player's jump invisible and never fail a test.

### The move report

The client owns its hero's position and REPORTS it â€” `{t:"move"}`, carrying all three axes,
vertical velocity, the unit facing vector and the three locomotion flags. There is no command queue, no sequence number
and no `ack`; `{t:"input"}`, `MAX_STARVED_TICKS` and the starve branch are deleted.

- **20 reports a second, deliberately** (`MOVE_REPORT_MS = TICK_MS`, `packages/client/src/game/net.ts`)
  â€” the exact rate the retired one-command-per-tick stream ran at, so it is already proven to sit
  inside `RATE_MAX_MESSAGES` (35/s) with chat, actions and resyncs beside it. Do not lift it.
- **An identical frame is not sent.** An idle hero reports nothing: the last frame the server has is
  still true. The hero still STEPS every animation frame; only the report is throttled, and remote
  clients fill the gaps with the interpolation above.
- **The server validates, it does not step.** `applyReportedMove` (`worldTick.ts`) bounds the
  reported position against the real map (`withinRoomBounds`), the parser caps every coordinate at
  `MOVE_COORDINATE_LIMIT`, and a corpse's or a mid-handoff hero's frames are dropped outright.
  Authority over movement was conceded; validity was not.

### Why `stepHero()` lives in `engine/`

The client runs it to move, and it is the only copy â€” so the terms have changed but the reason has
not. What both sides still share is the TERRAIN: `zoneTerrainFromHeightfield` bakes a `ZoneTerrain`
out of the stored heightfield string, and `canStand`/`resolveGroundMovement` answer every "can a
body be here" question. The server bakes it to validate; the client bakes it to move. **Same
string, same function, one answer** â€” fork that and a hero walks through a wall on one side of the
wire and into it on the other, with nothing failing anywhere.

Two client-owned decisions and their fences:

- **Mobility (blink).** The server GRANTS it: `SelfState.mobility` carries a distance and a deadline
  derived from the live held action, so the grant's ABSENCE is its withdrawal â€” there is no revoke
  message. The client spends it once per action id and lands on a standable cell. Cost, cooldown,
  resource, invulnerability and every effect stayed server-side, and `ClientMessage` gained nothing
  that mentions mobility, so a client cannot fabricate a grant.
- **Drowning.** A server-decided death in place. The client reports a bare `{t:"drowned"}` â€” no
  position, no damage â€” and the room refuses it unless that client's own position stream has the
  hero alive and swimming. Then `killPlayer` leaves the body where it went under. The current
  release policy resurrects it at the map entry like any other death.

`apps/lab` remains the witness that exercises `stepHero` outside the game, not a second copy of it.

### Per-package tsconfigs, not one

The DOM lib and the Workers/Node runtime types both declare `WebSocket`, `Response`, and `fetch`
with incompatible shapes â€” loading both into one program produces a blizzard of nonsense
errors. The **package boundary carries that split**: `engine` is pure (neither lib),
`renderer`/`client`/`editor`/`ui` are DOM, `server` extends alepha's base (below). Each package
has one `tsconfig.json` extending the root `tsconfig.json` base and typechecking its own `src`
**and** `test/`. The only root program is `tsconfig.tooling.json` (Node): the Vite/vitest
configs, the root `scripts/`, and the engine's tests (which use Node globals its pure src
config can't host). `npm run typecheck` runs each package's `tsc` then the tooling one;
`npm run typecheck:<pkg>` runs just one.

The Alepha migration added a second split inside `client` and `editor`: alepha's own package.json
points `types` at raw framework source rather than a compiled `.d.ts`, so any file importing
`alepha`/`alepha/react*` pulls the whole framework source tree into whichever program resolves it,
type-checked under THAT program's `compilerOptions` â€” and this repo's base is stricter than
alepha's own (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, â€¦), so alepha's internals
fail it by the hundreds. Each affected package therefore also has a `tsconfig.api.json`, extending
`.vendor/alepha/tsconfig.base.json` instead of the repo base, that owns only the files that import
alepha (`ui/AppRouter.tsx`, `state/atoms.ts` and their alepha-reading consumers for
`client`/`editor`) â€” each such file is `exclude`d from the package's plain `tsconfig.json` so it is
never checked under both regimes. `npm run typecheck:<pkg>` runs both programs for an affected
package. `apps/main/tsconfig.json` follows the same fix for its two bootstrap entries (`main.ts`,
`main.browser.ts`), which both import the alepha-flavored `AppRouter` â€” extending alepha's base
directly rather than needing a plain-vs-alepha split of its own, since neither entry has a
non-alepha half to keep separate. `server` needs no split at all: its sole `tsconfig.json`
extends alepha's base and covers all of `src` plus `test-api/` â€” one program,
`npm run typecheck:server`.

### Classes

`CLASS_STATS` in `shared/game.ts` and `CLASS_SKILLS` in `shared/skills.ts` are the balance tables for
damage scaling and skill values. `PLAYER_ACTIONS` in `shared/combat-actions.ts` supplies the active
frame, recovery and projectile geometry. The server validates class, unlock level, resource cost,
cooldown, direction, collision and every resulting damage or heal.

### Directional action combat

Player combat has no target selection. The only offensive intents are `{ t: "attack" }` and
`{ t: "skill", slot }`; neither may carry an entity id, hit position, damage, heal or impact.
The last non-zero movement accepted by the server becomes the player's facing and remains stable
while idle. Starting an action freezes that direction, spends its cooldown/resource immediately,
and broadcasts only visual timing. Missing is valid and still consumes the cooldown.

Actions have anticipation, one active frame and recovery. Melee origin follows the actor until the
active frame; projectile origin is frozen when the projectile spawns. Projectiles use swept terrain
and entity collision, so a fast projectile cannot tunnel between ticks. Monster threat may choose
whom the AI pursues, but a monster freezes its strike direction at wind-up and damages only actors
still inside its capsule at the active frame. See
[`docs/directional-action-combat.md`](./docs/directional-action-combat.md) for skill geometry,
timings, limits and Tiny Swords mappings.

### Death is a state machine, not a timer

`shared/death.ts` owns it. Dying does not move you â€” it leaves your body where you fell:

```
"alive" â”€â”€(hp 0)â”€â”€â–¶ "corpse" â”€â”€(a priest interacts)â”€â”€â–¶ "alive"
                        â”‚
                        â””â”€â”€(you press R)â”€â”€â–¶ "ghost" â”€â”€(walk onto your body)â”€â”€â–¶ "alive"
```

The current release policy bypasses the ghost branch: pressing R resurrects immediately at the
current map's authored entry (or its nearest standable fallback). The ghost route shown above is
retained only for historical persisted-state compatibility.

There is no timer in it and no auto-release. A corpse waits indefinitely, which is the only
reason a priest's grace period means anything. Priest revival and direct release both return at
`RESURRECT_HP_RATIO` of max HP.

Three consequences, each easy to break:

- **Monsters skip any player who is not `alive`.** A corpse waiting for release or a priest must not
  keep taking damage, and a historical ghost remains protected while compatibility state resolves.
- **A body is broadcast for as long as its owner has one** â€” while they lie over it *and* while
  a historical ghost still refers to it. Ordinary release clears it immediately.
- **`life` and the corpse position are persisted** (`hero.life`, `corpse_x`, `corpse_y`,
  `corpse_z` â€” three axes, `x`/`z` ground and `y` elevation, like every other position).
  Death that lives only in memory turns logging out into a free resurrection.

A compatibility ghost moves at `GHOST_SPEED` and a corpse at zero, so the client folds its life state into the
one speed the rule reads (`speedForLife`, `engine/death.ts`) before every `stepHero` â€” it does not
branch on life twice, and a corpse is fed a zeroed input rather than skipped, so gravity and the
water keep running underneath it. The server's half of the fence is `applyReportedMove`,
which refuses a corpse's frames outright: a body that reports itself walking is not believed.

The priest's resurrect is the interact key, not a sixth skill slot: `#interact` already dispatches
to the nearest sensible thing, and a corpse is one more thing you can be standing next to.

`CEMETERIES` and `nearestCemetery()` remain part of the legacy pixel catalogue, but the current
heightfield release path does not use them: `mapEntryPosition()` resolves the authored map entry.

### Bay production routing

Production is a plain Node process on Alepha Bay. `apps/main/alepha.config.ts` intentionally has no
Cloudflare assets block: Alepha serves the SPA/API/WebSocket routes and Bay proxies the public
domain to that process. `endpoint` is the authenticated bay-admin control plane used only for
deploys; it is not the application origin. The retired `lindocara.alepha.dev` Worker remains an
old, frozen deployment and must never be presented as the live application.

## Database

The **alepha ORM**. `packages/server/src/api/entities/*.ts` are the `$entity` definitions â€” one
file per table, the single source of truth â€” and services access them through `$repository`. Both
dev and the Bay production process use SQLite; dev auto-syncs while production uses migrations.
Migrations live in `apps/main/migrations/sqlite/`:

```bash
# edit packages/server/src/api/entities/*.ts
# BROKEN as of 2026-08-04 and not yet fixed: a top-level `await` inside an `if` in
# apps/main/src/main.ts defeats drizzle-kit's esbuild bundling, and every `alepha db` command boots
# that entry. `npm run check:migrations` (the drift check) is unaffected. Writing a migration by
# hand, or hoisting that await, are the two ways round it until someone fixes the entry.
npm run db:generate -w @lindocara/main        # alepha db migrations create â€” commit the output
npm run check:migrations -w @lindocara/main   # entity/migration drift check (also inside `npm run v`)
```

`alepha platform up` packs the migrations with the Bay artifact; the production app applies them
at boot before it begins serving traffic.

**D1 compatibility discipline** â€” the current production is SQLite, but the ORM code remains
portable and these adapter constraints stay load-bearing:

- `repo.transaction()` throws on D1 â€” use the `$transactional()` middleware instead, and know it
  degrades to a no-op there (the D1 provider reports `supportsTransactions: false`), so it never
  serializes a read-then-write sequence against a concurrent request.
- Bulk writes/deletes are chunked under D1's ~100 bound-parameter cap per statement â€” see
  `MapService`'s chunked element/layer writes.
- A count-then-insert invariant (party size cap, unique colour slot) cannot rely on a transaction
  to serialize it. Build the guarded row as **one single-statement conditional
  `INSERT ... SELECT ... WHERE (SELECT count(*) ...) < cap`** via `Repository.query()` and
  classify a zero-row result against a follow-up read â€” never a `count()` read followed by a
  separate `create()` call.

Objects, equipment, skills and multi-quest progression use separate normalized ownership tables
documented in [`docs/persistence-model.md`](./docs/persistence-model.md) (written pre-migration;
its `hero_*` model carried over, its `character_*` rollback family did not). Hero inventory,
equipment, currencies, class resource, skills, quest rows, talents, bounded cooldowns and timed
consumable effects are durable alongside its map, position, core stats, life, corpse and fencing
epoch. Every hero child-table mutation must include an `EXISTS` fence against
`hero.session_epoch` (or be a server-side create before a session exists).

Accounts are Alepha's own `users` (username+password credentials realm â€” see
`api/providers/AppSecurityProvider.ts`). The primary post-login screen lists persistent parties as
resumable saves. Each `hero` belongs to one user and one party and is selected inside that party.
Dirty hero profiles are saved every five seconds, on disconnect and at map transitions.

### Hero presence and save fencing

`PresenceRoom` (`/ws/presence`, headless, roomId `heroId`) owns the per-hero lease
(`connectionId`, epoch, room, timestamps). The database is the single monotone source of
`hero.session_epoch` (`HeroEpochService`); the presence room stores only the active lease.

- Acquisition freezes and saves the previous owner while its epoch is still valid, increments the
  epoch atomically, then installs the new lease.
- The lease lasts 30 seconds (`PRESENCE_TTL_MS`) and `WorldRoom` renews it on a 10-second beat
  (`PRESENCE_HEARTBEAT_MS`). Inputs use local authority and never touch the presence room per
  command or tick. A refused renew is a lost lease: the player is dropped with 4003.
- Normal disconnect saves with `WHERE id = ? AND session_epoch = ?`, releases the matching lease,
  then removes the runtime player.
- A stale save changes no row, logs a stale-save diagnostic, invalidates local authority,
  and closes the socket with `WS_CLOSE.PRESENCE_LOST`.
- Hero core and normalized progression writes share the same batch and epoch fence
  (`HeroSaveService`). A stale room may update neither the `hero` row nor inventory, equipment,
  skill or quest children.

Adventure-map handoff uses the same epoch fence: freeze source actions, save the source, then
conditionally write destination map/position and epoch N+1. Only then remove/close the source
socket with `WS_CLOSE.ZONE_TRANSITION`. The client reconnects with only its party/hero identity;
admission reads the destination from the database.

### Party routing and room isolation

Admission is two steps: the client calls `GET /api/join?party=<partyId>&hero=<heroId>`
(`JoinController` + `AdmissionService`) for a `{roomId, channelPath}` **hint**, then dials
`/ws/world?roomId=â€¦&party=â€¦&hero=â€¦`. The room re-validates account, membership, hero ownership
and adventure-map membership against the database in `onJoin` and reads the authoritative map and
position there â€” no query parameter or client message may select a destination map or position.
Close codes keep the 4001-4008 vocabulary (`engine/close-codes.ts`).

`PartyRoom` (headless, roomId `partyId`) coordinates the room directory and party-wide
broadcasts. Simulation is sharded into `WorldRoom` instances addressed by `partyId:mapId`; each
owns only that room's players, monsters, loot, timers, navigation and local chat. Persistent
party chat and victory fan out through `PartyRoom`. This sharding preserves the session isolation
invariant. Compiled catalogue zones remain test content.

### Maps and the editor

Maps live in the database (`MapService`) and are private to their author account. Every successful
content/name update increments a monotone `revision`; failed updates do not. Adventures may only
reference their author's maps, their full graph is revalidated before a referenced map mutation,
and delete/edit operations cannot silently invalidate a saved adventure. Legacy ownerless rows are
quarantined unless the migration can identify exactly one author.

Terrain is three layers of frozen tile ids (`MapData.layers`, RPG Maker XP-shaped) over an authored
`tilesetId`, not one `TileKind` character per cell. A tile's id is decided once, at paint time â€” the
editor computes the autotile edge variant when you paint and freezes the result, which is what lets
an author override a single tile by hand afterwards. What an id *means* â€” walkable or not, drawn
behind or in front of characters â€” is a tileset property authored once per tile, never a per-cell
one, so collision stays derivable from appearance through one indirection: `tile id â†’ tileset â†’
passable`. The pixel `TerrainGeometry` still carries two baked collision sources â€” `tiles` (the
grid, whole cells) and `colliders` (a `ColliderIndex` of sub-cell rectangles, one per colliding
element), joined by `isWalkable` so a tree blocks its trunk rather than its whole cell â€” **but no
running room reads them any more.** That model belongs to the tile editor and the catalogue zones
now; it feeds no live party and dies with them. **On the wire, `WorldInfo.heightfield` is the ONLY
terrain, and
`WorldInfo.layers`/`WorldInfo.elements`/`WorldInfo.events` are appearance only** â€” never derive
collision from any of the latter three. `WorldInfo.tiles` and `WorldInfo.colliders` are gone: S3's
tile-units increment made the stored heightfield the single geometry, baked into a `ZoneTerrain` by
`zoneTerrainFromHeightfield` (`packages/engine/src/terrain-access.ts`) on the server AND, from the
same string with the same function, on the client â€” which runs the movement rule itself and needs
the very geometry the server will validate it against. An agent that reads
`layers` to decide walkability reintroduces exactly the silent desync this design exists to prevent,
and reading `elements` for a collider is the same mistake with a second bake: collision only ever
comes from the heightfield, via `canStand`/`resolveGroundMovement`. Elevation needs no engine change â€” a cliff face
is its own cell, impassable, one layer above the ground. The brush maintains that face on the lower
cell of every north/east/south/west boundary, so a plateau is a real barrier on all four sides.
Directional stair gateways are the only authored crossing: the editor chooses a side
(right/left) and the transition (0â†”1 or 1â†”2). They use Pixel Frog's two native side ramps; there are
no top/bottom variants. The brush clears both joined cliff faces and the path is bidirectional.
Every blocking cliff face draws its oriented rock cell; no side may remain collision-only because
that creates an apparently empty but inaccessible strip around raised ground. See
[`docs/superpowers/specs/2026-07-18-layered-map-model-design.md`](./docs/superpowers/specs/2026-07-18-layered-map-model-design.md)
for the full model.

The welcome message includes `mapId + revision`, the `heightfield` (the only geometry there is),
appearance layers, `tilesetId` and authored elements, so the client's movement rule, the renderer
and the mini-map share the same cache identity. The baked collision tiles and sub-cell colliders it
used to carry are gone with `WorldInfo.tiles`/`WorldInfo.colliders`.

The `adventures` and `map-editor` screens are gone: one `adventure-editor` screen
(`src/client/ui/editor/`) now owns both, as menu bar / toolbar / three resizable panes (shadcn
`TerrainPalette` left, the WYSIWYG HD-2D stage centre (rebuilt on the shared renderer;
rebuild), `MapListPanel` right) / status bar.

Entering the editor opens a fresh unsaved adventure rather than a picker: `AdventureEditorScreen`'s
no-session branch calls `ensureScratchAdventure()`, which is one atomic `POST /api/adventures`
(the route returns the default map with it, so there is no second round trip). `File → Open` reaches
an existing adventure and `File → New adventure` starts another; both are dirty-guarded. Untitled
scratches accumulate by design and are deleted by hand from the Open dialog.

Adventure metadata lives in `AdventureSettingsDialog`, off the canvas. All chrome is stock shadcn â€”
the old floating asset palette was the last Tiny import inside a creator surface, and it died with
the pre-merge screens, so the two-tree rule now has zero exceptions in the editor. The stage keeps
sharing placement/collision/catalog rendering rules with the runtime through `shared/map-data.ts`
and `client/game/catalog-element-render.ts`, with explicit loading/empty/error state, grouped
history, dirty navigation guards, selection/inspectors, stable marker ids with optional labels and
complete marker preview.

`shared/tile-brush.ts` grew a rectangle (`paintRectAutotile`/`eraseRect`), a flood fill
(`floodFill`) and a stairs stamp (`paintStairs`) â€” each re-resolves neighbours the same way the
pencil always did, and `resolveWholeLayer` is still the oracle they're tested against. The old
`Layer 1/2/3/EV` pill only ever routed the eraser â€” painting always wrote layer 0 (plus automatic
cliff-wall upkeep on layer 1) and stairs always wrote layer 1 â€” so it is now a Field/Element/Event
segmented control (`activeMode`, threaded from toolbar/menu bar down to the stage handle) that
actually names which of the three authored collections the editor is working in: Field owns the
tile layers, Element owns `MapData.elements`, Event owns `MapEvent[]`. The sidebar is three
mode-scoped palettes (`TerrainPalette`/`ElementPalette`/`EventPalette`) and the eraser is
mode-scoped too. Element mode places at quarter-cell positions: an element carries `offsetX`/
`offsetY` (0..3, quarter tiles = 16px) on top of its `col`/`row`, so a terrain cell is a 4x4 sub-grid
of decoration slots â€” up to 16 stacked decorations per cell â€” with an offset inspector, and each
catalogue asset authors its own sub-cell collider (`elementWorldCollider`), no longer a whole-cell
footprint. Scenery placement is terrain-independent: every known catalogue asset may be placed on
grass, cliffs or water; `allowedTerrain` remains catalogue guidance, not a save-time restriction.
Every tool has a keyboard shortcut, gated off while a dialog is open or the stage isn't ready. The
stairs tool stamps a two-tile Tiny Swords ramp on layer 1. Atlas column 0 climbs right and column 3
climbs left; those are the only supported orientations. Both halves run beside
one 0â†”1 or 1â†”2 boundary; the clicked cell is the low half and the preview shows both occupied cells.
It never paints elevation itself: the author paints both levels first, and flat or mismatched ground
is refused. Other adjacent elevation faces do not invalidate two matching endpoints. Painting water
over either stair tile, or any later terrain edit that invalidates either endpoint, removes the whole
pair and restores normal cliff upkeep. Baked ramp cells reduce hero movement to 86%; the renderer
adds a smooth 7px hero lift and raises the camera target by 24px on level 1 and 56px on level 2,
blending through the stair and reversing on descent. The elevation offset is applied after ordinary
map-bound camera clamping, otherwise a stair near the north edge silently loses the whole effect.
Client movement, server validation and local preview all read the same
baked `ramp` kind. Fill has no fill-to-empty primitive; the UI disables it rather than let it
silently no-op.

The pointer-events contract is load-bearing and easy to get backwards. `#stage` stays a `position:
fixed`, full-viewport sibling of `#root` (see the canvas gotcha below), so by default it paints and
hit-tests *above* any normal-flow chrome. `.editor-root` inverts that: a `pointer-events: none`
stacking context over the canvas, with each chrome island â€” menu bar, toolbar, the two side panels,
status bar â€” opting back in via `.editor-chrome`/`.editor-root > *`. The centre body row
(`.editor-body`) stays pointer-transparent so painting strokes reach the canvas; anything clickable
floating over that centre, like the selection inspector, must re-enable pointer events on itself.
Get this backwards and either every chrome click is eaten by the canvas, or every stroke is blocked
by the chrome.

Maps now carry authored **events** â€” their own `mapEvents`/`mapEventPages` tables, saved inside
the same map-save write path as elements and layers, chunked under D1's ~100-bound-parameter cap
the same way the element writes are. An event is a client-minted uuid (stable so tranche 5's
commands can reference it) plus a per-map creation-order ordinal (the `EV001` chip â€” display only,
never identity) and 1â€“8 ordered pages, each carrying conditions, appearance, autonomous-movement
settings, options and a trigger. **Nothing executes**: the game runtime is untouched, and an
authored event is invisible to a running party until the next tranche evaluates page conditions
server-side. The wire parser rejects a payload with an absent condition field â€” a client must emit
an explicit `null`, never omit the key, so "no condition" stays distinguishable from "malformed."
The EV tool, the stage overlay (sprite + `EV{ordinal}` chip, or the placeholder box with no
graphic) and the event dialog live entirely in the editor, in stock shadcn. Because Radix portals
`DialogContent` to `document.body`, outside `.editor-root`, the `legacy.css` shadcn fence now also
exempts `[data-slot] *`, not just `[data-slot]` itself â€” a bare `<button>`/`<input>` nested inside a
data-slot container had no `data-slot` of its own and was repainting as a green Tiny Swords pill.
See
[`docs/superpowers/specs/2026-07-19-map-events-design.md`](./docs/superpowers/specs/2026-07-19-map-events-design.md)
for the full model.

See
[`docs/superpowers/specs/2026-07-18-editor-shell-design.md`](./docs/superpowers/specs/2026-07-18-editor-shell-design.md)
and [`docs/superpowers/plans/2026-07-18-editor-shell.md`](./docs/superpowers/plans/2026-07-18-editor-shell.md)
for the shell's spec and plan, and
[`docs/adventure-editor-roadmap.md`](./docs/adventure-editor-roadmap.md) for what comes next. The
pre-merge two-screen spec/plan
([`docs/superpowers/specs/2026-07-16-map-editor-design.md`](./docs/superpowers/specs/2026-07-16-map-editor-design.md),
[`docs/superpowers/plans/2026-07-16-map-editor.md`](./docs/superpowers/plans/2026-07-16-map-editor.md))
is superseded.

### Adventure state: switches, variables and page selection

An event's conditions read something real. **State belongs to the party, not the hero** â€” a
party is the save, so `PartyRoom` (roomId `partyId`) is the single writer of switches,
variables and per-event self-switches; `WorldRoom`s never write it, they install a read-only
snapshot `PartyRoom` pushes over the same coordinator seam party chat and victory already cross.
Persistence is **write-through**: every accepted mutation batch is saved to the database before
the push (`AdventureStateService`), so the stored row is never behind the coordinator. The
registry â€” switch/variable ids and names, up to 200 of each â€” rides the adventure row as bounded
JSON, not a new table: it is small, atomic with the adventure, and authored entirely in the
editor's registry dialog.

**Page selection is XP's rule, not a per-tick one.** For each event, the active page is the
highest-position page whose conditions all hold; an unknown switch/variable id reads as false/0; no
page holding means the event is dormant. `WorldRoom` evaluates this against the state snapshot on
snapshot install and on hero join â€” **never per tick**; re-evaluation on state-change is the
reason the snapshot push exists at all. A room re-deriving its state (a fresh room, an evicted
isolate) pulls the current `(state, version)` from `PartyRoom` (`getAdventureState`, a reverse RPC
into the coordinator), never from the database directly: the coordinator's held version is the
ordering authority, and reading storage beside it would be a second, uncoordinated reader.

Active events reach the client as `WorldInfo.events` â€” the third member of the `elements`/`layers`
family: id, cell, the active page's appearance and options, **appearance only**. Collision still
comes exclusively from `tiles`; an event carries no collider in this tranche regardless of its
authored "traversable" flag.

**The interpreter mutates state.** `applyStateChanges` on `PartyRoom` is the real single
writer: an event run's `mutateState` effects flow UP as a coordinator RPC, are applied
serially, bump a **monotone `version`** (once per batch) shipped with every snapshot and written
through to the database before the new state is pushed to every room. `installAdventureState`
carries a **`>=` version guard** so a room that receives two pushes out of order keeps the newer
one, and it must **never throw** â€” `PartyRoom` awaits the push, so a throwing install would block
the writer. See
[`docs/superpowers/specs/2026-07-19-adventure-state-design.md`](./docs/superpowers/specs/2026-07-19-adventure-state-design.md)
and the interpreter design below.

### The event interpreter

Authored commands are a real language now (tranche 5). `shared/event-commands.ts` is the command
model + total parser; `shared/event-interpreter.ts` is the **pure, clockless stepper**
(`stepEventRun` executes exactly ONE command and returns the new context plus data effects);
`server/world/event-run-system.ts` holds the room's live runs and the budgeted drain;
`client/ui/hud/EventDialoguePanel.tsx` is the per-player panel;
`client/ui/editor/EventCommandEditor.tsx` is the editor's command column. Five contracts bind:

- **The budget is the speed limit.** `drainRuns` executes at most `EVENT_COMMANDS_PER_TICK` (16)
  commands per tick across ALL running contexts, round-robin, then yields. An authored
  `loop { setVariable add }` with no exit consumes its slice and returns â€” the room keeps ticking,
  monsters keep moving, other heroes keep being simulated. This is the same per-tick-budget
  discipline `navigation-system.ts` applies to A*; the mutation proof (remove the cap) is a bounded
  assertion, never a hang. Never make the interpreter drain a whole program in one tick.

- **One run per event, room-local lock.** `EventRunRuntime.contexts` is keyed by `eventId`, and that
  key IS the lock (Q4): while an event holds a live context, a second trigger is dropped silently
  (never an error the player sees). A hero's disconnect, map transition or death aborts their
  contexts (the life-transition queue-clear precedent). A per-hero dialogue cap adds that a hero
  already parked on a `say`/`choices` panel cannot open a second one. Proven end-to-end: two heroes
  triggering one gold chest on the same tick yield exactly ONE grant, not two.

- **Single-writer mutations, with the drain-local working-copy read model.** Durable writes go up to
  the coordinator (above), but a run must see its OWN just-written switches immediately, or
  `setSwitch X; if X â€¦` would take the wrong branch. So the drain keeps a **local working copy**,
  seeded from the snapshot at drain start and folded forward with the shared pure `applyStateMutation`
  after each `mutateState`; every later step THIS tick (command execution and `if`/waiting-condition
  evaluation alike) reads that copy. The batch still flows up unchanged. If the command budget splits
  a run across ticks, `WorldRoom` pauses only the event drain until `PartyRoom` has applied and
  pushed that batch; simulation keeps ticking. The next drain therefore seeds from the acknowledged snapshot,
  never from a pre-batch value that would replay a non-idempotent `add`. Cross-room propagation remains
  asynchronous relative to simulation, but the source run cannot outrun its own coordinator writes.

- **Authored prose is the sanctioned codes-not-sentences exception.** `event.say`/`event.choices`
  carry the author's `text`/`name`/`prompt`/option labels as DATA across the wire (still size-capped
  and defensively parsed both directions) â€” the one exception to "server events are codes", because
  the author wrote it and no dictionary can hold it. The i18n rule keeps governing every CHROME
  string around the panel (Continue, Choose, the hotkey caption). Do not route authored prose through
  an `EventCode`, and do not smuggle a UI label into a `say`.

- **Dialogue is a per-player panel with a distance-close.** A `say`/`choices` beat is wired to the
  TRIGGERER only (`event-run-system` buffers by `heroId`); the other party members' viewports stay
  clean. Movement stays LIVE while the panel is open â€” the panel captures only its own keys (Space /
  the interact key to advance, 1-4 to choose), never WASD or the skills. Each drain tick, a run parked
  on a dialogue whose triggerer has walked beyond `DIALOGUE_CLOSE_RADIUS` (3 tiles) ENDS: the
  panel closes and the conversation is over (WoW's rule). Walk-away is not a state rollback â€” anything
  the run already wrote stays written; it abandons only the REMAINDER.

Triggers are server-detected: the interact key near an `action` event, or a movement box landing on a
`player-touch` event's cell â€” both only for `normal`-kind events with a satisfied active page. The
client only ever sends the existing interact intent and movement; no message selects a run or supplies
an outcome. Gold/items are per-hero and persisted through the same epoch-fenced hero save boundary as
the rest of the normalized inventory. See
[`docs/superpowers/specs/2026-07-20-interpreter-design.md`](./docs/superpowers/specs/2026-07-20-interpreter-design.md).

### Heartroot city, guards and visual readability

The safe zone is an authored city, not a decoration-only rectangle. `shared/game.ts` owns every
building collider, quest-keeper coordinate, spawn, and guard home; `client/game/world-layout.ts`
owns only visual roads, districts, signs and decor density. Keep those two descriptions aligned.
All quest keepers must remain inside `SAFE_ZONE` on walkable ground.

Guards are simulated by the world room and emitted in snapshots. They target only live monsters
inside **their own patrol ring**, cannot leave that ring, and never attack players. A guard
kill sets the monster respawn state directly: it must never call the player reward path, create
loot, grant XP, or advance a kill quest.

**The safe zone did not survive the heightfield.** `ZoneTerrain` carries no `safeZone` and a stored
heightfield has no way to declare one, so the "monsters may not touch a player inside Heartroot's
walls" rule is gone and the patrol ring above replaces it. That is the branch every authored map
already took â€” `safeZone` was baked `null` for all of them â€” so the only loser is the Verdant Reach
catalogue, which no live party is routed to. `safeZoneShelters` (`engine/game.ts`) still exists for
the catalogue's own tests and dies with the pixel `TerrainGeometry`; no converted system calls it.

Guards themselves are durable service NPCs rather than defeat objectives. Hostile melee,
techniques and projectiles all pass through `world/combat-system.ts`'s `applyGuardDamage`, which
may wound them down to one HP but never removes them from the room.

Direction signs use the bundled Tiny Swords banner texture and localized text. They have no
collider by design so junctions cannot be grief-blocked. Puzzle rendering must never receive the
expected rune order; `questSiteFeedback()` exposes proximity labels but always returns a zero
signal alpha. World-space notifications are limited by `MAX_ACTIVE_WORLD_EFFECTS` and
`shouldFloatEvent()`; system, loot and quest prose belongs in React's event log.

### Spatial grid and area of interest

`server/spatial-grid.ts` is a non-authoritative index: the room's own collections remain the
source of truth. **Every radius below is in TILE units** since S3 converted the world; each is still
written in `engine/interest.ts` as its old pixel value over `TILE_SIZE`, so the distances themselves
did not change â€” only the ruler. Cells are 4 tiles. Per-recipient views query nearby players
(14.0625), monsters (13.28125) and loot (10.15625), with a 1.5 exit hysteresis; self is
unconditional. Guards and corpses use a 14.0625 view, spatial events 13.28125, and local chat
10.9375. `welcome` is the complete baseline; `world.delta` is emitted at 10 Hz while simulation
stays at 20 Hz. Per-player network maps compare against the last state actually sent, including HP,
life, class, appearance and equipment. Movement below `WORLD_POSITION_DELTA_THRESHOLD`
(`0.5 / 64` of a tile) accumulates against that sent baseline rather than being forgotten.

The client applies upserts/removals to maps, materializes a complete view, and only then appends it
to the existing interpolation buffer. A non-monotone/unexpected delta tick, invalid frame, unknown
removal, or `world.resync_required` causes one bounded `world.resync` request. The full response
replaces the maps and interpolation baseline. Keep JSON validation on every new delta collection.

When adding a dynamic spatial type, insert on creation, update after authoritative movement,
remove on destruction/expiry, and never mutate gameplay through the grid. A radius query touches
only intersecting cells; corpse and guard scans are intentionally retained because those sets are
small and bounded. The `local` and `party` chat channels are implemented; protocol types still
reserve future `guild`, `global`, and `whisper` names.

### Cooperative combat and persistent parties

`shared/cooperation.ts` owns the pure bounded-threat, contribution eligibility, taunt and XP-split
rules. `shared/resources.ts` is the single class-resource table. Room-owned mutable maps remain in
`WorldRoom`; `world/monster-system.ts` selects and prunes threat, `world/contribution-system.ts`
fences reward attribution and `world/interest-system.ts` filters personal loot.
`world/party-system.ts` still contains an older room-local group mechanic; hero sessions must not
expose its create/invite/dissolve UI. Their `party` chat means the persistent database party and
is routed by `PartyRoom` across map rooms.

Useful healing means actual missing HP restored; overhealing never creates threat or contribution.
Personal loot is protected twice: it is omitted from every other player's AOI/delta and collection
also checks `ownerId`. Persistent party membership and colour survive disconnects and handoffs;
`DELETE /api/parties/:id/membership` is the explicit abandon path for an open save: it removes the
caller's heroes and seat, transfers hosting to the oldest remaining member, and conditionally
deletes the party when its last member leaves. Those empty-cleanup and host-transfer writes are
single SQL statements so D1's no-op transaction middleware cannot create a join/leave race.
temporary combat contribution state remains room-local. See
[`docs/cooperative-combat.md`](./docs/cooperative-combat.md) for formulas and resource costs.

### Monster navigation

`ZoneDefinition.navigation` configures a room-local walkability grid generated from the zone's
authoritative `ZoneTerrain` â€” one node per heightfield cell, walkable per `canStand`, so the grid
and the movement rule read the same geometry. `world/navigation-system.ts` owns incremental
four-neighbour A*, the 128-entry path cache, unique request queue and per-tick node budget.
`monster-system.ts` owns behaviour selection: patrol, threat chase, unreachable-target abandonment
and return to spawn. Never bypass `resolveGroundMovement()` when following a path; it remains the
final collision authority.

A target must move at least `72 / 64` of a tile (the same distance the pixel world used, in the
units S3 converted to) and respect the 650 ms repath interval. A threat target change
may force a request, but navigation work still stays inside the room budget. Add navigation for a
new zone by configuring `navigation` beside its terrain, not by branching in the engine. See
[`docs/monster-navigation.md`](./docs/monster-navigation.md) for generation, budgets, debug mode and
known limits.

### Observability, load and security boundaries

The legacy per-room `world_metrics` observability system was retired with the workerd stack;
observability parity on the alepha rooms is an open follow-up, and rooms currently rely on
structured error logs plus Bay's platform views. When it returns, keep the old
discipline: bounded room-local counters, aggregate windows only, never individual inputs, attacks,
chat messages or inventory operations, and no metrics in module globals â€” a metric window belongs
to exactly one room.

`scripts/loadtest.mjs` is the black-box load boundary. It provisions through `/api/*`, resolves
admission through `GET /api/join` and connects through `/ws/world`, sends only legal client intent
and reports client-observed throughput and ACK latency. It groups accounts into parties of up to
four so `PresenceRoom`, `PartyRoom` and normalized hero persistence are all under load. Its
default target is localhost. Keep production behind both explicit remote and production opt-ins
(`--allow-remote=true` + `--allow-production=true`), and never put production credentials in the
script.

Security limits live beside the boundary they protect: HTTP JSON is capped before parsing,
WebSocket frames are capped at 2 KiB, identifiers are server-minted UUIDs, malformed/rate-limited
connections are closed, a reported position is bounded by the map it claims to be on
(`applyReportedMove`) and by `MOVE_COORDINATE_LIMIT` before that, resync is limited to one per
second, action cooldowns remain authoritative, and database mutations use
ownership/epoch/idempotency constraints.
When adding a message, assign its cost class: cheap intents use the connection window, expensive
rebuild-like requests also need a dedicated cooldown. Add rejection coverage as well as the happy
path. Credential stuffing is guarded separately from room traffic: Alepha's login service keeps
one 60-second database-backed window per source IP (30 failures) and per account (8 failures).
`LindocaraApi` must keep the global `CacheProvider -> DatabaseCacheProvider` substitution; the
workerd default expects an unprovisioned KV namespace and its defensive error handling would
otherwise fail open.

## Gotchas worth knowing

**Alepha atoms are not for the 60Hz path.** Every write to a `$atom` validates its zod schema and
fires an unfiltered global event â€” fine for state a screen transition writes once, disqualifying
for anything written 20-60x/s. The game bridge stays zustand (`store.ts`); atoms
(`state/atoms.ts`) hold only screen-transition state.

**`$action` names must not collide with alepha builtins.** Duplicate action names fail the
framework's configure hook at boot â€” and a collision can surface only in the full production
provider graph, so a narrow dev path can look green while the deployed service is dead.
`HealthController.apiHealth` is named that, not `health`, because
alepha's own `ServerHealthProvider` registers `health`.

**A green `alepha build` is not a working deploy.** `platform up` is the pipeline â€” build
`--target bare`, pack the service, assets and migrations, upload through bay-admin and push the
allowlisted `$env` secrets. The Bay process applies migrations at boot; a build alone proves only
compilation. Relatedly, any `alepha db` command boots the
real server entry (`apps/main/src/main.ts`) and needs a resolvable `DATABASE_URL` (the dev SQLite
default suffices locally).

**`npm run smoke` is what closes that gap** (`scripts/smoke-boot.ts`, last step of `npm run verify`
and of CI). It boots the built artifact the way Bay boots it and asserts five things a compiler
cannot see: migrations applied against an empty database, `/api/health` answers, `GET /` serves the
Lindocara shell with a module entry script, an unadmitted `/ws/world` dial is refused BY THE ROOM,
nothing logged an `ERROR` on the way up, and SIGTERM stops the process. Three details in it are
load-bearing and were each found the hard way:

- **The process runs with `apps/main` as its working directory, not `dist/`.** Alepha's
  `DatabaseProvider.getMigrationsFolder()` returns the RELATIVE `migrations/<driver>`, so booting
  from inside `dist/` logs "Migration SKIPPED - no migrations found" and then dies on the first
  query against a table nothing created.
- **Probe `localhost`, never `127.0.0.1`.** The Node server binds the hostname it is given and on a
  dual-stack machine that is `::1` ONLY — an IPv4-hardcoded probe gets ECONNREFUSED from a server
  that is up and healthy.
- **The WebSocket assertion is three-way on purpose.** A mounted-but-fenced `/ws/world` completes
  the upgrade and is then closed by the room with an `engine/close-codes.ts` code (4004 today); a
  path nothing serves fails the upgrade and surfaces as a transport error; an open socket means a
  client reached the world without passing `GET /api/join`. Collapsing that to "the socket did not
  stay open" would pass just as happily when the room stopped being served at all.

It is a boot smoke, NOT a browser end-to-end test: nothing logs in, creates a party or renders a
hero. A Playwright suite over the real screens is still an open gap.

**IDE tsserver misprojects the vendored-source programs.** alepha's `package.json` points `types`
at raw framework source, so an open file can be assigned the wrong tsconfig program and show false
diagnostics that no CI check reproduces. `npm run typecheck` is the truth, not the editor
squiggles.

**Empty rooms reset.** Room state is memory-only: the tick stops when a room empties and Node
sweeps idle rooms after 5 minutes â€” temporary
monsters/loot reset and state is recreated on the next join. Durable truth (hero saves, adventure
state) is written through to the database, epoch-fenced; never park durable truth in room memory.
Don't make the tick unconditional either: empty rooms should consume neither simulation work nor
memory indefinitely.

**A running party is isolated by `partyId`.** `PartyRoom` owns party-wide coordination while each
active `partyId:mapId` `WorldRoom` owns room-local simulation; production runs exactly one room
per id. Do not route authored maps by `mapId` alone or bypass the coordinator for party-wide
chat/victory.

**`onTick` is synchronous.** An async tick slower than its 50 ms period silently skips beats.

**A square that sits still may be clamped, not broken.** Heroes enter at their persisted position
or the map's authored spawn, so a test â€” or a manual check â€” that pushes one fixed direction may
simply be pressing into a wall or a collider.

**`import.meta.env.DEV` exposes `window.__lindocara`** (`self()`, `all()`) for measuring input
latency and interpolation from outside the app. It is stripped from production builds.

**Server events are codes, not sentences.** `{ t: "event", code, params }` â€” the client owns
all wording via `src/shared/i18n/`. Never add an English string to a server send; add
an `EventCode` and two dictionary entries instead (the i18n test enforces parity).

**The canvas is not React's.** `#stage` is a sibling of `#root`, created by the client bootstrap
(`bootClient()` in `main.tsx`), not by the served HTML; nothing in `ui/` may touch it.

**Movement audio is recorded, not synthesised.** `client/game/sound.ts` plays the shared bank
([`@lindocara/audio`](./packages/audio/AGENTS.md)) — the very takes the lab was tuned against, with
per-shot pitch/level jitter. It replaced a bandpass-noise synthesiser whose only variety was a
rotating ±8%. `movement-sounds.ts` still owns the ROUTING, as an exhaustive switch over `HeroEvent`,
so the compiler catches the day the rule grows an event; the package owns only what both consumers
agree on. A key named there that the package does not define is silent with nothing failing —
`movement-sounds.test.ts` is the guard.

**A looping strip's cadence is per MOTION, not one shared number.** `ACTOR_FRAME_MS`
(`renderer/actor-motion.ts`) holds the lab's `HERO.anims` fps inverted — idle 7, run 12 — and every
`ActorView` carries the one for the motion it is drawing (`frameDurationMs`). Before that, every
looping strip in the game shared a hardcoded 145 ms: right for idle by coincidence, and 6.9 fps for
a run that should be 12, so a hero's body moved at full speed while its legs cycled at 57%. That is
what reads as skating, and no typecheck or snapshot test can be wrong about a cadence — only an eye.

**Ripples, breath and footprints come from `@lindocara/hd2d`'s primitives, not from rebuilt
geometry.** `makeRipple()` is a textured plane with `fog: false`; a `RingGeometry` annulus with the
identical timing curve moves correctly and reads as a wireframe hoop. The swim ripple was exactly
that until it was fixed. Its cadence is the 550 ms timer in `syncLocalHero` ALONE — a `brasse` event
is a sound, and emitting a ripple there too puts two overlapping series on the water.

**A landing shakes the camera, off the same number that makes it loud.** The rule's `reception`
force (0.35..1.4, `hero-step.ts`) drives the sample's gain AND `heroLandingImpulse`
(`renderer/camera-shake.ts`). They must keep agreeing: a landing that is loud but still, or that
shakes without a thud, reads as a bug in the physics rather than in the presentation.

**`@lindocara/hd2d` has no module-level mutable state.** Camera yaw, the billboard registry, the
cloud-shadow uniforms all live on `Hd2dContext` (`createHd2dContext()`), never a module variable.
The PoC used module state because it only ever opened one scene; the game and a future editor
preview will each open their own `hd2d` context, and a module singleton would mean rotating one
scene's camera also rotates the other's sprites. See `packages/hd2d/AGENTS.md`.

## Generating assets

`studio/` is a **four-lane asset studio** for this game's art direction â€” sprites, sound effects,
voice lines and music â€” running entirely locally. macOS on Apple Silicon uses MLX, Windows and
Linux use CUDA; the backend is detected from the machine and the commands are identical. Every
model is Apache 2.0 or MIT, so **generated assets are shippable**; that constraint drove the picks
(MusicGen, AudioGen and F5-TTS are all CC-BY-NC and were rejected for it).

```bash
python3 studio/studio.py sprite --prompt "a goblin archer with a short bow, standing idle" --out <chemin>.png
python3 studio/studio.py sfx    --prompt "a heavy wooden door creaking open" --duration 3 --out <chemin>.wav
python3 studio/studio.py voice  --text "You shall not pass!" --archetype brute --out <chemin>.wav
python3 studio/studio.py music  --prompt "calm village at dawn" --duration 60 --out <chemin>.wav
```

Rules that matter:

- **Call `studio.py`, never the underlying runtimes.** It injects the art direction from
  `studio/theme.json` into every prompt â€” that is what makes a goblin sprite, a door creak and a
  village theme feel like one game rather than four models. `--no-theme` opts out deliberately.
- **Sprites are not finished when they come out.** The model renders a smooth 768Â² illustration;
  `apps/lab/scripts/sprite.py` is what turns it into pixel art at the game's density. Record the prompt and
  seed in `apps/lab/assets/generated/PROVENANCE.md`.
- `studio/characters.json` binds a name to a look *and* a voice, so a creature stays itself across
  lanes (`--character elf-druid`). Add an entry, nothing else changes.
- Shared flags: `--seed` (default 42), `--variants N`, `--no-theme`, `--dry-run`.
- `python3 studio/studio.py doctor` proves the plumbing. It cannot tell you whether a bleat sounds
  like a sheep â€” **that stays a human pass**, same as sprites always needed an eye on the grid.

Rough costs on the M4 Pro it was built on: a 768Ã—768 sprite ~25 s, 2 s of SFX ~4 s, a short voice
line ~5 s, 20 s of music ~55 s. A 12 GB NVIDIA card is in the same range.

### First run on a machine that has never generated anything

Weights are ~30 GB and download on first use; the repo itself only carries the 64 MB LoRA. Start
with the diagnostic â€” it names what is missing *and* the command that fixes it, so work from its
output rather than guessing:

```bash
python3 studio/studio.py doctor --no-gen
```

**On Windows that first word is `python`, not `python3`**, in this and every command below.
`python3` is not a real command there: what answers to it is a Microsoft Store stub that opens the
Store instead of running anything. `py -3 studio/studio.py â€¦` works too.

**Windows / Linux with an NVIDIA GPU.** Prerequisites are a recent driver,
[uv](https://docs.astral.sh/uv/), ffmpeg on PATH, and **espeak-ng** (Kokoro's phonemiser â€” the
voice lane fails without it; Windows installer on the
[espeak-ng releases page](https://github.com/espeak-ng/espeak-ng/releases), `apt install espeak-ng`
on Linux). Nothing else is installed by hand: each lane builds its own virtualenv on first use from
its `pyproject.toml`. Then fetch ACE-Step, which is the one model not pulled automatically:

```bash
git clone https://github.com/ace-step/ACE-Step-1.5.git studio/musics/ACE-Step-1.5 && uv sync --project studio/musics/ACE-Step-1.5 && uv run --project studio/musics/ACE-Step-1.5 acestep-download
```

Then `python3 studio/studio.py doctor --fast` (sfx and voice only, ~30 s) before the full run.

Two Windows traps worth naming up front:

- In the NVIDIA control panel, set **CUDA â€“ Sysmem Fallback Policy** to *Prefer No Sysmem Fallback*.
  Left on, a VRAM overflow does not fail â€” it silently spills to system RAM over PCIe and runs
  10â€“100Ã— slower, which reads as "the model is slow" rather than "the model does not fit".
- **The CUDA path has not been executed by its author.** It is written from each model's upstream
  docs; `doctor` is its acceptance test. If a package name has drifted upstream, the runner's error
  message carries the exact command to fix it â€” apply that rather than rewriting the runner.

**macOS (Apple Silicon)** needs `mflux`, `mlx-speech` and `mlx-audio` as uv tools. The `mlx-audio`
install line in `studio/AGENTS.md` is load-bearing: without its version pins, Kokoro dies on a numpy
ABI mismatch at import time.

### Where the details live

`studio/AGENTS.md` is the studio's own guide â€” install for both platforms, the backend model, the
theme file, characters. Per-lane guides carry the prompt recipes and the known limits, and are worth
reading before a batch rather than after:

| Lane | Guide | Read it for |
| --- | --- | --- |
| sprite | `studio/pixel-art/AGENTS.md` | prompt structure, locking a character, why sprites need post-processing |
| sfx | `studio/sounds/AGENTS.md` | physical-description prompting, a table of recipes that worked |
| voice | `studio/voices/AGENTS.md` | archetypes, cloning a voice, punctuation as prosody |
| music | `studio/musics/AGENTS.md` | track recipes, genre blending, why nothing loops cleanly |

Claude Code users also get `.claude/skills/game-assets/`, which fires on its own when a session
needs an asset. It is a shortcut to the same commands, not a separate path.

The LoRA is trained in the separate `pixel-art-model` lab; `studio/models/` holds the picked
checkpoint. Promoting a new one is a `cp` plus one line in `studio/theme.json`. The Tiny Swords
source art is Pixel Frog's pack â€” check its terms before distributing the LoRA or generated sprites
outside this project.

## Secrets

`APP_SECRET` is the one production secret: alepha's SecretProvider derives session encryption
from it and **throws in production when it is defaulted** â€” that throw is the guarantee. Dev
needs nothing; the framework default applies.

- production: stored as a GitHub repository secret (`gh secret set APP_SECRET`); the deploy job
  exports it and `alepha platform up` pushes it to the Worker. Rotating it is `gh secret set`
  with a new value plus a redeploy â€” this invalidates every live session.
- CI/deploy also needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (and `SEED_PASSWORD`
  for the Liin adventure publish step) as repository secrets.

The three game envs â€” `WEBSOCKET_MAX_PAYLOAD`, `NAVIGATION_DEBUG`, `CHEATS_ENABLED` â€” are `$env`
primitives with safe defaults; being `$env`-declared is what puts them on the manifest allowlist
`platform up` pushes from the deploy job's environment, so set them there only if a non-default
production value is ever wanted. `$env` parses once per Alepha instance from a boot-time env
snapshot â€” there is no live env mutation, in tests or on Workers.

## Conventions

- Browser checks (running the app, screenshots, driving the editor UI): use the `playwright-cli`
  skill, never the Claude-in-Chrome extension.
- Biome formats and lints. `noNonNullAssertion` is on: no `!`, narrow properly.
- Never trust a client message. `parseClientMessage` returns `null` and the frame is dropped.
- Prefer a test that drives the real app over one that mocks it. `packages/server/test-api/`
  boots the Alepha app and opens real HTTP requests and WebSockets; follow that. No `vi.mock`.
- Alepha classes (services, controllers, rooms) use no TypeScript `private` members; JSDoc
  comments are multi-line (`/** â€¦ */` blocks), matching the framework's own style.
- Every player-facing string lives in `src/shared/i18n/` in both languages. API errors are
  machine codes.
- UI is React; game code under `src/client/game/` must not import React. The store is the
  only bridge â€” components never call into net/renderer directly (the `GameHandle` in the
  store is the exception and the boundary).
- Two component trees, one rule each. Player/game UI uses the client's `ui/tiny-swords/`; creator
  tools and any non-game surface use **`@alepha/ui`** (`import { Button } from
  "@alepha/ui/components/ui/button"` - note the `ui/` segment and no `.js`). Never import a Tiny
  component into an editor to "match the theme".
- `@alepha/ui` is VENDORED, not local: it lives in `.vendor/@alepha/ui`, is listed in the root
  `alepha.config.ts` vendor plugin, and arrives with `npx alepha vendor sync`. Do not hand-edit it -
  a local change becomes a patch `vendor diff` reports forever and the next sync fights. A component
  that needs changing is changed upstream in `../alepha` and synced back, exactly like the framework
  (see the dogfood loop above). It replaced the project's own `packages/ui` shadcn copy, which is
  deleted; `npm run ui:add` is gone with it, because adding a component is now an upstream concern.
  The historical port spec (`docs/superpowers/specs/2026-07-18-shadcn-base-ui-port-design.md`)
  describes that deleted package.
  package's `components.json`.
- Stock shadcn's `@layer base` sets `body { background-color; color }` **directly**, which beats
  anything `legacy.css` inherits from `:root` â€” CSS layers only compete with declarations on the
  same element. If game text ever turns near-white, that is why; fix it in `legacy.css`'s
  unlayered `html, body` rule, never by editing the generated token blocks in `app.css`.
  The UI suite runs with `css: false`, so no test will catch a regression of this kind â€” check it
  in a browser. The same unlayered-beats-layered rule cuts the other way too: `legacy.css`'s bare
  `input`/`button` selectors (the Tiny Swords game skin) would otherwise bleed into stock shadcn
  controls wherever the two trees share a DOM, e.g. green pill buttons inside the editor. The fence
  is `:not(:where([data-slot], .editor-root *))` â€” `:where()` contributes zero specificity, every
  shadcn control carries `data-slot`, and every editor-authored raw control lives under
  `.editor-root`.
- `Label` is a generic passthrough that spreads props, so Biome's `noLabelWithoutControl` cannot see
  that call sites supply the control. The agreed resolution is a scoped `biome-ignore` on the JSX
  element, not an unconditional `for` attribute the component doesn't own.
