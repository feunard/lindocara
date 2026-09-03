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

Each angle owns four five-column by four-row key sheets and four companion in-between sheets. Every
companion cell is the genuine halfway pose immediately after its matching key; looping rows bridge
the fifth key back to the first. The prompts lock identity, costume, prop size, camera, body scale
and baseline, and require real alternating leg contacts rather than torso-only movement.

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

Accepted sources live under `refs/peasant/` as
`{front|front-quarter|side|back-quarter|back}-{a|b|c|d}-chroma.png` with matching
`*-inbetweens-chroma.png` files. The right-profile ration row uses the dedicated
`side-ration-chroma.png` and `side-ration-inbetweens-chroma.png` strips: the first generated
release pose contained only the parcels, so that row was regenerated with the full caster visible
in every phase before the runtime atlas was accepted.

## Normalization and runtime

`apps/lab/scripts/animation-sheet.py` removes the magenta background, interleaves five keys and
five transitions, applies hard alpha, a 24-colour palette and the project outline, and anchors the
feet 56 px above the bottom of a 192 px frame. Every internal source-row edge discards 28 px to
prevent neighbouring tools or effects from leaking into another animation. The run uses an 8 px
top and 32 px bottom crop after visual inspection found tiny axe debris below several feet.
`stack-animation-strips.py` stacks the five camera rows.

The sixteen 1920x960 atlases contain ten phases by five authored angles, or 800 processed runtime
cells:

- `packages/renderer/src/assets/bonus/peasant/{idle,run,death}.png`;
- `packages/renderer/src/assets/bonus/peasant/{axe,pickaxe,knife}.png`;
- `packages/renderer/src/assets/bonus/peasant/{rally,ration-throw,camp-build,bomb-throw}.png`;
- `packages/renderer/src/assets/bonus/peasant/carry-{wood,meat,gold}-{idle,run}.png`.

Idle runs at 3 fps and locomotion at 16 fps. Each skill maps authoritative contact to its own
semantic impact frame; the server still decides harvesting, buffs, healing, construction, bomb
collision, damage and inventory changes.
