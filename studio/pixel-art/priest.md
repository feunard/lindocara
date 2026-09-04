# Animated Priest prototype

Temporary playable visual body for the Priest. It preserves the authoritative Priest statistics,
mana, targeting, healing, projectiles, cooldowns, Lumen Step grant and talents; only
`CharacterAppearance.body` and presentation change.

## Source and identity

Generated on 2026-09-04 with Codex's built-in `imagegen` tool, using the shipped Tiny Swords blue
Monk as the class reference. The accepted identity is a compact kindly elder with a bald tonsure,
a ring of short curly silver hair, a rounded silver beard, a layered midnight-blue and muted ivory
robe, a broad blue sash, a golden sun medallion, a dark belt and brown sandals. His hands remain
free so each spell can be identified by its gesture.

`refs/priest/turnaround-chroma.png` locks direct front, front-quarter, right profile, back-quarter
and direct back views at one orthographic camera height. The runtime mirrors those five authored
angles into eight apparent directions.

## Animation prompt set

Each angle owns two five-column by four-row key sheets and two matching in-between sheets. The
in-between pass adds a genuine transition after every key, producing ten phases per motion. Prompts
lock the costume, proportions, camera and baseline while requiring alternating foot contacts and no
baked spell effects; authoritative projectiles and areas remain renderer effects.

The eight semantic motions are:

- a restrained breathing idle and a complete run cycle;
- Radiant Bolt with a gathered hand and decisive palm release;
- Mend with cupped hands extending gently toward one ally;
- Lumen Step with a compressed stride before the existing light-cloud traversal;
- Prayer with clasped hands rising into an open blessing;
- Divine Nova with a planted stance and powerful two-arm sweep;
- a non-gory collapse ending in a settled corpse.

Accepted sources live under `refs/priest/` as
`{front|front-quarter|side|back-quarter|back}-{a|b}-chroma.png` with matching
`*-inbetweens-chroma.png` files.

## Normalization and runtime

`apps/lab/scripts/animation-sheet.py` can now remove the generated background before grid
splitting. On a precut sheet it separates rows and cells at the widest transparent bands, which
keeps open hands, detached feet and wide death poses together without admitting fragments from a
neighbour. Each cell then receives hard alpha, component cleanup, a 24-colour palette, the project
outline and a common foot anchor 56 px above the bottom of a 192 px frame.

The eight 1920x960 atlases contain ten phases by five authored angles, or 400 processed runtime
cells:

- `packages/renderer/src/assets/bonus/priest/{idle,run,death}.png`;
- `packages/renderer/src/assets/bonus/priest/{radiant-bolt,mend,blink}.png`;
- `packages/renderer/src/assets/bonus/priest/{prayer,divine-nova}.png`.

Idle runs at 2.5 fps and locomotion at 16 fps. Skill contact frames match their semantic release,
blessing or stride. Lumen Step still uses the existing light-cloud replacement during traversal;
the server continues to grant its distance and deadline and decides every combat and healing
outcome.
