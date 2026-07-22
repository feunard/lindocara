# lindocara

**LindoCara** is a modern creator for cooperative 2D RPG adventures, built on Cloudflare Workers
and designed for one to four players. Builders will assemble complete adventures from connected
maps, authored scenery and, in later milestones, events, dialogue, quests, conditions and
cinematics. Players will be able to start alone, join a running game, save it and resume it later.

The primary flow is now a persistent authored adventure: title, login, saved parties, party heroes,
then the authoritative game runtime. A creator can connect account-owned maps into an adventure,
place monsters and entry/exit markers, create a party for one to four players, and resume each
hero's last map, position and core stats later. The compiled **Verdant Reach** content and the old
account-character roster remain compatibility foundations, not the product entry point. The whole
UI is localized in French and English, with a live toggle.

**Live:** [lindocara.alepha.dev](https://lindocara.alepha.dev)

## Stack

TypeScript · Vite · PixiJS · React 19 · Tailwind v4 · Radix/PixelAct UI · Zustand ·
Cloudflare Workers + Durable Objects · D1 + Drizzle ORM · Biome · Vitest

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

```bash
npm install
cp .dev.vars.example .dev.vars   # then put a real secret in it
npm run db:migrate               # apply the local D1 schema
npm run dev
```

`npm run dev` runs the client, the Worker, and the Durable Object together in workerd — the
same runtime that serves production.

```bash
npm run check:runtime # lint + typecheck + runtime server/player UI tests + build
npm run check         # full repository gates, including catalog and authored-map checks
npm run deploy        # build, then ship
```

## Local load testing

Start the local stack, then run a scenario from another terminal:

```bash
npm run dev
npm run loadtest -- --players=10 --duration=60 --scenario=mixed
```

Available scenarios are `idle`, `movement`, `combat`, `mixed`, `reconnect`, and
`zone-transition`. The runner creates or reuses deterministic `loadNNN` accounts, groups them into
parties of up to four, provisions two-map adventures with nearby monsters, creates party heroes,
and opens `/api/ws?party=...&hero=...` WebSockets. It prints connection, throughput, message-size,
acknowledgement latency, transition, disconnect, and protocol-error metrics. It targets
`http://localhost:5173` by default and refuses any remote target unless
`--allow-remote=true` is explicit; the production hostname needs the additional
`--allow-production=true` safeguard. Each scenario uses its own resumable party so durable combat
or death state cannot contaminate a later reconnect or transition run.

## How it works

The client sends **intent** — "I'm holding right" — and never a position. Cheating by editing
your own coordinates is impossible, because you never send coordinates.

Each input is stamped with a sequence number, one per simulation tick. The Durable Object runs
a 20 Hz loop, applies **exactly one command per player per tick**, and broadcasts a snapshot
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
potion, or chat. It never selects a combat entity. The Durable Object freezes the hero's last
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

Each party hero is one of three classes, picked inside its saved party: the warrior strikes frontal
arcs and nearby zones, the ranger fires physical projectiles, and the priest combines a directional
magic bolt with self, projectile and area healing. Attacking empty space is valid; enemies can move
out before the active frame and projectiles can miss or hit terrain. A member's persistent colour
slot selects the matching Tiny Swords unit variant. Tab is intentionally unbound and reserved for a
future mechanic; it no longer cycles combat targets.

## Database

A D1 database (`lindocara`) stores accounts, account-owned revisioned maps, adventures, persistent
parties/members and heroes through Drizzle. The party is the saved playthrough; a hero belongs to
both that party and its account. Hero map, position, level, XP, HP, life/corpse state and fencing
epoch are saved periodically, on disconnect and at transitions. Inventory, equipment, skills and
quests are initialized for each hero session in this first slice and are not yet complete save data.
The legacy `character` tables remain for rollback compatibility but are not reachable from the
normal post-login UI.

```bash
npm run db:generate   # schema change -> migrations/NNNN_name.sql
npm run db:migrate    # apply to local D1
```

Production migrations run automatically on deploy, before the new code goes live.

## Deployment

Pushing to `main` runs the full check suite and then deploys, via GitHub Actions.

Required repository secrets:

| Secret | Where to get it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens (*Edit Cloudflare Workers*) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID |

One-time, before the first deploy:

```bash
npx wrangler secret put SESSION_SECRET     # openssl rand -base64 32
```

The custom domain `lindocara.alepha.dev` is claimed in `wrangler.jsonc`; its zone must live
on the same Cloudflare account as the Worker.

## Sessions

Registering or logging in verifies a username/password against the `account` table, then the
Worker signs `{ id, username, iat }` with an HMAC and hands it back as an `HttpOnly` cookie.
The Durable Object never sees a password. For the primary WebSocket route
`/api/ws?party=<partyId>&hero=<heroId>`, the Worker verifies the account, party membership, hero
ownership, adventure, saved map and position before admission. The browser never supplies a map or
authoritative position.

A deterministic `HeroPresence` Durable Object acquires the hero lease and advances its D1-backed
epoch. A newer connection replaces the previous one, and every core profile save is conditional on
that epoch, so a stale room cannot overwrite the current hero. `CharacterPresence` and the old
`?character=` path remain isolated rollback/test seams only.

## Maps, rooms and sessions

`GameSession` is addressed by `partyId`. It coordinates the party-wide room directory and broadcasts
while authoritative simulation is sharded into `World` rooms addressed by `partyId:mapId`. This
keeps two parties on the same authored map completely isolated and lets players in one party occupy
different maps. A room owns its players, authored monsters, loot, local chat, timer and navigation;
when empty it stops ticking and may reset monsters and ground loot.

The server resolves exits only from the saved adventure graph. It loads the destination map and
entry, persists the centered destination position under the hero epoch, hands off presence, closes
with `ZONE_TRANSITION`, and lets the browser reconnect from D1. Reaching an `END` edge marks the
party completed idempotently and broadcasts victory to every connected party room; clients cannot
request either a destination or completion. Compiled zones and character routing remain a migration
boundary for rollback and historical tests.

Swapping in real OAuth means changing how a session is minted. The cookie, the Worker, and
the Durable Object all keep working.

## Spatial interest and local chat

Each `World` keeps its authoritative entity collections and maintains a disposable spatial index
with 256 px cells. `welcome` contains the complete initial area; subsequent `world.delta` messages
contain only changed or removed entities for that recipient. The local player is always
included. Enter radii are 900 px for players, 850 px for monsters, 650 px for loot and 900 px for
guards/corpses; a 96 px exit margin prevents border flicker. Local chat reaches 700 px and spatial
events reach 850 px. Persistent party chat crosses map rooms through `GameSession`; local chat never
does. Guild/global/whisper names remain protocol reservations.

Queries visit only the cells intersecting a radius, so their approximate cost is the nearby
entities plus a small fixed cell count, rather than every entity in the room for every player.
To add a dynamic entity type, keep its authoritative collection in `World`, index it on
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
