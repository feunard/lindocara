# lindocara

**LindoCara** is a modern creator for cooperative 2D RPG adventures, built on the
[Alepha](https://alepha.dev) framework — Node locally and on self-hosted Alepha Bay — and
designed for one to four players. Builders will assemble complete adventures from connected
maps, authored scenery and, in later milestones, events, dialogue, quests, conditions and
cinematics. Players will be able to start alone, join a running game, save it and resume it later.

The primary flow is now a persistent authored adventure: title, login, saved parties, party heroes,
then the authoritative game runtime. A creator can connect account-owned maps into an adventure,
place monsters and entry/exit markers, create a party for one to four players, and resume each
hero's last map, position and core stats later. The compiled **Verdant Reach** content remains
test and reference content, not the product entry point. The whole
UI is localized in French and English, with a live toggle.

**Live:** [lindocara.bay.alepha.dev](https://lindocara.bay.alepha.dev)

## Stack

TypeScript · Alepha (server, realtime rooms, ORM, router) · Vite · PixiJS · React 19 ·
Tailwind v4 · Radix/PixelAct UI · Zustand · Alepha Bay + SQLite in production · Biome · Vitest

The HUD, player screens and overlays use accessible React/Radix structure with a strong Tiny Swords
identity. Map and adventure editors deliberately use denser, sober tool surfaces: compact forms,
lists, panels and inspectors take priority over pixel-art chrome, while Tiny Swords remains visible
in asset previews and map thumbnails. The PixiJS canvas stays outside React; components communicate
with game code only through narrow handles and the Zustand store.

## Asset provenance

The three **Tiny Swords** packs by Pixel Frog are LindoCara's visual source of truth for terrain,
buildings, characters, enemies, resources, effects, cursors and all interface chrome. Their source
files live under `assets/Tiny Swords (Free Pack)`, `assets/Tiny Swords (Update 010)` and
`assets/Tiny Swords (Enemy Pack)`. `assets/index.json` is the generated technical inventory;
`assets/lindocara-asset-catalog.json` is the semantic catalogue used by the product. The repository
does not restate licence terms for these packs: consult the original purchase/download terms before
redistributing them or distributing a build. See `assets/README.md` for the neutral provenance note.

No external runtime asset URLs are used. Legacy atlas entries remain only where the Tiny Swords UI
migration report explicitly documents a temporary exception.

## Quick start

The package manager is **Yarn 4**, pinned by `packageManager` in the root `package.json` and
installed by corepack — once per machine:

```bash
corepack enable
```

```bash
yarn install
yarn dev
```

`yarn dev` runs the whole app (`alepha dev`) on Node: the API, auth, the realtime world rooms
and the SPA shell, over a local SQLite database whose schema is auto-synced from the entity
definitions. No secrets or migration step are needed locally.

It always serves **<http://localhost:5273>** — this project's dedicated dev port, pinned with
`strictPort` in [`apps/main/vite.config.ts`](./apps/main/vite.config.ts) so it never drifts onto a
neighbouring port. Every local tool that talks to the running app (the seed and import/export CLIs,
the load test, `.claude/launch.json`) defaults to that address. A startup failure saying the port is
taken means a stale dev server is still running — stop it rather than starting a second one
somewhere else.

```bash
yarn v             # the full verify pipeline (lint, typecheck, tests, drift/content checks, build)
yarn check:runtime # lint + typecheck + runtime server/player UI tests + build
yarn check         # full repository gates, including catalog and authored-map checks
yarn deploy        # alepha platform up -e production (CI does this on every push to main)
```

## Local load testing

Start the local stack, then run a scenario from another terminal:

```bash
yarn dev
yarn loadtest --players=10 --duration=60 --scenario=mixed
```

Available scenarios are `idle`, `movement`, `combat`, `mixed`, `reconnect`, and
`zone-transition`. The runner creates or reuses deterministic `loadNNN` accounts, groups them into
parties of up to four, provisions two-map adventures with nearby monsters, creates party heroes,
resolves admission through `GET /api/join?party=...&hero=...` and opens `/ws/world` room
WebSockets. It prints connection, throughput, message-size,
acknowledgement latency, transition, disconnect, and protocol-error metrics. It targets
`http://localhost:5273` by default and refuses any remote target unless
`--allow-remote=true` is explicit; the production hostname needs the additional
`--allow-production=true` safeguard. Each scenario uses its own resumable party so durable combat
or death state cannot contaminate a later reconnect or transition run.

## How it works

The client sends **intent** — "I'm holding right" — and never a position. Cheating by editing
your own coordinates is impossible, because you never send coordinates.

Each input is stamped with a sequence number, one per simulation tick. The server's world room
runs a 20 Hz loop, applies **exactly one command per player per tick**, and broadcasts a snapshot
along with the highest sequence number it has applied. Applying one per tick is what makes the
tick rate — rather than how fast you can send packets — the speed limit.

Your own square does not wait for any of that. The client applies your input locally the frame
you press a key, then reconciles: when a snapshot arrives it takes the server's position and
replays whatever commands the server hasn't acknowledged yet. Agreement means nothing visibly
happens; disagreement is smeared over ~100 ms rather than snapping. Measured input latency is
**one frame** (~7 ms), down from ~124 ms before prediction.

Everyone *else* is drawn ~150 ms in the past, interpolated between the two snapshots bracketing
that instant — you can't know where a remote player is right now, and guessing looks worse than
being slightly late.

All of this hangs on `step(position, input, dt)` and `resolveTerrain()` in `packages/engine/src/` being
pure functions that the server and the client both call. Reconciliation is only correct because
movement and collision are literally the same code on both sides.

The same rule applies to combat and progression: the browser asks to use a skill, interact, use a
potion, or chat. It never selects a combat entity. The server freezes the hero's last
server-validated movement direction, runs anticipation/impact/recovery, advances swept projectiles,
and decides collisions, damage, healing, threat and rewards. The client never sends positions,
victims, impacts, damage, healing, XP, loot, deaths, or quest completion.

Movement lives in `packages/engine/src/simulation.ts`; map geometry, collision, combat constants, and
progression formulas live in `packages/engine/src/game.ts`. They are platform-free and directly tested.

## Play

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Space / 1 | Directional basic action |
| 2–5 | Class skills in the hero's facing direction |
| E | Interact with Warden Mira |
| Q | Use a potion |
| R | Release a corpse as a ghost |
| M | Open the map |
| Enter | Focus chat |
| FR/EN button | Switch language |

New players begin in the sanctuary beside Warden Mira. The current quest chain crosses the whole
map through **The Three Offerings**, **The Bone Choir**, **Runes of the Mire**, and **The Ward
Run**. It combines ordered gathering, monster hunting, a rune sequence, and a clearly timed ward
course before each chapter's reward is claimed from its keeper.

Heartroot Crossing is a real protected town: a wide east-west main street, a civic crossing,
central arrival plaza, guildhall, sanctuary, market homes and eastwatch barracks. All four quest
keepers live in those districts. Four yellow-clad city guards patrol only inside the safe zone.
A border monster can physically enter, but guards intercept it server-side; a guard kill grants
no player XP, quest credit or loot. Direction boards point toward the forest, farm, marsh, ruins
and gate and are intentionally non-blocking so crossroads remain readable.

World-space text is reserved for immediate combat numbers, important heals and level-ups. Loot,
quest, interaction, presence and transition messages stay in the event log. Ordered rune sites no
longer pulse the expected answer: their distinct glyphs and the quest clue communicate the rule,
while success/error feedback appears only after interaction.

Each party hero is one of five classes, picked inside its saved party: warrior, ranger, priest,
rogue, or Peasant. The first four cover the direct combat roles; the Peasant trades raw damage for
authoritative harvesting, shared crafting materials, camps, rations, and homemade bombs. Attacking
empty space is valid; enemies can move out before the active frame and projectiles can miss or hit
terrain. A member's persistent colour slot selects the matching Tiny Swords unit variant. See
[`docs/peasant-runtime.md`](docs/peasant-runtime.md) for the Peasant's persistence, authoring, and
support contracts. Tab is intentionally unbound and reserved for a future mechanic; it no longer
cycles combat targets.

## Database

The database (SQLite locally and in production, through the Alepha ORM) stores users,
account-owned revisioned maps, adventures, persistent parties/members and heroes. The
`$entity` definitions in `packages/server/src/api/entities/` are the single source of truth; dev
auto-syncs the schema, and committed migrations under `apps/main/migrations/` carry it to
production. The party is the saved playthrough; a hero belongs to both that party and its user.
Hero map, position, level, XP, HP, life/corpse state, inventory, equipment, skills, personal
quest progress and fencing epoch are saved periodically, on disconnect and at transitions. Shared
authored-quest state belongs to the party, while unique reward claims make delivery consumption
and XP/gold/item rewards idempotent.

```bash
yarn workspace @lindocara/main run db:generate        # entity change -> apps/main/migrations/
yarn workspace @lindocara/main run check:migrations   # fail on entity/migration drift
```

Production migrations run automatically when the Bay process boots, before it serves the new code.

## Deployment

Pushing to `main` runs the full check suite and then deploys through GitHub Actions. One
`alepha platform up -e production` builds the bare Node artifact, packs the service, assets and
migrations, uploads them through bay-admin and pushes the allowlisted secrets. The Bay process
applies migrations at boot.

Required repository secrets:

| Secret | Where to get it |
| --- | --- |
| `BAY_API_KEY` | bay-admin API key for a user with the `admin` role |
| `APP_SECRET` | generate one: `gh secret set APP_SECRET --body "$(openssl rand -base64 48)"` |

The public domain `lindocara.bay.alepha.dev` and the bay-admin control endpoint are declared in
`apps/main/alepha.config.ts`. The old `lindocara.alepha.dev` Worker is a frozen legacy deployment,
not the live application.

## Sessions

Auth is Alepha's user system with a username+password credentials realm: registration is
two-phase under `/api/users/register`, login exchanges credentials at
`/_auth/token?provider=credentials`, and the browser holds an encrypted `HttpOnly` session
cookie. The game server never sees a password. Joining a game is two steps: `GET
/api/join?party=<partyId>&hero=<heroId>` returns a room hint, then the browser dials the
`/ws/world` room, which re-verifies user, party membership, hero ownership, adventure, saved map
and position before admission. The browser never supplies a map or authoritative position.

A per-hero presence room acquires the hero lease and advances its database-backed epoch. A newer
connection replaces the previous one, and every save is conditional on that epoch
(`WHERE session_epoch = ?`), so a stale room cannot overwrite the current hero.

## Maps, rooms and sessions

A party coordinator room is addressed by `partyId`. It coordinates the party-wide room directory
and broadcasts while authoritative simulation is sharded into world rooms addressed by
`partyId:mapId`. This keeps two parties on the same authored map completely isolated and lets
players in one party occupy different maps. A room owns its players, authored monsters, loot,
local chat, timer and navigation; when empty it stops ticking and may reset monsters and ground
loot.

The server resolves exits only from the saved adventure graph. It loads the destination map and
entry, persists the centered destination position under the hero epoch, hands off presence,
closes with `ZONE_TRANSITION`, and lets the browser reconnect from the saved state. Reaching an
`END` edge marks the party completed idempotently and broadcasts victory to every connected party
room; clients cannot request either a destination or completion.

Swapping in real OAuth means adding a provider to the security realm. The session cookie, the
admission flow and the rooms all keep working.

## Spatial interest and local chat

Each world room keeps its authoritative entity collections and maintains a disposable spatial index
with 256 px cells. `welcome` contains the complete initial area; subsequent `world.delta` messages
contain only changed or removed entities for that recipient. The local player is always
included. Enter radii are 900 px for players, 850 px for monsters, 650 px for loot and 900 px for
guards/corpses; a 96 px exit margin prevents border flicker. Local chat reaches 700 px and spatial
events reach 850 px. Persistent party chat crosses map rooms through the party coordinator room;
local chat never does. Guild/global/whisper names remain protocol reservations.

Queries visit only the cells intersecting a radius, so their approximate cost is the nearby
entities plus a small fixed cell count, rather than every entity in the room for every player.
To add a dynamic entity type, keep its authoritative collection in the world room, index it on
creation/movement/removal, then build its per-viewer snapshot from `queryWithHysteresis()`.

Simulation remains at 20 Hz while JSON world updates run at 10 Hz. A typical initial message is
`{"t":"welcome","tick":40,"players":[...],"monsters":[...],...}`; a later update is
`{"t":"world.delta","tick":42,"players":{"upsert":[...],"remove":[]},...}`. If a delta
cannot be applied or its tick is incoherent, the browser sends `{"t":"world.resync"}` and the
server answers with a complete `world.resync` view and a fresh tick/cache baseline.

## More

See [docs/adventure-creator-direction.md](./docs/adventure-creator-direction.md) for the product
direction and [docs/adventure-runtime-architecture.md](./docs/adventure-runtime-architecture.md)
for the staged domain model. [docs/mmo-architecture.md](./docs/mmo-architecture.md) remains a useful
record of the current authoritative networking, security, observability and load-testing
implementation; it is no longer the product roadmap. See [AGENTS.md](./AGENTS.md) for contributor
conventions and gotchas.
