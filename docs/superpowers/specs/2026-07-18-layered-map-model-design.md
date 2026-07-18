# Layered map model and tilesets

Status: design, approved 2026-07-18. Tranche 1 of the Adventure Editor roadmap.

## Why

`wireframes/RPG Editor.dc.html` is the target Adventure Editor: an RPG Maker XP-shaped tool where
everything about an adventure is authored. This spec covers only the foundation it stands on —
the map data model — and deliberately ships no new UI.

Today a map stores `blocks`: one character per cell over six `TileKind` values, and the renderer
derives the sprite from the four orthogonal neighbours at draw time. That model cannot express what
the wireframe authors: three tile layers, an elevation brush with three levels, per-tile draw
priority, and decorative tiles the author picks by hand.

The roadmap's later tranches (editor shell, events, switches, interpreter) all read this contract.
Changing it after they exist means migrating them too, so it goes first.

## Approach

The model is RPG Maker XP's, with one deliberate deviation.

**From XP.** A cell stores a *tile id*. What a tile means — walkable or not, drawn behind or in
front of characters — is a property of the **tileset**, authored once per tile, not per map cell.
Collision therefore stays derivable from what you see, through one indirection: `tile id → tileset
→ passable`. `shared/tilemap.ts`'s doctrine ("stores what a cell is, not what it looks like") is not
broken, it moves one level down: the tileset is the semantic layer, and both sides read the same one.

**Autotiling is a brush, not a storage format.** The editor computes the edge variant when you
paint and freezes the resulting id. This is what allows a manual override: an author who wants a
specific tile can place it, because there is a field to put it in. Storing the material instead
would make that impossible by construction.

**The deviation.** XP has 5 tile behaviours; this ships 2. See Non-goals.

### Elevation without touching the engine

The wireframe's three elevation levels need cliff faces to block movement. XP would use
4-direction passage for this. That does not transfer: this engine moves in continuous pixels at
20 Hz against a box, not square by square, so "blocked from the north" has no clean meaning.

The grid-based collision makes a simpler answer available. A cliff face gets **its own cells**, and
those cells are simply impassable. The elevation brush writes two things: the raised top into the
painted cell, and the wall tile into the cell below it, on the next layer up. The wall is then an
ordinary tile whose tileset entry says `passable: false`.

Consequence: **no change to `isWalkableBox`, `resolveTerrain`, `step()`, or prediction.** The
passability grid is baked at map load exactly as `bakeCollision` bakes one today.

Ramps (the wireframe's stairs stamp) are the only passable cells that join two levels.

## Art

Everything needed is already vendored. No new art.

`assets/Tiny Swords (Free Pack)/Terrain/Tileset/Tilemap_color1.png` — 576×384, a 9×6 grid of 64 px
cells — is byte-identical to the wireframe's `ts_grass.png`. Its layout:

| Region | Content |
| --- | --- |
| cols 0-3, rows 0-3 | flat grass — the standard 4×4 autotile group |
| cols 5-8, rows 0-3 | raised grass tops, same 4×4 arrangement |
| cols 5-8, rows 4-5 | cliff wall tiles |
| cols 0 and 3, rows 4-5 | ramp / stair pieces |

The wireframe's `ts_stairs.png` is a hand-crop of those ramp cells, so the stair art is vendored too.
`Tilemap_color2..color5.png` are palette swaps of the same layout — four extra biomes for free, not
used in this tranche but the reason the tileset model carries an atlas reference per entry.

This file must be copied into `public/assets/lindocara/tiny-swords/terrain/`; only `Tilemap_Flat.png`
ships there today.

**Accepted visual change.** What the game currently renders as "grass" is `Tilemap_Flat.png`, which
is in fact a green tilled field. Existing maps will look different after migration. This is approved
and intended.

`Tilemap_Elevation.png` (256×512) was considered and rejected for this tranche: it is a second
texture with its own lookup table, and `color1` already carries matching tops and walls on one sheet.

## The tileset

A tileset is a data file, not a screen. Authors do not edit tile flags in this tranche; we ship the
Tiny Swords tilesets preconfigured. The "Base de données…" editor is tranche 6.

```ts
type TilePriority = "below" | "above";   // drawn behind, or in front of, characters

interface FixedTile {
  atlas: AtlasId;
  col: number;
  row: number;
  passable: boolean;
  priority: TilePriority;
  tint?: number;
}

type AutotileKind = "edge16" | "run4";

interface Autotile {
  atlas: AtlasId;
  origin: { col: number; row: number };  // top-left of the tile group
  kind: AutotileKind;
  passable: boolean;
  priority: TilePriority;
  tint?: number;
}

interface Tileset {
  id: TilesetId;
  autotiles: readonly Autotile[];   // max AUTOTILE_SLOTS
  fixed: readonly FixedTile[];
}
```

`edge16` is the existing 4-neighbour mask with 16 variants — `AUTOTILE_LUT` in
`client/game/autotile.ts`, moved to `shared/` unchanged. It is strictly better than the wireframe's
9-case approximation, which misses concave corners and the lone island.

`run4` is a horizontal-run mask (west/east only, 4 variants) used by cliff walls, which tile
sideways but never vertically.

`tint` carries the elevation shading. Levels 1 and 2 are separate autotile entries pointing at the
same raised-top region with different tints, so shading is a tileset property and never a per-cell
field.

### Tile ids

Mirrors XP's split id space.

```
id 0                            empty cell
1 .. FIXED_BASE - 1             autotile: id = 1 + slot * VARIANTS_PER_AUTOTILE + variant
FIXED_BASE ..                   fixed: id = FIXED_BASE + index into tileset.fixed
```

`VARIANTS_PER_AUTOTILE = 16`, `AUTOTILE_SLOTS = 64`, so `FIXED_BASE = 1 + 64 * 16 = 1025`. A `run4` autotile uses variants 0-3 and leaves 4-15 unused; wasting
twelve slots buys a single decode rule, which is worth more than the density.

Decoding an id to a draw instruction is a pure function in `shared/`, called by the renderer, the
editor and the passability bake.

## The map

```ts
const MAP_LAYERS = 3;

interface MapData {
  tilesetId: TilesetId;
  layers: readonly TileLayer[];   // exactly MAP_LAYERS, index 0 is the ground
  elements: readonly MapElement[];
  spawn: SpawnPoint;
  markers?: MapMarkers;
}
```

`blocks` is removed. `elements`, `spawn` and `markers` are unchanged — **this tranche does not
touch `map_element`.** Catalogue elements carry multi-cell footprints and terrain overrides that
tiles cannot express; they keep existing and keep baking collision exactly as today. Layers are
additive. Deciding whether elements eventually collapse into fixed tiles is out of scope.

### Encoding

Ids exceed 255, so the char-per-cell encoding cannot carry them. Each layer encodes as one
run-length string, row-major, runs comma-separated:

```
"0*120,17,18,17,0*38"
```

A bare number is one cell; `id*n` is `n` cells of `id`. Maps have long uniform runs, so this stays
small and — unlike base64 — remains readable in a database row and in a failing test's output.

`parseTileLayer` follows the codebase rule for anything off the wire: returns `null` on a malformed
or over-long payload rather than throwing. `decodeTileLayer` throws, for content read at build time.

## The brushes

All brush logic is a pure function in `shared/`, taking the current layers and returning the cells
to write. The editor and the tests call the same one.

**Autotile brush.** Paint autotile slot `A` at `(col,row)`: write the resolved variant there, then
**re-resolve the four orthogonal neighbours** that hold the same slot. This is the correctness-
critical step — a missed re-resolution leaves a stale edge, which is the failure mode that comes
with freezing variants.

**Elevation brush.** Paint level `L ∈ {0,1,2}` at `(col,row)`:

1. write the level's raised-top autotile into layer 0 at `(col,row)`, re-resolving neighbours;
2. if the cell below is lower, write the cliff-wall `run4` variant into layer 1 at `(col,row+1)`;
3. if the cell above became covered, clear a wall that is no longer justified;
4. re-resolve wall runs horizontally either side.

**One wall row per drop, regardless of level difference**, matching the wireframe. A level-2 cliff
beside level 0 draws one wall. The sheet's second wall row stays unused and available.

**Eraser** writes id 0 and re-resolves the same neighbourhoods.

## Passability

Baked once at map load, from layers plus tileset plus the existing element baking:

```
solid(cell) = any layer's tile is non-empty and not passable
            | existing bakeCollision contribution from elements
```

Produces the same `TileMap`-shaped grid the movement code consumes today, so nothing downstream
changes. `TileKind` survives as the *baked* collision vocabulary; it stops being an authored one.

## Rendering

Priority is per tile, not per layer, so a layer can hold both kinds. The renderer scans all three
layers once and fills two containers:

```
water → foam → tiles(priority "below") → elements/decor → actors → tiles(priority "above") → labels
```

Cliff walls are `below`; treetops and anything the player should walk behind are `above`. This is
the change that makes a character's head pass under branches.

Water stays a scrolling `TilingSprite` background, not a tile layer. `needsFoam` and the foam pass
are untouched.

**Cliff into water.** Foam rings the base of the wall, not the raised top's footprint — the wall is
where the water actually meets something. Foam is drawn below the tile layers, so this falls out of
treating the wall's cell as the land cell for foam purposes.

`autotile.ts` moves to `shared/` and becomes editor-and-bake code. The renderer stops computing
masks: it reads frozen ids.

## Database and migration

`map.blocks` (TEXT) is replaced by `map.tileset_id` (TEXT) and `map.layers` (TEXT, the three
encoded layers as JSON). `map_element` is untouched. The deferred tile behaviours need no reserved
columns: a tileset is a versioned data file in the repo, so adding a field later is a code change,
not a migration.

Migration, per existing map:

1. decode `blocks` to its `TileKind` grid;
2. `water` → id 0 (the water background shows through);
3. every other kind → the flat grass autotile, variant resolved from neighbours;
4. write layers 1 and 2 empty.

`forest` and `building` never appear in authored `blocks` — they are products of `bakeCollision` —
so nothing solid is lost. Elements continue to supply that collision.

The migration runs the same pure resolver the brush uses.

## Testing

Pure, in `shared/`:

- `edge16` resolution over every one of the 16 neighbourhoods, and `run4` over its 4.
- Neighbour re-resolution: painting a cell fixes its neighbours' edges. Property test — paint a
  random sequence of cells, assert every cell's variant equals a full-grid recomputation. This is
  the test that guards the frozen-variant failure mode.
- Elevation brush: wall appears below a drop, disappears when the drop is filled in, runs join
  horizontally.
- Layer encode/decode round-trip; `parseTileLayer` returns `null` on ragged, over-long and
  non-numeric payloads.

**The safety test.** For each existing map fixture, assert the passability grid baked from the
migrated layers is *cell-for-cell identical* to the grid `bakeCollision` produces from `blocks`
today. Prediction and movement must not shift by one pixel. This is the test that says the
migration is safe.

Integration, against the real Durable Object as the suite already does: a player walks a migrated
map and is blocked in the same places; a player cannot walk through a cliff wall; a player can walk
up a ramp.

## Non-goals

Deferred, each with its tranche:

- **Terrain tag** — has no consumer before the interpreter (tranche 5). Adding it later costs one
  tileset column and no map migration.
- **Bush** (legs hidden in tall grass) — dropped, no plan to add.
- **Counter** (talking across a shop counter) — noted for "one day". Must be redesigned for
  continuous movement rather than transposed from XP.
- **4-direction passage** — not needed, see Elevation above. Same continuous-movement objection.
- **Tileset editor UI** — tranche 6.
- **Second wall row for multi-level drops** — art is available, not wired.
- **`Tilemap_color2..5` biomes** — the model supports them; no UI selects one.

## Risks

**Stale edges.** The one real hazard of freezing variants. Mitigated by the property test above,
which compares incremental painting against full recomputation.

**Migration is one-way.** Once maps are layers, `blocks` is gone. Mitigated by the cell-for-cell
passability assertion and by keeping the migration a pure function that can be re-run.

**Wire size.** Three layers of ids instead of one char per cell. Run-length encoding absorbs most
of it — a mostly-uniform 40×28 map compresses to a few hundred bytes — but a densely decorated map
is larger than today's. Measure before the editor makes dense maps easy to build (tranche 2).
