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

```
src/shared/     platform-free. Imports nothing from Cloudflare or the DOM.
  simulation.ts pure step(position, input, dt). The single source of movement truth.
  game.ts       map geometry, collision, combat/progression constants and pure rules.
  protocol.ts   the wire format, with defensive parsing of anything a client sends.
  prediction.ts pure reconcile()/prunePending(). Client-side prediction, as functions.
  i18n/         FR/EN dictionaries — data only; the server sends codes, never prose.

src/server/     runs in workerd.
  index.ts      Worker entry: /api/* only. Assets never reach it.
  session.ts    HMAC-signed cookie carrying the account identity. accounts.ts owns
                username/password (PBKDF2), characters.ts owns the roster.
  accounts.ts   register/login: username uniqueness, password hashing and verification.
  characters.ts roster CRUD and ownership checks, scoped to the caller's account.
  password.ts   PBKDF2 password hashing.
  profile.ts    D1 profile load/create/save boundary.
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
- **Everyone else** is drawn `INTERPOLATION_DELAY_MS` (100ms) in the past, interpolated
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
