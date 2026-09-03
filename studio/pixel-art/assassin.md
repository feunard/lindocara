# Assassin prototype

Temporary playable visual body for the Rogue. It keeps the Rogue's authoritative stats,
equipment, movement and five skills; only `CharacterAppearance.body` and presentation change.

## Source and identity

Generated on 2026-09-03 with Codex's built-in `imagegen` tool, using the shipped Tiny Swords Thief
as the class reference. The identity pass asked for one coherent rigged miniature rendered at five
camera angles before pixel conversion:

> Create a compact chibi assassin with a deep navy segmented hood, hidden face and two violet eyes,
> charcoal leather armour, a muted-violet split cloak and exactly two short curved steel daggers
> with violet edges. Show direct front, front-right quarter, direct right profile, back-right
> quarter and direct back on a flat #ff00ff background. Preserve one identity, scale, materials and
> orthographic camera height. Crisp Tiny Swords-compatible pixel-art shapes; no text or grid.

The accepted identity sheet is `refs/assassin/turnaround-chroma.png`. Five authored angles are
mirrored by the renderer into eight apparent directions, so a remote player sees the back of an
Assassin moving away instead of a billboard that turns toward their camera.

## Animation prompt set

Each angle owns two five-column by four-row key sheets and two matching in-between sheets. The key
prompt always repeated the exact identity and locked the selected turnaround camera. The common
motion brief was:

> Row 1: five progressive poses for the named motion. Row 2: five progressive poses for the next
> motion. Keep both feet, both arms, the split cloak and exactly two daggers readable in every
> non-dissolved cell. Looping rows end near their first pose; one-shots end in recovery or a settled
> corpse. Use equal cells, one complete character per cell and a flat #ff00ff background.

The eight semantic rows are:

- idle: guarded breathing and weight shift;
- run: left contact, passing, airborne extension, right contact, opposite passing;
- dual slash: ready, crossed wind-up, simultaneous twin-dagger X cut, follow-through, recovery;
- shadow step: crouch, forward lean, airborne launch, violet shadow phase, low landing;
- vanish: curl inward, smoke gather, engulf, dissolve, sparse remnant;
- poisoned shiv: compact draw-back and short thrust with green venom confined to the striking
  dagger;
- shadow dance: coiled crouch, leap, airborne twin-dagger cross-cut, shadow streak, landing;
- death: stagger, buckle, collapse, side/back fall, settled corpse.

The in-between prompt requested the genuine halfway pose *after* each matching key. Looping idle
and run bridge their last key back to the first; skill and death rows do not loop. Rear sheets were
corrected when a first pass rotated the torso toward the viewer during an attack. The accepted
sources are `refs/assassin/{front|front-quarter|side|back-quarter|back}-{a|b}-chroma.png` and the
matching `*-inbetweens-chroma.png` files.

## Normalization and runtime

`apps/lab/scripts/animation-sheet.py` selects each row with an 8 px source gutter (28 px for the
poison row, whose preceding smoke crossed the nominal boundary), removes the magenta background,
interleaves five keys and five transitions, and applies hard alpha, 24 colours, the project outline
and a 56 px foot offset. Sprites are normalized to 96 px content height in 192 px cells.
`stack-animation-strips.py` stacks the five camera rows.

The eight 1920x960 atlases each contain ten phases by five authored angles, for 400 processed source
cells in total:

- `packages/renderer/src/assets/bonus/assassin/idle.png`
- `packages/renderer/src/assets/bonus/assassin/run.png`
- `packages/renderer/src/assets/bonus/assassin/dual-slash.png`
- `packages/renderer/src/assets/bonus/assassin/shadow-step.png`
- `packages/renderer/src/assets/bonus/assassin/vanish.png`
- `packages/renderer/src/assets/bonus/assassin/poisoned-shiv.png`
- `packages/renderer/src/assets/bonus/assassin/shadow-dance.png`
- `packages/renderer/src/assets/bonus/assassin/death.png`

An automated adjacent-frame comparison found no identical neighbours in any row. The renderer runs
the ten-frame locomotion cycle at 16 fps and maps every skill's authoritative contact to its own
impact pose; the server still decides movement, damage, stealth, poison and targets.
