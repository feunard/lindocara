# Alepha Migration — Realtime Tranche Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the realtime layer (World/GameSession/HeroPresence) onto Alepha `$room`s and cut the client over (auth + api + websocket), making `npm run dev` serve the playable game on pure Alepha.

**Architecture:** Three channels: `world` (socketed `$room`, tickHz 20, one room per `partyId:mapId`), `party` (headless GameSession successor), `presence` (headless HeroPresence successor). The existing `packages/server/src/world/*` systems are reused nearly as-is (they already take injected contexts); what gets rewritten is the DO shell: admission moves into `onJoin` (re-validated from D1 — an authenticated `resolveJoin` `$action` tells the client its roomId, but the room never trusts it), persistence moves onto the Task-6/7 repositories with the same epoch fencing, and coordinator state becomes write-through to D1 because headless `$room` state is volatile. The client keeps `session.ts`'s close-code reconnect logic by speaking Alepha's wire envelope over a raw browser WebSocket instead of `WebSocketClient`.

**Tech Stack:** Alepha 0.24.0+ (`alepha/websocket` `$channel`/`$room`, `RoomClock` FakeClock testing idiom), engine package untouched, vitest `server-api` project.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-alepha-migration-design.md` (incl. the 2026-07-30 amendment: this tranche runs BEFORE the React tranche and carries the minimal client cutover).
- **`packages/engine` untouched** — `protocol.ts` stays the single wire-parsing truth: channel zod schemas stay loose (`z.unknown()`-shaped) and `onMessage` runs `parseClientMessage`; duplicating the 25 message variants in zod is a plan violation (drift risk).
- The server decides outcomes: no client message selects a room, position, damage, or destination. `resolveJoin` output is a hint the room re-validates against D1.
- One command per tick, ack by sequence, `MAX_STARVED_TICKS` — unchanged. `step()`/prediction untouched.
- Epoch fencing on every hero write — unchanged semantics (D1 `session_epoch` single source, `UPDATE … WHERE session_epoch = ?`).
- Close codes preserved verbatim from `packages/engine/src/close-codes.ts` (4001-4008 + 1008/1009 usage).
- App-level caps port verbatim: `MAX_FRAME_BYTES 2048`, `RATE_MAX_MESSAGES 35/1000ms`, `MAX_MALFORMED 5`, `MAX_QUEUED_COMMANDS 12`, resync 1/s (Alepha has NO built-in frame cap or rate limit — recon-verified).
- `onTick` stays SYNCHRONOUS (an async onTick slower than 50ms silently skips beats — RoomEngine guard).
- Legacy realtime sources (`world.ts`, `game-session.ts`, `hero-presence.ts`, `index.ts`) are READ but not modified; legacy stays runnable via `dev:legacy` until the cleanup tranche.
- New server code: `packages/server/src/api/realtime/` (covered by tsconfig.api.json — add the path to its include if globs miss it). No `private` keyword, Biome, multi-line JSDoc, no `vi.mock`.
- Foreground verification only (backgrounded checks have died repeatedly).
- Node is the validation runtime for this tranche. CF-specific work (DO wiring) is the deploy tranche's; its known prerequisite is that Alepha's `BuildCloudflareTask` only wires `$websocket` primitives, not `$room` (recon-verified gap — upstream fix or paired `$websocket` declaration, decided at the deploy tranche).
- Known volatile-state limitations accepted THIS tranche (documented, not fixed): headless room state is memory-only (Node 5-min idle sweep spares presence/party rooms only while calls keep coming; CF isolate eviction loses it) → GameSession state is WRITE-THROUGH to D1 on every mutation (no 5s debounce — the alarm primitive isn't exposed to rooms), and a lost presence lease kicks the player to the reconnect flow (D1 epoch fencing keeps writes safe regardless). Upstream feature request: durable room state + app alarms.

## Task Overview

1. Realtime channels + wire envelope helpers
2. PresenceRoom (headless) + fenced epoch helpers
3. PartyRoom (headless GameSession successor, write-through state)
4. WorldRoom α — resolveJoin, admission, movement, snapshots
5. WorldRoom β — full tick order (combat, monsters, guards, loot, projectiles, variants)
6. Persistence + fencing (5s save queue, onLeave, cooldown checkpoints)
7. Events, quests and adventure-state round-trip
8. Map transitions (freeze → save → handoff → 4008 → rejoin)
9. Client cutover α — auth + api endpoints
10. Client cutover β — net.ts on the Alepha wire + session.ts reconnect
11. Loadtest port + playable smoke + docs

---

### Task 1: Realtime channels + wire envelope helpers

**Files:**
- Create: `packages/server/src/api/realtime/channels.ts`
- Create: `packages/server/src/api/realtime/wire.ts`
- Test: `packages/server/test-api/realtime-wire.test.ts`

**Interfaces:**
- Produces: `worldChannel` (`$channel({ path: "/ws/world", schema })`), `partyChannel` (`/ws/party`), `presenceChannel` (`/ws/presence`) — the latter two headless-only with stub schemas. `wire.ts` exports `frameByteLength(raw: string): number` and `RATE` constants re-exported from `world-runtime.ts` equivalents.
- Channel schemas: `out` (client→server) = `z.record(z.string(), z.unknown())` (loose — `parseClientMessage` is the real gate), `in` (server→client) = `z.unknown()`. A comment on each schema states WHY they are loose (single-parser doctrine).

Steps (TDD): failing test asserting `worldChannel.path === "/ws/world"` and that a `ServerMessage` round-trips `encodeServerMessage`/JSON through the loose schema; implement; commit `feat: realtime channels for the alepha world/party/presence rooms`.

### Task 2: PresenceRoom (headless) + fenced epoch helpers

**Files:**
- Create: `packages/server/src/api/realtime/PresenceRoom.ts`
- Create: `packages/server/src/api/services/HeroEpochService.ts`
- Test: `packages/server/test-api/presence-room.test.ts`

**Interfaces:**
- Consumes: `presenceChannel` (Task 1), `heroes` entity (tranche 1).
- Produces: `$room({ channel: presenceChannel, methods })`, roomId = `heroId`. Methods (signatures mirror legacy `character-presence.ts:164-240`):
  - `acquire({ connectionId, roomKey, zoneId, instanceId }): { sessionEpoch: number } | null` — freezes/saves nothing itself; increments D1 epoch via `HeroEpochService.acquireEpoch(heroId)` (single-statement `UPDATE hero SET session_epoch = session_epoch + 1 … RETURNING session_epoch` — port of `hero-profile.ts:118-126`), then installs the lease `{connectionId, sessionEpoch, roomKey, zoneId, instanceId, expiresAt: now + 30_000}` in room state.
  - `renew(connectionId, sessionEpoch): boolean` (TTL 30s, extends expiry).
  - `isAuthorized(connectionId, sessionEpoch, roomKey): boolean`.
  - `release(connectionId, sessionEpoch): void`.
  - `handoff({ connectionId, sessionEpoch, mapId, x, y }): { sessionEpoch: number } | null` — the fenced move+increment in ONE statement (port of `hero-profile.ts:128-146`: `UPDATE hero SET map_id=?, x=?, y=?, session_epoch=session_epoch+1 WHERE id=? AND session_epoch=? RETURNING session_epoch`).
  - `checkpointCooldowns(connectionId, sessionEpoch, cooldowns)` / `readCooldowns(connectionId, sessionEpoch)` — held in room state (volatile; a lost checkpoint restores empty cooldowns, matching a fresh-session experience).
- Lease volatility is documented in the class docblock: eviction loses the lease → next `isAuthorized` fails → socket closes `PRESENCE_LOST 4003`; D1 fencing keeps data safe.

Steps: failing tests — acquire bumps D1 epoch and returns it; second acquire invalidates the first (`isAuthorized` false for old connectionId); renew extends, expiry lapses (inject a `now()` seam, do not sleep); handoff with stale epoch returns null and changes no row; then implement; commit `feat: presence room — hero lease and fenced epochs on alepha`.

### Task 3: PartyRoom (headless GameSession successor)

**Files:**
- Create: `packages/server/src/api/realtime/PartyRoom.ts`
- Create: `packages/server/src/api/services/AdventureStateService.ts`
- Test: `packages/server/test-api/party-room.test.ts`

**Interfaces:**
- Consumes: `partyChannel`, `partyAdventureStates` entity, engine's pure `applyStateMutation` (already in engine — find the exact export used by legacy `game-session.ts:849`).
- Produces: `$room({ channel: partyChannel, methods })`, roomId = `partyId`. Methods (port of `game-session.ts` surface, same names): `getAdventureState()`, `applyStateChanges(mutations)` (serialized, version monotone +1, **write-through**: D1 `partyAdventureStates` upsert BEFORE pushing to world rooms — replaces the legacy 5s alarm debounce, rationale in the docblock), `markPermanentMonsterDefeated(eventId)`, `recordQuestEvent(event)`, `acceptAuthoredQuest(actor, questId, target, inventory)`, `abandonAuthoredQuest(actor, questId)`, `completeAuthoredQuest(actor, questId, target, rewardChoiceId, heroState)` (port from `game-session.ts:408-750` — epoch-fenced hero writes via the same fenced batch style as Task 6), `broadcastToParty(message)`, `registerRoom(roomKey)` / `roomEmptied(roomKey)` (volatile directory; WorldRoom re-registers each lease-renew beat, so an evicted directory self-heals ≤10s), `markPartyCompleted()`.
- State pushes to world rooms go via `this.room.call(roomKey → worldRoom, "installAdventureState", state, version)` — install carries the `>=` version guard and never throws (spec invariants).

Steps: failing tests — applyStateChanges bumps version and lands in D1 immediately (read the row back, no clock advance); out-of-order double push keeps newer version; quest accept/complete fenced (stale epoch actor mutates nothing); implement; commit `feat: party room — write-through adventure state and quest coordination`.

### Task 4: WorldRoom α — resolveJoin, admission, movement, snapshots

**Files:**
- Create: `packages/server/src/api/realtime/WorldRoom.ts`
- Create: `packages/server/src/api/controllers/JoinController.ts`
- Test: `packages/server/test-api/world-room-admission.test.ts`, `packages/server/test-api/world-room-movement.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3, entities, `@lindocara/engine` (`simulation`, `protocol`, `close-codes`), legacy port sources `index.ts:392-505` (admission), `world.ts` (`fetch` :724-925, `#advanceTick` :4259+ movement slice), world systems `movement-system.ts`, `interest-system.ts`, `snapshot-system.ts`, `connection-system.ts`, `world-runtime.ts`.
- Produces:
  - `GET /api/join?party=<uuid>&hero=<uuid>` (`JoinController.resolveJoin`, `$secure({})`): runs the legacy admission reads (membership via parties/partyMembers, test-session access, hero ownership, adventure, map membership + `resolveAdventureStart` fallback) and returns `{ roomId: "partyId:mapId", channelPath: "/ws/world" }` or the legacy error codes (`missing_hero`/`invalid_hero`/`forbidden`/`not_found`). It performs NO presence acquire — that happens in `onJoin`.
  - `WorldRoom = $room({ channel: worldChannel, tickHz: 20, state, onJoin, onMessage, onTick, onLeave, onEmpty })`, roomId `partyId:mapId`.
  - `onJoin` (async): `conn.userId` must exist (else `room.close(conn.id, 4004)`); client passes `?party&hero` in the ws URL query — REDERIVE everything from D1 exactly as `resolveJoin` does and verify the hero's current map matches this room's mapId (else close `INVALID_LOCATION 4007`); `presenceRoom.call(heroId, "acquire", …)` (fail → `PRESENCE_ERROR 4005`); reload profile, epoch+zone must match (else 4005); room-full check `maxPlayers` → `ROOM_FULL 4006`; build the runtime `Player` (`newPlayer` from `world-runtime.ts`), register in state maps + spatial grid, `partyRoom.call(partyId, "registerRoom", roomId)`, send `welcome` (port of the legacy welcome assembly), then the wake event.
  - `onMessage`: app-level caps FIRST (frame bytes ≤2048 → close 1009; rate window 35/1000ms and malformed >5 → close 1008 — counters in `conn.data`), then `parseClientMessage(raw)`; null → malformed++. `input` messages enqueue (cap `MAX_QUEUED_COMMANDS 12`); this task dispatches `input` + `world.resync` only (other intents land in Tasks 5/7).
  - `onTick` (sync): this task's slice — consume one command per player (`movement-system.advancePlayers` with its injected context: `renewPresence` batched every 200 ticks/10s which ALSO re-registers on the party directory, `savePlayer` stub until Task 6), then every 2nd tick `snapshot-system.broadcastNetworkUpdates` with `interest-system.viewForPlayer`, then queued-resync flush (1/s cooldown).
  - `onLeave`: release presence (fenced save arrives Task 6), remove from state/grid.
  - `state()`: the room-runtime container (players by connectionId, monsters/guards/loot/projectiles arrays EMPTY until Task 5, grids, tick counter, map geometry loaded from D1 via the MapService read path — `TerrainGeometry` derived exactly as legacy `map-zone.ts` does).
- Test harness (from the Alepha recon, reuse verbatim): real-server idiom — `Alepha.create().with(AlephaWebSocket).with(LindocaraApi)`, register+login via HTTP, `resolveJoin`, then `new WebSocket(host + "/ws/world?roomId=…&party=…&hero=…")` with the session cookie; assert `welcome` arrives, a `{t:"input"}` moves the player (ack echoes seq), a hero on another map gets closed 4007, an unauthenticated socket gets closed 4004. For deterministic ticks use the FakeClock `RoomClock` idiom (`RoomEngine.spec.ts:14-42`) in a second, engine-level test file.

Steps: failing admission tests → implement onJoin/resolveJoin → failing movement test (one-command-per-tick: flood 5 inputs in one tick-advance, exactly one applied, ack = its seq) → implement onMessage/onTick slice → commit `feat: world room α — admission, movement and snapshots on alepha`.

### Task 5: WorldRoom β — full tick order

**Files:**
- Modify: `packages/server/src/api/realtime/WorldRoom.ts`
- Create: `packages/server/src/api/realtime/worldTick.ts` (the ordered tick function, kept out of the room shell)
- Test: `packages/server/test-api/world-room-combat.test.ts`

**Interfaces:**
- Consumes: every system in `packages/server/src/world/` (all recon-verified pure with injected contexts EXCEPT `connection-system` (WebSocket-keyed maps — key by `connectionId` string instead, adapting the context you build, not the system, unless a 2-line generic makes the system key-agnostic — prefer the latter, it's the kind of edit the systems' AGENTS.md sanctions) and `persistence-system` (Task 6)).
- Produces: `advanceWorldTick(room, deps)` reproducing the legacy order verbatim (`world.ts:4259-4421`): consumable effects → rogue expirations → damage-over-time → players → npc events → held-action ends → adventure exits → combat actions (players) → warrior cyclones → sanctuaries → projectiles → monsters → combat actions (monsters) → guards → expired loot → event-run drain (stub until Task 7) → every 2nd tick deltas + party-state broadcasts → queued resyncs. Zone runtime init (monsters/guards from the map's authored data) ports from `zone-runtime.ts` usage into `state()`.
- `onMessage` grows the remaining combat/consumable intents: `attack`, `skill`, `skill.release`, `release`, `interact`, `talent.unlock`, `talent.reset`, `use`, `item.use`, `merchant.buy`, `chat` (local channel in-room; `party` channel → `partyRoom.call(partyId, "broadcastToParty", …)`), `navigation.debug`.

Steps: failing tests ported from the legacy invariant suite (FakeClock): attack consumes cooldown even on miss; monster strike direction frozen at wind-up; guard kill grants no XP/loot (`guard-kill-sans-reward`); dead players skipped by monsters; personal loot omitted from another player's delta (AOI). Implement by wiring, not rewriting — any system that needs a code change beyond dependency-shape adaptation is a STOP-and-report. Commit `feat: world room β — full authoritative tick order`.

### Task 6: Persistence + fencing

**Files:**
- Create: `packages/server/src/api/services/HeroSaveService.ts`
- Modify: `packages/server/src/api/realtime/WorldRoom.ts` (save queue wiring, onLeave)
- Test: `packages/server/test-api/world-room-persistence.test.ts`

**Interfaces:**
- Consumes: legacy `persistence-system.ts` + `hero-profile.ts` as the behavior source; tranche-1 hero-family repositories.
- Produces: `HeroSaveService.saveHero(profile, sessionEpoch): Promise<"saved"|"stale">` — hero core + normalized children (items, equipment, skills, quests, cooldowns) in one epoch-fenced write set: every statement carries `WHERE session_epoch = ?` (or the EXISTS fence for children — port the legacy fence shape exactly; single-statement style per the tranche-1 D1 discipline, chunked where bulk). WorldRoom: dirty-hero save every `D1_SAVE_EVERY_TICKS 100` (5s), forced save on `onLeave` and before handoff; a `"stale"` result invalidates local authority and closes the socket `PRESENCE_LOST 4003` (legacy `#drop`/stale-save semantics).

Steps: failing tests — moved player's position lands in D1 within one save beat (FakeClock advance 100 ticks); stale epoch (bump via a second `acquire`) → save returns "stale", zero rows changed, socket closed 4003; disconnect saves immediately. Implement; commit `feat: epoch-fenced hero persistence for the world room`.

### Task 7: Events, quests and adventure-state round-trip

**Files:**
- Modify: `packages/server/src/api/realtime/WorldRoom.ts`, `worldTick.ts`, `PartyRoom.ts`
- Test: `packages/server/test-api/world-room-events.test.ts`

**Interfaces:**
- Consumes: `event-run-system.ts` (pure, produces `DispatchEffect`s), engine interpreter, PartyRoom methods (Task 3).
- Produces: trigger detection in the interact/movement paths (`action` / `player-touch`, `normal`-kind with satisfied page — port from world.ts), `#drainEventRuns` slot in the tick (budget `EVENT_COMMANDS_PER_TICK 16`, round-robin), dialogue buffering per triggerer (`event.say`/`event.choices`/`event.close` to that hero's socket only, walk-away close at `DIALOGUE_CLOSE_RADIUS`), `mutateState` effects → `partyRoom.call(partyId, "applyStateChanges", batch)` with the drain-local working copy (spec contract: a run reads its own writes same-tick; the drain pauses until the coordinator push lands, simulation keeps ticking), `installAdventureState(state, version)` room method with `>=` guard + never-throws + page re-evaluation on install and on join (never per tick), `world.delta` events member, `event.advance`/`event.choose`/`quest.action`/`quest.abandon` message dispatch, authored-quest RPC round-trips.
- Proven end-to-end (the spec's own proof obligations): two heroes triggering one gold chest same tick → ONE grant; an authored infinite loop consumes its 16-command slice and the room keeps ticking (bounded assertion, never a hang); walk-away abandons the remainder without rolling back writes.

Steps: failing tests for those three proofs + a cross-room state flip (hero in room A flips a switch; room B's active page changes after the push). Implement. Commit `feat: event interpreter and adventure state round-trip on alepha rooms`.

### Task 8: Map transitions

**Files:**
- Modify: `packages/server/src/api/realtime/WorldRoom.ts`
- Test: `packages/server/test-api/world-room-transition.test.ts`

**Interfaces:**
- Consumes: PresenceRoom.handoff (Task 2), HeroSaveService (Task 6), exit detection already ticking (Task 5's `#detectAdventureExits` port).
- Produces: the legacy choreography verbatim (`world.ts:3700-3737`): mark transitioning + deauthorize, clear queue, cancel combat action, checkpoint cooldowns, forced fenced save, `presenceRoom.call(heroId, "handoff", { mapId, x, y, … })` (null → abort transition, restore authority), remove player, close socket `ZONE_TRANSITION 4008`. Client rejoins via `resolveJoin` (which now reads the NEW map from D1).

Steps: failing test — hero walks onto an exit; socket closes 4008; D1 shows new map + epoch N+1; a reconnect via resolveJoin lands in the destination room with the saved position; a stale handoff (epoch raced) aborts without corrupting. Implement. Commit `feat: fenced map handoff between alepha world rooms`.

### Task 9: Client cutover α — auth + api endpoints

**Files:**
- Modify: `packages/client/src/api.ts`, `packages/client/src/ui/AuthScreen.tsx`, `packages/client/src/guest.ts`
- Test: existing jsdom suites under `packages/client/test/` (adapt fixtures/mocked fetches to the new routes)

**Interfaces:**
- Consumes: tranche-1 HTTP surface (routes unchanged: `/api/maps`, `/api/adventures`, `/api/parties`, `/api/parties/:id/heroes`, `/api/adventures/:id/test-sessions` — the client's existing paths mostly already match). What CHANGES: register = `POST /api/users/register` then `POST /api/users/register/complete` (two-phase — port the exact call sequence from `packages/server/test-api/auth.test.ts`), login = `POST /_auth/token?provider=credentials`, logout = `POST /oauth/logout` (verify exact route in the auth constants), me = `GET /_auth/userinfo` (map its user shape to the old `{id, username}`).
- Error mapping: alepha errors carry the machine code in `error` — the client's `errorCode()` already reads that field; extend `ERROR_KEYS` only where alepha emits codes legacy didn't (e.g. validation 400s) with sensible fallbacks.
- Produces: a client that, against `npm run dev` (alepha), can register → login → list/create adventures, parties, heroes — verified by the adapted jsdom tests plus a manual curl-equivalent check.

Steps: adapt tests first (they encode the new contract), then api.ts/AuthScreen/guest.ts, run `npm run test:client` + `npm run typecheck:client`. Commit `feat: client on alepha auth and api`.

### Task 10: Client cutover β — net.ts on the Alepha wire

**Files:**
- Modify: `packages/client/src/game/net.ts` (URL + envelope only), `packages/client/src/game/session.ts` (join flow calls resolveJoin)
- Test: `packages/client/test/net-wire.test.ts` (new, jsdom)

**Interfaces:**
- Consumes: `GET /api/join` (Task 4), the wire envelope (client→server frames wrap as `{ roomId, message }`; server→client frames carry a `__alephaRoom` transport key to strip before `parseServerMessage` — recon-verified in `WebSocketClient.ts:68,440-445`).
- Produces: `connect()` calls `resolveJoin` → opens a RAW `new WebSocket(ws(s)://host/ws/world?roomId=<roomId>&party=<partyId>&hero=<heroId>)` (browser cookies carry the alepha session — recon-verified). `#send` wraps the envelope; `#handle` strips `__alephaRoom`. Everything else in net.ts (seq/ack, prediction, interpolation, resync) untouched. `session.ts`'s close-code reconnect table (4008 immediate rejoin via a FRESH `resolveJoin`; terminal codes; exponential backoff) is preserved exactly — this is WHY we bypass Alepha's `WebSocketClient` (it hides close codes and reconnects on a fixed interval; noted as an upstream feature request in a code comment).

Steps: failing jsdom test with a mock WebSocket asserting the envelope shape both directions and the resolveJoin-then-connect sequence; implement; then the real verification — `npm run dev` + playwright (playwright-cli skill) driving title → login → create party → create hero → WASD movement with server ack (the dev `window.__lindocara` hook measures ack). Run `npm run check:runtime`. Commit `feat: game client on the alepha websocket`.

### Task 11: Loadtest port + playable smoke + docs

**Files:**
- Modify: `scripts/loadtest.mjs` (auth flow + ws URL + envelope), `AGENTS.md`, `packages/server/AGENTS.md`
- Test: `npm run v` (full) + loadtest run

**Interfaces:**
- Consumes: everything.
- Produces: loadtest provisions through the alepha `/api/*` (register two-phase, login cookie), connects via `resolveJoin` + `/ws/world`, sends only legal intent — same discipline, localhost default. Docs: AGENTS.md flips the authority statement (`npm run dev` IS the playable game now; legacy = rollback only until the cleanup tranche), commands table updated, server AGENTS.md documents `src/api/realtime/` and the three rooms + the volatile-state caveats. Memory-worthy leftovers for the cleanup/deploy tranche listed at the bottom of the plan's ledger by the controller, not in the docs.

Steps: port loadtest; run `npm run loadtest -- --players=8 --duration=30 --scenario=mixed` against `npm run dev` (expect ack latency in the same order as legacy's local runs); full `npm run v`; playwright smoke of a two-player party (two browser contexts, mutual visibility + a monster kill with loot); docs; commit `docs: realtime tranche — alepha is the playable stack` (code fixes, if any, committed separately first).

---

## Verified recon findings the executor must know

1. **Channel schemas are NOT the parser.** Alepha validates loosely; `parseClientMessage`/`encodeServerMessage` from engine stay the only wire truth. Client frames arrive wrapped `{roomId, message}`; server frames must be sent raw (the room stamps `__alephaRoom`).
2. **`conn` carries only `userId`** (from the session cookie at handshake). Hero/party identity comes from the ws URL query, re-validated in `onJoin` against D1. `$room secure` is Node-only — the room enforces auth itself by closing 4004 when `userId` is absent.
3. **`room.close(connectionId, code, reason)` supports custom codes** — the 4001-4008 vocabulary ports cleanly.
4. **Headless room state is volatile** (Node 5-min idle sweep; CF eviction, no storage/alarm APIs). PartyRoom is write-through to D1; PresenceRoom lease loss degrades to a 4003 kick; both documented in docblocks.
5. **The tick stops when the room empties and state is recreated on next join** — matches the legacy empty-room reset semantics (temporary monsters/loot reset).
6. **No built-in caps**: frame size, rate, malformed — all app-level in `onMessage` (constants from `world-runtime.ts:72-81`).
7. **An async `onTick` slower than its period skips beats** — keep it synchronous end-to-end.
8. **Test idioms**: real-server (`room-integration.spec.ts:20-91`), FakeClock `RoomClock` (`RoomEngine.spec.ts:14-42`) — use FakeClock for every timing assertion; never `sleep` for tick counts.
9. **CF build gap**: `$room`-only apps get no DO wiring (`BuildCloudflareTask` reads `$websocket` only). Deploy-tranche prerequisite, not this tranche's problem — do NOT add speculative `$websocket` declarations here.

## Explicitly deferred (NOT this tranche)

- React shell refactor ($page router, atoms, useAuth hooks, alepha i18n) — next tranche. zustand and both UI trees untouched.
- Legacy retirement (world.ts, game-session.ts, DOs, wrangler.jsonc, drizzle, old auth) — cleanup tranche.
- CF deploy, DO wiring fix (upstream or paired $websocket), migrations baseline, D1 provisioning — deploy tranche.
- Guest/rollback `?character=` flow — dies with legacy; not ported.
- Observability metrics parity (`world_metrics` windows) — deploy tranche.
