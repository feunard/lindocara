# lindocara

**LindoCara** is a modern creator for cooperative 2D RPG adventures, built on Cloudflare Workers
and designed for one to four players. Builders will assemble complete adventures from connected
maps, authored scenery and, in later milestones, events, dialogue, quests, conditions and
cinematics. Players will be able to start alone, join a running game, save it and resume it later.

The current playable vertical slice is **Verdant Reach**. It already proves useful foundations:
server-authoritative movement and combat, client prediction, persistent characters, maps stored in
D1, an in-game WYSIWYG map editor, quests, loot and local cooperative synchronization. Those
systems are being evolved into the adventure creator; they are not being discarded with the former
MMO product direction. The whole UI is localized in French and English, with a live toggle.

**Live:** [lindocara.alepha.dev](https://lindocara.alepha.dev)

## Stack

TypeScript · Vite · PixiJS · React 19 · Tailwind v4 · Radix/PixelAct UI · Zustand ·
Cloudflare Workers + Durable Objects · D1 + Drizzle ORM · Biome · Vitest

The HUD, screens, overlays and editor use accessible React/Radix structure. Tiny Swords is the
visual source of truth for their pixel-art skin as well as the game world. The PixiJS canvas
underneath stays outside React; components communicate with game code only through narrow handles
and the Zustand store.

## Assets and license

The three **Tiny Swords** packs by Pixel Frog are LindoCara's visual source of truth for terrain,
buildings, characters, enemies, resources, effects, cursors and all interface chrome. Their source
files live under `assets/Tiny Swords (Free Pack)`, `assets/Tiny Swords (Update 010)` and
`assets/Tiny Swords (Enemy Pack)`. `assets/index.json` is the generated technical inventory;
`assets/lindocara-asset-catalog.json` is the semantic catalogue used by the product. See
`assets/LICENSE.md` for the recorded licence status.

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
npm run check    # lint + typecheck + test
npm run deploy   # build, then ship
```

## Local load testing

Start the local stack, then run a scenario from another terminal:

```bash
npm run dev
npm run loadtest -- --players=10 --duration=60 --scenario=mixed
```

Available scenarios are `idle`, `movement`, `combat`, `mixed`, `reconnect`, and
`zone-transition`. The runner creates or reuses deterministic `loadNNN` accounts and characters,
opens authenticated WebSockets, and prints connection, throughput, message-size, acknowledgement
latency, transition, disconnect, and protocol-error metrics. It targets
`http://localhost:5173` by default and refuses any remote target unless
`--allow-remote=true` is explicit; the production hostname needs the additional
`--allow-production=true` safeguard.

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

All of this hangs on `step(position, input, dt)` and `resolveTerrain()` in `src/shared/` being
pure functions that the server and the client both call. Reconciliation is only correct because
movement and collision are literally the same code on both sides.

The same rule applies to combat and progression: the browser asks to attack, interact, use a
potion, or chat. The Durable Object validates distance, cooldown, inventory, health, quest state,
and rewards. The client never sends positions, damage, XP, loot, deaths, or quest completion.

Movement lives in `src/shared/simulation.ts`; map geometry, collision, combat constants, and
progression formulas live in `src/shared/game.ts`. They are platform-free and directly tested.

## Play

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Space | Attack the closest monster in range |
| F | Mend the most injured ally in range (priest) |
| E | Interact with Warden Mira |
| Q | Use a potion |
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

Each character is one of three classes, picked at creation: the warrior hits hard at short
range, the ranger hits softer from far away, and the priest hits softest of all but can mend
the most injured ally in range.

## Database

A D1 database (`lindocara`) stores accounts and characters through Drizzle. One `account` row
per registered user (`username` unique, stored lowercase, password PBKDF2-hashed), and up to
three `character` rows per account — zone/instance, position, appearance, HP, level, XP,
inventory, quest progress, the absolute ward-run deadline, creation time, and last-seen time —
one of which you pick at character select. The
active room remains in the Durable Object for low-latency simulation and writes dirty
characters periodically and on disconnect.

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
The Durable Object never sees a password — it trusts the identity only because the Worker
verified that signature first, and only ever learns which character to load after the Worker
has separately checked that the session's account owns it.

Before admission, a deterministic `CharacterPresence` Durable Object acquires a 30-second lease
for that character and assigns a new D1-backed `sessionEpoch`. The room renews it every 10 seconds.
A newer connection replaces the previous one, and every profile save is conditional on the epoch,
so a late room can never overwrite the current position, progression, inventory, or quest state.

## Maps, rooms and sessions

The server reads each character's map location from D1 and routes its WebSocket to a deterministic
Durable Object room. The browser cannot choose the room or authoritative position. Compiled zones
still host the current vertical slice and test fixtures; D1 maps host creator-authored terrain and
scenery. This hybrid is a migration boundary, not the future product model.

Rooms isolate players, chat, monsters, loot, timers, commands, and snapshots. Each zone declares
its own maximum room capacity. Adding a zone means adding an immutable entry in
`src/shared/zones.ts`; adding an instance means persisting a valid instance id for a character.

Portals are server-owned catalogue entries. An interaction is accepted only in range of the portal;
the browser never supplies a destination. The source room freezes actions, saves under its current
epoch, then `CharacterPresence` atomically writes `zoneId`, `instanceId`, `x`, `y` and the next
epoch in D1. It closes with `ZONE_TRANSITION`; the browser reconnects with bounded backoff, and
the Worker resolves the destination from D1. A late source save is rejected by its old epoch.

Swapping in real OAuth means changing how a session is minted. The cookie, the Worker, and
the Durable Object all keep working.

## Spatial interest and local chat

Each `World` keeps its authoritative entity collections and maintains a disposable spatial index
with 256 px cells. `welcome` contains the complete initial area; subsequent `world.delta` messages
contain only changed or removed entities for that recipient. The local player is always
included. Enter radii are 900 px for players, 850 px for monsters, 650 px for loot and 900 px for
guards/corpses; a 96 px exit margin prevents border flicker. Local chat reaches 700 px and spatial
events reach 850 px. Other chat channel names are reserved by the protocol but not implemented.

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
