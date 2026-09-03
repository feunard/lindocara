# Animated Ranger prototype

Temporary playable visual body for the Ranger. It keeps the authoritative Ranger statistics,
projectiles, cooldowns, targeting, talents and mobility grant; only `CharacterAppearance.body` and
presentation change.

## Source and identity

Generated on 2026-09-04 with Codex's built-in `imagegen` tool, using the shipped Tiny Swords yellow
Archer as the class reference. The accepted identity is a compact young forest scout with a
moss-green hood and shoulder cape, one amber feather, a brown leather jerkin, ochre sleeves, dark
trousers, worn boots, bracers, a curved short bow and a back quiver with red-fletched arrows.

`refs/ranger/turnaround-chroma.png` locks direct front, front-quarter, right profile, back-quarter
and direct back views at one orthographic camera height. The runtime mirrors those five authored
angles into eight apparent directions.

## Animation prompt set

Each angle owns two five-column by four-row key sheets and two matching in-between sheets. The
in-between pass creates a genuine pose after every key, producing ten phases for each motion. The
prompts lock the costume, bow, quiver, scale, camera and baseline while requiring true alternating
leg contacts.

The eight semantic motions are:

- a restrained breathing idle and a full run cycle;
- Quick Shot with a compact nock, partial draw and crisp release;
- Piercing Arrow with a planted stance, deep draw and stronger recoil;
- Volley with a visible bundle nock and wide fan release;
- Disengage with a low backward run while the torso keeps aiming forward;
- Heartseeker with a deliberate maximum draw and heavy recovery;
- a non-gory collapse ending in a settled corpse.

Accepted sources live under `refs/ranger/` as
`{front|front-quarter|side|back-quarter|back}-{a|b}-chroma.png` with matching
`*-inbetweens-chroma.png` files.

## Normalization and runtime

`apps/lab/scripts/animation-sheet.py` removes the explicit magenta background, detects the actual
four actor rows and five actor centres instead of trusting irregular model spacing, discards small
detached projectile components, interleaves keys and transitions, applies hard alpha, a 24-colour
palette and the project outline, and anchors the feet 56 px above the bottom of a 192 px frame.
Projectiles already in flight are intentionally excluded because the renderer draws the
server-authoritative projectile separately.

The eight 1920x960 atlases contain ten phases by five authored angles, or 400 processed runtime
cells:

- `packages/renderer/src/assets/bonus/ranger/{idle,run,death}.png`;
- `packages/renderer/src/assets/bonus/ranger/{quick-shot,piercing-arrow,volley}.png`;
- `packages/renderer/src/assets/bonus/ranger/{dash,heartseeker}.png`.

Idle runs at 3 fps and locomotion at 16 fps. Skill release frames are mapped to their semantic
contact poses. Disengage animates a real backward stride around the client mobility translation;
the server still grants its distance and deadline and decides every combat outcome.
