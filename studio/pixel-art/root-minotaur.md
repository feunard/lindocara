# Animated Root Minotaur

Directional replacement for the monster formerly displayed as Rootland Brute / Ogre des Racines.
The stable internal species id remains `minotaur_brute`, so authored maps, saves, combat statistics,
targeting, cooldowns and server authority are unchanged. Only its translated name and presentation
change to Root Minotaur / Minotaure des racines.

## Source and identity

Generated on 2026-09-04 with Codex's built-in `imagegen` tool, using the shipped Tiny Swords
Minotaur idle strip at
`packages/client/public/assets/lindocara/tiny-swords/enemies/minotaur/idle.png` as the identity and
scale reference. The accepted monster is a hulking pale blue-grey minotaur with a charcoal mane,
ivory horns, red eyes, a gold nose ring, navy guards and loincloth, cloven hooves and a massive pale
stone maul carried in its right hand.

`refs/root-minotaur/turnaround-chroma.png` locks direct front, front-quarter, right profile,
back-quarter and direct back views at one orthographic camera height. The runtime mirrors those five
authored angles into eight apparent directions.

## Animation prompt set

Each angle owns one five-column by four-row key sheet for idle, run, basic attack and horn charge,
plus one five-column by two-row key sheet for labyrinth stomp and death. Every key sheet has a
matching redrawn in-between sheet, producing ten phases per motion. Prompts lock the anatomy,
costume, maul, proportions, camera and ground line while excluding painted projectiles and impact
effects; authoritative combat VFX remain separate renderer layers.

The six semantic motions are:

- a weighty breathing idle and complete run cycle with alternating hoof contacts;
- a broad basic maul swing whose impact pose matches the authoritative contact;
- Horn Charge with the shoulders compressed and horns driven forward;
- Labyrinth Stomp with a raised hoof followed by a planted ground strike;
- a non-gory collapse ending in a settled corpse.

The 21 accepted source images live under `refs/root-minotaur/`: one turnaround, and
`{front|front-quarter|side|back-quarter|back}-{a|b}-chroma.png` with matching
`*-inbetweens-chroma.png` files.

## Normalization and runtime

`apps/lab/scripts/animation-sheet.py` removes the explicit magenta background before splitting the
grid, rejects tiny full-sheet debris before detecting rows, falls back from transparent lanes to
connected-component centres when a wide pose closes a lane, and can apply one shared scale across
all keys and in-betweens. The shared scale prevents a crouch or horizontal corpse from being enlarged
to the height of a standing pose. Each cell then receives hard alpha, component cleanup, a 24-colour
palette, the project outline and a common foot anchor 96 px above the bottom of a 320 px frame.

The six 3200x1600 atlases contain ten phases by five authored angles, or 300 processed runtime cells:

- `packages/renderer/src/assets/bonus/root-minotaur/{idle,run,attack}.png`;
- `packages/renderer/src/assets/bonus/root-minotaur/{horn-charge,labyrinth-stomp,death}.png`.

Idle runs at 3 fps and locomotion at 16 fps. The two special techniques select their own body atlas,
while their existing server-authored timing, damage, displacement and impact effects remain the
authority. Death plays once from the monster's last facing and holds its settled final frame.
