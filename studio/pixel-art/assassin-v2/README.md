# Assassin — prototype 2

Optional `assassin_v2` body for the existing Rogue. V1 remains selectable. The five skills
(including auto attack and Poisoned Shiv), their ten original frames, their contact frames
and their authoritative timings are shared with V1. Death also uses V1's original atlas and
900 ms timing. The idle accepted during review is frozen byte-for-byte in `sources/`.

## Motion pipeline

The first V2 bake damaged the anatomy: per-pose vertical registration compressed the torso
and legs, and a subsequent foot warp magnified that deformation, particularly in profile.
Those operations and the rejected replacement sheets are no longer part of the build.

The current bake uses the shipped V1 drawings at their original pixel density.
Every original run body pose remains intact; a test compares its visible pixels against V1
outside the explicitly recorded front head stencil. The other four views remain exact.
The two authored contacts now divide the cycle into two equal steps. Bidirectional
motion-compensated inbetweens are baked between the poses, including the loop seam.
No Python, optical-flow solver, image generation or interpolation executes in the game.

The front run keys also alternated the hood's width, eye spacing and slight head yaw.
Faster playback made that source-art drift read as a vibrating head. After interpolation,
the bake registers the same native V1 hood/face in each front locomotion and airborne frame.
It moves as a rigid image along a small, smooth, two-rise stride curve (three native pixels),
never scales or warps. Jump and landing have their own continuous head paths. Stopping
returns once to the approved idle; the idle atlas and every V1 skill remain untouched.
The manifest records the stencil and translations, and the checker compares the hood and
eyes pixel-for-pixel after undoing translation, including the run loop seam.

Run phase advances from real distance travelled: 2.4 tiles per cycle, matching two 1.2-tile
footsteps. A diagonal has the same cadence as straight movement. Direction changes retain
the cycle, including a half-cycle transfer for mirrored views. Teleports and airborne
travel do not consume ground strides.

Takeoff, apex, fall and landing have complete sprite clips in all eight apparent directions
(five authored views plus mirroring). Takeoff and recovery use the original character's
poses, not a newly generated body. Eight transition banks preserve the departure stride
when jumping or stopping. Moving landings return to the current stride. Ascent and fall
are selected by the controller's vertical velocity; the apex images match exactly.
Starting reuses the stop atlas in reverse. Repeated updates and camera turns cannot restart
the animation. Existing characters keep their previous state priorities.

Atlases use one union crop per clip and a fixed reconstructed `(96, 136)` ground anchor in
a 192 px canvas. Each manifest entry declares its own pixel density: this retains the
approved idle's scale while preserving the native V1 pixels in locomotion and skills.
Textures are bounded to 4096 px. The additional uncompressed RGBA allocation is about
74 MiB; original skill/death textures are shared and a four-player party shares its atlases.

## Regenerate and validate

From the repository root (Yarn 4 and `uv` installed):

```sh
yarn assassin:build
yarn assassin:check
yarn verify
```

`build.py` pins NumPy, OpenCV and Pillow in its script metadata. It requires no model,
GPU, API key or image-generation call: all accepted raster source assets are in the repo.
Source provenance for V1 is in `../assassin.md`. The V2 manifest records the SHA-256 of
every build input and output. Edit the builder, not the manifest or runtime PNGs.

The checker covers source drift, missing or obsolete files, all directional rows, binary
alpha, atlas bounds, anchors, frame counts, transition banks, exact V1 body poses, head stability, idle
preservation, unchanged skill contacts, shared apex/landing endpoints and the memory budget.
Renderer tests cover distance clocks at 30/60/144 Hz, mirrored UVs, turns, teleports,
takeoff phase, moving landing, hurt and the original Rogue action timelines. An API test
creates, saves and reloads the new body as a Rogue with the original five skills.

## Inspect the animation

```sh
yarn assassin:studio
# http://localhost:5329/studio/pixel-art/assassin-v2/
yarn dev
# http://localhost:5273/?preview=assassin
```

The studio shows all eight directions side-by-side with V1, at equal world scale. It has
speed, playback rate, frame scrub, transition-bank selection, previous-frame overlays and
moving ground markers. The game preview uses the actual controller, renderer, camera and
lighting, with V1, Ranger and Runic Guardian references.

Game preview controls: WASD, Space (jump/glider), 1–5 (skills), H (hurt), K (death),
R (reset), T (all-direction movement), N (water), arrows (camera), P (pause), [ / ] (rate).
For automated inspection, `window.assassinPreview` exposes `read`, `step(seconds)`, `heading`,
`jump`, `cast`, `pause`, `rate`, `references(false)` and `party(1..4)`.

With `yarn dev` running, `yarn assassin:review` uses installed Chrome through Playwright to
capture every direction, each phase of the jump, all five original skills, a 12-second
video and a focused front run/jump/stop video at ordinary playback speed in
`artifacts/assassin-v2/runtime-review/`.

Visual evidence is written under ignored `artifacts/assassin-v2/`, separate from runtime
assets. Review at normal game size and speed before judging a zoomed-in contact sheet.
The image checks prove preservation and continuity at the tested boundaries; they do not
prove physically exact foot contact from raster drawings. The source poses' remaining
biomechanical limits must still be assessed visually, especially during sharp turns.
