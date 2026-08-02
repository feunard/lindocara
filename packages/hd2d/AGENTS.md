# @lindocara/hd2d

The HD-2D **render engine**: pixel art sprites billboarded into a lit, post-processed Three.js
scene — the technique behind Octopath Traveler and The Adventures of Elliot, applied to Tiny
Swords. Ported verbatim from `~/git/poc-hd-2d` (Task 1-10 of the
[S1 spec](../../docs/superpowers/specs/2026-08-02-hd2d-reboot-design.md)).

## The boundary

`hd2d` knows nothing about lindocara or its protocol — no party, no hero, no `WorldRoom`, no wire
format. Its **only** dependency is `three`. Content (which textures exist, what a map looks like,
which sprite is the hero) lives entirely in the consumer — today `apps/lab`, later the game client.
A file here that imports a URL, a game rule, or anything from `@lindocara/engine`/`server`/`client`
is a boundary violation, not a convenience.

## No module-level mutable state — `Hd2dContext`

The PoC kept its camera yaw, its billboard registry and its cloud-shadow uniforms as **module**
variables — fine for a page with exactly one scene. `context.ts`'s `Hd2dContext` (`createHd2dContext()`)
carries all of that instead: the current yaw, the billboard/lit-billboard registries, the cloud
uniforms. The game and a future editor preview will each open their own context; sharing module
state between them would mean rotating the editor's camera also rotates the game's sprites. Every
function that touches per-scene state (`makeBillboard`, `applyCloudShadow`, `applyFillFromPointLight`,
`meshTerrain`, …) takes a `Hd2dContext` as an explicit argument — never reaches for a singleton.
The one exception is the lazily-built canvas textures in `billboard.ts` (contact shadow, glow,
ripple): those are immutable images with no scene state, correctly module-scoped, and built lazily
specifically so importing the module doesn't touch `document` (see the vitest note below).

## Files

- `context.ts` — `Hd2dContext`, the per-scene state carrier above.
- `config.ts` — `Hd2dConfig`/`DEFAULT_CONFIG`: render (MSAA, pixel scale), post-fx (bloom,
  tilt-shift, grade), cloud-shadow and sprite-stretch knobs. Merged per-context, never shared by
  reference (`createHd2dContext` clones `DEFAULT_CONFIG` before overlaying).
- `loader.ts` — `fetchAll`: byte-weighted download progress (see the file's own doc comment for
  why byte-weighted, not file-count).
- `textures.ts` — `createTextureRegistry`: decodes blobs into `THREE.Texture`, and `textureFiltering`,
  the atlas-vs-sprite filtering policy (no mipmaps + half-texel guard for atlases, mipmapped
  nearest for sprites).
- `pipeline.ts` — `createPipeline`: the render chain (scene → its own MSAA target → bloom → tilt-shift
  ×2 → `OutputPass` → grade), `render()`/`resize()`/`dispose()`.
- `shaders.ts` — `TiltShiftShader`, `GradeShader`, `SkyShader`: raw GLSL, all pass-through helpers.
- `billboard.ts` — `makeBillboard`/`makeFlatSprite`/`createAnimator`: the vertical-plane sprite
  construction (bombed normals, alpha-tested + shadow-casting lit material, sheet UV binding) and
  the contact-shadow/glow/ripple canvas textures.
- `sheet.ts` — `sheetUv`: pure frame-index → UV-rect arithmetic for a sprite sheet.
- `fill-light.ts` — `applyFillFromPointLight`: the emissive fill that makes a backlit sprite
  readable near a point light (see the file's own doc comment — a sprite's normal faces the camera,
  so a light behind it is physically, and wrongly, black).
- `clouds.ts` — `createCloudCover`/`applyCloudShadow`: the drifting cloud-shadow texture that
  multiplies albedo on terrain and sprites alike, no shadow-map geometry involved.
- `mood.ts` — `createMoodMixer`: interpolates a whole `MoodConfig` (colors included) between two
  named moods over a fade duration.
- `sky.ts` — `createSky`: the sky dome (gradient, sun glow, procedural stars).
- `particles.ts` — `createParticleField`/`createPetalFall`: additive point clouds (embers,
  fireflies, motes) and the falling-petal effect.
- `terrain/field.ts` — `HeightField`, the pure per-cell level/material contract terrain rendering
  reads from. A **rendering** interface: the level and material are authored data, everything else
  (walls, edges, ambient occlusion) is derived. It is not the map's collision authority.
- `terrain/atlas.ts` — `TerrainAtlas`/`tileUV`: which 4×4 autotile block an image contains and how
  to sample a tile from it.
- `terrain/mesh.ts` — `meshTerrain`: turns a `HeightField` + atlas set into real 3D geometry —
  blocks, cliff walls, autotiled edges, vertex-color contact occlusion.
- `terrain/water.ts` — `createWater`: the depth-graded sea plane with analytic swell normals.
- `terrain/foam.ts` — `createFoam`: the animated shoreline foam decal.

## Comments are in French, and say WHY

Every comment in this package is French, ported from the PoC — this repo's whole-codebase
convention (see the root [`AGENTS.md`](../../AGENTS.md), "Comments say WHY, never WHAT"), and it
matters more here than almost anywhere else: these comments are a running log of **measurements and
traps**, not a translation of the line below them (`+5 ms` for a badly-targeted MSAA buffer,
`-0.97` for the backlit dot product, `39 %` for the foam sprite's opaque fraction). Losing the
measurement loses the reason the code is shaped the way it is, and the next person re-measures from
scratch. Keep new comments in the same register: what was tried, what didn't work, the number that
settled it.

## Tests: vitest, `node` environment

`vitest.config.ts` runs `test/` in **Node**, not jsdom — three builds geometries, materials and
colors identically outside a browser, and that pure math/data path is everything these tests touch
(`npm test -w @lindocara/hd2d` or `npm run test:hd2d`). What is **not** unit-testable here, by
construction:

- anything that needs a `<canvas>` 2D context (the contact-shadow/glow/ripple textures in
  `billboard.ts`) or a live WebGL context (`pipeline.ts`'s actual render output, `clouds.ts`'s
  drift as seen on screen);
- visual correctness of lighting, shading, tilt-shift focus, bloom — these are judged on a
  screenshot, not an assertion (see the `playwright-cli` skill, and `apps/lab/AGENTS.md`).

Pure arithmetic extracted specifically to make it testable without a browser — `tiltShiftRadius`,
`fillAmount`, `sheetUv`, the terrain edge-mask tables — **is** covered here. When adding a feature
that mixes real math with a GPU/canvas side effect, split them the same way rather than writing an
untestable function that happens to also compute something pure.

## The pitfall registry

`~/git/poc-hd-2d/README.md` is the full registry of pitfalls this technique ran into — read it
before touching rendering, it will save you from re-discovering things the hard way. The ones that
cost the most to re-discover:

- **A dedicated MSAA target for the whole composer costs +5 ms/frame.** Multisampling only pays off
  where there's real geometry; the scene renders into its own MSAA target, everything downstream of
  it (bloom, tilt-shift, grade) works on plain targets (`pipeline.ts`).
- **Grading must run after `OutputPass`.** Before it, values are linear and unbounded — "contrast
  1.06" pivots around a *linear* 0.5, which is 0.73 on screen, and crushes shadows far more than it
  should. After `OutputPass`, 0.5 finally means the mid-gray you actually see.
- **`shadowSide: DoubleSide` on every sprite.** Three renders only back faces into the shadow map
  by default (anti-acne); a flat quad has none, so without this a billboard casts no shadow at all.
- **`alphaTest: 0.5`, not lower.** It's a binary cutoff, not a blend — 0.25 turned each sprite's
  painted ground shadow into a hard-edged opaque blob that never moved with the light. 0.5 removes
  the painted shadow entirely and lets the real shadow map do the work.
- **Atlases (tilesets, foam) never get mipmaps.** Lower mip levels blend neighbouring tiles/frames
  together and bleed across the alpha-tested cutout — atlases sample nearest, no mipmaps, UVs
  inset by a half-texel instead.
- **An emissive fill-light must be modulated by the texture.** Added raw, `totalEmissiveRadiance`
  paints a flat orange wash over the whole sprite — dark and light areas glow equally, reading as a
  halo, not as lit surface. One line in the shader
  (`totalEmissiveRadiance *= diffuseColor.rgb`) fixes it (`fill-light.ts`).
- **Rim light lives on its own render layer.** Applied to terrain too, the same light that gives
  sprites their detaching edge-light only washes out the ground — rim illumination is meaningful
  only because sprite normals are bombed sideways; terrain's aren't. Keep it on a layer only
  sprites are enrolled in.

See also this file's own "Comments are in French" section above — the PoC README is where a
pitfall gets its full write-up; the comment next to the code is the short version that points back
here.

## Graph

- **Depends on:** `three` only.
- **Depended on by:** `apps/lab` today. The game client (`@lindocara/client`/`renderer`) does not
  depend on it yet — see the note in the root [`AGENTS.md`](../../AGENTS.md) about the reboot's
  staging.

## Commands

```bash
npm run typecheck:hd2d          # tsc
npm test -w @lindocara/hd2d     # or: npm run test:hd2d — Node env, no canvas/WebGL
```

See the root [`AGENTS.md`](../../AGENTS.md) for the full monorepo layout.
