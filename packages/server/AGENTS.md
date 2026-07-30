# @lindocara/server

The authoritative game server. **The server decides outcomes** — clients send movement and action
*intent*, never positions, damage, health, inventory, XP, deaths, loot or quest completion. This
package owns everything that must be trusted. Since the realtime tranche it holds TWO stacks: the
live Alepha one under `src/api/` (see below — `npm run dev`, Node, the playable game) and the
legacy Cloudflare Worker (workerd, everything the "Responsibility" section below describes),
rollback-only via `dev:legacy` until the cleanup tranche.

## Responsibility (legacy workerd stack)

- `index.ts` — Worker entry (`/api/*` only; assets never reach it). The primary WS route is
  `/api/ws?party=<partyId>&hero=<heroId>`; it verifies account/membership/ownership and reads the
  authoritative map+position from D1. No client message may select a destination.
- `world.ts` — the Durable Object and room owner: admission, socket lifecycle, tick order.
  `world/` — the explicit-dependency systems (movement, combat, monsters, projectiles, quests, loot,
  navigation, interest/snapshot, persistence, event-run). No module-level mutable room state.
- `game-session.ts` — the party coordinator (room routing, cross-map broadcast, adventure state, the
  single writer of switches/variables). `hero-presence.ts`/`hero-profile.ts` — leases + fenced saves.
- `accounts.ts`/`session.ts`/`password.ts` — auth. `maps.ts`/`adventures.ts`/`parties.ts`/`heroes.ts`
  — the primary authored/save flow. `db/` — the D1 schema (Drizzle). `wrangler.jsonc` + `migrations/`
  — this Worker's deploy config and D1 schema history; `.dev.vars` holds `SESSION_SECRET` locally
  and `apps/main` prepares or migrates it before development starts.

## Graph

- **Depends on:** `engine` (+ `drizzle-orm`).
- **Depended on by:** the deployable `apps/main` (via `wrangler.jsonc` `main`); the client only over
  the wire.

## Commands

```bash
npm run typecheck:server        # tsc, Workers types
npm test -w @lindocara/server   # or: npm run test:server — real workerd + D1 + Durable Objects
npm run cf-typegen              # regenerate src/worker-configuration.d.ts from wrangler.jsonc
npm run db:generate             # (root) diff db/schema.ts -> migrations/*.sql
npm run db:migrate              # apply migrations to the local D1 (reads this package's wrangler)
```

## `src/api/` — the Alepha-ported API (migration tranches 0-1 + the realtime tranche)

The Alepha implementation of the server lives under `src/api/`, built on the vendored
[Alepha](../../.vendor/alepha) framework instead of a hand-rolled Worker. It runs on Node/SQLite in
dev (`npm run dev` from the repo root, i.e. `apps/main`'s `alepha dev`) and targets Cloudflare
Workers + D1 for a later deploy (`alepha build --target cloudflare`, still frozen — see the root
`AGENTS.md`/`CLAUDE.md` "Alepha migration status"). It is a from-scratch reimplementation of the
primary authored/save flow (accounts, maps, adventures, parties, heroes) **plus, since the
realtime tranche, the whole running game**: `src/api/realtime/` (below) replaces `/api/ws`,
`World`, `GameSession` and `HeroPresence` on this stack. It still does not touch the legacy
sources (`world.ts`, `game-session.ts`, `hero-presence.ts`, `index.ts`), which stay runnable via
`dev:legacy` as rollback until the cleanup tranche.

- `src/api/entities/*.ts` — Alepha ORM entity definitions (Drizzle-backed), one file per table:
  `maps`, `adventures`, `parties`, `partyMembers`, `heroes`, plus the normalized hero-child tables
  (`heroItems`, `heroEquipment`, `heroSkills`, `heroQuests`, ...) and authoring-side tables
  (`mapElements`, `mapEvents`, `mapEventPages`, `adventureTestSessions`,
  `authoredQuestRewardClaims`, `itemDefinitions`). These are the Alepha-side twins of `db/schema.ts`,
  not a shared source — the two schemas are independently maintained during the migration.
- `src/api/services/*.ts` — one `*Service.ts` per domain (`MapService`, `AdventureService`,
  `PartyService`, `HeroService`, `TestSessionService`) holding every repository read/write, plus a
  matching `*Authoring.ts` (`mapAuthoring.ts`, `adventureAuthoring.ts`, `partyAuthoring.ts`,
  `heroAuthoring.ts`, `testSessionAuthoring.ts`) holding the **pure** parsing/validation/error-mapping
  rules a service calls into — mirroring the legacy pattern where `maps.ts`'s `validateMapInput`
  never touches `Db` either, so every rule stays unit-testable without booting an Alepha app.
- `src/api/controllers/*.ts` — one `$action`-based controller per surface (`MapController`,
  `AdventureController`, `PartyController`, `HeroController`, `TestSessionController`,
  `MeController`, `HealthController`), each a thin HTTP shape around its service.
- `src/api/providers/AppSecurityProvider.ts` — registers the app's `$realm()` (username+password
  credentials only, no email/OAuth) and MUST stay listed in `LindocaraApi`'s `services[]`
  (`src/api/index.ts`) — nothing else injects it, so omitting it silently falls back to the
  framework's email-required default. Named `AppSecurityProvider`, not `SecurityProvider`, to avoid
  colliding with `alepha/security`'s own `SecurityProvider`, which this class transitively injects.
  `$action` auto-prefixes `/api` (`path: "/maps"` → `/api/maps`);
  auth is Alepha's own `/api/users/register` (two-phase: `createRegistrationIntent`, then
  `createUserFromIntent` at `/api/users/register/complete`) plus `/_auth/token?provider=credentials`
  and `/_auth/userinfo`.
- `src/api/controllers/SpaController.ts` — the SPA shell: `$route` (not `$action` — no `/api`
  prefix) serving `GET /` and `/index.html` with the load-bearing DOM (`<canvas id="stage">` as a
  sibling BEFORE `#root` — the canvas is not React's). Dev head = Vite client + React Fast Refresh
  preamble + `apps/main/src/main.browser.ts`; production head is resolved from the embedded client
  manifest. Without it a `$page`-less alepha app serves nothing at `/`.

### `src/api/realtime/` — the running game (realtime tranche)

Three `$room`s (all registered in `LindocaraApi`, served by `AlephaWebSocket`) replace the legacy
Durable Objects on this stack. `channels.ts` declares `/ws/world`, `/ws/party`, `/ws/presence`
with deliberately LOOSE zod schemas: **`@lindocara/engine`'s `parseClientMessage`/
`encodeServerMessage` stay the single wire truth** — never duplicate the message variants in zod.

- **`WorldRoom`** (`/ws/world`, roomId `partyId:mapId`) — the `World` successor: admission, the
  full authoritative tick order (`worldTick.ts`: movement, combat actions, projectiles, monsters,
  guards, loot, events, quests, snapshots/deltas), reusing the pure `src/world/*` systems with
  injected dependencies. Admission: the client first calls `GET /api/join?party&hero`
  (`JoinController` + `AdmissionService`) for a `{roomId, channelPath}` HINT, then dials
  `/ws/world?roomId=…&party=…&hero=…`; the room re-validates everything against D1 in `onJoin` —
  no query parameter selects an outcome. `conn` carries only `userId` (resolved at the upgrade
  from the bearer token or, for browsers, the encrypted session cookie — a vendored
  `resolveUserId` fallback, since a browser WebSocket cannot send an `Authorization` header).
  Close codes are the legacy 4001-4008 vocabulary verbatim (`engine/close-codes.ts`).
- **`PartyRoom`** (headless, roomId `partyId`) — the `GameSession` successor: room directory,
  party chat/victory fan-out, single writer of adventure state. State is **write-through to D1 on
  every mutation** (no 5s debounce — rooms have no alarm primitive).
- **`PresenceRoom`** (headless, roomId `heroId`) — the `HeroPresence` successor: the lease
  (`connectionId`, epoch, room, TTL 30s). D1 stays the single monotone source of
  `hero.session_epoch` (`HeroEpochService`); every hero save keeps the
  `WHERE session_epoch = ?` fence.

**Wire envelope**: client→server frames arrive wrapped `{roomId, message}` (the room unwraps
before `parseClientMessage`); server→client frames are sent raw, and the transport may stamp a
`__alephaRoom` key the client strips (`net.ts`). **App-level caps port verbatim** (2 KiB frames,
35 msg/s, 5 malformed, 12 queued commands, resync 1/s) — Alepha has no built-in frame cap or rate
limit. `onTick` stays SYNCHRONOUS: an async tick slower than its 50ms period silently skips
beats.

**Volatile-state caveats (accepted this tranche, documented in the room docblocks)**: headless
room state is memory-only — Node sweeps idle rooms after 5 minutes and a CF isolate eviction
loses it. The tick stops when a room empties and state is recreated on the next join (matching
the legacy empty-room reset of temporary monsters/loot); a lost presence lease degrades to a 4003
kick and the D1 epoch fence keeps writes safe regardless. CF deploy is the deploy tranche's
(`BuildCloudflareTask` wires `$websocket` only, not `$room` — known gap).

**D1 discipline**, both load-bearing and easy to violate:
- `repo.transaction()` throws on D1 — use the `$transactional()` middleware instead, and know it
  degrades to a no-op there (Alepha's D1 provider reports `supportsTransactions: false`), so it never
  serializes a read-then-write sequence against a concurrent request.
- Bulk writes/deletes are chunked the same way `maps.ts` already had to be (D1's ~100 bound-parameter
  cap per statement) — see `MapService`'s chunked element/layer writes and `AdventureService`'s
  `MAP_EVENT_PAGE_DELETE_CHUNK`-sized event-page deletes.
- A count-then-insert invariant (party size cap, unique color slot, etc.) cannot rely on a
  transaction to serialize it on D1. `PartyService.createParty`/`joinParty` instead build the guarded
  row as **one single-statement conditional `INSERT ... SELECT ... WHERE (SELECT count(*) ...) <
  cap`** via `Repository.query()`, then classify a zero-row result (already-member vs. full vs. a
  race-artifact color clash) against a follow-up read — never a `count()` read followed by a separate
  `create()` call.

**Tests**: `packages/server/test-api/` is a separate, Node-only Vitest project (`server-api` —
its own `vitest.config.ts`, `environment: "node"`, collected by the root aggregator alongside every
other package's project). It drives the Alepha app with real HTTP (`action.fetch()`/plain `fetch()`
against `ServerProvider.hostname`) the same way the workerd suite drives the real Durable Object —
no mocking. **Typechecking**: `src/api/**` and `test-api/` get their own program,
`packages/server/tsconfig.api.json` (extending `.vendor/alepha`'s own base config, not this
package's workerd `tsconfig.json`), because Alepha's own internals need Node/DOM globals and
`allowImportingTsExtensions` that the workerd program deliberately excludes — `npm run
typecheck:server` runs both `tsc -p packages/server/tsconfig.json` and `tsc -p
packages/server/tsconfig.api.json`.

**The legacy stack stays untouched during this migration.** Nothing in `src/api/` may import from or
mutate `index.ts`, `world.ts`, `world/`, `game-session.ts`, `hero-presence.ts`,
`accounts.ts`/`session.ts`/`password.ts`, `maps.ts`/`adventures.ts`/`parties.ts`/`heroes.ts`, or
`db/schema.ts` — every rule ported into `src/api/` is a read-and-reimplement against those files, not
a shared call. If a legacy fix also applies to the Alepha port, port it explicitly into the matching
`src/api/` file; do not reach into the legacy module from `src/api/` to "reuse" it. **Exception:**
`src/api/realtime/` may import pure runtime-neutral systems under `src/world/` (e.g.
`connection-system.ts`, `interest-system.ts`, `movement-system.ts`, `snapshot-system.ts`,
`world-runtime.ts`, `spatial-grid.ts`, `map-zone.ts`) with injected dependencies; the legacy shells
(`world.ts`, `game-session.ts`, `hero-presence.ts`, `character-presence.ts`) remain forbidden.

## Rules

- Never trust a client message: `parseClientMessage` returns `null` and the frame is dropped.
- Add a mechanic in the narrowest existing `world/` system; pass its dependencies from `World`; add
  it to the readable tick/action order. Never hide room state in a module global.
- Every hero child-table write includes an `EXISTS` fence against `hero.session_epoch`.
- Server events are codes, not sentences (add an `EventCode` + both dictionaries in `engine`).
- Tests run against the **real** Durable Object in workerd (`vitest.config.ts` = cloudflare pool,
  reading `./wrangler.jsonc`). Prefer a test that drives the real DO over a mock.

See the root [`AGENTS.md`](../../AGENTS.md) for the full server-systems map and the DO gotchas.
