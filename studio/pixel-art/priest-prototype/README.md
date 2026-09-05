# Prêtre · Prototype

The sole `priest` body is a raster character, using the Assassin V2 offline interpolation
and atlas delivery pipeline. The former painted 3D Priest, its rig, render targets,
sprites and build tools have been removed. Saved Priest heroes keep their class and skills.
The sole playable Assassin is V2; saved V1 appearances are redirected to it.

## Art and source provenance

The user supplied `sources/design-reference.png`: swept dark hair, a short beard, ivory
and gold clerical clothes, a split coat, brown boots, and a winged ruby staff. The design
was adapted beside the shipped Ranger, Assassin V2 and Runic Guardian in
`sources/style-reference.png`, then locked in `turnaround.png` and five canonical views.
Their compact proportions, dark outlines and readable palette follow the game's sprites.
No artwork from the former Priest is an input or fallback.

The source drawings were authored with the session's image-generation tool, using the
prompts and reference PNGs in `sources/`. They are original still drawings, not an AI
animation model. The repository's local sprite generator also supplies still images;
neither generator supplies a verified temporal animation contract. Therefore the large
runtime atlases are never used as the design prompt. Direction/action key drawings are
extracted, registered, checked and inbetweened separately before packing.

An AI call is not required to rebuild the delivered animations. Accepted source drawings
are committed. Repeating an image-generation prompt is an authoring operation and is not
bitwise reproducible; rebuilding from those accepted PNGs is deterministic.

## Motion pipeline

`build.py` and the shared `../lib/raster_animation.py` perform all interpolation offline:

1. Extract connected drawings from each action/view sheet, retaining disconnected dropped
   equipment. Remove the magenta background and use a fixed 256×256 canvas.
2. Register around the body, not the staff's bounding box or the forward-most foot.
   One torso/leg density calibration per source clip brings its drawing proportions back
   to the canonical view. Those constants remain fixed through every pose; bent legs are
   never resized to fill a standing bounding box. Three incorrectly handed cast drawings
   are reflected during source registration, before restoring the canonical head.
3. Order the authored run contacts, support and recovery poses. A complete two-step cycle
   covers 1.4 world tiles. Runtime phase consumes actual ground distance, including diagonal
   motion, rather than using a fixed FPS. Takeoff, teleport and suspension gaps do not spend
   ground strides. The Priest controller's audible steps use half that stride.
4. Use the same bidirectional OpenCV DIS motion compensation as Assassin V2. Priest clips
   additionally seed large displacements with neck, body and staff-orb correspondences.
   Without that seed a large staff swing can be misread as two unrelated objects and fade
   between them. The optional guidance leaves the Assassin's existing pixels unchanged.
5. Keep the canonical head out of the optical-flow deformation. Composite its identical
   pixels on an integer translation track after interpolation, preserving eyes, hair,
   proportions and collar placement. Death retains its authored facial turn and expression,
   with skull size registered before interpolation and one stable final resting drawing.
6. Bake all clips, including the last-to-first loop segment. Union-crop each whole clip
   once, with a common `(128,190)` reconstructed anchor and constant `192/2.34` pixels per
   tile. Individual frames are never independently trimmed or scaled at runtime.

The five authored views become the engine's eight apparent directions by its existing
mirroring convention. Mirrored locomotion transfers half a cycle, and turning never resets
the distance clock. Eight phase banks connect a running jump, landing, start and stop to
the appropriate stride. Vertical velocity selects ascent/apex/fall; apex and landing
endpoints are checked pixel-for-pixel. Starting reverses the stop bank without another texture.

The state inventory comes from `CharacterAnimationTracker`, the actual controller and
`PLAYER_ACTIONS.priest`: idle, run, start, stop, stationary/running jump, fall,
stationary/running landing, hurt, swim, glide, death and all five Priest actions.
There is no separate unreachable "walk" state. Movement speed controls the run cycle.

## Skills and weapon emission

| Skill | Release | Recovery | Clip |
| --- | ---: | ---: | --- |
| Radiant Bolt | 140 ms | 185 ms | radiant-bolt |
| Mend | 240 ms | 600 ms | mend |
| Blink | 180 ms | 420 ms | blink |
| Prayer | 320 ms | 640 ms | prayer |
| Divine Nova | 400 ms | 700 ms | divine-nova |

`combatActionFrameIndex` maps the server's anticipation, impact and recovery to the declared
contact frame. The action heading stays fixed during the cast. Each final sprite records
the visible ruby's socket; the renderer reconstructs that point using the same camera yaw,
pitch, stretch and actor elevation as its billboard. A newly confirmed projectile starts
there, then smoothly rejoins the authoritative ground trajectory over 160 ms. Its emission
height remains a presentation offset, avoiding a dive towards the feet.

Local Priest projectiles use the current caster clock instead of the remote interpolation
delay. Extrapolation only applies to already confirmed projectiles and is bounded to one
snapshot period. The server still creates/removes every projectile, decides collisions,
damage, healing and death. There is no speculative client projectile or gameplay hitbox.
Other characters retain their existing projectile sampling.

## Rebuild and verify

From the repository root, with Yarn 4 and `uv` installed:

```sh
yarn priest:build
yarn priest:check
yarn assassin:check
yarn verify
```

`build.py` pins NumPy, OpenCV and Pillow. It requires no GPU, key, model or network inference.
The manifest records source/output hashes, action, direction rows, counts, durations, loop
flags, contact frames, phase banks, pixel density, anchors, head tracks, sockets and memory.
It is generated by the builder, never edited by hand. All runtime PNGs live in
`packages/renderer/src/assets/bonus/priest-prototype/`; generation sources stay here.
Textures stay within 4096 pixels. The delivered Priest occupies 160.3 MiB (capped at 176 MiB) of
decoded RGBA, shared by every Priest in the scene. There are no per-actor render targets,
runtime optical-flow calculations or image-generation calls.

The checker covers source drift, clip coverage, empty frames, binary alpha, fixed-canvas
reconstruction, scale, exact canonical face pixels, loop seams, identical air/ground
endpoints, stable final death frames, actual ruby pixels at release sockets, old-file
retirement and memory. Tests additionally drive distance clocks at 30/60/144 Hz, heading
changes, phase banks, real skill timings, legacy hero selection and projectile networking.

## Preview and visual inspection

```sh
yarn priest:studio
# http://localhost:5330/studio/pixel-art/priest-prototype/
yarn dev
# http://localhost:5273/?preview=priest
yarn priest:review
```

The studio shows all eight views at game scale and enlarged, with a frame scrubber,
speed/rate controls, phase-bank selection, previous-frame overlay, root and orb markers,
and ground markers moving at the actual speed. Non-looping actions repeat for inspection.

The engine preview uses the actual controller, camera, lighting and renderer beside Ranger,
Assassin V2 and Runic Guardian. WASD moves, Space jumps/deploys the glider, 1–5 casts,
H takes a hit, K dies, R resets, T cycles directions, N toggles water, arrows turn the camera,
P pauses, and [ / ] change the rate. `window.priestPreview` also exposes `step`, `heading`,
`references`, `party(1..4)`, `projectileDelay(ms)` and `read` for reproducible inspection.

`priest:review` uses Playwright and installed Chrome against the dev server. It captures
all eight running/jumping directions, five skills, death and a normal-speed video to
ignored `artifacts/priest-prototype/runtime-review/`. `--quick` captures the comparison only.
It also checks the first displayed projectile against the actual staff socket for both
ranged spells in all eight directions, with 0, 100 and 200 ms delivery delays (48 launches).
`yarn priest:review --launches` runs just the comparison and those emission checks.
Review these at the normal camera, not only on a zoomed source sheet. Automated image
checks establish the tested registration/continuity properties; they do not by themselves
prove physically exact foot contact or perceptual quality.

The dated [validation record](review/README.md) keeps the comparison and motion witness.
