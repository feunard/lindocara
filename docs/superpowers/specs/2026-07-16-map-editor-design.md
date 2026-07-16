# Map editor — engine fix, CRUD, editor UI, preview

Sub-projects 2 and 3 of the runtime-maps work (see `2026-07-16-runtime-maps-design.md`), plus the
fix that unsticks sub-project 1. At the end of this work a logged-in player can press a button on
the launch screen, draw a map of grass, water, trees, bushes and stones, save it to D1, preview it
with a throwaway warrior, and walk it for real.

## Requirements (verbatim, so nothing is lost in paraphrase)

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
- a **preview button** in the map editor: play the map with a random level 1 warrior;
- **the tileset must be mapped correctly** — a grass/water boundary must autotile and grow the
  animated shoreline foam.

## Decisions made in this design (previously open)

| question | decision |
| --- | --- |
| a map edited under a live room | **stale until empty** — a room reads D1 once at startup; edits are seen by the next room that loads the map. Rooms stop when the last player leaves, so this resolves naturally. |
| map size | **cols 20–100, rows 15–100**, enforced in `validateMapInput`. Max map ≈ 10 KB of blocks. |
| preview | **client-only sandbox** — shared `bakeCollision()` + real `step()` + real renderer, no server, previews *unsaved* edits. |
| old compile-time zones | **untouched this session, via hybrid routing** — a catalogue id (`verdant-reach`, `mmo-test-zone`, `sunken-isles`) keeps resolving compile-time, so existing characters, zone content and the 473-test suite are untouched; any other id is a D1 map id. New characters start on the resolved D1 map (first map, else builtin), so user maps are where new play happens. Deleting the catalogue is a follow-up session; nothing is seeded into D1. |
| editor painting surface | **WYSIWYG** — a terrain-only PixiJS stage rendering through the same `landTile`/`needsFoam`/element paths as the game. |

## Where the code already is

`main` (green) has the pure map model (`src/shared/map-data.ts`), the codec
(`src/shared/tilemap-codec.ts`), the `map`/`map_element` tables, a fully tested `src/server/maps.ts`
(create/update/delete/list, auto-first flag, flag inheritance on delete, last-map refusal,
`BUILTIN_MAP` fallback, `resolveMapFor`), and a welcome that carries baked `tiles` + `elements` the
client collides against. `feature/d1-map-engine` (one WIP commit) routes the world off D1 and is
red: 58/64 `world.test.ts` connections fail with 409.

## 1. Engine — unstick the branch

**Diagnosis (confirmed by running the failing test, 2026-07-16).** The 409 is deterministic — not
a race, and not `isAuthorized`: `World.fetch`'s "character location changed" guard fires because
the profile row says `verdant-reach`, no such map row exists, and `resolveMapFor` silently falls
back to the builtin — a move nothing ever persisted. The guard is right; the fallback was
incomplete. A second discovery drove the routing shape: sending *every* id through D1 would strip
zone content (monsters, quests, guards) from every room, which half of `world.test.ts` exists to
test.

**The fix:** resolve the map **once, at the front door**, and make the fallback a real move.

- **Hybrid routing.** A catalogue zone id (`verdant-reach`, `mmo-test-zone`, `sunken-isles`)
  resolves compile-time exactly as on `main` — content, tests and existing characters untouched.
  Any other id is a D1 map id.
- `index.ts` owns all D1 fallback logic: hero's map → `is_first` map → `BUILTIN_MAP`. When the
  resolution lands on a *different* map than the profile names, that is the requirement's "move to
  the first map ever" — persisted after acquiring the lease with an **epoch-fenced relocation
  write** (`relocateProfile`: like `handoffProfileLocation`, but it must not advance the epoch,
  because the lease it fences against was just acquired).
- `World` validates header shape but **never re-resolves**. Catalogue ids use the catalogue; a D1
  id calls `loadMap(db, zoneId)` exact-id (or `BUILTIN_MAP` for the reserved id) purely to obtain
  terrain. A room that silently re-resolves is a room that can disagree with the lease it was
  admitted under.
- If the map was deleted between admission and load, the room closes with
  `WS_CLOSE.INVALID_LOCATION`; the client reconnects and the front door resolves the fallback.
- **New characters are created on the resolved D1 map** (first map, else builtin) instead of
  `verdant-reach`, so user maps are where new play happens.
- The test harness (`test/support/world-harness.ts`) pins existing world tests to `verdant-reach`
  explicitly; D1-map coverage lives in a new `test/map-world.test.ts` that creates maps per test.

"Hero saves map + position on exit" is inherited: `character.zone_id` is TEXT and the epoch-fenced
save is unchanged. "Stale until empty" is true by construction, not by code: a room reads D1
exactly once, at startup.

Merge `feature/d1-map-engine` into `main` only when `npm run check` is green.

## 2. CRUD API

Five thin handlers over `maps.ts` plus one new function. Handlers do **not** re-implement
validation; `validateMapInput` is the single gate.

| route | backing | errors |
| --- | --- | --- |
| `GET /api/maps` | `listMaps` (never includes the built-in) | — |
| `GET /api/maps/:id` | `loadMap` | 404 |
| `POST /api/maps` | `createMap` | 400 on `placement:` / `spawn:` / `size:` |
| `PUT /api/maps/:id` | `updateMap` (full replace) | 404, 400 |
| `DELETE /api/maps/:id` | `deleteMap` | **409 on `last_map:`** |
| `POST /api/maps/:id/first` | **new `setFirstMap`** — clears the old flag, sets the new, one transaction | 404 |

- All routes require a session (`requireSession`) and nothing more — any logged-in player may edit
  any map, by design, for now. Errors are machine codes, never prose.
- `validateMapInput` gains the size cap: `cols` 20–100, `rows` 15–100 (`size:` errors).
- **Body cap:** the global 4,096-byte JSON cap would 413 a real map. Map routes get their own
  32 KiB cap (`MAX_MAP_JSON_BYTES`); every other route keeps 4 KiB. This is the one gotcha.

## 3. Editor UI

**Entry:** a "Map editor" button on the launch screen (`CharacterSelect.tsx`) opens a new
`MapEditor` screen.

**Map list:** create (name + size within caps, default 40×30, all grass, spawn centered), open,
delete behind a confirm (the server moves the `is_first` flag if needed and refuses the last map),
and a "make this the first map" toggle backed by the new endpoint.

**Painting surface:** a terrain-only PixiJS stage rendering through the same pure functions as the
game — `landTile`/`landMask` for the 4×4 autotile, `needsFoam` for the shoreline, the real element
sprites with their animations. You paint against the coast you will actually get. React owns the
toolbar and map list; the stage is game code under `src/client/game/` and React reaches it through
a handle in the store — the same boundary as `GameHandle`, because nothing in `ui/` may touch the
canvas.

**Palette and rules:**

- blocks: grass, water — painting writes a char into the editor's in-memory `MapData`;
- elements: tree, bush, stone, each with variant cycling; an eraser;
- placement rules are **imported from `ELEMENT_RULES`**, never retyped: tree/bush on grass, stone
  on grass or water. The UI refuses invalid drops; the server re-validates on save anyway;
- one element per cell: painting over replaces (the DB primary key enforces it; the UI never
  offers to violate it);
- a spawn tool: exactly one spawn per map, on a walkable cell; placing it again moves it.

**Save** PUTs the whole map. Map size is fixed at creation; resizing an existing map is a
follow-up. Every string lives in both i18n dictionaries — the parity test enforces it.

## 4. Preview

The Preview button swaps the editor stage for a client-only sandbox of the **current, unsaved**
edits:

- `bakeCollision()` — the same shared function the server uses — produces the TileMap;
- a throwaway level-1 warrior with random appearance spawns at the spawn square;
- real input and the real `step()` at `TICK_HZ` drive it; the real renderer draws it;
- Esc returns to editing, edits intact. No server, no character row, no cleanup.

Prediction-parity is inherent rather than promised: the sandbox *is* the shared `step()` over the
shared bake. Since user maps carry no monsters, quests or guards, walking, collision and the
coastline are exactly what preview must prove.

## 5. Testing

- **Engine:** all `world.test.ts` green (pinned to `verdant-reach` by the harness); in the new
  `test/map-world.test.ts`, a character loads a D1 map, walks, disconnects, and returns to the same
  map and position with the epoch fence intact; a deleted map relocates (persisted) to the first
  map; an empty database lands on the builtin floor.
- **API:** create → list → update → delete round trip; unauthenticated 401; tree-on-water 400;
  bad spawn 400; oversized map 400; last-map delete 409; deleting the flagged map moves the flag;
  the 32 KiB boundary accepts a max-size map and rejects beyond it.
- **Editor:** UI tests for palette rules (imported, not retyped), the one-spawn invariant, and the
  delete confirm, following the existing UI test suite.
- **Autotile + foam on a D1 map** stays pinned by `test/map-terrain.test.ts`.

## Out of scope this session

Deleting the old zone catalogue (its own green-to-green session), map resize, live-room reload,
access roles, houses/sheep/units in the palette, seeding Verdant Reach or Sunken Isles into D1.

## Delivery order

Four milestones, each merged green to `main`: engine fix → CRUD API → editor UI → preview. The
engine fix is invisible foundation; the payoff becomes visible at milestone 3 — saying that out
loud here, because the last session's retrospective asked for it.
