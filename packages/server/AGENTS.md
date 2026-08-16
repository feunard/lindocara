# @lindocara/server

The authoritative game server, built on the vendored [Alepha](../../.vendor/alepha) framework.
**The server decides outcomes** — clients send action *intent*, never damage, health, inventory,
XP, deaths, loot or quest completion. Since S3 moved movement to the client, a `move` frame is the
one message that carries a FACT rather than an intent: the hero's own client ran the rule and
reports where it ended up. **That conceded AUTHORITY, not VALIDITY** — `applyReportedMove`
(`worldTick.ts`) bounds the claim against the real map (`withinRoomBounds`), the parser caps every
coordinate at `MOVE_COORDINATE_LIMIT`, and a corpse's or a mid-handoff hero's frames are dropped.
Everything else in the list above stayed here, and this package still owns everything that must be
trusted. It runs on Node/SQLite in dev (`yarn dev` from the repo root, i.e.
`apps/main`'s `alepha dev`) and as a plain Node process on Alepha Bay in production
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
  service. `$action` auto-prefixes `/api` (`path: "/maps"` → `/api/maps`). Every map route is
  owner-fenced: foreign lists are empty and foreign reads, writes, first-map changes, forced
  deletes and creates under another adventure answer 404 `map_not_found`.
  `PUT /api/maps/:id/heightfield` remains the terrain seeding route into a deployed instance
  whose database no script can open.
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
  state. Everything here reads in TILE units, grid centre as origin: `x` and `z` are the two GROUND
  axes and `y` is ELEVATION. The temporary `heightfield-pixel-bridge.ts` that used to project the
  stored heightfield into a pixel geometry is deleted, with the engine-side arithmetic it called.
  The terrain junction it was a stopgap for now lives in `@lindocara/engine/terrain-access.js` —
  `zoneTerrainFromHeightfield` builds the room's `ZoneTerrain`, and every "can something stand
  here" question is one `canStand` call. It is in the engine rather than here because the CLIENT
  bakes the terrain it MOVES on from the same string with the same function; two copies of a
  collision rule would let a hero walk through a wall on one side of the wire and into it on the
  other, with nothing failing anywhere.
- The proving-map generator is NOT in this package: it lives in the repo's root `scripts/`
  (`scripts/build-proving-map.ts`), beside the other cross-workspace generators and inside
  `tsconfig.tooling.json`'s program so it is actually typechecked. It generates the HD-2D
  heightfield (reusing `apps/lab`'s own island generator, a script-only one-way import that must
  never reach any package's runtime path) and stores it on a map row through
  `MapService.saveHeightfield` — see Commands below.
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
  authoritative tick order (`worldTick.ts`: combat actions, projectiles, monsters, guards, loot,
  events, quests, snapshots/deltas), reusing the pure `src/world/*` systems with injected
  dependencies. HERO movement is no longer in that order: it arrives as a reported `move` and is
  validated on receipt (`applyReportedMove`), while `movement-system.ts` keeps only the per-player
  beat that used to sit beside it — resource regeneration, the presence heartbeat, corpse reclaim,
  loot collection, the attachment write and the dirty flush. Monsters, guards and projectiles are
  still stepped here, and always will be. Admission: the client first calls `GET /api/join?party&hero`
  (`JoinController` + `AdmissionService`) for a `{roomId, channelPath}` HINT, then dials
  `/ws/world?roomId=…&party=…&hero=…`; the room re-validates everything against the database in
  `onJoin` — no query parameter selects an outcome. `conn` carries only `userId` (resolved at the
  upgrade from the bearer token or, for browsers, the encrypted session cookie, since a browser
  WebSocket cannot send an `Authorization` header). Close codes are the 4001-4008 vocabulary
  (`engine/close-codes.ts`).
- **`PartyRoom`** (headless, roomId `partyId`) — the party coordinator: room directory, party
  chat/victory fan-out, single writer of adventure state (switches/variables/self-switches, a
  monotone version, write-through persistence via `AdventureStateService`). Its room directory
  also supplies the non-authoritative `hasConnectedPlayers` hint used by party listings; admission
  never trusts that volatile value.
- **`PresenceRoom`** (headless, roomId `heroId`) — the per-hero lease (`connectionId`, epoch,
  room, TTL 30s, renewed on `WorldRoom`'s 10s beat). The database stays the single monotone
  source of `hero.session_epoch` (`HeroEpochService`); every hero save keeps the
  `WHERE session_epoch = ?` fence (`HeroSaveService`).

**Wire envelope**: client→server frames arrive wrapped `{roomId, message}` (the room unwraps
before `parseClientMessage`); server→client frames are sent raw, and the transport may stamp a
`__alephaRoom` key the client strips (`net.ts`). **App-level caps are ours** (2 KiB frames,
`RATE_MAX_MESSAGES` 35 msg/s, 5 malformed, resync 1/s) — Alepha has no built-in frame cap or rate
limit. The 12-deep command queue died with the command queue itself; the client's own move report
is throttled to 20/s (`MOVE_REPORT_MS`) and suppresses identical frames, deliberately leaving room
under the 35/s window for chat, actions and resyncs. `onTick` stays SYNCHRONOUS: an async tick slower than its 50ms period silently skips
beats.

**Volatile-state caveats (accepted, documented in the room docblocks)**: room state is
memory-only — Node sweeps idle rooms after 5 minutes, and so does a restart of the Bay process
itself (a redeploy or a crash), since production is one plain Node process, not a pool of
Cloudflare isolates. The tick stops when a room empties and state is recreated on the next join
(temporary monsters/loot reset); a lost presence lease degrades to a 4003 kick and the epoch fence
keeps writes safe regardless.

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
- Party abandonment follows the same D1 rule: `PartyService.abandonParty` deletes the caller's
  heroes and membership, then uses one conditional `DELETE ... NOT EXISTS` for empty-party cleanup
  and one subquery-backed conditional `UPDATE` for host transfer. Do not turn either write into a
  read-then-write pair; concurrent join/leave requests would make the read stale.

## Graph

- **Depends on:** `engine` + `alepha`.
- **Depended on by:** the deployable `apps/main` (its server entry composes `LindocaraApi` with
  the client's `AppRouter`); the client only over the wire.

## Commands

```bash
yarn typecheck:server        # tsc -p packages/server/tsconfig.json (one program, alepha base)
yarn test:server             # or: yarn workspace @lindocara/server run test — the Node test-api project
yarn workspace @lindocara/main run db:generate         # entity change -> apps/main/migrations/
yarn workspace @lindocara/main run check:migrations    # entity/migration drift check

# The proving map: generate the HD-2D heightfield and store it on a map row (run from the repo
# root). `--dry-run` generates and reports without touching the database; `--out` also writes the
# encoded `MapData` to a file; `--database` overrides the dev SQLite file.
yarn map:proving --map=<mapId>
yarn map:proving --dry-run --out=/tmp/proving.json

# A whole playable heightfield adventure, over HTTP only — the one path that also works against a
# deployed instance, whose database no local process can open. Needs the app running at --target.
yarn adventure:proving
SEED_PASSWORD=... yarn adventure:proving --target=https://lindocara.bay.alepha.dev \
  --allow-remote=true --allow-production=true
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
