# lindocara â€” agent & contributor guide

A modern cooperative RPG adventure creator built on the [Alepha](./.vendor/alepha) framework â€”
Node + SQLite in dev and on the self-hosted Alepha Bay production instance
([lc.alepha.dev](https://lc.alepha.dev)) â€” targeting solo play through
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
| `yarn dev` | `alepha dev` â€” the whole app on Node: auto-synced SQLite, `/api/*`, auth, the `/ws/*` realtime rooms and the SPA shell, always on **port 5273** (see below) |
| `yarn verify` (or `yarn v`, `yarn alepha verify`) | the full verify pipeline: clean â†’ lint â†’ typecheck + tests (parallel) â†’ migrations drift check â†’ catalog/map/music content checks â†’ build â†’ boot smoke; `--fast` keeps the migrations check but skips content checks, the build and the smoke. There is no separate i18n check â€” en/fr parity, empty strings and per-`EventCode` templates are asserted by `packages/engine/test/i18n.test.ts`, so `yarn test` covers it |
| `yarn clean` | remove every build output (`apps/main/dist`, `apps/lab/dist`, `apps/lab/dist-client`). `verify` runs it first so a green build cannot be a stale directory; it does NOT run it last, because the artifact is worth keeping |
| `yarn smoke` | boot the BUILT artifact and prove it runs (see below). Needs `yarn build` first â€” `verify` and CI both sequence it there |
| `yarn check` | catalog/map checks, lint, typecheck, test â€” run this before committing |
| `yarn check:runtime` | lint, typecheck, runtime server/player UI tests and build; skips creator map/adventure validation |
| `yarn alepha vendor diff` / `sync` | show local patches to the vendored framework / re-sync `.vendor/alepha` from `../alepha` (each sync = its own commit, pinned in `.vendor/vendor.json`) |
| `yarn loadtest --players=10 --duration=60 --scenario=mixed` | authenticated local WebSocket load test (`/api/join` + `/ws/world`); remote targets require explicit opt-in |
| `yarn lab` | `vite dev` on `apps/lab` â€” the HD-2D render witness (`@lindocara/hd2d` + `three`), see below |
| `yarn workspace @lindocara/lab run deploy` | ship the witness to [lindocara-lab.bay.alepha.dev](https://lindocara-lab.bay.alepha.dev) as a **static site** â€” files with no process behind them, `target: "static"` + `static.source`; needs `LORE_API_KEY`, see [`apps/lab/AGENTS.md`](./apps/lab/AGENTS.md) |
| `yarn lint` | `alepha lint`: **oxlint `--fix`, then oxfmt**, both shipped inside `alepha`. It rewrites your files rather than only reporting, so there is no `lint:fix`; this is it |
| `yarn typecheck` | one tsc per package + `apps/main` + a Node tooling program (see below). Deliberately NOT `alepha typecheck` â€” see below |
| `yarn test` | `alepha test` â€” Vitest over every package's project (all Node/jsdom; the `server` project drives the real Alepha app over HTTP/WebSocket) |
| `yarn build` | `alepha build` â€” bundles `apps/main`; CI builds the production shape via `yarn workspace @lindocara/main run build --target bare` |
| `yarn deploy` | `alepha platform up -e production` â€” build, pack and upload to Bay; CI runs it on every push to `main` and migrations run at app boot |
| `yarn workspace @lindocara/main run db:generate` | diff the `$entity` schemas into a new `apps/main/migrations/sqlite/` migration â€” **currently broken repo-wide**, see below |
| `yarn workspace @lindocara/main run check:migrations` | fail on entity/migration drift (also part of `yarn v`) |
| `python3 studio/studio.py sprite\|sfx\|voice\|music` | generate a game asset locally, in this game's art direction â€” sprites, sound effects, voice lines, music. No API, no cloud, no key. See [Generating assets](#generating-assets) |
| `python3 studio/studio.py doctor` | check the asset studio's runtimes and weights, then generate one artifact per lane â€” run it first on a machine that has never generated anything |

Asset generation runs on macOS (Apple Silicon) and on Windows/Linux with an NVIDIA GPU; on
Windows the commands start with `python`, not `python3`.

### The package manager is Yarn 4 — never npm

`yarn.lock` is the lockfile, `packageManager` in the root `package.json` pins **yarn@4.18.0**, and
corepack is what installs that exact version (`corepack enable`, once per machine). This matches
the sibling repos — `../alepha` and `../club` — so the same commands work across all three, and it
is what `alepha platform up` detects: `BayAdapter` composes its build invocation from the lockfile
it finds, and takes the `yarn alepha build` branch here.

- **`yarn install`** to install, **`yarn install --immutable`** in CI — the `npm ci` guarantee:
  it fails rather than writing a lockfile, so a dependency edited without regenerating `yarn.lock`
  is caught before merge.
- **Running one workspace's script is `yarn workspace <name> run <script>`**, and flags need no
  `--` separator (`yarn workspace @lindocara/main run build --target bare`).
- **Never run `npm install` here.** It writes a `package-lock.json` beside `yarn.lock` and the two
  disagree silently: the tree on your disk stops being the tree CI resolves, which is exactly the
  class of bug a lockfile exists to prevent.
- `.yarnrc.yml` chooses the **`node-modules` linker**, not PnP, and states `enableScripts: false`
  (Yarn 4's own default). Nothing here needs install-time scripts — esbuild and sharp both resolve
  their binary from a per-platform package — so the day something does, it belongs in an explicit
  `dependenciesMeta.built` rather than a silent flip of that line.
- The root `alepha` devDependency is `"*"`, not a semver range, and that is load-bearing: yarn
  resolves a workspace transparently only when the range matches, so a pinned `^0.24.0` beside a
  vendored `alepha@0.25.1` would quietly download the framework from npm and shadow
  `.vendor/alepha`. `*` always matches, which is why every internal dependency here uses it.

### The scripts delegate to the alepha CLI wherever the CLI can carry them

`dev`, `build`, `deploy`, `db:generate` and `check:migrations` always were `alepha` commands, and
`verify` is itself an `$command` declared in the root [`alepha.config.ts`](./alepha.config.ts).
`lint` and `test` joined them: **`yarn lint` is `alepha lint`** (oxlint + oxfmt) and **`yarn
test` is `alepha test`** (Vitest). `test` resolves the `vitest` the project already had, at the
identical 4.1.10, and finds the root `vitest.config.ts`, so it runs all nine projects exactly as
before. `lint` resolves **oxlint and oxfmt out of alepha's own dependencies**: this repo declares
no linter and no formatter of its own, which is why `@biomejs/biome` is gone from `package.json`
and `biome.json` with it.

**`alepha lint` FIXES, and that changes what a green lint means.** It runs `oxlint --fix` and then
`oxfmt`, in that order and never the reverse: `--fix` rewrites code with no regard for line width,
so the formatter has to run after it for the tree to reach a state the next `lint` agrees with.
Given a badly formatted file it rewrites it and exits **0**. Locally that is what you want and it
replaces the old `lint:fix`. In CI it would wave through the very PR the step exists to stop, so the
workflow's Lint step runs `git diff --exit-code` behind it: on a runner the tree is pristine, so
anything the toolchain touched is a fix the author owed. Never copy that diff guard into `verify` or
a local script: it fires on any uncommitted work in progress.

The two configs are [`.oxlintrc.json`](./.oxlintrc.json) and [`.oxfmtrc.json`](./.oxfmtrc.json), and
both carry their reasoning inline; read the config before arguing with a finding. The short version:
`correctness` + `perf` as errors with **type-aware** rules on (the half Biome could not do at all),
and every rule turned off carries the count measured in THIS repo rather than an inherited opinion.
Formatting is 100 columns, not the framework's 80, because the prose in these comments is wrapped at
100 and no formatter rewraps a comment. Markdown, `studio/`, `adventures/` and every `generated/`
tree are out of scope for both tools: the generated ones because `map:check`, `catalog:check` and
`music:check` compare them byte for byte against a fresh generation, so a formatter that also
rewrote them in place would turn every `yarn lint` into content drift.

Two scripts deliberately do **not** delegate, and both were tried:

- **`typecheck`.** `alepha typecheck` is one `tsc --noEmit` at the root. Here it fails on the spot —
  `error TS18002: The 'files' list in config file 'tsconfig.json' is empty` — because the root
  config is a shared base, not a program. That is not an oversight to fix: the DOM lib and the
  Node/Workers types declare `WebSocket`/`Response`/`fetch` incompatibly, and alepha's own source is
  type-checked under its base rather than this repo's stricter one, so the split into fifteen `tsc`
  invocations IS the design (see "Per-package tsconfigs, not one" below).
- **`clean`.** `alepha clean` removes one directory, `output.dist ?? "dist"`. The repo root has no
  `dist/`, and the lab's client build lives in `dist-client` *outside* `dist/` on purpose (the build
  empties `dist/` before any task runs, so a client written there would be deleted before the static
  target could adopt it). Fanning out per app would still miss it; the one `node -e` line removes all
  three paths and stays cross-platform.

### The dev server has a dedicated port: 5273

`yarn dev` always serves <http://localhost:5273>, pinned with `port` + `strictPort` in
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
[lc.alepha.dev](https://lc.alepha.dev). The
memory of the migration lives in git and in the
[spec](./docs/archive/specs/2026-07-29-alepha-migration-design.md) + plans
([tranches 0-1](./docs/archive/plans/2026-07-29-alepha-migration-tranches-0-1.md),
[realtime](./docs/archive/plans/2026-07-30-alepha-migration-realtime.md),
[react-shell](./docs/archive/plans/2026-07-30-alepha-migration-react-shell.md),
[deploy + cleanup](./docs/archive/plans/2026-07-30-alepha-migration-deploy-cleanup.md)).
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

## The rules that must not be broken

Each line is a rule; the link is why it exists. Breaking one of these usually fails nothing — that
is precisely why they are written down.

1. **The server decides outcomes.** Damage, healing, loot, XP, quests, deaths, monster AI and
   projectiles are decided by the room and relayed to a client. Exactly two decisions are the
   client's — where its own hero is, and where a mobility skill puts it — and both are fenced
   server-side. A `ClientMessage` cannot carry damage, health, a heal, an inventory change, XP, a
   death, loot or a quest completion. → [movement-and-death.md](./docs/movement-and-death.md)
2. **Collision comes from the heightfield and from nothing else.** `WorldInfo.layers`,
   `.elements` and `.events` are appearance. Both sides bake the same stored string with the same
   `zoneTerrainFromHeightfield`, and `canStand`/`resolveGroundMovement` answer every "can a body be
   here" question. → [maps-and-editor.md](./docs/maps-and-editor.md)
3. **Server events are codes, not sentences.** `{ t: "event", code, params }`; the client owns all
   wording through `engine/i18n/`. The single exception is authored prose (`event.say`/
   `event.choices`), which is data the author wrote. → [event-system.md](./docs/event-system.md)
4. **Adventure state belongs to the party.** `PartyRoom` is the single writer; `WorldRoom`s install
   a version-guarded read-only snapshot and never write it. → [event-system.md](./docs/event-system.md)
5. **Every hero child-table mutation carries the `session_epoch` fence** (or is a server-side
   create before a session exists). → [database.md](./docs/database.md)
6. **A running party is isolated by `partyId`**, one room per `partyId:mapId`. No query parameter
   and no client message may select a destination map or position.
   → [server-runtime.md](./docs/server-runtime.md)
7. **Two component trees, one rule each.** Player/game UI uses `client/ui/tiny-swords/`; creator
   tools and every non-game surface use `@alepha/ui`. Never import a Tiny component into an editor
   to "match the theme".
8. **`@lindocara/hd2d` has no module-level mutable state.** The game and the editor preview each
   open their own context. → [packages/hd2d/AGENTS.md](./packages/hd2d/AGENTS.md)
9. **`onTick` is synchronous.** An async tick slower than its 50 ms period silently skips beats.
10. **Room state is memory-only and empty rooms reset.** Durable truth (hero saves, adventure state)
    is written through to the database, epoch-fenced. Never park durable truth in room memory.
11. **The canvas is not React's.** `#stage` is a sibling of `#root`, created by `bootClient()`;
    nothing in `ui/` may touch it.
12. **Never trust a client message.** `parseClientMessage` returns `null` and the frame is dropped.
13. **Every authored 3D placeable has the building manipulation contract.** A new 3D model is not
    complete until an author can move it, enlarge it, shrink it and use multiple orientations (free
    0..359-degree rotation for native 3D). Its content definition must also make destructibility an
    explicit choice: either indestructible, or destructible with the required visual states. Saved
    transforms and destruction state must round-trip through the editor, renderer, map compiler and
    runtime collision; a visual-only transform is a bug. This applies to buildings, bridges, traps,
    barricades and every future placeable 3D family. → [maps-and-editor.md](./docs/maps-and-editor.md)

14. **Author 3D packs one validated visual language at a time.** Do not mass-produce a set from a
    human or generic base. Start with one faction, derive nearest-filtered surfaces from its shipped
    2D source art, and give every model its own silhouette, coherent load-bearing structure, real
    depth and role-specific landmark. Place the complete pack side by side in the editor at the
    gameplay camera, inspect it visually and revise repeated roofs, outlines, proportions or empty
    surfaces before applying the method to the next faction. Keep the renderer quality guard at or
    above the current baseline (55 meshes, 45 volumetric parts, 7 materials and 4 geometry families
    per finished faction building), record the comparison screenshot in the handoff, and never call
    a pack complete from unit tests alone. → [maps-and-editor.md](./docs/maps-and-editor.md)

## Where the rest lives

Read one when the task is in its subject — not before, and not all of them.

| Doc | Subject |
| --- | --- |
| [docs/README.md](./docs/README.md) | the index of every doc, including which ones are historical |
| [docs/monorepo-layout.md](./docs/monorepo-layout.md) | which package owns what, the old `src/` map, the per-package tsconfig split |
| [docs/server-runtime.md](./docs/server-runtime.md) | world systems, room isolation, presence fencing, spatial grid, limits |
| [docs/movement-and-death.md](./docs/movement-and-death.md) | the move report, `stepHero`, classes, directional combat, death |
| [docs/maps-and-editor.md](./docs/maps-and-editor.md) | the layered map model, tilesets, the editor shell and its modes |
| [docs/event-system.md](./docs/event-system.md) | switches/variables, page selection, the command interpreter |
| [docs/database.md](./docs/database.md) | entities, migrations, D1 compatibility discipline |
| [docs/secrets-and-env.md](./docs/secrets-and-env.md) | `APP_SECRET`, `ADMIN_USERNAMES`, the `$env` primitives |
| [docs/gotchas.md](./docs/gotchas.md) | the things found the hard way that nothing will tell you |
| [docs/hd2d-rendering.md](./docs/hd2d-rendering.md) | the render path — read before touching it |
| [studio/AGENTS.md](./studio/AGENTS.md) | generating sprites, sound effects, voice lines and music locally |

**Every package has its own `AGENTS.md`** (with a `CLAUDE.md` symlink beside it, so both Codex and
Claude pick it up when you work in that directory). Read it before working inside that package:
[engine](./packages/engine/AGENTS.md), [server](./packages/server/AGENTS.md),
[renderer](./packages/renderer/AGENTS.md), [client](./packages/client/AGENTS.md),
[editor](./packages/editor/AGENTS.md), [hd2d](./packages/hd2d/AGENTS.md),
[audio](./packages/audio/AGENTS.md), [catalog](./packages/catalog/AGENTS.md),
[testing](./packages/testing/AGENTS.md), [main](./apps/main/AGENTS.md), [lab](./apps/lab/AGENTS.md).

## Two directories never to read

- **`**/generated/**`** — machine-written, and `packages/engine/src/generated/tiny-swords-catalog.ts`
  alone is 31 000 lines. Change the generator (`yarn catalog:build`, `yarn map:build`,
  `yarn music:catalog`) and commit its output; never edit one by hand and never read one to learn
  anything.
- **`docs/archive/`** — 81 specs and plans for work already shipped. They describe the repo as it
  was on the date in their filename, so a grep hit there is a wrong answer with a confident tone.
  Open one only when something links it deliberately.

## Bay production routing

Production is a plain Node process on Alepha Bay. `apps/main/alepha.config.ts` intentionally has no
Cloudflare assets block: Alepha serves the SPA/API/WebSocket routes and Bay proxies the public
domain to that process. `endpoint` is the authenticated bay-admin control plane used only for
deploys; it is not the application origin. The retired `lindocara.alepha.dev` Worker remains an
old, frozen deployment and must never be presented as the live application.

**Two public hosts, one app.** `domain` in `apps/main/alepha.config.ts` is comma-separated and Bay
stores it as a list: `lc.alepha.dev` is canonical and `lindocara.bay.alepha.dev` â€” the name Bay
composes from the app name â€” keeps answering, because Bay has no redirect primitive and dropping a
host 404s every link into it. Both reach the same database, so both are in the `PRODUCTION_HOSTS`
allowlists that gate `--allow-production`.

**Every Bay host is grey-clouded in Cloudflare (DNS only), never proxied.** Bay terminates TLS
itself with CertMagic, issuing per host on demand for names registered with it. Behind the orange
cloud Cloudflare terminates at the edge and then cannot handshake with the origin, so the host
answers **525** while DNS, the deploy and `bay status` all look perfectly healthy. That is what
`lc.alepha.dev` did on its first day. `*.bay.alepha.dev` is DNS only for the same reason.

## Generating assets

`studio/` is a four-lane asset studio — sprites, sound effects, voice lines and music — running
entirely locally, macOS (MLX) or Windows/Linux with an NVIDIA GPU (CUDA). Every model is Apache 2.0
or MIT, so generated assets are shippable.

```bash
python3 studio/studio.py sprite --prompt "a goblin archer with a short bow, standing idle" --out <path>.png
python3 studio/studio.py sfx    --prompt "a heavy wooden door creaking open" --duration 3 --out <path>.wav
python3 studio/studio.py voice  --text "You shall not pass!" --archetype brute --out <path>.wav
python3 studio/studio.py music  --prompt "calm village at dawn" --duration 60 --out <path>.wav
```

**Call `studio.py`, never the underlying runtimes** — it injects the art direction from
`studio/theme.json`, which is what makes four models sound like one game. Sprites still need the
pixel-art post-processing pass, and a bleat still needs a human ear.
[`studio/AGENTS.md`](./studio/AGENTS.md) has the install, the backends, the characters file and the
per-lane guides; `python3 studio/studio.py doctor` proves the plumbing on a new machine.

## Conventions

- Browser checks (running the app, screenshots, driving the editor UI): use the `playwright-cli`
  skill, never the Claude-in-Chrome extension.
- oxlint lints and oxfmt formats, both through `yarn lint`. `noNonNullAssertion` carried over as
  `typescript/no-non-null-assertion`, named explicitly in `.oxlintrc.json` because oxlint files
  it under `restriction` rather than `correctness`: no `!`, narrow properly.
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
  `alepha.config.ts` vendor plugin, and arrives with `yarn alepha vendor sync`. Do not hand-edit it -
  a local change becomes a patch `vendor diff` reports forever and the next sync fights. A component
  that needs changing is changed upstream in `../alepha` and synced back, exactly like the framework
  (see the dogfood loop above). It replaced the project's own `packages/ui` shadcn copy, which is
  deleted; `yarn ui:add` is gone with it, because adding a component is now an upstream concern.
  The historical port spec (`docs/archive/specs/2026-07-18-shadcn-base-ui-port-design.md`)
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
- `Label` is a generic passthrough that spreads props, so a label rule cannot see that call sites
  supply the control (Biome's `noLabelWithoutControl` could not; oxlint's jsx-a11y equivalent has
  the same blind spot and simply does not fire on these sites today). The agreed resolution is a
  scoped suppression on the JSX element (now `// oxlint-disable-next-line <rule>`, placed on the line
  above the ELEMENT rather than above the attribute, which is where oxlint anchors the report), not
  an unconditional `for` attribute the component doesn't own. oxlint reports an unused suppression as
  an error, so a directive that stops suppressing anything gets deleted rather than re-read.
