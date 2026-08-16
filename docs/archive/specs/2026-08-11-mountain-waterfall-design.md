# The mountain and its waterfall — design

Date: 2026-08-11
Status: approved in brainstorming

## Goal

A fifth island in `apps/lab`, carrying a terraced mountain and a **three-drop waterfall** delivered
as a complete experience: falling water, catch basins, mist, spray, a rainbow, a distance-driven
roar, and its own zone with its own theme.

The mountain itself is scenery. It is terrain blocks at high elevation — a silhouette you approach
and can climb one 0.9-unit jump at a time, with nothing authored at the summit. **The waterfall is
the deliverable**; the mountain exists to give it somewhere to fall from.

This is lab work, in the lab's own sense: `apps/lab` is the witness for `@lindocara/hd2d`, so the
one genuinely new piece of render code (the falling sheet) is built **in the package**, not in the
app, and the app proves it. Exactly one edit deliberately leaves the lab — the falling sheet in
`@lindocara/hd2d` — and it is named as such below.

A wet-rock terrain material was part of the original scope and has been **cut**; the measurement
that killed it is recorded under "Wet rock, and why it is not here" near the end.

## What already exists, and what does not

Four findings from reading the current code decided the shape of everything below. They are
recorded here because each one closes off an approach that looks obviously right from the outside.

**Islands are author data, and the map is baked.** `ILES` (`apps/lab/src/world/island.ts`) is a
fixed list of `{x, z, r, onde, reliefs}` shapes in world coordinates; `mulberry32` exists for prop
scatter, not for island shape. The result is compiled once into `public/maps/ile.json` by
`npm run build:map` and **committed** — an edit to `ILES` that skips that step silently drifts from
what the dev server loads. A new island is therefore a data entry plus a re-bake, not a generator
change.

**A tall cliff face renders as one stretched texture cell.** `mesh.ts` states it directly: *"One UV
cell now stretches over the full drop, preserving a single tall-block silhouette."* That is the
right call for a level-2 cliff and the wrong one for a mountain — a five-level face would smear the
rock texture over 4.5 world units. The consequence is not a bug to fix but a constraint to design
around: **every wall on this island stays one level tall**, which a terraced cone gives for free.

**There is no water at altitude, anywhere in the model.** `createWater` builds a single horizontal
plane at `WORLD.waterLevel`, and `TerrainQuerySource.waterLevel` is one global scalar the whole
collision path reads. Nothing can detect "water above a cliff edge" the way `foamPlacements`
detects a shoreline from the height field. A waterfall therefore **cannot be derived** — it is an
authored placement, and its basins are decorative by construction rather than by choice.

**Distance-driven held sound is already solved.** The campfire is a `BOUCLES` loop whose gain is
driven every frame by `setFireDistance` against `PORTEE_FEU` (13 units), and the skid sound
(`glisse`) borrows the same infrastructure with a gain driven by skid intensity instead. A
waterfall roar is a third instance of a proven pattern, not a new audio system.

## The island

A fifth entry in `ILES`, at **(-25, 10), radius 7**.

The position was measured, not guessed. Sampling every existing island's effective reach
(`r · (0.94 − onde(a))`, the real threshold `makeHeightmap` applies) around the full circle gives:

| island | centre | radius | effective reach |
| --- | --- | --- | --- |
| main | (0, 0) | 16 | 12.02 – 18.06 |
| east (house) | (25, −1) | 8.5 | 6.77 – 11.42 |
| south (Grota) | (1, 24) | 4.6 | 3.82 – 4.83 |
| north (polar) | (0, −26) | 7.5 | 5.81 – 8.29 |

The main island's westmost point sits at x ≈ −15.91, so the west quadrant is the only free space
of any size. At (−25, 10) with radius 7 the new island keeps **3.9 units of open water** to the
nearest existing land and **3.1 units of margin** to the grid edge. That matters twice over:
`WORLD.size` stays at **72**, so the terrain mesh does not grow (a bump to 80 would be +23% cells
across the entire map for one island), and the crossing stays a genuine swim, which is what the
zone needs in order to fade in while the hero is still in the water.

`onde` gets a modest two-harmonic profile like its neighbours. `apps/lab/test/island.test.ts`
already asserts the north corridor stays open water on its full width; the same assertion is
extended to the west corridor, so a later tweak to either shape that closes the swim fails a test
instead of silently making the island walkable.

## The mountain

Four concentric `IslandRelief` discs of shrinking radius at `h = 1, 2, 3, 4`, combined by the
`Math.max` that `makeHeightmap` already applies. No new primitive, no new field.

That yields a **terraced cone**, and the terracing is load-bearing in three separate ways:

- **Every wall is exactly one level (0.9).** The stretched-UV behaviour above never bites, because
  no face is ever taller than the one cell its texture covers.
- **Every step is exactly one jump.** `WORLD.maxStep` is 0 — no cliff is walked up, all of them are
  jumped — and the hero's apex is `speed² / (2·gravity)` = 1.35 units against a 0.9 step. The path
  to the summit is the terraces themselves; nothing needs authoring, and `meshStairs` (which exists
  in `hd2d` and which the lab has never used) stays unused.
- **The silhouette reads as a mountain from the near-orthographic camera.** Stacked terraces catch
  the sun at four different heights and cast four shadow bands; a smooth cone at this FOV would
  read as a flat blob.

The summit sits at level 4 ≈ 3.6 units above sea level and carries no content — no NPC, no chest,
no dialogue. It is a vantage point and a shape. The one thing on it is the waterfall's own spring
pool (below), which is scenery: it explains where the water comes from, and a fall whose source is
off-screen reads as a leak rather than a spring.

### The rock band is appearance, not a rule

`renderMaterialAt` (`island.ts`) maps `(rule material, level) → atlas key`, and `levelSet` currently
clamps every level ≥2 onto `lvl2`. It gains one case: levels ≥3 return a new `"roche"` key.

This is deliberately a **render band and not a `TerrainMaterial`**. The function's own docstring
already establishes the distinction — the band is *"une dérivation (palier, matière) → bloc
d'atlas, pas une donnée en soi"* — and honouring it means the mountain's rock costs zero rule
changes: no collision difference, no friction difference, no new member in a union shared with the
game's server. The tileset is generated with `scripts/compose-tileset.py` onto the Tiny Swords 4×4
block geometry, exactly as `tileset-neige.png` and `tileset-glace.png` were, and registered as one
more entry in `boot.ts`'s `atlases` record with `block: "cliff-edge"` and `atlas: true` in
`TEXTURE_URLS` (a terrain atlas without `atlas: true` gets mipmaps, and its lower levels blend
neighbouring tiles into bleeding borders — see `docs/hd2d-rendering.md`).

## The waterfall

A new module, `packages/hd2d/src/terrain/waterfall.ts`, beside `water.ts` and `foam.ts`.

**Authored placement.** A waterfall is declared as data — `{x, z, width, topLevel, bottomLevel,
facing}` — in `apps/lab/src/settings.ts`, beside the island it belongs to, the way `NORD` and
`GROTA.at` are. It cannot be derived (see above), and pretending otherwise would mean inventing a
"water source" concept in the height field that nothing else in the engine wants.

Three primitives, one mesh each:

1. **The falling sheet.** A vertical quad hugging the cliff face, scrolling `/tex/water.png`
   downward. Custom shader in the spirit of `createWater`'s: opaque core so it never repaints over
   the alpha-tested foam, softened alpha at the lateral edges, a horizontal squash at the lip
   (water accelerates as it leaves the edge) and a widening toward the base.
2. **The catch basin.** A small horizontal water disc on the terrace below, at that terrace's
   height, reusing the water shader with `depthRange` collapsed — a basin has no "open sea" tint to
   grade toward, but it must read as the same substance as the ocean or the island falls apart
   visually.
3. **The plunge ring.** A ripple decal where sheet meets basin, animated the way `makeRipple`
   already drives the hero's swim wake.

**Three drops, chained.** Level 4→3 (thin, the source), 3→2 (the main drop, widest, the one the
rainbow and the loudest mist belong to), and 2→1 (the last). Each is the same three primitives with
different settings, so building the first one well delivers the other two.

Every drop is **one level tall**, which is not a coincidence but the terracing rule from above
applied to the water: a sheet spanning two levels would hang over a two-level wall, and no such
wall exists on this island. The chain is closed at both ends without a fourth sheet — a shallow
spring pool on the summit terrace feeds the first drop (a basin without a sheet above it), and the
lowest basin is placed on a level-1 terrace whose outer lip **is** the shoreline, so it drains
visibly into the sea across the existing beach and foam rather than needing a sheet of its own.

**The basins are decorative and stay that way.** The hero wades through them: `TerrainQuery` keeps
its single global `waterLevel`, no swim state, no breath, no splash-in. Teaching the engine about
per-cell water height is a change in `@lindocara/engine` shared with the game's authoritative
server, and nothing in this chantier justifies it. What the basins get instead is ripples at the
hero's feet and the mist and spray below.

**Budget.** Three drops × three meshes, plus the summit spring pool = 10 added draw calls. The
lab's 60 fps target is a hard
constraint, not a goal: this is verified against the page's own fps counter and, if the number
turns out to be close, against `bench.measure()` through the `readPixels` method documented in
`apps/lab/AGENTS.md` — `performance.now()` around `render()` measures command queuing and is worth
nothing here.

## The package

### Sound

- **The roar.** A `cascade` entry in `BOUCLES` (`core/audio.ts`), created once by
  `demarrerBoucles` and silent until driven, with its gain set every frame from the hero's distance
  to the nearest drop against a `PORTEE_CASCADE` — the `feu`/`setFireDistance`/`PORTEE_FEU` path,
  third instance. Generated on the studio's `sfx` lane.
- **Spray accents.** Short one-shots near the basins on the existing `jouer()` random-variant path,
  which already randomises variant and pitch so a handful of samples do not become audible loops.
- **Wet footsteps.** A `pasRocheHumide` bank and a new `case` in `pasDe`. The switch is exhaustive,
  so TypeScript flags this site the moment the material union grows — it cannot be forgotten.

The loop needs the tail margin the polar chantier established: Opus perceptibly deforms the last
samples of an encoded stream (its transform window has no context past end-of-file), which produced
a measurable click at the loop seam until `LOOP_END_S` was made to loop *before* the damaged zone.
A new held loop gets the same treatment and the same entry.

### The zone

`ZONE_FALLS` in `settings.ts`, inserted into `ZONES` **before** `ZONE_LARGE` — the ordering *is*
the priority in `zoneAt`, and the infinite-radius default must stay last.

It carries its own ambience bed (`nappe`) and its own generated theme (`musique`), and `souffle: 1`
— there is no reason this water is crueller than the open sea; the doubled drain belongs to the
polar chantier's icy water and should not be copied by reflex.

Its radius extends past the island's littoral so **the change lands while the hero is still
swimming**, before the first step ashore. That is exactly the lesson `ZONE_POLAIRE.rayon = NORD.r +
3` encodes, and `apps/lab/test/zone-precede-matiere.test.ts` pins the relation for the polar zone by
importing the real symbols rather than restating the formula. The same test grows a case for this
zone, so a later tweak to either the radius or the island's reach that breaks the ordering turns a
test red instead of quietly making two events land on the same frame.

### The effects

- **Mist column** at each landing: the hot spring's `VAPEUR_SOURCE` recycled puff pool
  (`world/props.ts`), retuned — denser, wider, faster-rising, cooler in colour. Same machine, new
  settings; no allocation during play, as with every pool in the lab.
- **Spray burst** at each sheet's foot: a short-lived additive swarm, the `createParticleField`
  ember machine with a different respawn function.
- **Drifting low fog** at the island's base: driven through the existing `MoodConfig.fogPulse`
  channel that `BLIZZARD` already uses. No new mood field, and — like the aurora and the blizzard —
  it stays 0 in both `MOODS` entries, lit by the zone rather than by the hour.
- **The rainbow**: a thin additive arc billboard anchored to the main drop, its opacity driven by
  the sun's azimuth (`SUN_DRIFT` already oscillates it, ±22° over 96 s) and gated to daytime moods.
  The gating mirrors `applyAurora`, which fades the aurora in only when the hero is in the polar
  zone *and* it is night, with its own fade independent of `MOOD_FADE`.

### Wet rock, and why it is not here

A sixth `TerrainMaterial` — wet rock on the ledges beside the falls, with its own footstep and a
friction between grass's and ice's — was scoped into this chantier and then **cut on measurement**.

The estimate was six sites, all mechanical. The count was wrong, and one of them is not mechanical
at all:

| file | what it would need | mechanical? |
| --- | --- | --- |
| `packages/engine/src/hd2d/terrain-query.ts` | the union member | yes |
| `packages/engine/src/hd2d/map-data.ts` | `TERRAIN_MATERIALS`, the parser's runtime list | yes |
| `packages/engine/src/hd2d/locomotion.ts` | `frictionPour`, `vitesseMaxPour` | yes |
| `packages/engine/src/hd2d/hero-state.ts` | `HeroSettings.friction` | yes |
| `packages/engine/src/tilesets/tiny-swords.ts` | **four tile-id slots in the game's authored tile id space** | **no** |
| `packages/renderer/src/minimap.ts` | `MATERIAL_COLORS`, an exhaustive `Record` | yes |
| `packages/renderer/src/hd2d/scene.ts` | the material → atlas case | yes |
| `packages/audio/src/movement.ts` | `STEPS` — **not exhaustive**, falls back to grass | silent if missed |
| `packages/audio/src/assets.ts` + `packages/audio/assets/` | a bank key and three `.ogg` takes | yes |
| `apps/lab` | `renderMaterialAt`, the assignment, `pasDe`, `HERO.friction` | yes |

`TERRAIN_MATERIAL_SLOTS` is declared `satisfies Readonly<Record<TerrainMaterial, ...>>`, so the
union cannot grow until the new member is given four tile ids in the space authored maps are
stored in — ids no shipped tileset has art for, for a material only the lab would ever paint. That
is a content-format decision, not a plumbing change, and it is far too much to carry for a footstep
sound and a friction value.

Two smaller findings came out of the same measurement and are worth keeping:

- **`STEPS` is `Record<string, StepSample>` with a grass fallback**, not an exhaustive record. A
  material missing from it does not fail the build — it silently plays a grass footstep. Any future
  material must be added there by hand, because nothing will tell you.
- **Footsteps are no longer lab-local.** They moved to `packages/audio/assets/`, reached through
  `audioAssetUrl`, so the game and the lab share one copy. Ambience beds, doors and dialogue ticks
  stay in `apps/lab/public/sfx/`. The root `AGENTS.md` package table does not list
  `@lindocara/audio` yet.

The ledges therefore keep rock's ordinary footing. If the footing turns out to matter once the
falls are on screen, it comes back as its own chantier, costed honestly against the tile id space.

## Language

New identifiers, comments and docstrings are written in **English**, following the glider
chantier's precedent (`HERO.glide`, `GLIDER`, and their English docstrings in `settings.ts`) rather
than the older French code around them. Existing French symbols are not renamed as a side effect of
this work.

Nothing in the remaining scope adds a value to a persisted vocabulary, so the decision costs
nothing here: the one place it would have bitten was the cut wet-rock material, whose value would
have had to sit in a union of French strings and in every baked map.

## Staging

Small increments, each ending on screen at 60 fps — the lab's own acceptance test.

1. **The island and the mountain.** `ILES[4]`, the four relief discs, the rock render band and its
   generated tileset. Map re-baked; `island.test.ts` extended for the west corridor.
2. **The falling sheet.** `waterfall.ts` in `@lindocara/hd2d`, one drop, silent, no basin.
3. **Basin, plunge ring, and the three drops chained.**
4. **The roar** — sfx lane, `BOUCLES` entry, distance gain.
5. **`ZONE_FALLS`** — generated theme, ambience bed, `zone-precede-matiere.test.ts` case.
6. **Mist, spray, low fog.**
7. **The rainbow.**

Steps 1–3 are the chantier's spine; 4–7 each stand alone and can be judged, kept or retuned on
their own.

## What this deliberately does not do

- **No swimmable water at altitude.** Named above; it would change a shared engine contract for a
  visual feature.
- **No summit content.** No NPC, no chest, no dialogue. The mountain is scenery, by the brief.
- **No stairs.** `meshStairs` exists in `hd2d` and stays unused: terraces plus the existing jump
  already make the mountain climbable, and wiring a second traversal primitive into the lab for the
  first time is its own chantier.
- **No wet-rock material, and no `@lindocara/engine` edit at all.** Cut on measurement — see "Wet
  rock, and why it is not here" above. `waterfall.ts` lives in `@lindocara/hd2d` because it is
  render code; nothing that remains belongs in the pure rule package.
- **No change to `WORLD.size`.** The measurement above exists precisely so the whole map does not
  get 23% more expensive for one island.
