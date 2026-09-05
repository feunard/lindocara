# Dawn sanctuary priest

This replaces the discarded Priest prototype. The canonical design is authored from scratch in
`model.mjs`: warm skin, chestnut hair, ivory forehead band, teal sanctuary mantle, amber stole,
prayer book and a sun-arch crozier in the right hand. The split tunic leaves the boots visible.
One articulated construction fixes the silhouette, materials, equipment and proportions.
`concept_1.png` is the exploratory design plate; the articulated construction is the canonical
source. No runtime frame is cut from, or image-interpolated from, that plate.

## Regenerate everything

Run from the repository root with Yarn 4 (use `corepack yarn` if a machine still has Yarn 1 on PATH):

```sh
yarn install --immutable
yarn priest:build
yarn priest:check
```

The baker uses Three, Sharp and Playwright with installed Google Chrome; no model weights or API
key are required. It compiles `rig.glb`, `motion.json`, a manifest with source/output SHA-256 hashes,
fourteen PNG review atlases and a square selection/HUD portrait into
`packages/renderer/src/assets/characters/priest/`. It checks
source bounds before publishing and validates the delivered files. Joint tracks and screenshots
are written to the gitignored `artifacts/priest/` directory. Do not edit compiled output.

## Why the pipeline changed

The local sprite lane is FLUX.2-klein-4B with the Tiny Swords LoRA. Its actual runner exposes
reference images, seed, size, steps, guidance and CPU offload. It has no temporal conditioning,
skeletal controls or contact constraints; distilled Klein also ignores the tested guidance value.
A 12 GB RTX 3060 trial saturated memory. The offload trial completed its four denoising steps but
the Windows process crashed during decoding. Runtime animation does not depend on those trials.
`studio.py --offload` now forwards the runner's existing option, rather than inventing a model knob.

Independent image generations cannot lock a foot to the floor. The former renderer also selected
frames from global elapsed time, so cadence did not follow displacement, and mirrored directional
views swapped equipment hands. Body squash and sprite perspective compensation could move an
otherwise fixed anchor. The new distance clock, full orientations and fixed projection address
those execution problems as well as the authored motion.

Offline raster clips were evaluated first. Their remaining limitation was concurrent movement
and casting: a whole-body cast freezes legs while the hero still moves. The delivered runtime
therefore composes precomputed pose curves on a **25-bone, one-material skin**, solves its limb
chains, and rasterizes it to a 160×160 pixel sprite in the game's existing WebGL context. This is
ordinary skeletal animation, not AI generation or image interpolation during gameplay. A fixed
320×320 scratch target and one pixel pass preserve the pixel silhouette. The resulting billboard
uses the existing world lighting, shadows, occlusion, water, invisibility and glider systems.

Only the idle atlas is eagerly loaded, for afterimages; selection uses the square portrait. The other PNGs
are inspectable exports, not a hidden runtime fallback. Old Priest art, references, documentation
and animation mappings have been removed. Shared class effects and the stock Monk are independent
roster resources, not recycled Priest prototype assets.

## Runtime contract

- Eight camera-relative headings are required by the existing game. The atlas covers all eight;
  the rig also turns continuously between them and preserves the staff hand when the camera orbits.
- Ground movement, idle, jump impulse/rise/apex/fall/landing, swimming and gliding exist in
  `engine/hd2d/hero-step.ts`. There is no delayed pre-jump gameplay state.
- The server owns radiant bolt, mend, held blink, prayer and divine nova, with explicit
  anticipation/impact/recovery timestamps. Renderer frames must follow those timestamps.
- Damage does not impose a gameplay stun. Its reaction must remain presentation-only and may
  not interrupt an authoritative cast or movement.
- Corpses must hold their final pose, including after a new client joins.
- Locomotion spends one cycle per 1.72 tiles at the actual 3.65625 tiles/s class speed. Its phase
  survives turns, stops and action changes. Contact feet are held in world coordinates, swing feet
  settle on a stop, and a fast reversal releases an overextended support into a catch-up step.
- All frames share one camera, world scale and ground origin; alpha bounds never rescale a pose.

The fourteen authored clips cover idle, run, jump, fall, land, swim, glide, hurt, death and all five
Priest actions. Rise/fall follow `vy`; landing compression is additive even when movement resumes.
The engine launches jumps immediately, so there is no added input delay for a preparation pose.
Knockback uses that same airborne path. Historical compatibility ghosts retain their own moving
rig independently of their corpse. The current ordinary release policy revives immediately at the
map entry. A newly observed old corpse starts in its settled pose. Death inherits the actual last
pose and cast orientation, even when auto-aim pointed away from the movement direction.

| Action | Anticipation / recovery at base speed | Visual release |
| --- | --- | --- |
| Radiant Bolt / ordinary attack | 140 / 185 ms | phase 0.4 |
| Mend | 240 / 600 ms | phase 0.4 |
| Lumen Step | 180 / 420 ms, plus server-held channel | phase 0.4, cloud during hold |
| Prayer | 320 / 640 ms | phase 0.4 |
| Divine Nova | 400 / 700 ms | phase 0.4 |

These are authored defaults, not client deadlines. The continuous phase is mapped through
`ServerClock` from the accepted action's actual `startedAt`, `impactAt`, `channelEndsAt` and
`recoveryEndsAt`; haste and held release therefore retain the same contact pose. Damage, healing,
projectile creation and hitboxes remain authoritative server operations.

## Review and tests

```sh
yarn priest:studio                   # prints the local atlas-review URL
yarn dev                            # http://localhost:5273/?preview=priest
yarn test:renderer priest-rig
yarn test:renderer character-animation
yarn verify                         # includes asset hashes, full tests, build and boot smoke
```

The atlas studio shows eight views, a ground-speed witness, looping, speed control, frame stepping,
consecutive-frame ghosts and foot/head/pelvis overlays from the baker's diagnostic tracks.
The DEV game witness uses the real movement controller and shipped renderer, alongside Assassin
and Runic Guardian at the normal game camera. WASD moves; Space jumps/toggles the canopy; 1–5 cast;
H receives damage; K dies; R resets; N enters water; T runs eight headings; arrows orbit; P pauses.
It simulates authoritative timestamps for visual rehearsal; server integration tests cover outcomes.

For repeatable browser capture with the repository's Playwright CLI:

```sh
node node_modules/playwright/cli.js cli -s=priest open "http://localhost:5273/?preview=priest"
node node_modules/playwright/cli.js cli -s=priest run-code --filename=studio/pixel-art/priest-rig/review-run.pw.cjs
node node_modules/playwright/cli.js cli -s=priest run-code --filename=studio/pixel-art/priest-rig/review-actions.pw.cjs
node node_modules/playwright/cli.js cli -s=priest run-code --filename=studio/pixel-art/priest-rig/review-sequences.pw.cjs
node studio/pixel-art/priest-rig/review-sheets.mjs
```

`window.priestPreview` also exposes `step(seconds)`, `pause`, `rate`, `party(1..4)`, `heading`,
`pitch`, `turnCamera`, `jump`, `cast`, `water`, `hurt`, `die`, `reset` and `read` for deterministic
capture and profiling. Browser evidence is saved under `artifacts/priest/`.

Automated checks cover hashes, clip/direction coverage, dimensions, fixed world pixel scale,
alpha bounds, missing frames, loop seams, bone lengths, world-space support drift, clock reversal,
teleports and tab suspension. Tests load the actual compiled GLB, not a substitute skeleton.
Atlas memory is measured separately from runtime memory: the exported PNG set is about 88 MiB
decoded, while one active rig's intermediate render targets use 0.88 MiB; each additional Priest
adds 0.098 MiB. The 4.7 MB mesh is shared between actors. On the local RTX 3060 Chrome witness,
one Priest measured 57.6 Hz, 0.3 ms median / 0.4 ms p95 CPU composition; four measured 57.6 Hz,
0.5 / 0.6 ms, eight additional draws and 1.17 MiB of render targets. Both 12-second routes cover
all eight headings at normal speed and stay on the ground. These are CPU submission measurements,
not GPU timings or a guarantee for every device. See [the recorded review](review/README.md).
