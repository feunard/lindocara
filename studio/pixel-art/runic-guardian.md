# Runic Guardian prototype

Temporary playable visual body used to judge the 3D-to-pixel-art hero workflow. It reuses the
Warrior's authoritative class, equipment and skills; only `CharacterAppearance.body` changes.

## Source

Generated on 2026-09-01 with Codex's built-in `imagegen` tool. The first 4-column by 3-row contact
sheet established the character against the existing blue Warrior idle, run and attack strips.
The playable pass then expanded it to five unique camera angles, mirrored at runtime into eight
directions.

Primary prompt:

> Create one cohesive 4-column by 3-row animation contact sheet for a bonus playable hero named
> the Runic Guardian. The same single character appears exactly once in every cell: four subtle
> idle breathing phases, four clear running-cycle phases and four sword-and-shield attack phases.
> A stocky chibi fantasy guardian wears deep indigo steel armour, a closed rounded helmet with a
> tall dark-blue plume, a broad ivory-and-cyan runic shield and a short pale-cyan glowing sword.
> First imagine a consistent rigged stylized 3D miniature rendered frame by frame with an
> orthographic three-quarter side camera, then convert that render into crisp Tiny
> Swords-compatible pixel art. Preserve identity, equipment, palette, proportions, scale and a
> common ground line across all frames. No text, borders, labels, extra characters or watermark.

The first output painted a transparency checkerboard. A precise edit replaced only that background
with a magenta key; the character and layout were held invariant. That initial witness is retained
as:

- `refs/runic-guardian-grid-chroma.png`
- `refs/runic-guardian-grid.png`

## Directional animation pass

Five angles were authored: direct front, front-right quarter, right profile, back-right quarter and
direct back. The three left-hand angles reuse the nearest authored row with a horizontal mirror.
For every angle, two 4-column by 4-row sheets were generated and interleaved:

- odd key frames 1, 3, 5 and 7;
- even transition frames 2, 4, 6 and 8;
- row 1 idle, row 2 run, row 3 sword-and-shield attack, row 4 death/fall.

The shared key-frame prompt specified the exact established armour, equipment, palette and camera
angle, a strict equal-cell 4x4 layout, and four distinct progressive poses per row. The companion
prompt edited that sheet into the missing temporal in-betweens while keeping every visual invariant
and ending death on a settled corpse. Every source uses a flat `#ff00ff` key. The ten source sheets
are retained as `refs/runic-guardian-{angle}-{odd|even}-chroma.png`.

## Normalization

The imagegen chroma-key helper removed the sampled magenta border with a soft matte, despill and a
one-pixel alpha contraction. `apps/lab/scripts/animation-sheet.py` then selected each source row,
interleaved the odd/even passes and processed every cell independently at 118 px content height:
BOX downsample, hard alpha, 24-colour palette, the project's rgb(22,28,46) outline and a 56 px
ground-line offset in 192 px frames. `stack-animation-strips.py` stacked the five angles.

Idle, attack and death ship as 1536x960 atlases: eight animation columns by five directional rows.
Run ships as 768x960: four deliberately distinct columns by the same five rows. They are:

- `packages/renderer/src/assets/bonus/runic-guardian/idle.png`
- `packages/renderer/src/assets/bonus/runic-guardian/run.png`
- `packages/renderer/src/assets/bonus/runic-guardian/attack.png`
- `packages/renderer/src/assets/bonus/runic-guardian/death.png`

## Run-cycle correction

An in-game movement check on 2026-09-01 showed that the first run bake changed the plume and torso
but kept the boots on almost identical contact points, which read as planted feet at gameplay size.
An eight-pose whole-atlas correction was rejected after playtesting: its front legs splayed and
several other angles still changed only every third frame. The accepted pass edited each viewing
angle separately and reduced the gait to four strong poses: contact, passing, opposite contact,
opposite passing. The five retained sources are
`refs/runic-guardian-{front|front-quarter|side|back-quarter|back}-run-4-chroma.png`. The normalizer
uses 118 px content height, 24 colours, a 56 px foot offset and the stricter chroma tolerances 140/100.
The renderer holds each frame for 125 ms, producing one readable half-second cycle without duplicate
in-betweens.

The right-profile source received one final focused correction on 2026-09-02 after left/right play
still looked planted. Codex's built-in image generator changed only the second row of
`refs/runic-guardian-side-run-4-chroma.png`: a wide planted contact, a low passing pose, a clearly
airborne high-knee pose and the opposite landing transition, with the rune shield retained in every
cell. The final prompt required the third silhouette to differ strongly from the first and forbade
hidden equipment, merged legs and camera changes. A detached sword-tip fragment crossing the first
cell boundary was removed during the normalizing pass. Only row 3 of the runtime atlas (the shared
left/right profile) was replaced; the other four directional rows were verified byte-identical.
