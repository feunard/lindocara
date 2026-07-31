# @lindocara/server

The authoritative game server, built on the vendored [Alepha](../../.vendor/alepha) framework.
**The server decides outcomes** — clients send movement and action *intent*, never positions,
damage, health, inventory, XP, deaths, loot or quest completion. This package owns everything
that must be trusted. It runs on Node/SQLite in dev (`npm run dev` from the repo root, i.e.
`apps/main`'s `alepha dev`) and on Cloudflare Workers + Durable Objects + D1 in production
(`alepha platform up`).

## Responsibility

- `src/api/index.ts` — `LindocaraApi`: registers every controller, service, provider and room.
- `src/api/entities/*.ts` — alepha ORM `$entity` definitions, one file per table: `maps`,
  `adventures`, `parties`, `partyMembers`, `heroes`, the normalized hero-child tables
  (`heroItems`, `heroEquipment`, `heroSkills`, `heroQuests`, ...) and authoring-side tables
  (`mapElements`, `mapEvents`, `mapEventPages`, `adventureTestSessions`,
  `authoredQuestRewardClaims`, `itemDefinitions`, `partyAdventureStates`). Migrations are
  generated from these into `apps/main/migrations/` (see the root `AGENTS.md` Database section).
- `src/api/services/*.ts` — one `*Service.ts` per domain (`MapService`, `AdventureService`,
  `PartyService`, `HeroService`, `TestSessionService`, plus `HeroEpochService`/`HeroSaveService`/
  `AdventureStateService` for the realtime boundary) holding every repository read/write, and a
  matching `*Authoring.ts` (`mapAuthoring.ts`, `adventureAuthoring.ts`, `partyAuthoring.ts`,
  `heroAuthoring.ts`, `testSessionAuthoring.ts`) holding the **pure**
  parsing/validation/error-mapping rules a service calls into — every rule stays unit-testable
  without booting an Alepha app.
- `src/api/controllers/*.ts` — one `$action`-based controller per surface (`MapController`,
  `AdventureController`, `PartyController`, `HeroController`, `TestSessionController`,
  `MeController`, `HealthController`, `JoinController`), each a thin HTTP shape around its
  service. `$action` auto-prefixes `/api` (`path: "/maps"` → `/api/maps`).
- `src/api/providers/AppSecurityProvider.ts` — registers the app's `$realm()` (username+password
  credentials only, no email/OAuth) and MUST stay listed in `LindocaraApi`'s `services[]` —
  nothing else injects it, so omitting it silently falls back to the framework's email-required
  default. Named `AppSecurityProvider`, not `SecurityProvider`, to avoid colliding with
  `alepha/security`'s own `SecurityProvider`, which this class transitively injects. Auth is
  Alepha's own `/api/users/register` (two-phase: `createRegistrationIntent`, then
  `createUserFromIntent` at `/api/users/register/complete`) plus
  `/_auth/token?provider=credentials` and `/_auth/userinfo`.
- `src/api/realtime/` — the running game (below). `src/world/` — the explicit-dependency domain
  systems the world room composes (movement, combat, monsters, projectiles, quests, loot,
  navigation, interest/snapshot, event-run, class variants, ...). No module-level mutable room
  state.
- The SPA shell is not this package's job: `GET /` and every page route are served by
  `@lindocara/client`'s `ui/AppRouter.tsx` `$page` tree, registered alongside `LindocaraApi` in
  `apps/main/src/main.ts` (the one workspace that depends on both `client` and `server`). This
  package owns nothing HTML-shaped; it stays `/api/*` plus auth plus the realtime rooms.

## `src/api/realtime/` — the running game

Three `$room`s (all registered in `LindocaraApi`, served by `AlephaWebSocket`). `channels.ts`
declares `/ws/world`, `/ws/party`, `/ws/presence` with deliberately LOOSE zod schemas:
**`@lindocara/engine`'s `parseClientMessage`/`encodeServerMessage` stay the single wire truth** —
never duplicate the message variants in zod.

- **`WorldRoom`** (`/ws/world`, roomId `partyId:mapId`) — the room owner: admission, the full
  authoritative tick order (`worldTick.ts`: movement, combat actions, projectiles, monsters,
  guards, loot, events, quests, snapshots/deltas), reusing the pure `src/world/*` systems with
  injected dependencies. Admission: the client first calls `GET /api/join?party&hero`
  (`JoinController` + `AdmissionService`) for a `{roomId, channelPath}` HINT, then dials
  `/ws/world?roomId=…&party=…&hero=…`; the room re-validates everything against the database in
  `onJoin` — no query parameter selects an outcome. `conn` carries only `userId` (resolved at the
  upgrade from the bearer token or, for browsers, the encrypted session cookie, since a browser
  WebSocket cannot send an `Authorization` header). Close codes are the 4001-4008 vocabulary
  (`engine/close-codes.ts`).
- **`PartyRoom`** (headless, roomId `partyId`) — the party coordinator: room directory, party
  chat/victory fan-out, single writer of adventure state (switches/variables/self-switches, a
  monotone version, write-through persistence via `AdventureStateService`).
- **`PresenceRoom`** (headless, roomId `heroId`) — the per-hero lease (`connectionId`, epoch,
  room, TTL 30s, renewed on `WorldRoom`'s 10s beat). The database stays the single monotone
  source of `hero.session_epoch` (`HeroEpochService`); every hero save keeps the
  `WHERE session_epoch = ?` fence (`HeroSaveService`).

**Wire envelope**: client→server frames arrive wrapped `{roomId, message}` (the room unwraps
before `parseClientMessage`); server→client frames are sent raw, and the transport may stamp a
`__alephaRoom` key the client strips (`net.ts`). **App-level caps are ours** (2 KiB frames,
35 msg/s, 5 malformed, 12 queued commands, resync 1/s) — Alepha has no built-in frame cap or rate
limit. `onTick` stays SYNCHRONOUS: an async tick slower than its 50ms period silently skips
beats.

**Volatile-state caveats (accepted, documented in the room docblocks)**: room state is
memory-only — Node sweeps idle rooms after 5 minutes and a CF isolate eviction loses it. The tick
stops when a room empties and state is recreated on the next join (temporary monsters/loot
reset); a lost presence lease degrades to a 4003 kick and the epoch fence keeps writes safe
regardless.

**D1 discipline**, both load-bearing and easy to violate:
- `LindocaraApi` globally substitutes `CacheProvider` with `DatabaseCacheProvider`. This is the
  authoritative login-rate-limit store (30 failed attempts/IP/minute, 8/account/minute). Do not
  remove the substitution: the workerd default expects a KV binding this app does not provision,
  and `SessionService` deliberately fails open when its defensive cache is unavailable.
- `repo.transaction()` throws on D1 — use the `$transactional()` middleware instead, and know it
  degrades to a no-op there (Alepha's D1 provider reports `supportsTransactions: false`), so it never
  serializes a read-then-write sequence against a concurrent request.
- Bulk writes/deletes are chunked under D1's ~100 bound-parameter cap per statement — see
  `MapService`'s chunked element/layer writes and `AdventureService`'s
  `MAP_EVENT_PAGE_DELETE_CHUNK`-sized event-page deletes.
- A count-then-insert invariant (party size cap, unique color slot, etc.) cannot rely on a
  transaction to serialize it on D1. `PartyService.createParty`/`joinParty` instead build the guarded
  row as **one single-statement conditional `INSERT ... SELECT ... WHERE (SELECT count(*) ...) <
  cap`** via `Repository.query()`, then classify a zero-row result (already-member vs. full vs. a
  race-artifact color clash) against a follow-up read — never a `count()` read followed by a separate
  `create()` call.

## Graph

- **Depends on:** `engine` + `alepha`.
- **Depended on by:** the deployable `apps/main` (its server entry composes `LindocaraApi` with
  the client's `AppRouter`); the client only over the wire.

## Commands

```bash
npm run typecheck:server        # tsc -p packages/server/tsconfig.json (one program, alepha base)
npm run test:server             # or: npm test -w @lindocara/server — the Node test-api project
npm run db:generate -w @lindocara/main         # entity change -> apps/main/migrations/
npm run check:migrations -w @lindocara/main    # entity/migration drift check
```

## Tests and typechecking

`packages/server/test-api/` is this package's sole, Node-only Vitest project (`server` — its own
`vitest.config.ts`, `environment: "node"`, collected by the root aggregator alongside every other
package's project). It drives the Alepha app with real HTTP (`action.fetch()`/plain `fetch()`
against `ServerProvider.hostname`) and real WebSockets — no mocking — and also holds the pure
`src/world/**` system-test suites. **Typechecking**: the whole package (`src` + `test-api/`) is
one program, `packages/server/tsconfig.json`, extending `.vendor/alepha`'s own base config
(alepha's internals need Node/DOM globals and `allowImportingTsExtensions` that the repo's plain
root `tsconfig.json` doesn't carry).

## Rules

- Never trust a client message: `parseClientMessage` returns `null` and the frame is dropped.
- Add a mechanic in the narrowest existing `world/` system; pass its dependencies from
  `WorldRoom`/`worldTick.ts`; add it to the readable tick/action order. Never hide room state in
  a module global.
- Every hero child-table write includes an `EXISTS` fence against `hero.session_epoch`.
- Server events are codes, not sentences (add an `EventCode` + both dictionaries in `engine`).
- Prefer a test that drives the real app over a mock: boot it via `test-api/helpers.ts` and talk
  HTTP/WebSocket. No `vi.mock`.
- No TypeScript `private` members in Alepha classes; multi-line JSDoc.

See the root [`AGENTS.md`](../../AGENTS.md) for the full server-systems map and the gotchas.
