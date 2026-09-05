# Animated Ranger prototype

Temporary playable visual body for the Ranger. It keeps the authoritative Ranger statistics,
projectiles, cooldowns, targeting, talents and mobility grant; only `CharacterAppearance.body` and
presentation change.

## Source and identity

Rebuilt from scratch on 2026-09-04 and 2026-09-05 with Codex's built-in `imagegen` tool. The Tiny
Swords Archer supplied the class language, but none of the former prototype Ranger sheets remain.
The accepted identity is a compact female forest scout with a copper braid, fitted pine-green hood
and short cape, leather jerkin, ochre sleeves, charcoal trousers, short yew bow and back quiver.

The rig has a deliberate asymmetric locomotion marker: the anatomical left lower leg wears a
moss-green gaiter with brown straps while the right boot is plain brown. That makes support-foot
audits objective instead of relying on nearly symmetrical silhouettes.

`refs/ranger/turnaround-chroma.png` locks direct front, front-quarter, right profile, back-quarter
and direct back views. The runtime mirrors those five authored angles into eight visible directions.

## Animation prompt set

The run owns eight hand-selected key poses per angle plus eight temporal midpoints. Its key cycle is
balanced by construction as two four-pose half-cycles, one led by each support leg, with matching
contact, passing and flight phases. The sixteen runtime frames therefore describe one full
left/right stride rather than repeating a preferred leg.

Each skill and the defeat motion owns five keys and five temporal midpoints per angle. Idle instead
holds five restrained key poses across ten timings; the larger generated sway poses are excluded so
breathing never reads as a full-body action:

- restrained breathing idle;
- Quick Shot with a compact nock, draw, release and recovery;
- Piercing Arrow with a planted stance, deep draw and stronger recoil;
- Volley with a visible bundle nock and fan release;
- Disengage with a real backward push-off, airborne retreat, landing and recovery;
- Heartseeker with a deliberate maximum draw and heavy recoil;
- non-gory stagger, collapse and settled defeat.

Accepted sources live under `refs/ranger/` as `run-v3-{angle}-8-chroma.png` and
`run-v3-{angle}-8-inbetweens-chroma.png`, plus `actions-{a|b}-{angle}-chroma.png` and their matching
in-between sheets, where `angle` is `front`, `front-quarter`, `side`, `back-quarter` or `back`.

## Normalization and runtime

`apps/lab/scripts/animation-sheet.py` receives already chroma-keyed sources, isolates each actor,
rejects detached neighbouring-cell fragments and projectiles already handled by the authoritative
renderer, interleaves keys and midpoints, applies hard alpha and a 32-colour palette, and anchors the
feet 56 px above the bottom of every 192 px frame. Standing scale uses a fixed per-angle reference
height so action poses cannot enlarge or shrink the Ranger.

The runtime contains 430 inspected cells:

- `run.png`: sixteen frames by five authored angles, 80 cells;
- `idle.png`, five skill sheets and `death.png`: ten frames by five angles each, 350 cells.

The complete run cycle lasts 1.2 seconds, so sixteen frames play at 75 ms each instead of becoming
faster merely because the atlas is denser. Idle runs at 3 fps with each restrained pose held for two
timings. Skill release/contact frames remain mapped to the corresponding authored pose and the
server continues to decide every combat outcome.
