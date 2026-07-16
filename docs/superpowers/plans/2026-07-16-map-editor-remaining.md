# Map editor — what is left, and where it is stuck

> **Read this first.** Written at the end of a session that ran out of context mid-way. It records
> the exact blocker, what was already ruled out, and the remaining work. Nothing here is speculation
> about code that was not read.

## The requirements, as given

Verbatim from the user, so nothing gets lost in paraphrase:

- humans (the user and `heros20`) create maps; maps live in D1; **no access role** — any logged-in
  player can create and edit, for now;
- a **map editor button on the launch screen**; add, delete, update maps;
- a map must have a **spawn square**, the default spawner unless overridden;
- **hero saves map + position on exit**;
- **you cannot delete all maps** — always one;
- if a hero loads and their map is deleted/missing → **move to the first map ever**;
- a map can be flagged **"first map"**; deleting the flagged one **moves the flag**;
- a **built-in hardcoded map**, not visible, used when all are deleted: water + grass + spawner;
- **tileset editor** offers *already-built tiles*, not the raw tileset:
  - **blocks** (grid size, grid position): `grass`, `water` (collides)
  - **elements** (already animated): `tree` (all variants, collides), `bush` (all variants),
    `stone` (all variants, collides, **allowed on water**)
  - no house, no sheep, no unit *for now*
- a **preview button** in the map editor: play the map with a random level 1 warrior.
- **the tileset must be mapped correctly** — a grass/water boundary must autotile and grow the
  animated shoreline foam.

## Where the code is

| | |
| --- | --- |
| `main` | **green**, `15da520`, 473 tests + 68 UI |
| `origin/feature/d1-map-engine` | **8+ tests red** — the blocker below |

`main` contains, all invisible to a player:

- `src/shared/map-data.ts` — `MapData`, `ElementKind`, `ELEMENT_RULES`, `canPlaceElement`,
  `bakeCollision`, `parseMapData`, `parseMapElements`.
- `src/shared/tilemap-codec.ts` — `encodeTileMap` and a non-throwing `parseTileMap`.
- `src/server/db/schema.ts` — `map` and `map_element`, migration `0011_windy_purifiers.sql`.
- `src/server/maps.ts` — `BUILTIN_MAP`, `loadMap`, `listMaps`, `firstMap`, `createMap`,
  `updateMap`, `deleteMap`, `resolveMapFor`, `validateMapInput`. **Fully tested** (14 tests).
- The welcome carries `tiles` (baked, one char per cell) and `elements`; the client collides
  against what it was sent rather than a compiled-in constant.

The branch adds: `ZoneId = string`, `resolveMapFor` in `index.ts` and `World`, and
`src/server/world/map-zone.ts` (`terrainFromMap`, `zoneFromMap`, `locationFromMap`).

---

## THE BLOCKER — start here

On `feature/d1-map-engine`, **58 of 64 `world.test.ts` tests fail**. Every one is the same thing:

```
AssertionError: expected 409 to be 101
  at Client.joinCharacter test/support/world-harness.ts:201
```

`409` has exactly one source — `World.fetch`:

```ts
const presence = this.env.CHARACTER_PRESENCE.getByName(id);
if (!(await presence.isAuthorized(connectionId, sessionEpoch, roomKey))) {
  return new Response("presence lost", { status: 409 });
}
```

So the lease exists but `isAuthorized` says no. It compares three things
(`src/server/character-presence.ts:103`): `connectionId`, `sessionEpoch`, `roomKey`.

### Already ruled out — do not re-check these

- **Not the DO constructor.** The new `await resolveMapFor` sits inside `blockConcurrencyWhile`,
  in a loop over `ctx.getWebSockets()`. A *fresh* object has none, so the loop never runs on a first
  connection. The tests fail on first connection.
- **Not `validIdentity`.** It is `value.length > 0 && value.length <= 128`
  (`character-presence.ts:51`). `"builtin"` passes.
- **Not an invalid location.** That branch returns `#closedSocket(WS_CLOSE.INVALID_LOCATION)`,
  which is a **101 with a close code**, not a 409.
- **Not a thrown `acquire`.** That is caught in `index.ts` and returns
  `closedWebSocket(WS_CLOSE.PRESENCE_ERROR)` — also 101. No `presence_acquisition_failed` was
  logged.
- **On paper the keys agree.** `index.ts` resolves `verdant-reach` → no maps → `BUILTIN_MAP` →
  `roomKey "builtin:main"`, acquires the lease with it, and sends it as `x-room-key`. `World`
  receives `x-zone-id: "builtin"` → resolves → `"builtin:main"`. They match.

### The leading hypothesis

`index.ts` and `World` each call `resolveMapFor` **independently**, against a database other tests
write to (`test/db.test.ts` and `test/maps.test.ts` both insert maps; the workerd pool **does not
isolate storage between tests** — see the note in `test/db.test.ts`). If a map row exists when
`index.ts` resolves and is gone when `World` resolves — or vice versa — `firstMap()` returns
different answers and the two room keys diverge. The lease then holds one key and the header
carries another.

### The next action, concretely

Add one log to `World.fetch` immediately before the `isAuthorized` call:

```ts
console.log(JSON.stringify({
  event: "presence_debug",
  header: { roomKey, connectionId, sessionEpoch },
  resolved: location.roomKey,
}));
```

and one inside `isAuthorized` printing `current`. Run:

```bash
npx vitest run test/world.test.ts -t "welcomes a player with the world dimensions"
```

The two room keys will disagree, or the epoch will. That names the bug in one run.

### If the hypothesis is right, the fix

Resolve the map **once**, in `index.ts`, and let `World` trust the header it already validates
(`roomKey`), rather than re-resolving. `World` still needs the map's *terrain*, so pass the map id
and load **that specific map** (`loadMap(db, zoneId)`), never `resolveMapFor` — the fallback belongs
at the front door, not in the room. A room that silently re-resolves is a room that can disagree
with the lease it was admitted under.

---

## Task A — make the engine green

**Files:** `src/server/world.ts`, `src/server/index.ts`, `test/support/world-harness.ts`

- [ ] Add the debug logs above; run one failing test; read the disagreement.
- [ ] Apply the fix (likely: `World` uses `loadMap`, not `resolveMapFor`).
- [ ] Seed a map in `test/support/world-harness.ts` so rooms resolve to a real one rather than the
      built-in floor. Give it a **known id** so existing tests that assert `verdant-reach:main`
      still mean something, or update those assertions deliberately.
- [ ] `npm run check` → green.
- [ ] Merge `feature/d1-map-engine` into `main`.

**Watch for:** `test/zones.test.ts`, `test/zone-connectivity.test.ts` and
`test/navigation-system.test.ts` were already updated on the branch for `ZoneId = string`
(`ZONES[x]` can now be `undefined`; they use `zoneDefinition(x)` / `visualConfigFor(x)` instead).

---

## Task B — the CRUD API

**Files:** `src/server/index.ts`, `test/worker.test.ts`

`src/server/maps.ts` is done and tested. These endpoints are a thin layer over it — do **not**
reimplement validation in the handlers.

- [ ] `GET /api/maps` → `listMaps(db)`. Never includes the built-in.
- [ ] `GET /api/maps/:id` → `loadMap(db, id)`, 404 if absent.
- [ ] `POST /api/maps` → `createMap(db, input)`; 400 on `placement:` / `spawn:` errors.
- [ ] `PUT /api/maps/:id` → `updateMap(db, id, input)`; 404 on `not_found:`.
- [ ] `DELETE /api/maps/:id` → `deleteMap(db, id)`; **409 on `last_map:`**.
- [ ] All five require a session (`requireSession`) and nothing more — any logged-in player may
      edit any map, by design, for now.
- [ ] Cap the body: `MAX_API_JSON_BYTES` is 4,096 and a 40x30 map is ~1.2 KB of blocks plus
      elements. **Raise it for these routes or maps will 413.** This is the one gotcha in Task B.

**Tests:** create → list → update → delete round trip; deleting the last map 409s; a tree on water
400s; an unauthenticated call 401s.

---

## Task C — the editor

**Files:** `src/client/ui/CharacterSelect.tsx`, new `src/client/ui/MapEditor.tsx`,
`src/client/api.ts`, `src/shared/i18n/{en,fr}.ts`

- [ ] A **Map editor** button on the launch screen (`CharacterSelect.tsx`).
- [ ] An editor scene: pick a map or create one; a grid canvas; a palette; save; delete.
- [ ] **Palette — blocks:** grass, water. Painting a block writes a character into `blocks`.
- [ ] **Palette — elements:** tree, bush, stone, each with variants. One element per cell —
      the DB enforces it, but the UI should not let you try.
- [ ] Placement rules mirror `ELEMENT_RULES` (`src/shared/map-data.ts`) — import them, do not
      retype them. Tree/bush on grass; stone on grass **or water**.
- [ ] A spawn tool: exactly one per map, and it must land on a walkable cell.
- [ ] i18n both dictionaries. The parity test enforces it.

**The renderer already does the hard part.** `landTile()`/`landMask()` autotile from grass/water
neighbours and `needsFoam()` grows the shoreline — neither knows where the `TileMap` came from
(`test/map-terrain.test.ts` pins exactly this against a hand-built map). The editor's preview of a
coast comes free if it renders through the same path.

---

## Task D — preview

- [ ] A **Preview** button in the editor: enter the map with a throwaway level 1 warrior.
- [ ] Decide (and write down) whether preview uses a real room + real character, or a client-only
      sandbox. A real room is more honest and reuses everything; it needs a temporary character or
      an instance id that is not the player's own.

---

## Open questions nobody has answered yet

- **A map edited under a live room.** Does the room reload its terrain, drain, or ignore the edit
  until restart? Nothing decides this today. Ignoring it means a player walks through a wall that
  exists in D1 but not in the room's memory. Decide before the editor ships.
- **Map size.** Nothing constrains `cols`/`rows`. A 500x500 map is 250 KB in a welcome. Pick a cap
  and enforce it in `validateMapInput`.
- **The existing zones.** The user said: *"i don't care about existing maps, just make the engine"*.
  So Verdant Reach and Sunken Isles are **not** being seeded into D1. Once the engine routes off D1,
  the compile-time catalogue (`ZONES`, `build-map.ts`, the generated `*-tiles.ts`, `map:check`) is
  dead weight and should be deleted — but only after Task A is green, never in the same change.

## What this session got wrong, so it is not repeated

- The plan's Task 5/6 split was drawn at the wrong boundary. Sending the baked tilemap turned out to
  be independent of the routing change, so the prediction risk could land on its own — it did, and
  it is green on `main`.
- Four sub-tasks shipped with no visible payoff before anyone said so out loud. If the next session
  is going to be another foundation-only stretch, **say that first**.
