# Animated Peasant prototype

Temporary playable visual body for the Peasant. It keeps the Peasant's authoritative statistics,
harvest rules, inventory and five skills; only `CharacterAppearance.body` and presentation change.

## Source and identity

Generated on 2026-09-03 and 2026-09-04 with Codex's built-in `imagegen` tool, using the shipped
Tiny Swords yellow Pawn as the class reference. The identity pass established one young fieldhand:
tousled medium-brown hair tied low, a mustard neckerchief and patched tunic, dark cropped trousers,
worn boots, gloves, a cross-body tool strap and belt pouch. It requested direct front,
front-quarter, right profile, back-quarter and direct back views at one orthographic camera height,
one scale and one ground line on flat `#ff00ff`.

The accepted identity is `refs/peasant/turnaround-chroma.png`. Five authored angles are mirrored
into eight apparent directions at runtime, so other players see the character's back and quarters
instead of a camera-facing billboard.

## Animation prompt set

Except for the rebuilt run, each angle owns four five-column by four-row key sheets and four
companion in-between sheets. Every companion cell is the genuine halfway pose immediately after
its matching key; looping rows bridge the fifth key back to the first. The prompts lock identity,
costume, prop size, camera, body scale and baseline.

Locomotion received a second rebuild on 2026-09-04 after the eight-pose pass still read as a series
of jumps from the side and quarter views. Each angle now starts from one complete 24-pose run cycle
authored as a strict six-column by four-row sequence: contact, weight absorption, passing, airborne,
opposite contact and the same return path into frame 1. The profile was accepted first and became
the timing reference for direct front, front-quarter, back-quarter and direct back. Every prompt
locks the camera, scale and ground line while requiring both boots and counter-swinging arms to move
by short neighbouring increments.

A local CUDA RIFE pass inserts one motion-aware midpoint between every neighbouring pair, including
the frame 24 to frame 1 closure. The 48 resulting phases are normalized from already validated full
cells rather than from the raw grids, so no character can be cut at a source-cell boundary. A shared
32-colour palette derived from the crisp key poses removes chroma spill and prevents alternate
frames from changing colour. Sequence checks cover the complete loop, not only the source sheets:
all 48 frames share one ground line, and silhouette deltas are measured through the closing edge.

The sixteen semantic rows are:

- calm idle and a full run cycle;
- contextual axe, pickaxe and harvest-knife actions;
- the rooster-call rally, three-ration throw, camp-building hammer action and bomb throw;
- a non-gory fall ending in a settled corpse;
- separate idle and run loops for carried wood, meat and gold.

The rally uses posture and restrained golden sound marks rather than spawning a literal rooster.
The ration action visibly gathers and throws three parcels. Camp construction shows only the
caster's hammer-and-stake work because the authoritative camp object is rendered separately. The
bomb leaves the hand without exploding inside the caster strip.

Accepted non-run sources live under `refs/peasant/` as
`{front|front-quarter|side|back-quarter|back}-{a|b|c|d}-chroma.png` with matching
`*-inbetweens-chroma.png` files. The right-profile ration row uses the dedicated
`side-ration-chroma.png` and `side-ration-inbetweens-chroma.png` strips: the first generated
release pose contained only the parcels, so that row was regenerated with the full caster visible
in every phase before the runtime atlas was accepted.

The accepted run sources are `run-v5-{front|front-quarter|side|back-quarter|back}-24-chroma.png`.
They were generated with Codex's built-in `imagegen` from `turnaround-chroma.png`; the side sheet is
the shared timing witness and the other four directions also reference their earlier camera-angle
passes. The direct-front result received a background-only edit from brown to pure magenta, the side
result received a frame-13 scale and fragment correction, and back-quarter frame 24 was rebuilt to
close the loop without a jump.

## Normalization and runtime

`apps/lab/scripts/animation-sheet.py` removes the magenta background, applies hard alpha, a
24-colour palette and the project outline, and anchors the feet 56 px above the bottom of a 192 px
frame. Every internal non-run source-row edge discards 28 px to prevent neighbouring tools or
effects from leaking into another animation. The rebuilt run uses shared 96 px scaling, automatic
actor-centre detection, hard alpha and a common 32-colour final palette;
`stack-animation-strips.py` stacks its five camera rows into one 9216x960 atlas.

Fifteen 1920x960 atlases contain ten phases by five authored angles. The 9216x960 run atlas contains
48 phases by five angles, for 990 processed runtime cells in total:

- `packages/renderer/src/assets/bonus/peasant/{idle,run,death}.png`;
- `packages/renderer/src/assets/bonus/peasant/{axe,pickaxe,knife}.png`;
- `packages/renderer/src/assets/bonus/peasant/{rally,ration-throw,camp-build,bomb-throw}.png`;
- `packages/renderer/src/assets/bonus/peasant/carry-{wood,meat,gold}-{idle,run}.png`.

Idle runs at 3 fps and the 48-phase main locomotion at 60 fps, producing one 0.8-second loop. The
existing ten-phase cargo runs remain at 14 fps. Each skill maps authoritative contact to its own
semantic impact frame; the server still decides harvesting, buffs, healing, construction, bomb
collision, damage and inventory changes.
