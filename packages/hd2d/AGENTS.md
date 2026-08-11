# @lindocara/hd2d

The HD-2D **render engine**: pixel art sprites billboarded into a lit, post-processed Three.js
scene â€” the technique behind Octopath Traveler and The Adventures of Elliot, applied to Tiny
Swords. Ported verbatim from the `poc-hd-2d` PoC, now retired (Task 1-10 of the
[S1 spec](../../docs/superpowers/specs/2026-08-02-hd2d-reboot-design.md)).

## The terrain sheet has two cliff feet, and a ramp is a slope

Two things about `terrain/` that no amount of reading the code will tell you, and that cost real
time once each:

- **`wallRow` vs `wallRowInWater`.** Pixel Frog draws the cliff face twice — footed on land (grass
  tufts at its base) and footed in water (a foam scallop). They are alternatives chosen by what is
  BELOW the cliff, not a band and its repeat. `mesh.ts` picks per wall segment. Foam
  (`foam.ts`) is placed on a shore cell at any level for the same reason: half a waterline is worse
  than none.
- **A ramp is real sloped geometry, and it opens the wall it meets.** `meshStairs` builds the same
  slope `rampSampleAt` walks the hero up, off the same `progress` convention — they cannot disagree.
  Pass the ramps to `meshTerrain` too (`MeshTerrainOptions.ramps`) or the height field draws a cliff
  across the ramp's mouth. Do NOT go back to slicing Pixel Frog's 64x128 ramp strip across box tops:
  it is a side ELEVATION, half transparent, and horizontal slices of it draw neither tread nor slope.

See `docs/hd2d-rendering.md` for the full sheet anatomy, and
`scripts/build-showcase-map.ts` for a map that exercises every case (`npm run adventure:showcase`).

## The boundary

`hd2d` knows nothing about lindocara or its protocol â€” no party, no hero, no `WorldRoom`, no wire
format. Its **only** dependency is `three`. Content (which textures exist, what a map looks like,
which sprite is the hero) lives entirely in the consumer â€” today `apps/lab`, later the game client.
A file here that imports a URL, a game rule, or anything from `@lindocara/engine`/`server`/`client`
is a boundary violation, not a convenience.

## No module-level mutable state â€” `Hd2dContext`

The PoC kept its camera yaw, its billboard registry and its cloud-shadow uniforms as **module**
variables â€” fine for a page with exactly one scene. `context.ts`'s `Hd2dContext` (`createHd2dContext()`)
carries all of that instead: the current yaw, the billboard/lit-billboard registries, the cloud
uniforms. The game and a future editor preview will each open their own context; sharing module
state between them would mean rotating the editor's camera also rotates the game's sprites. Every
function that touches per-scene state (`makeBillboard`, `applyCloudShadow`, `applyFillFromPointLight`,
`meshTerrain`, â€¦) takes a `Hd2dContext` as an explicit argument â€” never reaches for a singleton.
The one exception is four lazily-built canvas textures, module-scoped rather than context-scoped
on purpose: the contact shadow (`radialDisc`), the diffuse glow (`diffuseGlow`, cached per seed)
and the ripple ring (`ringTexture`) in `billboard.ts`, plus the point sprite (`pointTexture`) in
`particles.ts`. All four are immutable images with no scene state, correctly PROCESS-lifetime by
design â€” the game and a future editor preview open separate `Hd2dContext`s but must share these,
because duplicating an immutable image per context would waste GPU memory for nothing. They stay
lazy â€” built at first call, never at import â€” specifically so importing the module doesn't touch
`document` (see the vitest note below).

## Files

- `context.ts` â€” `Hd2dContext`, the per-scene state carrier above.
- `config.ts` â€” `Hd2dConfig`/`DEFAULT_CONFIG`: render (MSAA, pixel scale), post-fx (bloom,
  tilt-shift, grade), cloud-shadow and sprite-stretch knobs. Merged per-context, never shared by
  reference (`createHd2dContext` clones `DEFAULT_CONFIG` before overlaying).
- `loader.ts` â€” `fetchAll`: byte-weighted download progress (see the file's own doc comment for
  why byte-weighted, not file-count).
- `textures.ts` â€” `createTextureRegistry`: decodes blobs into `THREE.Texture`, and `textureFiltering`,
  the atlas-vs-sprite filtering policy (no mipmaps + half-texel guard for atlases, mipmapped
  nearest for sprites).
- `pipeline.ts` â€” `createPipeline`: the render chain (scene â†’ its own MSAA target â†’ bloom â†’ tilt-shift
  Ã—2 â†’ `OutputPass` â†’ grade), `render()`/`resize()`/`dispose()`.
- `shaders.ts` â€” `TiltShiftShader`, `GradeShader`, `SkyShader`: raw GLSL, all pass-through helpers.
- `billboard.ts` â€” `makeBillboard`/`makeFlatSprite`/`createAnimator`: the vertical-plane sprite
  construction (bombed normals, alpha-tested + shadow-casting lit material, sheet UV binding) and
  the contact-shadow/glow/ripple canvas textures.
- `sheet.ts` â€” `sheetUv`: pure frame-index â†’ UV-rect arithmetic for a sprite sheet.
- `fill-light.ts` â€” `applyFillFromPointLight`: the emissive fill that makes a backlit sprite
  readable near a point light (see the file's own doc comment â€” a sprite's normal faces the camera,
  so a light behind it is physically, and wrongly, black).
- `clouds.ts` â€” `createCloudCover`/`applyCloudShadow`: the drifting cloud-shadow texture that
  multiplies albedo on terrain and sprites alike, no shadow-map geometry involved.
- `mood.ts` â€” `createMoodMixer`: interpolates a whole `MoodConfig` (colors included) between two
  named moods over a fade duration.
- `sky.ts` â€” `createSky`: the sky dome (gradient, sun glow, procedural stars).
- `particles.ts` â€” `createParticleField`/`createPetalFall`: additive point clouds (embers,
  fireflies, motes) and the falling-petal effect.
- `terrain/field.ts` â€” `HeightField`, the pure per-cell level/material contract terrain rendering
  reads from. A **rendering** interface: the level and material are authored data, everything else
  (walls, edges, ambient occlusion) is derived. It is not the map's collision authority.
- `terrain/atlas.ts` â€” `TerrainAtlas`/`tileUV`: which 4Ã—4 autotile block an image contains and how
  to sample a tile from it.
- `terrain/mesh.ts` â€” `meshTerrain`: turns a `HeightField` + atlas set into real 3D geometry â€”
  blocks, cliff walls, autotiled edges, vertex-color contact occlusion.
- `terrain/water.ts` â€” `createWater`: the depth-graded sea plane with analytic swell normals.
- `terrain/foam.ts` â€” `createFoam`: the animated shoreline foam decal.

## Comments are in French, and say WHY

Every comment in this package is French, ported from the PoC â€” this repo's whole-codebase
convention (see the root [`AGENTS.md`](../../AGENTS.md), "Comments say WHY, never WHAT"), and it
matters more here than almost anywhere else: these comments are a running log of **measurements and
traps**, not a translation of the line below them (`+5 ms` for a badly-targeted MSAA buffer,
`-0.97` for the backlit dot product, `39 %` for the foam sprite's opaque fraction). Losing the
measurement loses the reason the code is shaped the way it is, and the next person re-measures from
scratch. Keep new comments in the same register: what was tried, what didn't work, the number that
settled it.

## Tests: vitest, `node` environment

`vitest.config.ts` runs `test/` in **Node**, not jsdom â€” three builds geometries, materials and
colors identically outside a browser, and that pure math/data path is everything these tests touch
(`npm test -w @lindocara/hd2d` or `npm run test:hd2d`). What is **not** unit-testable here, by
construction:

- anything that needs a `<canvas>` 2D context (the contact-shadow/glow/ripple textures in
  `billboard.ts`) or a live WebGL context (`pipeline.ts`'s actual render output, `clouds.ts`'s
  drift as seen on screen);
- visual correctness of lighting, shading, tilt-shift focus, bloom â€” these are judged on a
  screenshot, not an assertion (see the `playwright-cli` skill, and `apps/lab/AGENTS.md`).

Pure arithmetic extracted specifically to make it testable without a browser â€” `tiltShiftRadius`,
`fillAmount`, `sheetUv`, the terrain edge-mask tables â€” **is** covered here. When adding a feature
that mixes real math with a GPU/canvas side effect, split them the same way rather than writing an
untestable function that happens to also compute something pure.

## The pitfall registry

`docs/hd2d-rendering.md` is the full registry of pitfalls this technique ran into â€” read it
before touching rendering, it will save you from re-discovering things the hard way. The ones that
cost the most to re-discover:

- **A dedicated MSAA target for the whole composer costs +5 ms/frame.** Multisampling only pays off
  where there's real geometry; the scene renders into its own MSAA target, everything downstream of
  it (bloom, tilt-shift, grade) works on plain targets (`pipeline.ts`).
- **Grading must run after `OutputPass`.** Before it, values are linear and unbounded â€” "contrast
  1.06" pivots around a *linear* 0.5, which is 0.73 on screen, and crushes shadows far more than it
  should. After `OutputPass`, 0.5 finally means the mid-gray you actually see.
- **`shadowSide: DoubleSide` on every sprite.** Three renders only back faces into the shadow map
  by default (anti-acne); a flat quad has none, so without this a billboard casts no shadow at all.
- **`alphaTest: 0.5`, not lower.** It's a binary cutoff, not a blend â€” 0.25 turned each sprite's
  painted ground shadow into a hard-edged opaque blob that never moved with the light. 0.5 removes
  the painted shadow entirely and lets the real shadow map do the work.
- **Atlases (tilesets, foam) never get mipmaps.** Lower mip levels blend neighbouring tiles/frames
  together and bleed across the alpha-tested cutout â€” atlases sample nearest, no mipmaps, UVs
  inset by a half-texel instead.
- **An emissive fill-light must be modulated by the texture.** Added raw, `totalEmissiveRadiance`
  paints a flat orange wash over the whole sprite â€” dark and light areas glow equally, reading as a
  halo, not as lit surface. One line in the shader
  (`totalEmissiveRadiance *= diffuseColor.rgb`) fixes it (`fill-light.ts`).
- **Rim light lives on its own render layer.** Applied to terrain too, the same light that gives
  sprites their detaching edge-light only washes out the ground â€” rim illumination is meaningful
  only because sprite normals are bombed sideways; terrain's aren't. Keep it on a layer only
  sprites are enrolled in.

See also this file's own "Comments are in French" section above â€” the PoC README is where a
pitfall gets its full write-up; the comment next to the code is the short version that points back
here.

## Known S5 debt: `pipeline.ts` assumes a full-screen canvas

`createPipeline` receives a `canvas` explicitly, but `resize()` (`pipeline.ts`, `resize`) reads
`innerWidth`/`innerHeight` rather than the canvas's own box, and the initial pixel ratio (the
`renderer.setPixelRatio` call near the top of `createPipeline`) reads `devicePixelRatio`
unconditionally. Correct today because `apps/lab` â€” and the game,
which still renders through PixiJS â€” only ever mounts `hd2d` full-screen. Verbatim port from the
PoC, which only ever had one full-screen canvas too.

This becomes wrong the moment a consumer is NOT full-screen â€” the design intent for S5 is "the
editor scene IS hd2d," and a map-preview pane inside the editor shell is not the viewport. Left
here so S5 doesn't have to re-discover it by debugging a preview pane that renders at the wrong
size: `resize()` should measure `canvas.clientWidth`/`clientHeight` (or take them as parameters)
instead of the window.

## Graph

- **Depends on:** `three` only.
- **Depended on by:** `apps/lab` today. The game client (`@lindocara/client`/`renderer`) does not
  depend on it yet â€” see the note in the root [`AGENTS.md`](../../AGENTS.md) about the reboot's
  staging.

## Commands

```bash
npm run typecheck:hd2d          # tsc
npm test -w @lindocara/hd2d     # or: npm run test:hd2d â€” Node env, no canvas/WebGL
```

See the root [`AGENTS.md`](../../AGENTS.md) for the full monorepo layout.
