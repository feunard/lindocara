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

Locomotion was rebuilt on 2026-09-04 as eight decisive phases per direction: contact, loading,
passing and airborne for one leg, then the same four phases with the opposite leg leading. Direct
front and front-quarter use separate four-frame half-cycle sources so the model could not hide the
leg swap in near-duplicate poses. Side, back-quarter and direct-back prompts likewise require two
visible boots, counter-swinging arms, one fixed camera and an unchanged scale. The first side result
was rejected because frame 6 faced left; the accepted replacement keeps all eight figures facing
right.

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

The accepted run sources are `run-v4-front-{a|b}-chroma.png`,
`run-v4-front-quarter-{a|b}-chroma.png`, `run-v4-side-chroma.png`,
`run-v4-back-quarter-{a|b}-chroma.png` and `run-v4-back-{a|b}-chroma.png`. They were generated with
Codex's built-in `imagegen` from `turnaround-chroma.png`; the two half-cycle prompt sets explicitly
reverse only the limbs while keeping hair, strap, pouch and viewing angle on their original sides.

## Normalization and runtime

`apps/lab/scripts/animation-sheet.py` removes the magenta background, applies hard alpha, a
24-colour palette and the project outline, and anchors the feet 56 px above the bottom of a 192 px
frame. Every internal non-run source-row edge discards 28 px to prevent neighbouring tools or
effects from leaking into another animation. The rebuilt run uses shared 96 px scaling across each
four-frame half-cycle and a stricter background cutout; `stack-animation-strips.py` stacks its five
camera rows into one 1536x960 atlas.

Fifteen 1920x960 atlases contain ten phases by five authored angles. The 1536x960 run atlas contains
eight phases by five angles, for 790 processed runtime cells in total:

- `packages/renderer/src/assets/bonus/peasant/{idle,run,death}.png`;
- `packages/renderer/src/assets/bonus/peasant/{axe,pickaxe,knife}.png`;
- `packages/renderer/src/assets/bonus/peasant/{rally,ration-throw,camp-build,bomb-throw}.png`;
- `packages/renderer/src/assets/bonus/peasant/carry-{wood,meat,gold}-{idle,run}.png`.

Idle runs at 3 fps and locomotion at 14 fps. Each skill maps authoritative contact to its own
semantic impact frame; the server still decides harvesting, buffs, healing, construction, bomb
collision, damage and inventory changes.
