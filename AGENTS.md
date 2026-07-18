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
  ui/           React components: screens, HUD, chat, overlays and creator tools. Player UI keeps
                the Tiny Swords skin; editors use compact React/Radix tool surfaces.
  store.ts      zustand bridge: the game session writes, React reads. Text state is
                i18n keys + params, never rendered strings.
  api.ts        fetch client; machine-code errors mapped to dictionary keys.
  game/         the game loop: net.ts (prediction), renderer.ts (PixiJS), input.ts,
                sound.ts, session.ts (owns the store writes). No React in here.
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
- `combat-system.ts` contains target selection and damage calculations; `skill-system.ts` contains
  skill targeting and collision-resolved mobility helpers.
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

`CLASS_STATS` in `shared/game.ts` is the one balance table — attack damage, attack range, and
(for priests) heal amount, heal range, and heal cooldown all read from it, for both the server's
validation and the client's UI. The server validates class, range, cooldown, and targeting for
every action; `{ t: "heal" }` is intent like any other, resolved server-side into the most
injured ally in range or `heal.nobody` if there is none.

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

Objects, equipment, skills and multi-quest progression use the normalized character tables
documented in [`docs/persistence-model.md`](./docs/persistence-model.md), but they are not yet the
party-hero persistence boundary. For the primary flow, `hero` owns map, position, core stats, life,
corpse position and fencing epoch; starter inventory/equipment/skills/quests are session-only.
Do not silently point character-owned normalized rows at heroes. A later explicit migration must
add hero ownership and fencing before those systems become durable for party heroes.

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
- Inventory, equipment, resource, skill and quest state are reinitialized for each hero session in
  this slice; do not describe those fields as durable hero data yet.

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

The welcome message includes `mapId + revision`, baked terrain and authored elements so prediction,
renderer and mini-map share the same cache identity. The map editor is a WYSIWYG PixiJS stage that
shares placement/collision/catalog rendering rules with the runtime through `shared/map-data.ts` and
`client/game/catalog-element-render.ts`. It has explicit loading/error state, grouped history,
dirty navigation guards, selection/inspectors, stable marker ids with optional labels and complete
marker preview. Editor controls are compact React/Radix tool surfaces; Tiny Swords belongs in asset
previews rather than oversized editor chrome. See
[`docs/superpowers/specs/2026-07-16-map-editor-design.md`](./docs/superpowers/specs/2026-07-16-map-editor-design.md)
and [`docs/superpowers/plans/2026-07-16-map-editor.md`](./docs/superpowers/plans/2026-07-16-map-editor.md)
for the full spec and plan.

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
latency. Its default target is localhost. Keep production behind both explicit remote and
production opt-ins, and never put production credentials in the script.

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

- Biome formats and lints. `noNonNullAssertion` is on: no `!`, narrow properly.
- Never trust a client message. `parseClientMessage` returns `null` and the frame is dropped.
- Prefer a test that drives the real Durable Object over one that mocks it. The existing
  suite opens real WebSockets against real workerd; follow that.
- Every player-facing string lives in `src/shared/i18n/` in both languages. API errors are
  machine codes.
- UI is React; game code under `src/client/game/` must not import React. The store is the
  only bridge — components never call into net/renderer directly (the `GameHandle` in the
  store is the exception and the boundary).
