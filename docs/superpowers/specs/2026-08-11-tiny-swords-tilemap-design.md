# Tiny Swords tilemap fidelity

Read the terrain sheets the way Pixel Frog drew them, and make the HD-2D mesher use every band they
carry. Three rendering defects, one showcase map that proves the fix, and the documentation of what
the sheet actually contains — because nothing in the repo records it today, and the one comment that
tries gets it wrong.

## Why

The engine draws a cliff that falls into the sea with grass tufts at the waterline and no wave.
It draws a staircase as eight boxes with a side-view sprite smeared across their tops, while the
collision underneath them already interpolates a smooth slope. Both are the same kind of mistake:
the sheet holds a tile for the case, and the mesher never asks for it.

## What the sheets hold

`Tilemap_color1..5.png` (Free Pack, 576x384, a 9x6 grid of 64px cells) is the sheet the lab and the
game both render from. Every composed variant — `neige`, `glace`, `roche`, the lab's `lvl0..2` —
reuses its geometry, so this anatomy is the whole terrain vocabulary:

| Region | Contents |
| --- | --- |
| cols 0-3, rows 0-3 | grass, 4x4 `edge16`, **white foam rim** — the block that borders **water** |
| cols 5-8, rows 0-3 | grass, 4x4 `edge16`, **tufted dark rim** — the block that **caps a cliff** |
| cols 5-8, **row 4** | cliff face **footed on land** — grass tufts sprouting at its base |
| cols 5-8, **row 5** | cliff face **footed in water** — a white foam scallop at its base |
| cols 0 and 3, rows 4-5 | the two 64x128 **ramps** (col 0 climbs right, col 3 climbs left) |
| col 4 | empty, a separator |

Rows 4 and 5 are **alternatives selected by what lies below the cliff**, not a stack. `atlas.ts`
currently documents row 5 as "the repeatable band that extends it", which is wrong and is the direct
cause of defect 1.

`Tilemap_Flat.png` (Update 010, 640x256, 10x4) is the sand sheet: two 4x4 `edge16` blocks (grass at
col 0, sand at col 5) and a decoration tuft at col 4 / col 9. It carries **no wall band at all**,
which is fine — sand only ever exists at level 0.

Pixel Frog's own guide describes the layer stack as BG colour, Water Foam, Flat Ground, then Shadow
and Elevated Ground repeated once per level, plus Stairs. We implement every component except the
Shadow sprite; see "Deliberately not doing".

## The three defects

### 1. Row 5 is never drawn

[`mesh.ts`](../../../packages/hd2d/src/terrain/mesh.ts) reads `atlas.wallRow` unconditionally, and
every atlas declares `4`. A cliff dropping into the sea therefore gets the land-footed face.

**Fix.** `TerrainAtlas` gains an optional `wallRowInWater`. In the wall loop, the foot lands in water
exactly when the neighbour across that side has no level:

```ts
const footInWater = field.levelAt(i + di, j + dj) === null;
const wallRow = footInWater ? (atlas.wallRowInWater ?? atlas.wallRow) : atlas.wallRow;
```

`wallDrop` already sends a void-facing wall down through all its levels, so the segment that needs
row 5 is exactly the segment whose foot reaches the bottom. The fallback keeps the sand sheet — which
has no such row — working unchanged.

Both composition roots declare `wallRowInWater: 5` for the 9x6 sheets:
[`apps/lab/src/boot.ts`](../../../apps/lab/src/boot.ts) and
[`packages/renderer/src/hd2d/scene.ts`](../../../packages/renderer/src/hd2d/scene.ts).

### 2. Foam stops at level 0

[`foamPlacements`](../../../packages/hd2d/src/terrain/foam.ts) requires `levelAt(i, j) === 0`, so an
elevated shore gets no wave — the second half of the same missing waterline.

**Fix.** Accept any land cell that touches water: `levelAt(i, j) === null` is the only skip. The
placement itself does not otherwise change. A pastille still sits at water level and is still hidden
by the geometry above it — `meshTerrain`'s `wallShell` closes the volume, so only the overhang past
the cliff base shows, which is precisely the rim the sprite is drawn for.

### 3. Stairs are boxes wearing a side-view sprite

[`meshStairs`](../../../packages/hd2d/src/terrain/stairs.ts) builds eight `BoxGeometry` steps and
maps the 64x128 ramp strip across their top faces. The strip is a side elevation: half of it is
transparent, and slicing it horizontally shows neither a tread nor a slope. Meanwhile
`rampSampleAt` ([`terrain-query.ts`](../../../packages/engine/src/hd2d/terrain-query.ts)) already
gives a hero a smooth linear climb, so the render actively contradicts the collision it stands on.

**Fix.** Build the ramp the collision already describes:

- **One sloped top quad** spanning the ramp rectangle, its two high corners at
  `(lowLevel + 1) * levelHeight` and its two low corners at `lowLevel * levelHeight`, with `east`
  climbing towards `+x` and `west` towards `-x` — the same `progress` convention `rampSampleAt`
  uses, so the surface and the collision cannot disagree. Textured with the plain fill tile of its
  atlas's block (block origin + col 1, row 1), which is what makes it read as ground rather than as
  an object placed on ground.
- **Two triangular cheeks**, one per lateral side, from the low end to the high end, textured with
  the cliff wall row so the ramp's flank matches every other cliff in the scene.
- **Its atlas resolved per ramp, from the level it climbs to.** Grass reads its tileset from its
  altitude — the pack ships five hues and `terrainAtlasKey` picks one per level — but `meshStairs`
  today takes a single atlas and both composition roots hand it `lvl0`. A ramp climbing 1 to 2 is
  therefore drawn in level 0's green. `MeshStairsOptions` replaces `atlas` with
  `atlasFor(level: number): TerrainAtlas`, and each ramp asks for `lowLevel + 1`: the plateau you
  walk off is the hue the eye compares the slope against, and it is the bank Pixel Frog draws the
  ramp sprite in. All three callers — the lab, the game scene and the editor's ghost preview — pass
  a closure over the `atlases` record they already build.
- **The same vertex colouring as the terrain**: `tintAt` for the procedural hue, and the wall-foot
  darkening curve (`AO_WALL` over `AO_WALL_HEIGHT`) so the ramp's base sinks into the ground the way
  a cliff's does.

`WATER_EDGE_COL` / `CLIFF_EDGE_COL` / `blockOrigin` move from `mesh.ts` to `atlas.ts`, beside the
`TerrainAtlas` they interpret, so `stairs.ts` can reach them without importing the mesher. `tintAt`
stays in `mesh.ts` and gains a second legitimate consumer; its doc comment is corrected to say so.

`MeshStairsOptions.steps` is deleted — there are no steps. `color`, `opacity` and `lift` stay: the
editor's ghost preview ([`visual-layer.ts`](../../../packages/renderer/src/hd2d/visual-layer.ts))
uses them.

## The showcase map

A seed adventure, so the fix is proven through the game's own renderer path with a real hero, not
only in the witness.

`scripts/build-showcase-map.ts` builds a `MapData` and `scripts/seed-showcase-adventure.ts` seeds it,
modelled on the `build-proving-map.ts` / `seed-proving-adventure.ts` pair and reusing its flow:
create the adventure and map through the API, then stamp the terrain through
`PUT /api/maps/:id/heightfield`.

Unlike the proving map, the grid is **hand-authored, not generated** — a generated island proves an
island, and the point here is coverage. The layout must contain, each reachable and each visible from
a normal camera:

- all sixteen `edge16` variants of level-0 grass: the isolated tile, the three cells of a one-wide
  column, the three cells of a one-tall row, the four corners, the four edges, and plain fill;
- a sand beach meeting grass on one side and the sea on the other;
- a level-1 plateau dropping onto **land** on one side (row 4) and straight into the **sea** on
  another (row 5 plus foam) — the two cases side by side, so a screenshot shows the difference;
- a level-2 mesa, for a two-level drop;
- a land-locked lake, for an inner shore;
- both ramps: one `east` climbing 0 to 1, one `west` climbing 1 to 2.

The generator is deterministic — no clock, no `Math.random` — and the layout is reviewed as ASCII
through `scripts/preview-reference-map.ts` before anything is booted.

## Verification

- Unit tests in `packages/hd2d/test/`: `terrain-mesh.test.ts` asserts a void-facing wall carries row
  5's UVs and a land-facing wall row 4's; `foam.test.ts` asserts an elevated shore cell is placed;
  `terrain-stairs.test.ts` is rewritten to assert the sloped surface's corner heights against
  `rampSampleAt`'s own formula rather than against a box count, and that a ramp asks `atlasFor` for
  `lowLevel + 1`.
- `npm run check` for the repo, and `npm run typecheck` covers the new scripts through
  `tsconfig.tooling.json`.
- The showcase adventure seeded into the dev server on port 5273 and walked in the browser with the
  `playwright-cli` skill: screenshots of the two cliff feet, the ramps, and the beach.

## Deliberately not doing

- **The Shadow sprite layer.** The guide's sixth component exists because a 2D tilemap has no
  lighting. Ours casts real directional shadows from the cliff geometry, adds cloud shadows, and
  already darkens the wall foot with `AO_WALL` and the corners with `cornerOcclusion`. Laying a
  painted blob on top would double-darken every cliff foot and disagree with the sun as the camera
  yaws. If the feet read too light against the reference, the answer is to tune `AO_WALL`.
- **Per-cell water-edge / cliff-edge block selection.** It looks like a gap and is not: a plateau
  meeting the sea *should* wear the tufted rim, because there is a cliff below it. The waterline
  belongs to the wall's foot and to the foam, both of which defects 1 and 2 fix. The existing
  per-material declaration is correct given these sheets.
- **Stacking one wall tile per level on tall cliffs.** The Free Pack sheet has no plain repeat band —
  only the land-footed and water-footed variants — so stacking would sprinkle grass tufts halfway up
  a two-level cliff. The current single stretched UV cell stays.

## Risks

- `neige`, `glace` and `roche` are composed sheets. They share the 9x6 geometry, so row 5 exists in
  all of them, but whether their generated fill carries a convincing foam scallop is an eye check,
  not a test. Look at each once the mesher starts asking for the row.
- The showcase map's coverage claim is only as good as the layout. The ASCII preview is the guard:
  if a variant cannot be pointed at in the preview, it is not covered.
