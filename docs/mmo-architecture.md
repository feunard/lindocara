# LindoCara MMO architecture

This document is the operational map of the current MMO foundation. The invariant behind every
section is that the server decides outcomes and mutable room state belongs to one Durable Object.

## Request, zone and room routing

The Worker in `src/server/index.ts` is the only public API entry point. It verifies the signed
session, proves account ownership of the selected character, loads the character location from D1,
and resolves that location through `src/shared/zones.ts`. Neither a query parameter nor a
WebSocket frame can select a zone or instance.

A room name is deterministic: `<zoneId>:<instanceId>`, for example `verdant-reach:main`. The Worker
calls `WORLD.getByName(roomKey)`. This avoids a global room registry. Each `World` owns only its
players, monsters, guards, loot, parties, navigation queue, spatial indexes, timers, network
baselines, and metrics. No mutable room state is global.

## Transitions and character locking

Portals are immutable zone-catalogue entries. A client sends `interact`; the source room checks
proximity and cooldown, freezes the character, clears queued commands, and performs a fenced save.
`CharacterPresence`, addressed by character UUID, atomically writes the destination and epoch N+1.
The source removes the player and closes with `ZONE_TRANSITION`; the reconnecting Worker reads the
new D1 location.

D1 owns the monotone `session_epoch`; the presence object owns the live lease. Acquisition replaces
a previous owner, renewal keeps a socket authoritative, and every save includes the epoch
predicate. A stale room cannot overwrite a newer room. Disconnect and transition remove threat,
contribution, and temporary party membership.

## Simulation, spatial grid, and interest

Simulation runs at 20 Hz. One sequenced movement command is consumed per player per tick; replayed
or older sequences are ignored. Short starvation repeats the last intent for at most five ticks.
Shared pure movement and collision rules drive both server authority and client prediction.

Each room maintains disposable 256 px spatial grids; authoritative collections remain the source
of truth. Entries are inserted on creation, updated after authoritative movement, and removed on
destruction or expiry. Radius queries build recipient-specific views for players, monsters, loot,
guards, corpses, spatial events, and local chat. Self is unconditional and a 96 px exit hysteresis
avoids border flicker.

## Deltas, client cache, and reconciliation

`welcome` is a full area-of-interest baseline. Simulation stays at 20 Hz while `world.delta` runs
at 10 Hz. Per-recipient maps compare current state with the last state actually sent and produce
typed upserts/removals. Personal loot is removed before the diff, so it cannot leak through a full
view or delta.

The client validates each frame, applies deltas to entity maps, materializes a complete view, then
appends it to the interpolation buffer. Invalid or incoherent deltas trigger one bounded
`world.resync`; the server enforces one resync per second. Remote entities interpolate 150 ms in
the past. For self, commands through the ACK are dropped and the remainder are replayed over the
authoritative position. Ghost speed is part of the same contract.

## Persistence, objects, skills, and quests

D1 and Drizzle own durable account and character data. Core location, stats, currencies, life, and
fencing epoch stay on `character`. Possessions, equipment, skills, and quests use
`item_definition`, `character_item`, `character_equipment`, `character_skill`, and
`character_quest`. Migration `0008` backfills existing items/equipment/skills/quest progression;
`0009` adds the claim fence used by cooperative reward attribution.

Quantities are positive, equipment must reference an item owned by the same character, and
slot/class compatibility is checked server-side. Potion consumption is a conditional D1 decrement
inside a per-character mutation chain. Quest rewards use one-time conditional claims. Several
quest rows may coexist while the current chain is adapted into one gameplay-facing state.

To add an item, define its stable id, type, stackability, maximum stack, and compatibility in
`src/server/items.ts`, seed it through a migration, then cover ownership, use/equipment, and
reconnection. To add a slot, extend the shared type, D1 constraint, and compatibility resolver
together. To add a quest, add a stable definition and localized text, persist one quest row, and
make its rewards idempotent.

## Threat, contribution, rewards, and parties

Combat actions are directional and server-owned. Clients send an attack or skill slot without an
entity id; the room freezes authoritative facing, resolves the active frame once, and advances
swept projectiles against terrain and spatial indexes. Threat still chooses an internal monster AI
opponent, but it does not expose or restore player targeting.

Every monster owns bounded threat and contribution maps. Damage, useful healing, taunt, and initial
proximity contribute through `src/shared/cooperation.ts`. Dead, disconnected, out-of-zone,
distant, or expired entries are pruned. Highest valid threat wins deterministically; warrior taunt
raises threat above the current leader without replacing ordinary damage gameplay.

Death eligibility combines meaningful contribution with proximity/presence. XP follows the
explicit split rule and attribution is fenced against duplicate processing. Loot is personal:
owner UUID is checked during both AOI construction and collection. Overhealing produces neither
threat nor contribution.

Parties are room-local and non-persistent. A leader creates, invites, kicks, or dissolves; accepting
requires a matching live invite and a character may belong to one party only. Party chat and
same-zone HP go only to members. Disconnect or transition removes membership. There are no raids,
guilds, matchmaking, or cross-room party coordinator.

## Navigation

Each zone supplies navigation configuration beside authoritative terrain. A walkability grid is
generated from colliders and incremental four-neighbour A* runs under a room node budget. Paths are
cached, requests are unique and queued, movement must cross a threshold, and a minimum repath
interval prevents per-pixel recalculation. Collision resolution remains final authority.

Monsters patrol, acquire by threat, chase, reach attack range, abandon unreachable or over-leashed
targets, and return to spawn. Development-only snapshots expose path, destination, state, and
abandonment reason when `NAVIGATION_DEBUG=true`; production leaves it disabled.

To add a zone, add one catalogue entry containing terrain, capacity, quests, spawns, portals, and
navigation parameters. Add reciprocal transition coverage, walkable spawn/portal assertions, and
a navigation test. Do not add a zone-name branch to the engine.

## Adding entities and messages

For a dynamic entity, define its runtime type, keep its mutable collection in `World`, add lifecycle
updates to a narrow domain system, index it when AOI needs it, and define its snapshot/delta shape.
Private state must be filtered before snapshot generation, never merely hidden by the renderer.

For a client message, add a narrow protocol union and defensive parser, reject non-finite values,
oversized strings and invalid UUIDs, dispatch only intent, and apply a dedicated cooldown to
expensive work. For a server message, add strict parsing, cache application, and resync semantics.
Player prose stays in both i18n dictionaries. Add protocol rejection and real Durable Object tests.

## Observability

`src/server/world/observability-system.ts` owns a room-local 20-second window. One structured
`world_metrics` record includes:

- tick count, average, approximate p95, maximum, overruns, and exceptions;
- current players, monsters, and loot;
- sent messages/bytes plus average and maximum delta size;
- successful D1 saves and errors;
- saturated command queues, oversized/malformed frames, rate-limited sockets, and throttled resyncs;
- navigation paths and expanded nodes;
- successful transitions and room reconnections.

Individual actions are not logged. Exceptional tick and presence failures remain structured.
`wrangler.jsonc` retains custom aggregate logs, disables noisy invocation logs, and samples traces
at 1%. Alert on tick overruns, D1 errors, queue saturation, reconnect spikes, and delta growth.

## Load tests

With the local stack running:

```bash
npm run loadtest -- --players=50 --duration=60 --scenario=mixed
```

Scenarios are `idle`, `movement`, `combat`, `mixed`, `reconnect`, and `zone-transition`. The runner
creates/reuses accounts, two-map adventures, parties and heroes through the real API, keeps cookies,
opens `/api/ws?party=...&hero=...` WebSockets, sends 20 Hz sequenced inputs and scenario actions, and
reports connection rate, unexpected closes, messages/bytes per second, message sizes, ACK
average/p95/maximum, transitions, protocol errors, setup time, and actual duration. Accounts are
grouped four per party so the run crosses `HeroPresence`, `GameSession`, current room routing and
normalized hero persistence instead of the rollback character seam.

The default target is localhost. Remote execution requires `--allow-remote=true`; the production
hostname additionally requires `--allow-production=true`. Prefer staging for remote capacity work:
local workerd validates application behavior and relative load, not global edge latency or billing.

## Security audit

Implemented boundaries:

- 4 KiB streamed account/character JSON and 2 KiB WebSocket frames;
- defensive unions, boolean movement axes, safe positive sequences, and UUID identifiers;
- 35 messages/s per connection, bounded command queues, and one resync/s;
- authoritative action/resource/transition cooldowns and server-owned portal destinations;
- signed HttpOnly SameSite cookie, seven-day expiry, and live account check;
- presence lease and epoch fencing against double connections and stale saves;
- conditional owned/idempotent inventory, equipment, quest, reward, and loot mutations;
- validated room keys, room-owned state, spatial chat, and owner-filtered personal loot;
- navigation repath thresholds, queue limit, cache, and node budget.

Tests cover malformed/oversized traffic, invalid ids, replayed commands, stale presence,
unauthorized equipment, double potion use, duplicate reward attribution, forged party invites,
private loot, and navigation budgets. The remaining public-edge gap is credential-abuse protection
by source (Cloudflare rate limiting and/or Turnstile); a room limiter cannot stop distributed login
attempts. Review CSP/browser security headers before public promotion. `npm audit` remains a release
check, but development-tool advisories should not be “fixed” through blind breaking downgrades.

## Current limits and next scale boundary

Rooms are single Durable Objects with a fixed 20 Hz loop and JSON fan-out. Parties do not cross
rooms, pathfinding is a simple grid, and D1 persistence is periodic rather than event-sourced. The
test zone capacity is intentionally two and Verdant Reach is 48, so a 50-client single-room run
should expose capacity rejection rather than bypass it.

The next boundary is deterministic instance allocation plus a small coordinator for room capacity
and cross-room party presence, not a larger global `World`. Then run production-like staging load
tests with analytics export, percentile dashboards, and explicit SLOs before increasing room caps.
