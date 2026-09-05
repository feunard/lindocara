# Dawn sanctuary priest

The Priest uses illustrated parts on an invisible articulated skeleton. The canonical design is
[`painted/canonical.png`](painted/canonical.png): warm skin, chestnut hair, an ivory forehead band,
teal mantle, amber stole, split ivory tunic, brown boots and a sun-ring staff. Five construction
plates in `painted/` supply the painted head, torso, arm, thigh, boot and staff. Their provenance,
actual prompts and corrections are recorded in [PROVENANCE.md](painted/PROVENANCE.md).

`model.mjs` authors the movement curves and an offline geometric proxy for diagnostics/contact
calculations. Its primitive surfaces are neither exported nor rendered in the game. `concept_1.png`
is a superseded exploratory study, not an input to the current artwork or build.

## Regenerate everything

Run from the repository root with Yarn 4 (`corepack yarn` if Yarn 1 remains on PATH):

```sh
yarn install --immutable
yarn priest:build
yarn priest:check
```

The build is deterministic from the committed sources. It needs Three, Sharp and Playwright with
installed Google Chrome; no model weights, image generation service or API key. `painted/build.mjs`
removes the source background, straightens bent arm drawings into a common construction space,
normalizes fixed cells and packs one 1536 × 1280 texture. It then compiles `skeleton.glb` (25 named
nodes, no visible geometry), `motion.json`, fourteen PNG review atlases, a portrait and a manifest
with source/output SHA-256 hashes into `packages/renderer/src/assets/characters/priest/`.
Joint tracks and screenshots go to the gitignored `artifacts/priest/` directory. Do not edit
compiled output. Re-authoring the AI drawings is a separate, non-deterministic art operation;
the committed source plates make routine regeneration independent of it.

## Why the pipeline changed

Independent generated frames do not enforce anatomy or floor contact. The original animation
clock also advanced independently of displacement. Enlarging the generated sheet could not fix
either problem. The first reconstruction established a distance clock and articulated motion,
but its visible primitive 3D surfaces did not match the illustrated Assassin, Ranger and Runic
Guardian. The first painted trial also exposed an overly upright, rigid torso.

The current gait adds forward weight transfer, pelvis/chest counter-rotation, vertical loading,
spinal flexion, a stabilized head and delayed arm, staff and cloth movement. Planted feet remain
fixed in world space. The painted torso is a deformable grid driven by those same curves, including
the garment panels; it is not a rigid image sliding over moving legs. Limbs deform along the solved
joint chains. Artwork comes from static identity references, never independent animation frames.

The head and torso have matching collar landmarks authored in each source view. The compositor
attaches these landmarks on the actual deformed painted triangles. An independent 3D head-centre
projection previously shortened the apparent neck in front-facing runs while the torso drawing
kept its height; explicit collar registration fixes that mismatch without straightening the gait.
Diagnostics follow the rendered head and neck, and tests cover the attachment in every action.

The runtime composes precomputed curves on the invisible skeleton, solves contacts, deforms one
small painted mesh (about 60 triangles) and renders it to the existing 160 × 160 sprite target.
The fixed 320 × 320 scratch pass preserves the silhouette. This is lightweight skeletal composition,
with no AI or image interpolation during gameplay. Existing HD-2D lighting, shadows, water,
occlusion, invisibility and glider integration remain in use.

Five authored view plates supply eight game directions by reflecting individual painted parts.
The skeleton, equipment hand and equipment trajectory are never reflected. Part widths vary
continuously with heading; artwork selection follows the game's discrete directional convention.
The locomotion phase survives direction changes. Only the idle atlas is eagerly loaded for
afterimages; the other exported clips are review artifacts, not a hidden playback fallback.
The discarded Priest prototype supplies no runtime resource.

## Runtime contract

- Eight camera-relative game headings, one fixed world scale and ground anchor.
- Idle, run, jump, fall, land, swim, glide, hurt, death and five Priest actions: fourteen clips.
- One stride per 1.72 tiles at the actual 3.65625 tiles/s class speed. Phase survives turns, stops
  and action changes. A stopped swing settles; an overextended support takes a catch-up step.
- Jump starts immediately as required by `hero-step.ts`; rise/fall follow velocity, and landing
  compression is additive. There is no artificial pre-jump input delay. Knockback shares this path.
- Moving casts combine upper-body action with locomotion. Hurt stays presentation-only and cannot
  interrupt authoritative gameplay. Death inherits the last pose and aim, then holds a stable corpse;
  a newly observed old corpse starts settled.

| Action | Base anticipation / recovery | Visual release |
| --- | --- | --- |
| Radiant Bolt / ordinary attack | 140 / 185 ms | phase 0.4 |
| Mend | 240 / 600 ms | phase 0.4 |
| Lumen Step | 180 / 420 ms, plus server-held channel | phase 0.4 |
| Prayer | 320 / 640 ms | phase 0.4 |
| Divine Nova | 400 / 700 ms | phase 0.4 |

The accepted action's `startedAt`, `impactAt`, `channelEndsAt` and `recoveryEndsAt`, mapped through
`ServerClock`, control playback, including haste and held release. Damage, healing, projectiles
and hitboxes remain authoritative server operations. This artwork revision changes none of them.

## Preview and tests

```sh
yarn priest:studio                   # prints the local atlas-review URL
yarn dev                            # http://localhost:5273/?preview=priest
yarn test:renderer priest-rig
yarn test:renderer character-animation
yarn verify                         # full checks, build and boot smoke
```

The atlas studio shows all eight directions, a ground-speed witness, looping, speed control,
frame stepping, consecutive-frame ghosts and joint trajectories. **Motion without artwork** exposes
the feet, knees, hips, spine, head and arms so the gait can be judged independently of the costume.
The game witness uses the real movement controller and renderer, alongside Ranger, Assassin and
Runic Guardian at the ordinary game camera. WASD moves; Space jumps/toggles the canopy; 1–5 cast;
H receives damage; K dies; R resets; N enters water; T runs eight headings; arrows orbit; P pauses.
Its simulated accepted timestamps rehearse visuals; server integration tests cover outcomes.

For repeatable browser capture with the repository's Playwright CLI:

```sh
node node_modules/playwright/cli.js cli -s=priest open "http://localhost:5273/?preview=priest"
node node_modules/playwright/cli.js cli -s=priest run-code --filename=studio/pixel-art/priest-rig/review-run.pw.cjs
node node_modules/playwright/cli.js cli -s=priest run-code --filename=studio/pixel-art/priest-rig/review-sequences.pw.cjs
node studio/pixel-art/priest-rig/review-sheets.mjs
```

`window.priestPreview` exposes `step(seconds)`, `pause`, `rate`, `party(1..4)`, `heading`, `pitch`,
`turnCamera`, `jump`, `cast`, `water`, `hurt`, `die`, `reset` and `read`. Screenshots are saved under
`artifacts/priest/`; [the review record](review/README.md) records the accepted comparison.

Checks cover all 2,008 exported frames, hashes, direction/state coverage, dimensions, fixed scale,
alpha bounds, loop seams, bone lengths, support drift, reversal, teleports and tab suspension.
Tests load the actual compiled skeleton and also track the rendered boot-sole vertices: planted
artwork must stay within 0.3 pixel, including torso/limb deformation.

The shared painted texture takes 7.5 MiB decoded; the skeleton takes 4,508 bytes and replaces the
previous 4.7 MB visible mesh. Render targets use 0.88 MiB for one actor plus 0.098 MiB per additional
Priest, with two additional draws per actor. The 83.4 MiB decoded review atlases are measured
separately and are not all loaded during gameplay. CPU measurements are in the review record;
they are not GPU timings or a mobile-device certification.
