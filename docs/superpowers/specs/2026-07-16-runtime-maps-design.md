# Runtime maps — terrain in D1, authored by humans

Sub-project 1 of three. This one makes a map a **row in D1** instead of a TypeScript constant, and
routes the world off it. The editor UI (sub-project 2) and preview (sub-project 3) sit on top and
are out of scope here; this ships with maps seeded, not drawn.

## Why this is the hard one

Today the tilemap **never travels over the wire**. `WorldInfo` carries a `zoneId` and nothing else
about the terrain: `net.ts:228` looks up `zoneDefinition(zoneId).terrain` for prediction and
`renderer.ts:741` does the same for drawing. Both sides read the *same compile-time constant*, and
that shared single copy is exactly why reconciliation is correct — the same rule the project already
protects for `step()` ("Two hand-synchronised copies of movement logic is the classic way to make
prediction unfixable").

A D1 map cannot be imported. So the terrain becomes wire data, and the invariant has to be restated
rather than abandoned:

> **Client and server derive collision from the same payload through one shared pure function.**
> Never two decoders, never a client-side reconstruction that "should" match.

That is the whole risk of this sub-project. Everything else is plumbing.

## What is NOT deleted

Monsters, quests, guards, loot, skills, XP, corpse runs and navigation all stay. An editor-made map
simply has none of them on it, because nobody placed any — not because the system was removed. The
editor palette is deliberately small *for now* (blocks + elements); it grows later without a rebuild.

Deleted: `scripts/build-map.ts`, the `map:check` script, the generated `*-tiles.ts` files, and the
compile-time `ZoneId` union.

## Storage

`character.zone_id` is already `TEXT`, so a map id drops straight in. **No change to the character
row**, and the existing epoch-fenced position save keeps working as-is — "hero saves map + position
on exit" is a property this design inherits rather than builds.

```sql
CREATE TABLE map (
  id           TEXT PRIMARY KEY,   -- server-minted uuid; never client-supplied
  name         TEXT NOT NULL,
  cols         INTEGER NOT NULL,
  rows         INTEGER NOT NULL,
  blocks       TEXT NOT NULL,      -- one char per cell, row-major
  spawn_col    INTEGER NOT NULL,
  spawn_row    INTEGER NOT NULL,
  is_first     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE map_element (
  map_id   TEXT NOT NULL REFERENCES map(id) ON DELETE CASCADE,
  col      INTEGER NOT NULL,
  row      INTEGER NOT NULL,
  kind     TEXT NOT NULL,          -- 'tree' | 'bush' | 'stone'
  variant  INTEGER NOT NULL,
  PRIMARY KEY (map_id, col, row)
);
```

Two deliberate choices:

- **`blocks` reuses `tilemap-codec.ts`** — one char per cell, `.` grass and `#` water, already
  written and already tested. A 40x30 map is 1,200 bytes of diffable text. No new format.
- **`PRIMARY KEY (map_id, col, row)` is the "one element per cell" rule.** "You can't set another
  tree on it" is enforced by the database, not by a check somebody has to remember to write.

`ON DELETE CASCADE` means deleting a map takes its elements with it.

## Blocks and elements

Blocks are the ground. Elements stand on it.

| element | may be placed on | collides |
| --- | --- | --- |
| tree | grass | yes |
| bush | grass | no |
| stone | grass **or** water | yes |

Placement rules are validated **server-side** on write. The editor is open to any logged-in user, so
the API is the only place they can be enforced; a client that posts a tree onto water is rejected.

## Collision: baked, not taught

Colliding elements are baked into the tilemap when a map is loaded — a tree or stone cell becomes a
solid land cell. `isWalkableBox`, `resolveTerrain`, `step()` and prediction are **untouched**.

The alternative — teaching collision to consider an element list — would mean changing the one pure
function both sides depend on, on the same day the terrain starts moving over the wire. Baking keeps
exactly one thing changing at a time.

```
blocks (grass/water)  ──┐
                        ├──► bakeCollision() ──► TileMap ──► isWalkableBox / step / prediction
elements (colliding) ───┘
                        └──► rendered from the element list, not from tiles
```

This retires the "a forest cell IS a tree" model from `2026-07-16`'s prop work. That trick derived
trees from `forest` tiles and thinned forests to trunks in `build-map.ts`; with real elements, tree
positions are authored data and the thinning has nothing left to thin.

## The tileset must autotile, and the shore must foam

A user map is grass and water. It must get the same 4x4 autotiled rocky rim and the same animated
shoreline foam Verdant Reach has — not a flat two-colour grid.

This costs nothing, and that is worth stating precisely: `landTile()` reads `landMask()`, which reads
nothing but whether the four orthogonal neighbours are land; `needsFoam()` reads whether any of the
eight neighbours is water. Neither knows or cares where the `TileMap` came from. Drive the terrain
pass from the wire blocks and both work unchanged.

**It is pinned by a test, not assumed**: a hand-built D1 map with a grass island in water must
produce a non-zero foam count and at least one non-`0b1111` autotile mask.

## Wire format

`WorldInfo` grows the terrain:

```ts
blocks: string[];        // one string per row, one char per cell
elements: readonly { col: number; row: number; kind: ElementKind; variant: number }[];
```

`parseServerMessage` must validate this defensively, the way client intent already is: ragged rows,
an unknown block char, a bad element kind, or an out-of-bounds cell drops the frame. A malformed map
must not reach `decodeTileMap` and throw on the first paint. This is the one place the client is
currently *weakest* — `parseServerMessage` only checks the top level and casts nested structures
(recorded as known debt in `docs/mmo-migration-plan.md` §11) — and terrain is not a field to extend
that habit to.

Size check: Verdant Reach is 75x43 = 3,225 chars, sent once in `welcome`. Deltas are unaffected.

## Routing and fallbacks

`resolveZoneLocation` is pure and synchronous today. Loading a map needs D1, and `index.ts` already
reads the character's profile from D1 before routing — so the map load happens there, beside it.

| situation | behaviour |
| --- | --- |
| hero's map exists | route to it, restore saved x/y |
| hero's map deleted or unknown | route to the `is_first` map, at its spawn |
| delete the last remaining map | refused, 409 |
| delete the `is_first` map | flag moves to the oldest survivor, same transaction |
| **zero maps in D1** | the built-in map |

The last two rules overlap and the resolution is deliberate: because the API refuses to delete the
last map, zero maps is only reachable on a **fresh database**. The built-in is therefore the
empty-database floor, not a delete outcome. It is hardcoded, has a reserved id, is never listed by
the API, and is never editable: grass, a little water, one spawn.

Room keys stay `zoneId:instanceId`, so presence, the 30s lease, epoch fencing and handoff are
unchanged — they only ever saw an opaque string.

## Spawn

Every map has exactly one spawn cell, stored as `spawn_col`/`spawn_row` and validated on write to be
in bounds and on a walkable cell — a spawn inside a tree is a map nobody can enter. A hero with no
saved position on that map, or arriving after a fallback, starts there.

## Testing

- **Codec/round-trip** — blocks encode/decode losslessly; a ragged or unknown-char map is rejected.
- **Baking** — a tree bakes solid, a bush does not, a stone on water stays water-solid.
- **Autotiling + foam on a D1 map** — the pinned test above.
- **Prediction parity** — the existing `prediction.test.ts` guarantee, but with a wire-loaded map:
  replaying commands over a stale position lands exactly where the server lands.
- **Protocol** — malformed terrain drops the frame and does not throw.
- **Fallbacks** — deleted map routes to first; last-map delete refused; first-map delete moves the
  flag; empty database yields the built-in.
- **Placement validation** — tree on water rejected; stone on water accepted; spawn on a solid cell
  rejected.
- **Real Durable Object** — a character loads a D1 map, walks, disconnects, and returns to the same
  map and position with the epoch fence intact.

## Risks

- **Prediction desync** — the headline risk. Mitigated by one shared decode+bake function used by
  both sides, and by keeping `step`/`isWalkableBox` untouched this sub-project.
- **Unvalidated terrain from the wire** — mitigated by defensive parsing before `decodeTileMap`.
- **A map edited under a live room** — out of scope here (no editor yet), but noted: sub-project 2
  must decide whether a running room reloads or is drained. Do not let it discover this by accident.
- **Losing the authored world** — `verdant-reach` is seeded into D1 as blocks + elements so the
  shape survives; its quests/NPCs/guards keep referencing its id, which does not change.
