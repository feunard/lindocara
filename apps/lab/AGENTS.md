# @lindocara/lab

A **witness, not a frozen copy**. `apps/lab` reproduces the retired `poc-hd-2d` PoC â€” a hero, a
troop, an island, day/night, dialogue, a house â€” on top of the real `@lindocara/hd2d` package
rather than the PoC's own copy of the render code. That single fact is the whole point of this
app: it consumes the **same** package the game will eventually consume, so an experiment that works
here works in the game. A screen-for-screen port frozen at Task 12 would drift from `hd2d` within
two weeks of the next change and stop being a witness for anything â€” every change to `hd2d` gets
proven against the lab before it's trusted, and the lab is kept current with `hd2d`, not the other
way around.

**`apps/lab` depends on exactly `@lindocara/hd2d`, `@lindocara/engine` and `three`** â€” no
`server`, `client` or `renderer`. It also does not (yet) feed the game: the game's render path is
now HD-2D, and the lab remains its isolated render witness (see the root
[`AGENTS.md`](../../AGENTS.md) and
[`docs/superpowers/specs/2026-08-02-hd2d-reboot-design.md`](../../docs/superpowers/specs/2026-08-02-hd2d-reboot-design.md)).
`island.ts` is the remaining deliberate exception to "witness, don't build product here": it is
written as the future `@lindocara/engine` generation module, kept pure and `three`-free on
purpose, so a later task can promote it by moving the file, not rewriting it. Its siblings already
made that move: `terrain-query.ts`, `collider-index.ts` and `map-data.ts` first, then
`hero-state.ts`, `locomotion.ts` and `hero-step.ts` â€” all now live in
`@lindocara/engine/hd2d/`, tile-unit geometry AND the hero's movement rule kept in their own
subfolder there, away from the pixel-unit `simulation.ts`/`collider.ts` the live game still ships
against â€” and the lab imports every one of them back as `@lindocara/engine/hd2d/*.js`. **`world/hero.ts`
is an adapter, not the rule** â€” it holds the billboards, the animator, the audio calls and the
camera-facing bits, and every frame it calls `stepHero()` (`@lindocara/engine/hd2d/hero-step.js`)
with the current `HeroState` and plays back whatever `HeroEvent`s that pure call returns. It keeps
exactly TWO rules of its own, both deliberate exceptions documented at the field level in
`HeroState` (`packages/engine/AGENTS.md`'s `hd2d/` section): the attack state machine (`attaque`,
presentation timing a server doesn't need)
(`thinIce.update(dt)`, called once per frame, unconditionally, before `stepHero` â€” see
`StepDeps.glace`'s docstring for why `stepHero` itself never does). Everything else about why the
hero jumps, skids or drowns the way it does lives in `hd2d/`, not here. **The
glider adds no third rule**: opening/closing the canopy and pinning the descent to
`HERO.glide.fall` are `stepHero`'s (`state.gliding`, `hero-step.ts`), and `hero.ts` holds only the
canopy billboard, its flip (sharing `state.facing` with the body) and the deploy sound.

## Files

- `main.ts` â€” the composition root: loading (byte-weighted, `hd2d/loader.js`), world assembly
  (terrain, water, foam, props, Grota, Nanuq, the hero, the house/interior, the harness), the
  pipeline, moods, zones, dialogue, camera and the render loop. Everything else is a factory this
  file wires together â€” it owns no game rule of its own.
- `bench.ts` â€” the load-testing harness (`createBench`, Task 13); see "The load-testing harness"
  below.
- `settings.ts` â€” every tunable that is *content*, not engine: world size/seed, camera, hero
  stats/animation clips (including the friction/speed table â€” see "The snow island" below), Grota,
  Nanuq (`NANUQ`), water, the polar zone (`ZONE_POLAIRE`) and its ambience knobs (snowfall, breath,
  footprints, aurora, blizzard), the day/night `MOODS`, and `TEXTURE_URLS` (`hd2d` knows no content
  URL, only filtering policy â€” the catalogue lives here).
- `core/audio.ts` â€” WebAudio playback: a suspended context woken on the first click, footstep
  cadence by distance not time (five materials â€” see "The snow island" below), and a dubbed-line
  path per NPC (`VOIX`, keyed by character: `grota`, `habitant`) outside the random-variant path.
- `core/dialog.ts` â€” the dialogue banner, shared by every NPC (`Dialog.start`'s optional `voice`
  argument selects whose `VOIX` entry cadences the typing) â€” one bandeau, not one per character;
  typing cadence follows the voice line's real duration.
- `core/input.ts` â€” keyboard/mouse sampling (AZERTY+QWERTY+arrows, wheel zoom, right-drag orbit).
- `world/island.ts` â€” pure procedural heightmap + beach generation (`generateIsland`,
  `mulberry32`), including the frozen lake and snow of the north island (Task 4-7 of the
  snow island). Destined for `@lindocara/engine` in S2 â€” see above and "The snow island" below.
- `@lindocara/engine/hd2d/terrain-query.ts` â€” `TerrainQuery`: world-space collision queries over a
  `HeightField`, and `TerrainMaterial`, the five-material type
  (`sable`/`herbe`/`neige`/`glace`). Moved out of `apps/lab` first, kept `three`-free
  from the start for exactly this move.
- `@lindocara/engine/hd2d/locomotion.ts` â€” the friction-based movement model (`pasAmorti`) and the
  per-material friction/speed/skid helpers. Pure and deterministic on purpose â€” see "The snow
  island" below for why, and for the consequence this had for S2. Moved out of `apps/lab` alongside
  `hero-state.ts` and `hero-step.ts`.

- `world/zones.ts` â€” `Zone`/`zoneAt`: a named region carrying its own ambience (soundscape, music,
  breath-drain rate). Pure rules; `main.ts` reads `zoneAt` every frame and wires the result to
  `core/audio.ts` and the hero.
- `@lindocara/engine/hd2d/hero-state.ts` â€” `HeroState`/`HeroInput`/`HeroSettings`/`HeroEvent`/
  `StepDeps`: the data a step of hero simulation reads and writes, and what it narrates having
  caused. Nothing here holds a `three` type, a billboard or a sound â€” that's `hero.ts`'s job, below.
- `@lindocara/engine/hd2d/hero-step.ts` â€” `stepHero`: the per-frame movement rule itself, horizontal
  and vertical, mutating a `HeroState` in place and returning the `HeroEvent`s it caused for the
  adapter to play. This is what moved out of `world/hero.ts`'s old `update()` across S2's tasks.
- `@lindocara/engine/hd2d/collider-index.ts` â€” the static spatial grid props/the house/the NPCs
  register into. Colliders are axis-aligned rectangles (the primitive that can model a long wall,
  which a circle couldn't); the hero's own footprint stays a circle, tested disc-vs-rect by nearest
  point â€” see `hero-state.ts`'s `ColliderQuery`, the interface that hides the shape change from the
  rule. Moved out of `apps/lab` first, alongside `terrain-query.ts`.
- `@lindocara/engine/hd2d/map-data.ts` â€” `MapData`/`encodeMap`/`decodeMap`: a map as pure,
  defensively-parsed data (Task 10), plus `mapToQuerySource` to adapt a decoded map into what
  `createTerrainQuery` consumes. `scripts/build-map.ts` writes one; `main.ts` loads it instead of
  generating the island procedurally. Moved out of `apps/lab` in Task 11.
- `world/npc-base.ts` â€” `planStaticNpc()`, the shape every static NPC shares (water guard,
  collider registration, squared-distance `inReach`) and the `NpcHandle` interface `npc.ts`/
  `snow-npc.ts` alias. Holds nothing about a billboard, an animator or dialogue text â€” those stay
  per-character in the two factories below.
- `world/hero.ts`, `sheep.ts`, `npc.ts`, `snow-npc.ts`, `chest.ts`, `house.ts`, `interior.ts`,
  `props.ts` â€” gameplay entities, each a `create*(ctx, textures, ...)` factory returning an
  `update(dt)` handle. `npc.ts` (Grota) and `snow-npc.ts` (Nanuq, Task 12 of the snow island) are
  a second CONTENT in a system that already expects one, not a second system: their shared shape
  (collider, height guard, reach test) lives in `world/npc-base.ts`, each factory keeps only what
  genuinely differs â€” see "The snow island" below.
- `world/debug.ts` â€” the `B` collision-volume overlay: walkable-cell edges, impassable-step edges,
  prop/hero footprints. When a move looks wrong, this is where you see why.

## Scripts

- `scripts/sync-assets.sh` â€” the only way anything reaches `public/`. Reads the Tiny Swords packs
  from `packages/catalog/assets/` and the SFX pack from `$LAB_SFX_PACK` (371 MB, out of tree),
  extracts just the files actually used, renames them space-free for Vite, and applies the
  re-encodes/crops. Adding an asset means adding a line here and re-running it â€” never a manual copy.
- `scripts/sprite.py` â€” turns a *generated* image (a smooth illustration on flat background) into a
  playable sprite: background removal by edge propagation (a flat colour test would punch holes
  through a sprite's own shadows), tight crop, downscale to the game's pixel density, colour
  quantisation. The downscale is the real work â€” a model outputs smooth 768Â², the rest of the game is
  64-192 px pixel art, and without it a generated chest is ten times more detailed than the trees
  around it. `assets/generated/PROVENANCE.md` records which assets went through it.

## The snow island

A fourth island, `ILES[3]` in `world/island.ts`, frozen and reachable only by swimming
(`NORD`/`ZONE_POLAIRE`, `settings.ts`) â€” the couloir between it and the main island stays open
water on purpose, so the ambience change (nappe, music, breath drain) lands *while* the hero is
still swimming across, before the first step in the snow. It carries a frozen lake (`LAC_R`), a
snow everywhere else, a hot spring (the polar counterpart of
the campfire â€” same glow/shadow/fill-light plumbing, `world/props.ts`), snow-covered pines and ice
stalagmites, and Nanuq, the second NPC.

**Five terrain materials, one collision path.** `TerrainMaterial`
(`@lindocara/engine/hd2d/terrain-query.ts`) is
`"sable" | "herbe" | "neige" | "glace"`.
render one â€” it shares `glace`'s atlas and step sound, and only Task 7's crackle overlay tells them
apart visually. Passability still comes from `tiles`/`isWalkable` exactly like the other three
islands (see the root `AGENTS.md`'s "Maps and the editor" section for why collision only ever comes
from the baked grid, never from appearance): material is read to pick friction, footstep sound and
whether a cell can crack, never to decide whether a cell blocks.

**One movement model, three frictions â€” and why that's the load-bearing decision of this whole
chantier.** `@lindocara/engine/hd2d/locomotion.ts`'s `pasAmorti` replaces the old instantaneous
`vitesse = entrÃ©e Â· HERO.speed` with `dv/dt = friction Â· (cible âˆ’ v)`, integrated EXACTLY (not
Euler) so the result is independent of `dt` and replays identically at any step size. Input
accelerates, the material brakes â€” grass is tuned to stay indistinguishable from the old
instantaneous model (fast accel/decel), snow brakes harder AND caps lower (`HERO.vitesseSol.neige`
= 0.55Ã—), ice barely brakes at all (`HERO.friction.glace` = 0.35, so releasing input a full second
later you're still gliding at ~70% speed â€” a turn skids instead of snapping).
`hero-state.ts` (the data) and `hero-step.ts` (`stepHero`, the per-frame rule) complete the set —
every file, and all their tests, moved into `@lindocara/engine/hd2d/` in this chantier's last task;
see `packages/engine/AGENTS.md`'s `hd2d/` section for what each one now holds.

All of them are written **pure and deterministic to the bit** â€” no `Math.random`, no clock, no
`three` â€” not as a style preference but because **this is the movement model the game is getting**.
Introducing inertia here is deciding the game has inertia, and that decision has a real cost
downstream: `@lindocara/server`'s authoritative `step()` and the client's prediction/reconciliation
(root `AGENTS.md`, "Why `step()` lives in `shared/`") both replay committed input deterministically
â€” an inertial model must replay identically bit-for-bit on both sides, or reconciliation drifts
silently exactly the way a wrong ghost/alive speed already does for `shared/death.ts`.

**The consequence for S2 and beyond.** The move you're reading about above â€” `apps/lab` into
`@lindocara/engine` â€” was deliberately made a *file move*, not a rewrite: `git mv`, then translate
the comments, fix the imports, nothing else. That was only possible because the four files were
kept pure from the day they were written, specifically so this move would cost nothing. The port
that matters is the NEXT one, still ahead: `stepHero` becoming the server's authoritative per-tick
rule and the client's prediction function, the same way `shared/simulation.ts`'s `step()` is today
(root `AGENTS.md`, "Why `step()` lives in `shared/`"). That port is meant to be exactly as cheap as
this one was â€” another file already living in the right package, wired into a tick loop â€” and it
stays that cheap for exactly as long as `hero-state.ts`/`hero-step.ts`/`locomotion.ts`
stay pure. Nothing enforces that after this task except discipline: `npm run typecheck:engine`
catches a stray `three` type or a leaked DOM global (the package has neither in its `tsconfig`),
but it does NOT catch a call to `performance.now()`, a bare `Math.random()`, or a `dt` silently
assumed to be `1/60` instead of read from the parameter â€” all three typecheck clean, all three
compile, all three pass in the lab where nobody but a human eye would notice. Each one is exactly
the kind of change that looks like an innocent improvement (a jitter effect seeded from `Math.random()`,
a debug timestamp, a "just use the standard frame time" shortcut) and is in fact the thing that
turns a promised file move into a rewrite: the day this code runs on the server, `Math.random()`
diverges between server and client, `performance.now()` doesn't exist in the same form on both
sides and wouldn't agree with either one's clock if it did, and a hardcoded `dt` breaks the moment
the server's tick rate and the lab's frame rate aren't identical â€” replaying a client's pending
commands (root `AGENTS.md`, "One command per tick") assumes the exact same function produces the
exact same result from the exact same inputs, nothing else. If you're about to add any of those
three things to a file under `@lindocara/engine/hd2d/`, you have just made this port more
expensive than it needs to be â€” flag it, or find the way to do it without them, rather than let it
in quietly.

**Zones own ambience, not the day/night cycle.** `world/zones.ts`'s `Zone`/`zoneAt` predates the
snow island's specific content but the polar biome is what actually exercises it: `ZONE_POLAIRE`
(`settings.ts`) carries its own soundscape (`nappe: "polaire"`), its own music (`musique: "neige"`)
and a doubled breath-drain rate for the icy water (`souffle: 2`) â€” `main.ts` reads `zoneAt` every
frame and pushes the result through `setZoneMusic`/`setAmbience` (`core/audio.ts`) only on actual
zone CHANGE (identity comparison, not name), so day/night can keep fading the base `MOODS`
independently of which zone the hero is standing in. `ZONE_LARGE` (rayon `Infinity`, last in
`ZONES`) is the catch-all that delegates back to the day/night nappe â€” read its own comment in
`settings.ts` before adding a third zone, the ordering IS the priority.

**Nanuq shares Grota's NPC shape through `world/npc-base.ts`.** A first pass copied
`createGrota`'s collider/reach/height-guard machinery near-verbatim into `createSnowNpc`; code
review caught it as exactly the kind of duplication the task asked NOT to introduce, so
`npc-base.ts`'s `planStaticNpc()` now owns the part that was truly identical between the two â€”
the water guard, the collider registration and the squared-distance `inReach` test â€” plus the
shared `NpcHandle` interface both `Grota` and `SnowNpc` alias. `createGrota` (`world/npc.ts`) and
`createSnowNpc` (`world/snow-npc.ts`) each call `planStaticNpc()` and keep only what genuinely
differs: their billboard/atlas setup, their animator (or its absence) and their `update()` body.
`F` still opens the exact same `Dialog` (`core/dialog.ts`) for both â€” not a second dialogue
system. The one real difference stays the sprite: Grota is one frame of a Tiny Swords pack sheet
(animated idle bob); Nanuq's `habitant.png` is a single generated pose (no `Clip`/`createAnimator`),
so `SnowNpcSettings` (`settings.ts`) has no `frame` field the way `GrotaSettings` does. Voice is
threaded the same way for both: `core/audio.ts`'s `VOIX` is keyed by character (`"grota"`,
`"habitant"`), and `Dialog.start(speaker, lines, portrait, voice)`'s `voice` argument is what tells
the shared bandeau which `sayLine` entry cadences that NPC's typing â€” see `core/dialog.ts`'s
docstring.

**Generated assets, and where they came from.** The pre-chantier convention
(`assets/generated/PROVENANCE.md`, "Asset discipline" below) staged raw LoRA output under
`assets/generated/` and had `sync-assets.sh` copy the processed result into `public/`. Everything
generated for the snow island instead goes straight into `public/` with `studio.py --out`, gets
judged and cut with `scripts/sprite.py` in place, and the raw underscore-prefixed variant
(`_name.png`) is deleted once the pick is made â€” never committed, never routed through
`sync-assets.sh`. That covers the five snow/ice tilesets (`tileset-neige.png`/`tileset-glace.png`,
`scripts/compose-tileset.py`, Task 2), the snow/ice footstep SFX and the polar
ambience loop (`public/sfx/pas-neige-*`, `pas-glace-*`, `craquement-*`, `rupture.ogg`,
`plouf-glace.ogg`, `amb-polaire.ogg`, `rafale.ogg`, Task 6/7/9), the polar music track
(`public/music/neige.ogg`, Task 5), the two snow props (`sapin-neige.png`, `stalagmite.png`, Task
11), and Nanuq's sprite and portrait (`public/tex/habitant.png`, `public/ui/habitant.png`) and his
four dubbed lines (`public/voice/habitant-{1..4}.ogg`, Task 12). `~/git/pixel-art-model`'s
`characters.json` gained a `polar-hermit` entry (description + `elder` archetype) so the sprite and
the voice stay the same character across lanes, the same reason `characters.json` exists at all â€”
see its own `CLAUDE.md`. Its `studio.py` also gained a `--lang-code` passthrough on the `voice`
lane: every stock archetype voice is English-trained, and without an explicit French G2P pass a
French line gets phonemized as if it were English and comes out wrong â€” the flag doesn't change
timbre, only how the TEXT is read, and needs `espeak-ng` installed (`brew install espeak-ng`) for
any language beyond English/Japanese/Chinese.

The glider's canopy (`public/tex/glider.png`, `world/hero.ts`) follows the same one-off generated-
sprite path â€” a single frame, no `Clip`/animator, cut with `scripts/sprite.py` â€” but is not snow-
island content: it belongs to the separate glider chantier (`.superpowers/sdd/2026-08-04-glider/`).

## The waterfall island

A fifth island, `ILES[4]` in `world/island.ts`, west of the main one (`WEST`, `settings.ts`) and
reached only by swimming. It carries a **terraced mountain** and a **three-drop cascade** with its
own zone, roar, mist, spray and rainbow. Design and plan:
[spec](../../docs/superpowers/specs/2026-08-11-mountain-waterfall-design.md),
[plan](../../docs/superpowers/plans/2026-08-11-mountain-waterfall.md).

**The mountain's south face is SHEER, and that is what the waterfall needs.** Four relief discs of
shrinking radius whose SOUTH edges all coincide (`MOUNTAIN_RELIEFS`, `world/island.ts`): the south
side drops from level 4 straight to level 0 in one 3.6-unit cliff, while the north and the flanks
keep their terraces and stay climbable one 0.9 jump at a time. Concentric discs — built first —
give a pretty terraced cone and no waterfall at all: each step is 0.9 units, far too short to read
as falling water, and a sheet dropped from the summit's south edge lands INSIDE the terrace below
rather than in front of it. The cost of the sheer face is that `mesh.ts` stretches one UV cell over
a wall's full drop, so the rock is stretched 4x where the water does not cover it; accepted
deliberately, because the alternative is no cliff to fall down.

**SOUTH, because this camera cannot see any other face.** The rig sits due south of its target at
yaw 0, 38° above the horizon, looking north (`CAMERA`). A south-facing wall is seen 38° off normal
— nearly full-on. An east-facing wall is seen EXACTLY edge-on. The first version of this chantier
hung three sheets on the east face and they rendered as thin vertical slivers: correct geometry
viewed at 90°. The same trap caught the rainbow independently. Anything flat and upright added to
this lab belongs in the world XY plane unless you have checked otherwise.

**One tall fall, not a tiered cascade.** Levels ≥3 render with the `roche` atlas — a RENDER band
added to `renderMaterialAt`/`LEVEL_SET`, **not** a `TerrainMaterial`, so the mountain's rock costs
zero rule changes.

**The streaks are long vertical lines, generated in the shader.** They are the whole legibility of
a falling sheet, and two attempts got them wrong before one worked: sampling `water.png`'s grain
gives a flat pale rectangle (it is a gentle tiling surface, and its contrast vanishes stretched
over three world units), and varying brightness quickly along BOTH axes makes the two beat against
each other into a chequerboard of dots. What works is brightness chosen per COLUMN and held down
the fall, breathed only by a sine whose wavelength is longer than the fall is tall.

**`@lindocara/hd2d/terrain/waterfall.ts` is authored, never derived.** `foam.ts` can find a
shoreline by asking the height field where land meets water, but nothing in the field knows about
water ABOVE ground — `waterLevel` is one global scalar. So a fall is a placement its caller
declares (`WATERFALLS`, `settings.ts`), and its basins are **decorative by construction**: the hero
wades through them, because teaching `TerrainQuery` about per-cell water height would change a
contract shared with the game's authoritative server for the sake of a visual feature.

Three render traps were each paid for once here, and each now has a test:

- **`ShaderMaterial` defaults to `FrontSide`.** A single quad's facing depends on winding AND yaw;
  get it wrong and the sheet is backface-culled into total invisibility while still sitting in the
  scene graph with a correct bounding box. Both the sheet and the basin render `DoubleSide`.
- **Coplanar surfaces z-fight, and `renderOrder` does not fix it** — it decides draw order, not
  depth comparison. `FACE_CLEARANCE` stands each sheet a hair proud of its wall and each basin a
  hair above its terrace.
- **`THREE.RingGeometry` maps its uvs PLANARLY across the bounding square, not by (angle, radius).**
  The rainbow's spectrum is painted across the band's width, so on a `RingGeometry` almost all of it
  landed in the strip's transparent ends and the whole arc rendered as one thin vertical line.
  `arcBand()` (`world/waterfall-fx.ts`) builds the half-annulus by hand with radial uvs.

**The rainbow faces the CAMERA, not the valley.** Rotating it to face east — the way the water
flows, the intuitive choice — puts its plane nearly edge-on to a rig sitting 38° above the horizon
looking north, and it collapses to a one-pixel line. It stands in the world XY plane instead.

**Two sounds, opposite halves of one pair.** `BOUCLES.cascade` is the roar: a HELD sound whose gain
follows distance (`setCascadeDistance`, `PORTEE_CASCADE` = 22), never a zone soundscape — the same
shape as the campfire's `setFireDistance` and the skid's `setSkid`. `BOUCLES.falls` IS the zone
soundscape, raised by `setAmbience`. `test/waterfall-placement.test.ts` asserts no zone ever claims
the roar's key, which would make it blare across the island at full gain regardless of distance.

`ZONE_FALLS` follows `ZONE_POLAIRE`'s rule: its radius runs past the island's widest shoreline
(`WEST_REACH_MAX`) so the theme and the bed install themselves DURING the swim, and
`test/zone-precede-matiere.test.ts` pins that relation against the real symbols. Its low fog rides
the same `MoodConfig.fogPulse` channel the blizzard uses — a second contribution, not a second
mechanism — and `updateCamera` now takes the `Zone` itself rather than a `enPolaire` boolean, so
the signature stops growing a flag per ambience.

**Every particle here is a recycled pool**, like the hot spring's steam and the hero's breath —
`world/waterfall-fx.ts` shares ONE mist pool and ONE spray pool across all three impact points,
round-robin, because the total is what costs. Its settings were judged on screen, not on paper: the
first pass (`MIST.taille` 0.85, opacity 0.38) put a bright haze over the whole mountain, because
the puffs are unlit billboards with the pipeline's bloom on top of them.

## The load-testing harness

`bench.ts` answers S1's one open question: does a game-scale population (four players, dozens of
monsters/guards, ground loot, corpses, projectiles, combat effects, and shadow-casting point
lights â€” see the file's own `POPULATION` table) still fit the frame budget once the PoC's ~30 props
grow into a real game? It shares the textures `main.ts` already decoded â€” it loads nothing new, so
the measurement is GPU render cost, not decode time â€” and freezes every sprite on a random sheet
frame rather than animating it, because `Bench.measure()` re-renders the *same* frozen state 40
times â€” animating between those renders would defeat the point of measuring one consistent frame.

**Why `readPixels`, and why twice.** `performance.now()` around `render()` measures only the time
spent *queuing* GPU commands, which is nearly free and tells you nothing. `readPixels` forces the
CPU to block until the GPU has actually finished, so a read on each side of the loop turns the
wall-clock delta into real frame cost. This is the method the PoC used, and it is the only one whose
numbers are worth citing:

```js
// depuis la console du navigateur, sur `window.lab`
const gl = lab.renderer.getContext(), px = new Uint8Array(4);
lab.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // vide le pipe
const t0 = performance.now();
for (let i = 0; i < 40; i++) lab.render();
gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // bloque jusqu'au GPU
console.log((performance.now() - t0) / 40, "ms/frame");
```

The 60 fps target is a hard constraint, not a goal: **any change to the rendering path is verified
against the page's own counter**, and against this measurement when the number matters.

**Every entity is scattered inside a disk, never across the whole map.** `scatterOnLand` takes a
`center` and `BENCH_RADIUS` (14 world units â€” 1 unit = 1 tile) and draws **inside** that disk by
construction (polar sampling, `r = radius * sqrt(rng())`), never by drawing in a bounding square and
rejecting the corners â€” `apps/lab/test/bench.test.ts` asserts the invariant holds for every point
returned, not just on average. Round 1 of this task's review caught the harness scattering entities
over the *entire* island chain instead: with the camera framing only ~20-30 units around the hero
and the sun's shadow map fixed at a 26-unit extent, a real fraction of the population landed outside
both the view frustum and the shadow pass â€” free to render, at zero measured cost, for entities the
game would actually have to draw. The reported number was reassuring and wrong, which is exactly the
failure mode this harness exists to prevent. `BENCH_RADIUS` is derived from the game's own interest
radii (`TILE_SIZE = 64` px): players 900 px â‰ˆ 14 units, monsters 850 px â‰ˆ 13, loot 650 px â‰ˆ 10 â€” 14,
the widest of the three, still fits entirely inside the main island (radius 16) around the spawn.

**The measurement assumes a frame at least 16:9.** Round 3 of review found that `cameraGroundFootprint`
only modeled the VERTICAL half of the frustum â€” three's `camera.fov` is vertical, and the real
horizontal half-width is `atan(tan(fov/2) * aspect)`. `BENCH_REFERENCE_ASPECT` (16/9, `bench.ts`) is
the narrowest aspect the harness guarantees the disk stays inside the frustum laterally: at 1280Ã—720
(1.778) it fits with ~7% margin, but below an aspect of ~1.66 the disk's flanks start getting culled
â€” a MacBook window at full screen, or a browser with devtools docked to the side, can land under that
threshold. `cameraGroundFootprint(camera, aspect).halfWidthAt(depth)` exposes this bound (pinned by
`apps/lab/test/bench.test.ts`); the harness itself does not check the *actual* window aspect at
runtime, so running the lab narrower than 16:9 silently reintroduces a small lateral undercount rather
than failing loudly.

**The disk is centered on the visible ground footprint, not on the hero.** Round 2 of review found
that a *disk* centered on the hero still overshoots the frame on the camera's side, because that
footprint is asymmetric â€” a diving camera sees farther than it sees near. `cameraGroundFootprint`
(`bench.ts`) computes it by intersecting the vertical frustum's top/bottom rays with the ground
plane: with the current `CAMERA` settings (22Â° FOV, distance 40, 38Â° pitch, height 1.2), the near
edge sits â‰ˆ9.07 units toward the camera and the far edge â‰ˆ19.17 units away from it â€” not symmetric
around the hero at all. `BENCH_CENTER_OFFSET` is that footprint's midpoint (â‰ˆ5.05), and `main.ts`
shifts the population center by that amount along the viewing axis, away from the camera, before
passing it to `createBench`. Don't claim the disk covers "100% of what the camera sees": a circle
can't exactly cover a trapezoid (the true footprint is wider far away than it is near), only be
centered so it stays entirely within the visible depth range along the central viewing axis â€” which
is the actual, checkable guarantee `apps/lab/test/bench.test.ts` pins.

Select a level with `?bench=game` or `?bench=heavy` in the URL; `?bench=off` or no parameter leaves
the scene exactly as Task 12 left it. The measured ms/frame appears in the HUD next to the fps
counter, re-measured automatically after the mood fade settles whenever you press `N` â€” so reading
the day number, then night, is just two waits and two glances at the HUD, per the measurement
method in `task-13-report.md`.

**A measurement can go stale between populate and read.** Round 3 of review found the two rounds
above only guard the SPACE axis: `scheduleBenchMeasure` re-fires on every `N` press, arbitrarily
long after `Bench.populate()` froze the population around one hero position and one camera zoom. If
you've walked (the camera follows) or zoomed (`CAMERA.zoom` is `[16, 78]`) by then, the population
that got measured no longer matches what's on screen â€” `benchStillValid` (`bench.ts`) compares the
hero position and camera distance at read time against the snapshot taken at populate time
(`BENCH_DRIFT_TOLERANCE`, deliberately tiny â€” only float jitter, not real movement, should pass) and
the HUD prints `mesure invalide : dÃ©placÃ©/zoomÃ© depuis le peuplement` instead of a number rather than
show a measurement that no longer describes what's rendered. Stay put (or re-populate, i.e. reload
with the same `?bench=`) between toggling day/night if you want a comparable reading. `renderer.info.render.calls` resets on every `WebGLRenderer.render()`
call, including each of the composer's own full-screen passes â€” reading it right after
`pipeline.render()` therefore reports only the last post-fx pass, not the scene. To read the real
scene draw-call count, issue a throwaway `renderer.render(scene, camera)` first (see how
`task-13-report.md` gathered its numbers via `window.lab`).

## `window.lab`

The dev-only debug handle (the lab's equivalent of the PoC's `window.poc`): `THREE`, `scene`,
`camera`, `renderer`, `render` (`pipeline.render`), `field`, `query`, `colliders`, `hero`, `chest`,
`house`, `sakura`, `grota`, `nanuq`, `dialog`, `props`, `sun`, `hemi`, `rim`, `sky`, `clouds`,
`particles`, `neige`, `mood`, `applyMood`, `bench`, `benchLevel`, `zone` (a getter â€” the current
`Zone`, see "The snow island" above). Console-only wiring â€” teleporting the hero, forcing a mood,
calling `bench.measure(lab.render, lab.renderer.getContext())` by hand, walking `colliders.all` to
find a clear spot for a new prop/NPC, or instrumenting the audio context all go through this object
rather than adding debug UI. `window.labBench.armer()` (only defined when `?bench=` is active)
re-populates the harness AND re-anchors its validity snapshot on the hero's current position â€” the
one correct way to re-measure somewhere other than spawn; see "The load-testing harness" below.

## Asset discipline

Nothing is copied into `public/` by hand from a *pack*. `scripts/sync-assets.sh` pulls the textures
it needs straight from the Tiny Swords packs already vendored once in `packages/catalog/assets/`
(the lab does not keep its own copy) plus this app's own `assets/generated/` sprites (LoRA-generated
â€” provenance and prompts in `assets/generated/PROVENANCE.md`), and drops clean, space-free filenames
into `public/tex/`. Adding a *pack* texture means adding a line to that script and re-running it,
never dropping a file into `public/` directly.

Studio-generated content for the snow island (see "The snow island" above) takes a shorter path
instead: `studio.py --out apps/lab/public/tex/_name.png` (or `public/sfx/`, `public/voice/`,
`public/music/`) writes straight into `public/`, `scripts/sprite.py` (for sprites) or `ffmpeg` (for
audio) turns the raw output into the final asset in place, and the underscore-prefixed raw file is
deleted once a variant is picked â€” it is never committed and never routed back through
`assets/generated/`/`sync-assets.sh`. Both conventions coexist on purpose: `sync-assets.sh` is the
only path for anything that comes from a *pack* (its job is re-extraction on pack update), while a
one-off generated asset has no pack to re-sync from.

The SFX pack (371 MB) is **not** in the repo â€” only the handful of `.ogg` files the lab actually
plays live in `public/sfx/`. Re-running `sync-assets.sh` for sound therefore needs the pack
locally: point `LAB_SFX_PACK` at its `OGG Files` directory, or the script fails loudly rather than
silently skip sound assets.

```bash
LAB_SFX_PACK=/path/to/pack apps/lab/scripts/sync-assets.sh
```

## Graph

- **Depends on:** `@lindocara/engine` (its `hd2d/` subfolder only), `@lindocara/hd2d`,
  `@lindocara/audio` (the sample bank the game and the lab share), `three`.
  Nothing else â€” see "witness, not a frozen copy" above.

## Deployed as a static site

The lab ships to [lindocara-lab.bay.alepha.dev](https://lindocara-lab.bay.alepha.dev) as **files,
not a process**. Bay hosts a site with no server behind it: no port, no `.env`, no database, no
health probe. Three pieces make that work, and each is easy to undo by accident:

- `alepha.config.ts` declares `build: { target: "static", static: { source: "dist-client" } }`.
  `dist-client` lives **outside** `dist/` on purpose â€” `alepha build` cleans `dist/` before any task
  runs, so a client built there is deleted before the static target can adopt it. That is also why
  the vite half writes there rather than to `dist/public` directly.
- `src/boot.ts` is the browser entry, and **must not be called `main.ts`**: that name matches both
  the server and the browser entry conventions, so the CLI picked it up as the SERVER entry and
  died evaluating `document` under Node.
- `src/main.server.ts` is a five-line stub the CLI boots to analyze the workspace. Nothing of it
  ships â€” the static target keeps only `dist/public/` and the manifest.

Dev is unchanged: `vite` with this package's own `index.html`. Alepha is only in the shipping path,
which is why the hand-written shell (HUD markup, inline CSS, the cursor `image-set`) survives
verbatim â€” `static.source` copies it as written instead of generating a `<div id="root">` shell over
it.

**The host is not ours to choose.** Bay composes it from the app name â€” `<name>[-<env>].<base>`,
bare name in production â€” which is why this is `lindocara-lab.bay.alepha.dev` and not the
`lab.bay.alepha.dev` it was first configured with. That is deliberate on Bay's side (the name is a
property of the artifact, not a deployment choice), and the `lore` path has no channel to override
it the way the `bay` adapter does. A `domain` in `alepha.config.ts` therefore only NAMES the host â€”
set it wrong and the deploy still reports success while the address 404s with no certificate.
Moving it would mean renaming the app itself (`platform({ name: "lab" })`), which today also needs
an upstream fix: `alepha pack` names the artifact from `package.json` while the adapter looks for
`${project}-latest.tar.gz`, so a name override cannot be found after packing.

The deploy needs `LORE_API_KEY` in the environment (it is a repository secret for the game's
workflow). `npm run deploy -w @lindocara/lab` builds the client, builds the artifact and uploads the
release to Lore; the machine picks it up on its own outbound channel. CI does the same on every push
to `main` (`deploy-lab` in `.github/workflows/deploy.yml`), gated on the same checks a PR runs.

## Commands

```bash
npm run lab                  # (root) vite dev â€” http://localhost:5174
npm run build -w @lindocara/lab      # client + static artifact into dist/
npm run build:client -w @lindocara/lab   # just the vite half, into dist-client/
npm run deploy -w @lindocara/lab     # needs LORE_API_KEY
npm run build:map -w @lindocara/lab  # regenerate public/maps/ile.json â€” required after editing
                              # `world/island.ts`/`world/props.ts`'s placement rules, or anything
                              # else `scripts/build-map.ts` bakes into the map: the file is
                              # committed, not generated at dev-server start, so an edit that
                              # changes the map silently drifts from what's on disk until this runs.
npm run typecheck:lab        # tsc
npm test -w @lindocara/lab   # or: npm run test:lab â€” Node env, pure logic only (island,
                              # map-parite, zones, bench). The hero's own tests
                              # (hero-state/hero-step/hero-friction) AND terrain-query's
                              # moved to `packages/engine/test/hd2d/` alongside the code â€” run with
                              # `npm run test:engine`.
```

See the root [`AGENTS.md`](../../AGENTS.md) for the full monorepo layout, and the `playwright-cli`
skill for driving the lab in a browser â€” never the Claude-in-Chrome extension.
