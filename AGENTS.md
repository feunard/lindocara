# lindocara — agent & contributor guide

A compact MMO vertical slice on Cloudflare Workers. One authoritative room contains players,
terrain, Warden Mira, roaming slimes, combat, loot, progression, a quest, and local chat.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite + the Worker + the Durable Object, all in workerd |
| `npm run check` | lint, typecheck, test — run this before committing |
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

### MMO multizone migration

Before changing world routing, room ownership, character location persistence, or splitting
`world.ts`, read [`docs/mmo-migration-plan.md`](./docs/mmo-migration-plan.md). It records the
verified current flows, migration order, D1 changes, duplicate-character risks, rollback strategy,
and acceptance criteria for each future step.

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
                username/password (PBKDF2), characters.ts owns the roster.
  accounts.ts   register/login: username uniqueness, password hashing and verification.
  characters.ts roster CRUD and ownership checks, scoped to the caller's account.
  password.ts   PBKDF2 password hashing.
  profile.ts    D1 profile load/create/save boundary, fenced by sessionEpoch.
  character-presence.ts deterministic per-character lease and connection authority.
  world.ts      room authority: 20 Hz simulation, prediction acks, AI, combat, loot, quest, chat.
  db/           D1 schema + Drizzle.

src/client/     runs in a browser.
  main.tsx      React entry; mounts <App/> beside the canvas.
  ui/           React components: screens, HUD, chat, overlays. PixelAct UI copies
                (restyled) under ui/pixelact-ui/.
  store.ts      zustand bridge: the game session writes, React reads. Text state is
                i18n keys + params, never rendered strings.
  api.ts        fetch client; machine-code errors mapped to dictionary keys.
  game/         the game loop: net.ts (prediction), renderer.ts (PixiJS), input.ts,
                sound.ts, session.ts (owns the store writes). No React in here.
  i18n.ts       locale state; useLocale() for React, t() for everyone.
```

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

Deploying applies migrations to production **before** shipping the code, so a column always
exists before the code that reads it.

One `account` row per registered user (`username` unique, stored lowercase). Up to three
`character` rows per account, each the persistent roster entry a player picks at character
select. The character row — position, level, XP, HP, appearance, inventory, and quest state —
is what the world loads before the WebSocket is accepted and saves back; `name` is deliberately
not unique, since the account, not the name, is the identity. Dirty profiles are saved every
five seconds and on disconnect.

### Character presence and save fencing

`CharacterPresence` is a SQLite-backed Durable Object addressed with
`CHARACTER_PRESENCE.getByName(characterId)`. D1 is the single monotone source of
`character.session_epoch`; the presence DO stores only the active lease (`connectionId`, epoch,
room, zone, instance, timestamps).

- Acquisition freezes and saves the previous owner while its epoch is still valid, increments the
  D1 epoch atomically, then installs the new lease.
- The lease lasts 30 seconds and `World` renews it every 10 seconds. Inputs use local authority and
  do not call the presence DO per command or tick.
- Normal disconnect saves with `WHERE id = ? AND session_epoch = ?`, releases the matching lease,
  then removes the runtime player.
- A stale save changes no row, logs `stale_character_save_rejected`, invalidates local authority,
  and closes the socket with `WS_CLOSE.PRESENCE_LOST`.
- `ward_run_expires_at` is an absolute D1/attachment deadline. Never reconstruct it from a new
  connection time or a tick counter.

Interzone handoff uses the same epoch fence: freeze source actions, save the source, then let
`CharacterPresence.handoff()` conditionally write destination location and epoch N+1 in one D1
statement. Only then remove/close the source socket with `WS_CLOSE.ZONE_TRANSITION`. The client
reconnects; `index.ts` reads the destination from D1 and grants a fresh lease. Never add a portal
without a server-owned catalogue destination and integration tests for the stale source save.

### Zone routing and room isolation

`src/shared/zones.ts` is the only place that declares a zone. It validates the persisted
`zoneId`/`instanceId`, resolves the immutable terrain/content definition, and builds
`zoneId:instanceId`. `index.ts` reads that location from D1 after ownership verification; query
parameters and WebSocket messages never select a room.

`World` validates the internal room headers against the catalogue before admission, then owns only
that zone's players, monsters, loot, quests, timers and chat. Respect `maxPlayers`: a full room
closes with `WS_CLOSE.ROOM_FULL`. `verdant-reach:main` preserves the current map; the compact
`mmo-test-zone` has a collision obstacle and paired return portal for handoff coverage. Rooms
remain isolated; portal interaction is only an intent, never a client-selected destination.

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

**The room is intentionally one Durable Object today.** The next scale boundary is deterministic
room routing in `server/index.ts`, not a larger global object. Keep room-local simulation in
`World` so sharding later is a routing change rather than a gameplay rewrite.

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
