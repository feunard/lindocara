# Admission cutover design (hero replaces character in the running game)

Status: designed, not yet implemented. Persistence decision (2026-07-18): **core stats only** —
a hero persists position/level/xp/hp/life/corpse/epoch (columns the `hero` table already has);
inventory, equipment, quests and skills are session-only (seeded from class starters each entry,
not saved). Repointing the normalized model to heroes (persistent loot/gear) is a later bite.

## Why this is the highest-risk plan

It rewrites the core admission path and migrates the whole server test suite. Everything up to
here (parties, heroes, launch UI) was additive — the running `character` game stayed intact. This
plan makes heroes THE way to play and stands the character path down.

## Design (ready to execute)

### 1. Hero profile boundary — `src/server/hero-profile.ts` (new)
Mirror `profile.ts` on the `hero` table, defaulting the session-only fields.
- `loadHeroProfile(db, heroId): PlayerProfile | null` — SELECT the hero row; build a `PlayerProfile`:
  - `id/nick(=name)/level/xp/hp/class/x/y/life/corpse/sessionEpoch` from the row.
  - `zoneId = hero.mapId`, `instanceId = "main"` (heroes are always on a D1 map — never a catalogue
    zone, so the `isKnownZone` branch never applies to them).
  - `appearance`: derive from the owner's `party_member.color` (blue/red/yellow/purple) mapped to the
    character appearance enum (azure/ember/moss/violet): blue→azure, red→ember, yellow→moss,
    purple→violet. This IS the colour rendering — it falls out here for free.
  - `equipment` = `starterEquipmentFor(class)`; `inventory` = `{ potions: 2, gold: 0, crystals: 0 }`;
    `quest` = default `three_offerings/available/0`; `resource` = `initialResource(class)`;
    `wardRunExpiresAt = null`. (All session-only, matching `profileFromAttachment`'s defaults.)
- `saveHeroProfile(db, profile): boolean` — fenced `UPDATE hero SET x,y,level,xp,hp,life,corpse_x,
  corpse_y,session_epoch(unchanged),updated_at WHERE id=? AND session_epoch=?`. Does NOT write
  inventory/equipment/quest (no hero_* tables yet). Returns whether the fenced row matched.
- `acquireHeroEpoch(db, heroId): number | null` — `UPDATE hero SET session_epoch = session_epoch+1
  … RETURNING`.
- `relocateHero(db, {id,sessionEpoch}, {mapId,x,y}): boolean` and `handoffHeroLocation(...)` — fenced
  position writes (handoff advances epoch, relocate does not), mirroring `profile.ts`.

### 2. HeroPresence DO — `src/server/hero-presence.ts` (new) + config
Duplicate `CharacterPresence` but point its epoch/handoff calls at the hero-profile functions
(`acquireHeroEpoch`/`handoffHeroLocation`) and store `heroId` in the lease. Config:
- `wrangler.jsonc`: add binding `{ "name": "HERO_PRESENCE", "class_name": "HeroPresence" }` and a
  new append-only migration `{ "tag": "v3", "new_sqlite_classes": ["HeroPresence"] }`.
- Export `HeroPresence` from `src/server/index.ts`.
- `npm run cf-typegen` → adds `HERO_PRESENCE` to `Env` and `"HeroPresence"` to `durableNamespaces`.
- Its `#invalidateRoom` still calls `env.WORLD.getByName(roomKey).invalidatePresence(...)` (rooms are
  shared).

### 3. handleJoin admits heroes — `src/server/index.ts`
Replace the `?character=` path with `?hero=<heroId>&party=<partyId>`:
- verify session → account; verify the account is a member of `party` (party_member) AND the hero
  belongs to (party, account) — reuse a small `heroOwnedBy(db, accountId, partyId, heroId)`.
- `loadHeroProfile` → its `mapId` is the room. Resolve `location = locationFromMap(loadMap(mapId))`
  (always the D1-map branch; drop the `isKnownZone` catalogue branch for heroes). Fallback if the
  hero's map was removed from the adventure (the seam the heroes-bite review flagged): re-resolve to
  the adventure's `graph.start` and epoch-fence a relocate before admission.
- `HERO_PRESENCE.getByName(heroId).acquire({ heroId, connectionId, roomKey, mapId, instanceId })`.
- route to `WORLD.getByName(roomKey)` with headers `x-hero-id`, `x-party-id`, `x-map-id`,
  `x-instance-id`, `x-connection-id`, `x-session-epoch`, `x-room-key`.

### 4. World DO admits heroes — `src/server/world.ts`
Switch `fetch` + `#restoreWebSocket` to read the hero headers, call `loadHeroProfile`, and use
`HERO_PRESENCE`. `#locateRoom` for heroes only needs the D1-map branch. `newPlayer(profile,…)` is
UNCHANGED — a `PlayerProfile` is a `PlayerProfile` regardless of source. `saveProfile` calls become
`saveHeroProfile`. The `Attachment` carries `mapId` instead of `zoneId` (or keep `zoneId=mapId` to
avoid churn). Guards (`ROOM_FULL` via `maxPlayers`, epoch mismatch, location changed) stay.
NOTE: the cutover can either (a) fully replace the character path in world.ts, or (b) branch on a
header to support both during transition. (a) is cleaner but breaks every character test at once;
(b) is safer but leaves dead code. Recommend (a) with a full test-harness migration in the same plan.

### 5. Client — `src/client/game/{net,session}.ts`, `PartyScreen.tsx`
- `net.ts connect(handlers, heroId, partyId)` → `?hero=&party=`.
- `session.ts startGameAsHero(hero: StoredHero, party: PartyListing)` — mirrors `startGame` but reads
  the hero for name/class; on terminal close, return to `"party"` (not character-select).
- `PartyScreen` gains a "Play" button per hero → `startGameAsHero`. Gate Play on
  `party.status !== "completed"`? (Spec keeps completed parties playable, so NO gate — but Join was
  flagged; revisit.)
- `App.tsx` `game` screen already renders the HUD; the store's `resetToCharacterSelect` needs a
  hero-aware sibling (`resetToParty`) that returns to `"party"` with `activeParty` intact.

### 6. Test harness migration — `test/support/world-harness.ts` + 4 consumers
`testCharacter`/`Client.joinCharacter` become `testHero` (register → create party from a seeded
adventure → create hero → admit via `?hero=&party=`). Migrate `world.test.ts`, `map-world.test.ts`,
`mission-2a.test.ts`, `party-world.test.ts`, `worker.test.ts`. This is the bulk of the work and the
main risk surface. The room key for a hero is `mapId:instanceId` (e.g. the adventure's start map).

## Then: removals bite (separate plan)
Delete `character` table + `characters.ts`/`profile.ts`/`CharacterPresence`/CharacterSelect/
CharacterCreator; retire `zones.ts` compiled content (Verdant Reach, Heartroot, Mira, guards, zone
quests, cemeteries, mmo-test-zone); make `"parties"` the post-login landing. Monsters come only from
placed spawns. The `nearestCemetery` ghost release becomes the map's fallback spawn (spec'd).

## Open risks
- The World DO + presence are process-wide singletons in tests (`fileParallelism: false`); the hero
  harness must drain rooms between tests like the character harness does (`waitForRoomSockets`).
- Colour enum mismatch (party blue/red/yellow/purple vs appearance azure/ember/moss/violet) resolved
  by the mapping in step 1.
- `hero.mapId` drift vs the pinned adventure (heroes-bite review finding) — handled by the step-3
  fallback re-resolve.
