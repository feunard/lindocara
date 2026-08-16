# Adventures, parties and party-owned heroes — design

Date: 2026-07-17. Status: approved direction for the next vertical slice.

This spec turns the adventure vocabulary of
[`docs/adventure-runtime-architecture.md`](../../adventure-runtime-architecture.md) into the
product's actual entry point. It supersedes the account character roster and retires the compiled
catalogue zones from the product. The project is at prototype stage: destructive migration of
existing character data is explicitly authorized.

## Product decisions (agreed)

- An **adventure** is an authored graph of maps with one start and at least one end. Exits name
  their destination (map + entry) or end the adventure — a free graph from v1, not a linear list.
- A **party** (GameSession) is one live playthrough of an adventure, like a private server. Any
  account can browse a public party list and join a party with a free slot. Only the host can
  delete a party. The adventure declares `maxPlayers` (1–4).
- **Heroes belong to a party.** The account roster is removed. A player creates up to 3 heroes
  inside a party (one active at a time) and heroes never leave their party.
- **Color belongs to the player's slot** in a party: blue, red, yellow or purple, unique per
  party, chosen from the remaining colors at join, durable across reconnects. All of a player's
  heroes in that party wear that color. Black is reserved for NPCs/monsters.
- **Reaching an end exit** shows a victory screen to every connected party member and marks the
  party `completed` (idempotent, once). The party stays joinable and playable afterwards.
- **Verdant Reach is removed** from the product, along with Heartroot city, Warden Mira, active
  guards, zone quests and cemeteries. Combat stays alive through **placeable monster spawns** in
  the map editor, driving the existing monster/combat/loot/XP systems.
- **Runtime topology: one party = one Durable Object.** The GameSession DO owns all of the
  party's active maps as internal rooms.
- Motivation: fast engine iteration — author a small adventure in minutes to exercise a new
  feature, while a main authored adventure lives alongside as ordinary content.

## Domain model and D1

New tables (Drizzle in `src/server/db/schema.ts`, one generated migration):

- `adventure` — id, `account_id` (author), `title`, `max_players` (1–4), `version` (integer,
  always 1 for now, reserved for future immutable published versions), timestamps, and a JSON
  `graph` column validated server-side. The graph holds the start point
  (`{ mapId, entryId }`) and one binding per placed exit:
  `{ mapId, exitId } → { destMapId, destEntryId } | END`.
- `adventure_map` — ordered membership. Maps stay in the account's library (existing `map` /
  `map_element` tables); an adventure references them. A map may appear in several adventures;
  **destinations belong to the adventure, never to the map.**
- `party` — id, `adventure_id`, pinned `adventure_version`, `host_account_id`, optional `name`
  (default "{adventure} de {host}"), `status` `open | completed`, timestamps.
- `party_member` — (`party_id`, `account_id`, `color`) with UNIQUE(party, color) and
  UNIQUE(party, account). Membership is durable; the member count is capped by the adventure's
  `max_players` at join time. Any of the four colors may be picked regardless of `max_players`;
  only the member count is capped.
- `hero` — replaces `character`: id, `party_id`, `account_id`, name, class, `map_id`, x/y,
  hp/level/xp, life state and corpse position, `session_epoch`, timestamps. Max 3 per
  (party, account), enforced server-side. The normalized item/equipment/skill/quest-progress
  tables re-point their foreign key to `hero`.

Dropped: the `character` table and the roster flow. Accounts and login are unchanged. Existing
character rows, items and progression are deleted by the migration — accepted (prototype).

Deletion rules: deleting a map referenced by any adventure is refused; deleting an adventure with
existing parties is refused (predictable, no cascades); deleting a party deletes its members,
heroes and owned-item rows. All checks run inside guarded `db.batch` like today's map CRUD.

### Hot editing (v1)

No immutable snapshot per party yet. A party reads the live adventure; edits take effect the next
time a room loads. This is deliberately iteration-friendly and is bounded by the deletion rules
above. The `version` column and the pinned `adventure_version` on `party` are the seam where the
architecture doc's published-immutable versions land later.

## Map format additions

`shared/map-data.ts` gains a **markers** collection in the map payload, versioned with a format
bump and a legacy reader (maps without markers stay valid). Markers are functional, not
decorative: they are **not** `MapElement`s with catalogue asset ids, matching the architecture
doc's rule that runtime entities are separate collections rather than special static element
kinds.

- `entry` — local id, position. Spawn/arrival point. The existing single `spawn` cell remains as
  the fallback entry for maps with no markers.
- `exit` — local id, one trigger tile cell. Its destination lives in the adventure graph, never
  in the map.
- `monsterSpawn` — monster type + patrol radius, hydrated by the server into monster-system
  entities on room load.

Validation lives beside `canPlaceElement`/`bakeCollision`: marker counts are bounded, positions
must be on walkable ground, and marker payloads count toward `MAX_MAP_JSON_BYTES`. Both server
(`validateMapInput`) and editor refuse invalid markers up front.

## Server runtime

**GameSession DO** (evolution of `World`), addressed by `partyId` via `idFromName`. It owns a
collection of internal rooms, one per active map:

- A room loads on first player arrival: map payload read from D1, collision baked by
  `shared/map-data.ts`, navigation grid generated from terrain, monsters hydrated from
  `monsterSpawn` markers. A room with no players unloads (monsters reset). The tick loop runs
  only while at least one player is connected — the billing rule is preserved.
- The tick iterates active rooms and calls the existing `world/` systems per room; they already
  receive their collections as explicit arguments. Observability keeps one metrics window per
  room, labeled with party and map.
- The adventure graph is loaded from D1 when an idle party receives its first connection and
  stays pinned while any player remains connected, matching the hot-editing rule: graph and map
  edits take effect on the next (re)activation or room load, never mid-flight.

**Admission** (`server/index.ts`): session cookie → account → D1 checks (party membership and
color slot, hero ownership, hero cap) → presence lease (the `CharacterPresence` DO becomes
`HeroPresence`, same epoch fencing mechanics) → route to the GameSession DO with internal
headers (`partyId`, `heroId`; the destination map comes from the hero's D1 row). Query parameters
and WebSocket messages never select a party, map or room. The `maxPlayers` cap is enforced when
joining the party (membership), so every member can always connect; a non-member WebSocket is
rejected at admission.

**Portals**: walking onto an exit trigger resolves the binding in the pinned graph, server-side
only.

- Normal destination: epoch-fenced save writing the destination map + entry position, then close
  with `WS_CLOSE.ZONE_TRANSITION`. The client reconnects through the normal join path and lands
  in the same DO, new room. The existing handoff machinery and client flow are reused as-is.
- `END`: write `party.status = completed` in D1 (idempotent, first time only), broadcast a
  victory event code to every connected socket in the party, client shows the victory overlay.
  Play continues; the party list shows the completed badge.

**Death without cemeteries**: the state machine in `shared/death.ts` is unchanged (corpse →
priest resurrect, or release → ghost → walk back to the body). Only the release destination
changes: a released ghost appears at the current map's fallback spawn point instead of
`nearestCemetery()`, which is removed. Deterministic and always walkable; no new state.

**Cooperation**: the party IS the group. The temporary party create/invite lifecycle is removed;
XP split, bounded threat, contribution eligibility and personal loot from
`shared/cooperation.ts` apply implicitly to the 1–4 heroes of the session. The `party` chat
channel now means "everyone in the party"; per-room local chat remains.

**Monsters**: the existing monster-system (AI, patrol, threat, navigation, respawn) runs per
room, fed by placed spawns. Guards and Mira leave with Verdant Reach; the guard code path remains
but nothing instantiates it.

## Client

**Launch flow** (replaces character select):

1. Login → home screen: the account's adventures (create / edit / delete) and the public party
   list (adventure name, present colors, free slots, completed badge).
2. Create a party from an adventure (optional name) or join a party with a free slot, picking a
   color among the remaining ones.
3. Inside a party: hero screen — this party's heroes for this account (max 3, all in the
   player's color), create / delete / pick → play. The existing character-select UI is recycled
   here.
4. The host sees a delete-party action with confirmation.

**Editor**: the map editor palette gains the three markers (entry, exit, monster spawn), drawn as
editor-only markers. A light **adventure editor** sits above it: compose the ordered map list,
set the start (map + entry), bind every exit to a destination (map + entry, or END) in a bindings
panel, set `max_players`. Save-time validation: start defined, every placed exit bound, at least
one END binding. The sandbox preview keeps working per map.

**Colors and rendering**: heroes render with the Tiny Swords faction variants (blue / red /
yellow / purple) resolved from the member's color; NPCs and monsters keep the black/neutral
faction. The color replaces the free-form character appearance field.

**i18n**: every new screen, error code and event code (victory, party full, color taken, hero
cap, deletion refusals…) lands in both FR and EN dictionaries; the parity test enforces it.

## Removals

Removed from the product: `shared/zones.ts` compiled catalogue zones (Verdant Reach,
mmo-test-zone), Heartroot layout, Warden Mira, active guards, zone quests, cemeteries and the
account character roster. Tests that relied on compiled zones migrate to D1 adventure fixtures;
driving the real Durable Object over real WebSockets remains the testing method.

## Security boundaries (unchanged rules, new surfaces)

Party/adventure/hero mutations are JSON-capped, ownership-checked and epoch-fenced like today's
map CRUD. Identifiers are server-minted. Joining, hero creation and party deletion get rejection
coverage (full party, taken color, hero cap, non-host delete, non-member connect). Adventure
graph validation is server-side; a client can never supply a destination.

## Out of scope (v1)

Authored events/dialogues/quests, AdventureSave checkpoints, immutable published versions,
invite codes, friends visibility, elevation, professions — all stay on the documented roadmap.
