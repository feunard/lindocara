# lindocara — agent & contributor guide

A modern cooperative RPG adventure creator on Cloudflare Workers, targeting solo play through
four-player sessions. The current authoritative vertical slice contains players, terrain, Warden
Mira, roaming monsters, combat, loot, progression, quests, local chat and a D1-backed map editor.
Those systems are foundations for authored multi-map adventures, not a commitment to MMO scale.

The primary UX is title → login → resumable parties/saves. Creating a new party then selects an
adventure; hero creation/selection happens inside that party. Adventure/map authoring is a secondary
creator-tools route. Never make `CharacterSelect` the post-login screen again. Player/game UI may
use strong Tiny Swords chrome; creator editors must stay dense, sober and keyboard-efficient using
the existing React/Radix primitives, with Tiny Swords limited to previews and restrained accents.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite + the Worker + the Durable Object, all in workerd |
| `npm run check` | lint, typecheck, test — run this before committing |
| `npm run check:runtime` | lint, typecheck, runtime server/player UI tests and build; skips creator map/adventure validation |
| `npm run loadtest -- --players=10 --duration=60 --scenario=mixed` | authenticated local WebSocket load test; remote targets require explicit opt-in |
| `npm run lint` / `lint:fix` | Biome |
| `npm run typecheck` | three TypeScript programs (see below) |
| `npm test` | Vitest inside workerd |
| `npm run build` | client bundle + deployable `wrangler.json` |
| `npm run deploy` | build, then `wrangler deploy` |
| `npm run cf-typegen` | regenerate `src/worker-configuration.d.ts` from wrangler.jsonc |
| `npm run db:generate` | diff `db/schema.ts` into a new `migrations/*.sql` |
| `npm run db:migrate` | apply migrations to the local D1 |
| `npm run db:migrate:remote` | apply migrations to production D1 (CI does this on deploy) |

## Architecture

The one rule that matters: **the server decides outcomes.** Clients send movement and action
intent, never positions, damage, health, heals, inventory, XP, deaths, loot, or quest
completion.

### Monorepo layout (npm workspaces)

The old single `src/` is now five packages under `packages/*`, each with its own
`package.json`/`tsconfig.json`. Tooling (Vite, wrangler, drizzle, vitest configs, `index.html`,
`migrations/`, `test/`) stays at the repo root — the root is the app that assembles the packages
into one deployable Worker + assets. The old path prefixes in the file map below map straight onto
the new homes:

| Package | Old path | Depends on | Runtime |
| --- | --- | --- | --- |
| `@lindocara/engine` | `src/shared/` | — | pure (ni DOM ni Workers) |
| `@lindocara/server` | `src/server/` | engine | workerd |
| `@lindocara/renderer` | drawing half of `src/client/game/` (+ `input`, `locale`, `scene-sample`) | engine | browser, React-free (PixiJS) |
| `@lindocara/client` | rest of `src/client/` (app shell, HUD, shadcn/Tiny-Swords, store, api, i18n, net/sound/session glue) | engine, renderer | browser + React |
| `@lindocara/editor` | `src/client/ui/editor/` + editor game files | engine, renderer, client | browser + React |

The graph is acyclic: `engine ← {server, renderer}`, `renderer ← {client}`, `client ← {editor}`
(the client App lazy-`import()`s the editor at runtime without declaring it, so no cycle). Cross-package
imports use `@lindocara/<pkg>/<file>.js`; the `@` alias still means the client source root everywhere.
`npm run typecheck` runs all five package `tsc`s plus the three test programs; `npm run typecheck:<pkg>`
checks one. Tests still live in `test/` and run through the existing vitest configs (co-locating them
per package is a documented follow-up). See
[`docs/superpowers/specs/2026-07-22-monorepo-packages-design.md`](./docs/superpowers/specs/2026-07-22-monorepo-packages-design.md)
and [`docs/superpowers/plans/2026-07-22-monorepo-packages.md`](./docs/superpowers/plans/2026-07-22-monorepo-packages.md).
The file map below keeps its original `src/…` prefixes; read them through the table above.

### Current party-adventure foundation

Before changing world routing, room ownership, hero location persistence, or splitting
`world.ts`, read [`docs/adventure-runtime-architecture.md`](./docs/adventure-runtime-architecture.md)
and the historical [`docs/mmo-migration-plan.md`](./docs/mmo-migration-plan.md). The latter records
verified current flows, D1 changes, duplicate-character risks and rollback strategy; its MMO scale
target is historical, while its fencing and routing analysis remains valid.

```
src/shared/     platform-free. Imports nothing from Cloudflare or the DOM.
  simulation.ts pure step(position, input, dt). The single source of movement truth.
  game.ts       map geometry, collision, combat/progression constants and pure rules.
  protocol.ts   the wire format, with defensive parsing of anything a client sends.
  prediction.ts pure reconcile()/prunePending(). Client-side prediction, as functions.
  i18n/         FR/EN dictionaries — data only; the server sends codes, never prose.
  zones.ts      typed zone catalogue, validation and deterministic room keys.
  tileset.ts    the tile id space (autotile band, fixed-tile band) and tileset types. A tile
                id's meaning — passable or not, drawn below or above characters — lives here,
                authored once per tile, not per map cell.
  autotile.ts   the `edge16` and `run4` neighbour-mask variant tables. Lives here rather than
                the client because the paint-time brush, the map migration and the tests all
                need the same tables the renderer uses.
  tile-layer-codec.ts run-length codec for one tile layer; `parseTileLayer` never throws.
  tile-brush.ts pure paint/erase/elevation brushes: they write an id and re-resolve the
                neighbours whose variant it can change. The stored id IS the neighbour mask —
                autotiling is a paint-time brush, not a storage format, so an author can freeze
                a single hand-picked tile without the renderer overwriting it.
  map-migrate.ts one-shot projection of the old `blocks` model into layers.
  tilesets/     the shipped Tiny Swords tileset, as data.

src/server/     runs in workerd.
  index.ts      Worker entry: /api/* only. Assets never reach it.
  session.ts    HMAC-signed cookie carrying the account identity. accounts.ts owns
                username/password (PBKDF2).
  accounts.ts   register/login: username uniqueness, password hashing and verification.
  maps.ts/adventures.ts/parties.ts/heroes.ts own the primary authored/save flow.
  password.ts   PBKDF2 password hashing.
  hero-profile.ts D1 hero core-profile load/save boundary, fenced by sessionEpoch.
  hero-presence.ts deterministic per-hero lease and connection authority.
  game-session.ts party coordinator: room routing and cross-map broadcasts.
  world.ts      Durable Object adapter and room owner: admission, WebSocket lifecycle and tick order.
  profile.ts/character-presence.ts/characters.ts remain rollback-only character seams.
  world/        explicit-dependency systems used by World; no module-level mutable room state.
  db/           D1 schema + Drizzle.

src/client/     runs in a browser.
  main.tsx      React entry; mounts <App/> beside the canvas.
  ui/           React components: screens, HUD, chat, overlays and creator tools.
    components/ stock shadcn (Base UI, base-nova). Generated by `shadcn add` — do not
                hand-edit. The vocabulary for creator tools and any non-game surface.
    tiny-swords/ the game superset: TinyButton/TinyInput/TinyLabel/TinyFieldSelect/TinyKbd
                plus panels and bars. Reads its own `--tiny-*` tokens from tokens.css and
                never a shadcn token, so the two trees can be restyled independently.
  store.ts      zustand bridge: the game session writes, React reads. Text state is
                i18n keys + params, never rendered strings.
  api.ts        fetch client; machine-code errors mapped to dictionary keys.
  game/         the game loop: net.ts (prediction), renderer.ts (PixiJS), input.ts,
                sound.ts, session.ts (owns the store writes). No React in here.
                tile-draw.ts holds the per-cell tile id → draw instruction arithmetic, shared
                by the renderer and the editor stage so the two cannot drift.
  i18n.ts       locale state; useLocale() for React, t() for everyone.
```

### Server world systems

`World` remains the Durable Object entry point and owns every mutable room collection, timer and
save queue. Modules under `src/server/world/` are concrete domain systems, not an ECS:

- `world-runtime.ts` defines player, monster, guard, loot and room runtime types plus attachment
  hydration/serialization and entity factories.
- `connection-system.ts` maintains socket/player indexes and connection rate windows.
- `movement-system.ts` consumes at most one command per tick, advances players, updates the player
  grid and schedules movement-adjacent maintenance.
- `combat-action-system.ts` owns the authoritative anticipation/impact/recovery timeline and
  guarantees one resolution per action. `projectile-system.ts` advances bounded swept projectiles,
  resolves terrain/entity contacts and removes them on impact, expiry or owner departure.
- `combat-system.ts` retains narrow damage helpers, while `skill-system.ts` owns
  collision-resolved mobility and line-of-sight helpers. Player combat never selects an entity.
- `monster-system.ts` advances monster AI, respawns and guards. Guard kills remain a separate path
  that cannot grant player rewards.
- `quest-system.ts` exposes zone-owned quest ordering; quest mutations and interzone handoff remain
  orchestrated by `World` because they cross persistence, presence and connection boundaries.
- `loot-system.ts` collects and expires ground loot while keeping the non-authoritative grid in
  sync.
- `persistence-system.ts` serializes fenced D1 saves per character. It receives the room save map,
  database and stale-save callback explicitly.
- `interest-system.ts` builds per-recipient AOI views; `snapshot-system.ts` turns those views into
  welcome state, deltas and resync responses.
- `zone-runtime.ts` initializes zone-scoped monsters/guards and resolves zone quest definitions.
- `event-run-system.ts` holds the room's live event runs: the `eventId`-keyed run lock, the
  budgeted per-tick drain with its working-copy read model, and the buffered per-triggerer dialogue.
  Trigger DETECTION and effect DISPATCH stay in `World` (it owns positions, sockets, the coordinator
  seam); this owns only the bookkeeping that must never touch a socket, a clock or the coordinator.
- `spatial-grid.ts` is the world-system import boundary for the existing non-authoritative grid.

Allowed dependency direction is `world.ts -> world systems -> shared rules`. Systems may import
server persistence/binding boundaries when that is their stated responsibility, but never client
code. Shared modules must not import server systems. Systems receive room collections, grids,
services and callbacks as arguments; do not add mutable module globals or hide room state in a
singleton.

To add a mechanic, first place platform-free rules in `src/shared/` when both client and server need
them. Add the authoritative mutation to the narrowest existing server system (or a small new domain
system), pass its dependencies from `World`, add it explicitly to the readable tick/action order,
then cover the pure/system edge with a unit test and the authoritative flow with the existing real
Durable Object harness.

To add a network message, define and defensively parse its wire shape in `shared/protocol.ts`. For a
client intent, dispatch it in the connection/action boundary and pass only validated intent to the
responsible system. For a server message, emit a machine event code or typed snapshot change through
`snapshot-system.ts`; update both i18n dictionaries for player-facing wording, update client map
upsert/removal validation when the message changes world state, and add protocol plus resync/delta
integration coverage. Never let a new message select a room or supply an authoritative outcome.

### Two players, two rules

- **You** are drawn in the present. Your input is applied locally the frame you press a key
  (measured: 1 frame, ~7ms). Each snapshot carries the server's truth, which is one
  round-trip stale, so the commands it has not acknowledged yet are replayed on top of it.
  When client and server agree, nothing visibly happens.
- **Everyone else** is drawn `INTERPOLATION_DELAY_MS` (150ms) in the past, interpolated
  between the two snapshots bracketing that instant. You cannot know where a remote player is
  *now*, and guessing looks worse than being slightly late.

Do not "fix" the interpolation delay by removing it. It is what buys smooth remote motion out
of a 20Hz snapshot stream, and it does not apply to your own square.

### One command per tick

The client stamps every input with a sequence number and sends one per simulation tick. The
server queues them and applies **exactly one per tick**, echoing the highest sequence it has
applied as `ack`. This is the load-bearing invariant:

- Flooding commands buys no speed. The tick rate is the speed limit, not the send rate.
- A replayed or out-of-order sequence is dropped (`seq <= lastSeq`).
- With no command to apply the server repeats the last intent for up to `MAX_STARVED_TICKS`
  (5, i.e. 250ms) to ride out a late packet, then stops the square. A frozen tab must not
  leave a square sprinting.

If you change the tick rate, the client's command rate follows automatically — both derive
from `TICK_HZ`. If you ever make them differ, reconciliation breaks silently, because replay
assumes one command means exactly one `TICK_DT`.

### Why `step()` lives in `shared/`

Both sides call it. The server to decide truth; the client to predict, and to replay pending
commands during reconciliation. Reconciliation is only correct because the two are literally
the same function. Two hand-synchronised copies of movement logic is the classic way to make
prediction unfixable. There is one copy, and `prediction.test.ts` asserts that replaying
commands over a stale position lands exactly where the server lands.

### Three tsconfigs, not one

The DOM lib and the Workers runtime types both declare `WebSocket`, `Response`, and `fetch`
with incompatible shapes. Loading both into one program produces a blizzard of nonsense
errors. So: `tsconfig.client.json`, `tsconfig.worker.json`, `tsconfig.node.json`. Code in
`src/shared/` is checked by both of the first two, which is the point — it must be valid in
a browser *and* in workerd.

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

`shared/death.ts` owns it. Dying does not move you — it leaves your body where you fell:

```
"alive" ──(hp 0)──▶ "corpse" ──(a priest interacts)──▶ "alive"
                        │
                        └──(you press R)──▶ "ghost" ──(walk onto your body)──▶ "alive"
```

There is no timer in it and no auto-release. A corpse waits indefinitely, which is the only
reason a priest's grace period means anything, and releasing is **one-way** — a priest cannot
resurrect a ghost. Both routes back cost you: you return at `RESURRECT_HP_RATIO` of max HP.

Three consequences, each easy to break:

- **Monsters skip any player who is not `alive`.** Without that the corpse run is unwinnable —
  you would die on the way to your own body, over and over.
- **A body is broadcast for as long as its owner has one** — while they lie over it *and* while
  their ghost walks back to it. Emitting corpses only for the `corpse` state makes your body
  vanish at the exact moment you start needing to find it.
- **`life` and the corpse position are persisted** (`character.life`, `corpse_x`, `corpse_y`).
  Death that lives only in memory turns logging out into a free resurrection.

A ghost moves at `GHOST_SPEED`, so `step()` takes a speed and `reconcile()` takes a `LifeState`.
Replaying a ghost's commands at living speed is a *silent* desync: nothing in the protocol would
complain, the client would simply draw its own spirit permanently short of where the server has
put it. The server clears the command queue on **every** life transition, so a batch of pending
commands is never split across two life states. `prediction.test.ts` pins both speeds against the
server, and that assertion is the thing standing between you and an unfixable drift.

The priest's resurrect is the interact key, not a sixth skill slot: `#interact` already dispatches
to the nearest sensible thing, and a corpse is one more thing you can be standing next to.

`CEMETERIES` are the three spirit anchors; `nearestCemetery()` picks where a released ghost
appears. Their chapels are `graveyard` landmarks with colliders, so moving one means re-checking
that it blocks no spawn point, no monster patrol ring, and no quest site — `game.test.ts` asserts
all three, and it will catch you.

### `run_worker_first`

`assets.not_found_handling: "single-page-application"` means any unmatched path returns
`index.html`. Without `assets.run_worker_first: ["/api/*"]`, that fallback would answer API
calls with the SPA shell and the Worker would never see them. Both settings are load-bearing;
changing one without the other breaks routing in a way tests will catch.

## Database

D1 (`DB` binding) with **Drizzle ORM**. `src/server/db/schema.ts` is the single source of
truth; `drizzle-kit generate` diffs it into a numbered `.sql` file under `migrations/`, and
`wrangler d1 migrations apply` runs those files. drizzle-kit never talks to D1 — there is one
migration system, not two.

Changing the schema:

```bash
# edit src/server/db/schema.ts
npm run db:generate     # writes migrations/NNNN_name.sql — commit it
npm run db:migrate      # apply locally
npm run cf-typegen      # only if you changed bindings, not the schema
```

Objects, equipment, skills and multi-quest progression use separate normalized ownership tables
documented in [`docs/persistence-model.md`](./docs/persistence-model.md). The rollback flow owns
`character_*`; the primary party flow owns `hero_*`. Never point one family at the other. Hero
inventory, equipment, currencies, class resource, skills, quest rows, talents, bounded cooldowns
and timed consumable effects are durable alongside its map, position, core stats, life, corpse and
fencing epoch. Every hero child-table mutation must include an `EXISTS` fence against
`hero.session_epoch` (or be a server-side create before a session exists).

Deploying applies migrations to production **before** shipping the code, so a column always
exists before the code that reads it.

One `account` row exists per registered user (`username` unique, stored lowercase). The primary
post-login screen lists persistent parties as resumable saves. Each `hero` belongs to one account
and one party and is selected inside that party; the old three-character account roster remains
for rollback only and must not be reintroduced into `App` as the normal launch route. Dirty hero
profiles are saved every five seconds, on disconnect and at map transitions.

### Hero presence and save fencing

`HeroPresence` is a SQLite-backed Durable Object addressed with
`HERO_PRESENCE.getByName(heroId)`. D1 is the single monotone source of `hero.session_epoch`; the
presence DO stores only the active lease (`connectionId`, epoch, room, zone, instance, timestamps).

- Acquisition freezes and saves the previous owner while its epoch is still valid, increments the
  D1 epoch atomically, then installs the new lease.
- The lease lasts 30 seconds and `World` renews it every 10 seconds. Inputs use local authority and
  do not call the presence DO per command or tick.
- Normal disconnect saves with `WHERE id = ? AND session_epoch = ?`, releases the matching lease,
  then removes the runtime player.
- A stale save changes no row, logs a stale-save diagnostic, invalidates local authority,
  and closes the socket with `WS_CLOSE.PRESENCE_LOST`.
- Hero core and normalized progression writes share the same D1 batch and epoch fence. A stale room
  may update neither the `hero` row nor inventory, equipment, skill or quest children.

Adventure-map handoff uses the same epoch fence: freeze source actions, save the source, then let
`HeroPresence.handoff()` conditionally write destination map/position and epoch N+1. Only then
remove/close the source socket with `WS_CLOSE.ZONE_TRANSITION`. The client reconnects with only its
party/hero identity; `index.ts` reads the destination from D1. `CharacterPresence` retains the old
compiled-zone equivalent as a rollback seam.

### Party routing and room isolation

The primary WebSocket route is `/api/ws?party=<partyId>&hero=<heroId>`. `index.ts` verifies account,
membership, hero ownership and adventure-map membership, then reads the authoritative map and
position from D1. No query parameter or client message may select a destination map or position.

`GameSession` is addressed by `partyId` and coordinates its room directory and party-wide
broadcasts. Simulation is currently sharded into `World` objects addressed by `partyId:mapId`;
each owns only that room's players, monsters, loot, timers, navigation and local chat. Persistent
party chat and victory fan out through `GameSession`. This sharded implementation preserves the
session isolation invariant, although converging the rooms into one multi-room Durable Object
remains a possible later topology change. Compiled catalogue zones remain rollback/test content.

### Maps and the editor

Maps live in D1 (`src/server/maps.ts`) and are private to their author account. Every successful
content/name update increments a monotone `revision`; failed updates do not. Adventures may only
reference their author's maps, their full graph is revalidated before a referenced map mutation,
and delete/edit operations cannot silently invalidate a saved adventure. Legacy ownerless rows are
quarantined unless the migration can identify exactly one author.

Terrain is three layers of frozen tile ids (`MapData.layers`, RPG Maker XP-shaped) over an authored
`tilesetId`, not one `TileKind` character per cell. A tile's id is decided once, at paint time — the
editor computes the autotile edge variant when you paint and freezes the result, which is what lets
an author override a single tile by hand afterwards. What an id *means* — walkable or not, drawn
behind or in front of characters — is a tileset property authored once per tile, never a per-cell
one, so collision stays derivable from appearance through one indirection: `tile id → tileset →
passable`. Collision now has two baked sources on `TerrainGeometry`: `tiles` (the grid, whole cells)
and `colliders` (a `ColliderIndex` of sub-cell rectangles, one per colliding element) — `isWalkable`
is the single junction that queries both, so a tree blocks its trunk (~24x20 px), not its whole
64x64 cell. **On the wire, `WorldInfo.tiles` and `WorldInfo.colliders` are baked collision truth and
`WorldInfo.layers`/`WorldInfo.elements`/`WorldInfo.events` are appearance only** — never derive
collision from any of the latter three. An agent that reads `layers` to decide walkability
reintroduces exactly the silent desync this design exists to prevent, and reading `elements` for a
collider is the same mistake with a second bake: collision only ever comes from `tiles`/`colliders`
via `isWalkable`/`resolveTerrain()`/`isWalkableBox`. Elevation needs no engine change — a cliff face
is its own cells, impassable, one layer above the ground — but the wall is only ever cast on the
drop's south face: a plateau adjacent horizontally to lower ground has no cliff and is walkable.
Appearance and collision still agree, so this is a design narrowness, not a bug, but it is not a
gameplay barrier either. See
[`docs/superpowers/specs/2026-07-18-layered-map-model-design.md`](./docs/superpowers/specs/2026-07-18-layered-map-model-design.md)
for the full model.

The welcome message includes `mapId + revision`, baked collision tiles, sub-cell colliders,
appearance layers, `tilesetId` and authored elements so prediction, renderer and mini-map share the
same cache identity.

The `adventures` and `map-editor` screens are gone: one `adventure-editor` screen
(`src/client/ui/editor/`) now owns both, as menu bar / toolbar / three resizable panes (shadcn
`TerrainPalette` left, the WYSIWYG PixiJS stage centre, `MapListPanel` right) / status bar.
Adventure metadata lives in `AdventureSettingsDialog`, off the canvas. All chrome is stock shadcn —
the old floating asset palette was the last Tiny import inside a creator surface, and it died with
the pre-merge screens, so the two-tree rule now has zero exceptions in the editor. The stage keeps
sharing placement/collision/catalog rendering rules with the runtime through `shared/map-data.ts`
and `client/game/catalog-element-render.ts`, with explicit loading/empty/error state, grouped
history, dirty navigation guards, selection/inspectors, stable marker ids with optional labels and
complete marker preview.

`shared/tile-brush.ts` grew a rectangle (`paintRectAutotile`/`eraseRect`), a flood fill
(`floodFill`) and a stairs stamp (`paintStairs`) — each re-resolves neighbours the same way the
pencil always did, and `resolveWholeLayer` is still the oracle they're tested against. The old
`Layer 1/2/3/EV` pill only ever routed the eraser — painting always wrote layer 0 (plus automatic
cliff-wall upkeep on layer 1) and stairs always wrote layer 1 — so it is now a Field/Element/Event
segmented control (`activeMode`, threaded from toolbar/menu bar down to the stage handle) that
actually names which of the three authored collections the editor is working in: Field owns the
tile layers, Element owns `MapData.elements`, Event owns `MapEvent[]`. The sidebar is three
mode-scoped palettes (`TerrainPalette`/`ElementPalette`/`EventPalette`) and the eraser is
mode-scoped too. Element mode places at quarter-cell positions: an element carries `offsetX`/
`offsetY` (0..3, quarter tiles = 16px) on top of its `col`/`row`, so a terrain cell is a 4x4 sub-grid
of decoration slots — up to 16 stacked decorations per cell — with an offset inspector, and each
catalogue asset authors its own sub-cell collider (`elementWorldCollider`), no longer a whole-cell
footprint. Every tool has a keyboard shortcut, gated off while a dialog is open or the stage isn't
ready. The stairs tool stamps the tileset's four ramp fixed tiles onto layer 1, so ramps are
paintable — tranche 1's "declared but unpaintable" caveat is dead. Fill has no fill-to-empty
primitive; the UI disables it rather than let it silently no-op.

The pointer-events contract is load-bearing and easy to get backwards. `#stage` stays a `position:
fixed`, full-viewport sibling of `#root` (see the canvas gotcha below), so by default it paints and
hit-tests *above* any normal-flow chrome. `.editor-root` inverts that: a `pointer-events: none`
stacking context over the canvas, with each chrome island — menu bar, toolbar, the two side panels,
status bar — opting back in via `.editor-chrome`/`.editor-root > *`. The centre body row
(`.editor-body`) stays pointer-transparent so painting strokes reach the canvas; anything clickable
floating over that centre, like the selection inspector, must re-enable pointer events on itself.
Get this backwards and either every chrome click is eaten by the canvas, or every stroke is blocked
by the chrome.

Maps now carry authored **events** — their own `map_event`/`map_event_page` D1 tables, saved inside
the same map-save transaction as elements and layers, chunked under D1's 100-bound-parameter cap the
same way tranche 1 had to chunk elements. An event is a client-minted uuid (stable so tranche 5's
commands can reference it) plus a per-map creation-order ordinal (the `EV001` chip — display only,
never identity) and 1–8 ordered pages, each carrying conditions, appearance, autonomous-movement
settings, options and a trigger. **Nothing executes**: the game runtime is untouched, and an
authored event is invisible to a running party until the next tranche evaluates page conditions
server-side. The wire parser rejects a payload with an absent condition field — a client must emit
an explicit `null`, never omit the key, so "no condition" stays distinguishable from "malformed."
The EV tool, the stage overlay (sprite + `EV{ordinal}` chip, or the placeholder box with no
graphic) and the event dialog live entirely in the editor, in stock shadcn. Because Radix portals
`DialogContent` to `document.body`, outside `.editor-root`, the `legacy.css` shadcn fence now also
exempts `[data-slot] *`, not just `[data-slot]` itself — a bare `<button>`/`<input>` nested inside a
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

An event's conditions now read something real. **State belongs to the party, not the hero** — a
party is the save, so `GameSession` (addressed by `partyId`) is the single writer of switches,
variables and per-event self-switches; `World` rooms never write it, they install a read-only
snapshot `GameSession` pushes over the same coordinator seam party chat and victory already cross.
Persistence is a debounced 5s save, matching the hero-profile cadence, plus an immediate flush (with
orphan self-switch pruning, against D1's live event ids) when the party empties, so the last owner
never leaves a stale row behind. The registry — switch/variable ids and names, up to 200 of each —
rides the adventure row as bounded JSON, not a new table: it is small, atomic with the adventure, and
authored entirely in the editor's registry dialog.

**Page selection is XP's rule, not a per-tick one.** For each event, the active page is the
highest-position page whose conditions all hold; an unknown switch/variable id reads as false/0; no
page holding means the event is dormant. `World` evaluates this against the state snapshot on
snapshot install and on hero join — **never per tick** — because nothing yet mutates state within a
room's lifetime; re-evaluation on state-change is the reason the snapshot push exists at all.
Hibernation restore pulls the current state from `GameSession` (`getAdventureState`, a reverse RPC
into the coordinator), never from D1: the debounce can leave D1 several seconds stale, and reading
storage directly would be a second, uncoordinated writer.

Active events reach the client as `WorldInfo.events` — the third member of the `elements`/`layers`
family: id, cell, the active page's appearance and options, **appearance only**. Collision still
comes exclusively from `tiles`; an event carries no collider in this tranche regardless of its
authored "traversable" flag.

**The interpreter now mutates state** (tranche 5). `#applyStateChange` on `GameSession` is the real
single writer: an event run's `mutateState` effect flows UP as a coordinator RPC, is applied
serially, bumps a **monotone `version`** shipped with every snapshot, and pushes the new state to
every room. `installAdventureState` carries a **`>=` version guard** so a room that receives two
pushes out of order keeps the newer one, and it must **never throw** — `GameSession` awaits the
install ahead of room admission, so a throwing install would block every join. The debounce is a
`ctx.storage.setAlarm`, not a `setTimeout`, so a coordinator eviction cannot lose a flip. See
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
  `loop { setVariable add }` with no exit consumes its slice and returns — the room keeps ticking,
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
  `setSwitch X; if X …` would take the wrong branch. So the drain keeps a **local working copy**,
  seeded from the snapshot at drain start and folded forward with the shared pure `applyStateMutation`
  after each `mutateState`; every later step THIS tick (command execution and `if`/waiting-condition
  evaluation alike) reads that copy. The batch still flows up unchanged. If the command budget splits
  a run across ticks, `World` pauses only the event drain until `GameSession` has applied and pushed
  that batch; simulation keeps ticking. The next drain therefore seeds from the acknowledged snapshot,
  never from a pre-batch value that would replay a non-idempotent `add`. Cross-room propagation remains
  asynchronous relative to simulation, but the source run cannot outrun its own coordinator writes.

- **Authored prose is the sanctioned codes-not-sentences exception.** `event.say`/`event.choices`
  carry the author's `text`/`name`/`prompt`/option labels as DATA across the wire (still size-capped
  and defensively parsed both directions) — the one exception to "server events are codes", because
  the author wrote it and no dictionary can hold it. The i18n rule keeps governing every CHROME
  string around the panel (Continue, Choose, the hotkey caption). Do not route authored prose through
  an `EventCode`, and do not smuggle a UI label into a `say`.

- **Dialogue is a per-player panel with a distance-close.** A `say`/`choices` beat is wired to the
  TRIGGERER only (`event-run-system` buffers by `heroId`); the other party members' viewports stay
  clean. Movement stays LIVE while the panel is open — the panel captures only its own keys (Space /
  the interact key to advance, 1-4 to choose), never WASD or the skills. Each drain tick, a run parked
  on a dialogue whose triggerer has walked beyond `DIALOGUE_CLOSE_RADIUS` (`3 * TILE_SIZE`) ENDS: the
  panel closes and the conversation is over (WoW's rule). Walk-away is not a state rollback — anything
  the run already wrote stays written; it abandons only the REMAINDER.

Triggers are server-detected: the interact key near an `action` event, or a movement box landing on a
`player-touch` event's cell — both only for `normal`-kind events with a satisfied active page. The
client only ever sends the existing interact intent and movement; no message selects a run or supplies
an outcome. Gold/items are per-hero and persisted through the same epoch-fenced hero save boundary as
the rest of the normalized inventory. See
[`docs/superpowers/specs/2026-07-20-interpreter-design.md`](./docs/superpowers/specs/2026-07-20-interpreter-design.md).

### Heartroot city, guards and visual readability

The safe zone is an authored city, not a decoration-only rectangle. `shared/game.ts` owns every
building collider, quest-keeper coordinate, spawn, and guard home; `client/game/world-layout.ts`
owns only visual roads, districts, signs and decor density. Keep those two descriptions aligned.
All quest keepers must remain inside `SAFE_ZONE` on walkable ground.

Guards are simulated by `World` and emitted in snapshots. They target only live monsters already
inside the safe zone, cannot leave their home patrol radius, and never attack players. A guard
kill sets the monster respawn state directly: it must never call the player reward path, create
loot, grant XP, or advance a kill quest.

Direction signs use the bundled Tiny Swords banner texture and localized text. They have no
collider by design so junctions cannot be grief-blocked. Puzzle rendering must never receive the
expected rune order; `questSiteFeedback()` exposes proximity labels but always returns a zero
signal alpha. World-space notifications are limited by `MAX_ACTIVE_WORLD_EFFECTS` and
`shouldFloatEvent()`; system, loot and quest prose belongs in React's event log.

### Spatial grid and area of interest

`server/spatial-grid.ts` is a non-authoritative index: `World` collections remain the source of
truth. Cells are 256 px. Per-recipient views query nearby players (900 px), monsters (850 px) and
loot (650 px), with a 96 px exit hysteresis; self is unconditional. Guards and corpses use a
900 px view, spatial events 850 px, and local chat 700 px. `welcome` is the complete baseline;
`world.delta` is emitted at 10 Hz while simulation stays at 20 Hz. Per-player network maps compare
against the last state actually sent, including ACK, HP, life, class, appearance and equipment.
Movement below 0.5 px accumulates against that sent baseline rather than being forgotten.

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
`World`; `world/monster-system.ts` selects and prunes threat, `world/contribution-system.ts` fences
reward attribution and `world/interest-system.ts` filters personal loot. `world/party-system.ts`
still contains the old room-local group mechanic for rollback character sessions; hero sessions
must not expose its create/invite/dissolve UI. Their `party` chat means the persistent D1 party and
is routed by `GameSession` across map rooms.

Useful healing means actual missing HP restored; overhealing never creates threat or contribution.
Personal loot is protected twice: it is omitted from every other player's AOI/delta and collection
also checks `ownerId`. Persistent party membership and colour survive disconnects and handoffs;
temporary combat contribution state remains room-local. See
[`docs/cooperative-combat.md`](./docs/cooperative-combat.md) for formulas and resource costs.

### Monster navigation

`ZoneDefinition.navigation` configures a room-local walkability grid generated from the zone's
authoritative `TerrainGeometry`. `world/navigation-system.ts` owns incremental four-neighbour A*,
the 128-entry path cache, unique request queue and per-tick node budget. `monster-system.ts` owns
behaviour selection: patrol, threat chase, unreachable-target abandonment and return to spawn.
Never bypass `resolveTerrain()` when following a path; it remains the final collision authority.

A target must move at least 72 px and respect the 650 ms repath interval. A threat target change
may force a request, but navigation work still stays inside the room budget. Add navigation for a
new zone by configuring `navigation` beside its terrain, not by branching in the engine. See
[`docs/monster-navigation.md`](./docs/monster-navigation.md) for generation, budgets, debug mode and
known limits.

### Observability, load and security boundaries

`world/observability-system.ts` owns bounded, room-local counters. `World` records tick duration,
network bytes/messages and delta sizes, successful/erroring D1 saves, saturated command queues,
navigation work, transitions, reconnects and rejected traffic. Every active room emits one
structured `world_metrics` record per 20-second window; it never logs individual inputs, attacks,
chat messages or inventory operations. Cloudflare logs retain these aggregates and traces are
sampled at 1%. Do not place metrics in module globals: a metric window belongs to exactly one room.

`scripts/loadtest.mjs` is the black-box load boundary. It provisions through `/api/*`, connects
through `/api/ws`, sends only legal client intent and reports client-observed throughput and ACK
latency. It groups accounts into parties of up to four and must use the primary
`?party=<partyId>&hero=<heroId>` admission route so `HeroPresence`, `GameSession` and normalized hero
persistence are under load. Its default target is localhost. Keep production behind both explicit
remote and production opt-ins, and never put production credentials in the script.

Security limits live beside the boundary they protect: HTTP JSON is capped before parsing,
WebSocket frames are capped at 2 KiB, identifiers are server-minted UUIDs, malformed/rate-limited
connections are closed, command queues are bounded, resync is limited to one per second, action
cooldowns remain authoritative, and D1 mutations use ownership/epoch/idempotency constraints.
When adding a message, assign its cost class: cheap intents use the connection window, expensive
rebuild-like requests also need a dedicated cooldown. Add rejection coverage as well as the happy
path. The remaining public-edge requirement is an account/login IP rate limit or Turnstile policy;
the per-room limiter is not a credential-stuffing defense.

## Gotchas worth knowing

**`vite dev` stacks Worker versions.** After a hot reload the *previous* Worker can keep
running, its Durable Object still ticking and still broadcasting to your open socket. Two
reloads, three live worlds — all writing to the same client. Symptoms: your square appears to
teleport between a few fixed positions, or players you never created show up. It is not a bug
in the game. **Restart the dev server.** Production runs exactly one object per id.

**`evictDurableObject()` hangs on a ticking world.** It waits for in-flight work to drain and
the `setInterval` never drains. That's why the rebuild path is tested as two halves — the
write (`persists a moved player's position onto their socket`) and the read
(`positionFromAttachment`) — rather than end-to-end.

**The world Durable Object is a singleton across a test file.** Assert on *which* player ids
are present, never on how many; a straggler still disconnecting from an earlier test must not
be able to fail an unrelated assertion.

**The test pool does not isolate storage between tests.** Rows written by one test are visible
to the next. `test/db.test.ts` truncates in `afterEach`. Do not reach for `reset()` from
`cloudflare:test` to fix this — it wipes every binding, Durable Object storage included.

**Durable Object billing follows the tick loop.** The loop runs while at least one player is
connected, and an active object is billed for its duration. An empty world stops the loop and
costs nothing. Don't make the loop unconditional.

**Players spawn at a random x.** A test that always pushes "right" will occasionally start
against the right wall and fail for reasons unrelated to what it tests. Use
`awayFromNearestWall()` in `world.test.ts`. The same trap bites manual checks: a square that
sits still may be clamped, not broken.

**`import.meta.env.DEV` exposes `window.__lindocara`** (`self()`, `all()`) for measuring input
latency and interpolation from outside the app. It is stripped from production builds.

**A running party is isolated by `partyId`.** `GameSession` owns party-wide coordination while each
active `partyId:mapId` `World` owns room-local simulation. Empty rooms stop ticking and reset
temporary monsters/loot. Do not route authored maps by `mapId` alone or bypass the coordinator for
party-wide chat/victory. A future one-object multi-room consolidation must preserve these boundaries.

**Server events are codes, not sentences.** `{ t: "event", code, params }` — the client owns
all wording via `src/shared/i18n/`. Never add an English string to a `#send` in `world.ts`; add
an `EventCode` and two dictionary entries instead (the i18n test enforces parity).

**The canvas is not React's.** `#stage` is a sibling of `#root`; nothing in `ui/` may touch it.

## Secrets

`SESSION_SECRET` signs the session cookie.

- locally: copy `.dev.vars.example` to `.dev.vars`
- production: `npx wrangler secret put SESSION_SECRET`
- CI: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repository secrets

It is typed in `src/env.d.ts` rather than inferred from `.dev.vars`, so CI and a laptop see
the same `Env`.

## Conventions

- Browser checks (running the app, screenshots, driving the editor UI): use the `playwright-cli`
  skill, never the Claude-in-Chrome extension.
- Biome formats and lints. `noNonNullAssertion` is on: no `!`, narrow properly.
- Never trust a client message. `parseClientMessage` returns `null` and the frame is dropped.
- Prefer a test that drives the real Durable Object over one that mocks it. The existing
  suite opens real WebSockets against real workerd; follow that.
- Every player-facing string lives in `src/shared/i18n/` in both languages. API errors are
  machine codes.
- UI is React; game code under `src/client/game/` must not import React. The store is the
  only bridge — components never call into net/renderer directly (the `GameHandle` in the
  store is the exception and the boundary).
- Two component trees, one rule each. Player/game UI uses `ui/tiny-swords/`; creator tools and
  any non-game surface use stock shadcn from `ui/components/`. Never import a Tiny component
  into an editor to "match the theme", and never hand-edit `ui/components/`. See
  `docs/superpowers/specs/2026-07-18-shadcn-base-ui-port-design.md`.
- Add a shadcn component with `npm run ui:add -- <name>`, then `npm run lint:fix` (stock output
  has no semicolons; Biome requires them). Do **not** call `npx shadcn@latest add` directly: the
  CLI resolves aliases only from a file named `tsconfig.json`, and this repo's `paths` live in
  `tsconfig.client.json`, so without `--path` it writes into a literal `./@/ui/components/`
  directory.
- Stock shadcn's `@layer base` sets `body { background-color; color }` **directly**, which beats
  anything `legacy.css` inherits from `:root` — CSS layers only compete with declarations on the
  same element. If game text ever turns near-white, that is why; fix it in `legacy.css`'s
  unlayered `html, body` rule, never by editing the generated token blocks in `app.css`.
  The UI suite runs with `css: false`, so no test will catch a regression of this kind — check it
  in a browser. The same unlayered-beats-layered rule cuts the other way too: `legacy.css`'s bare
  `input`/`button` selectors (the Tiny Swords game skin) would otherwise bleed into stock shadcn
  controls wherever the two trees share a DOM, e.g. green pill buttons inside the editor. The fence
  is `:not(:where([data-slot], .editor-root *))` — `:where()` contributes zero specificity, every
  shadcn control carries `data-slot`, and every editor-authored raw control lives under
  `.editor-root`.
- Regenerating `label` (`npm run ui:add -- label -o`) re-trips Biome's `noLabelWithoutControl`:
  stock shadcn's `Label` is a generic passthrough that spreads props, and Biome cannot see that
  call sites supply the control. The agreed resolution is a scoped `biome-ignore` on the JSX
  element, not an unconditional `for` attribute the component doesn't own.
