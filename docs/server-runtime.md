# Server runtime: world systems, rooms, presence and limits

The authoritative half. `WorldRoom` owns the mutable room state and `worldTick.ts` composes the
beat order; everything below is what those beats call and what fences them.

**What a beat DOES lives beside `worldTick.ts`, not inside it** — `world-glue.ts` (the shared
`WorldGlue`/`WorldTickDeps` seam and the room accessors), `world-send.ts` (everything the room
sends), `world-move-life.ts` (`applyReportedMove`, drowning, death, corpse, loot),
`world-combat.ts`, `world-actions.ts` (the action timeline and class variants) and
`world-interactions.ts` (interact, consumables, talents, chat, cheats, authored events, quests).
`worldTick.ts` itself is the tick order and nothing else.

### Server world systems

`WorldRoom` (`packages/server/src/api/realtime/WorldRoom.ts`) is the room entry point and owns
every mutable room collection and timer; `worldTick.ts` composes the readable tick order it runs.
Modules under `packages/server/src/world/` are concrete domain systems, not an ECS:

- `world-runtime.ts` defines player, monster, guard, loot and room runtime types plus attachment
  hydration/serialization and entity factories.
- `connection-system.ts` maintains socket/player indexes and connection rate windows.
- `movement-system.ts` no longer moves anyone: the hero's rule runs on the client and
  `applyReportedMove` (`world-move-life.ts`) is where a position changes. What it kept is the per-player
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
Close codes keep the 4001-4009 vocabulary (`engine/close-codes.ts`); 4009 is the browser-only,
retryable signal for a malformed server frame.

`PartyRoom` (headless, roomId `partyId`) coordinates the room directory and party-wide
broadcasts. Simulation is sharded into `WorldRoom` instances addressed by `partyId:mapId`; each
owns only that room's players, monsters, loot, timers, navigation and local chat. Persistent
party chat and victory fan out through `PartyRoom`. This sharding preserves the session isolation
invariant. Compiled catalogue zones remain test content.

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
[`docs/cooperative-combat.md`](./cooperative-combat.md) for formulas and resource costs.

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
[`docs/monster-navigation.md`](./monster-navigation.md) for generation, budgets, debug mode and
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
