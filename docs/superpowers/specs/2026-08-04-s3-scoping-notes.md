# S3 — scoping notes, before the spec

Date: 2026-08-04
Status: **scoping only.** Not a design. Written after S2 landed, to record what an exploration of
the codebase found before anyone writes the S3 spec.

## Why this file exists

The reboot spec describes S3 in one line — *"`renderer` rewritten as an hd2d adapter; the 5 228
lines of Pixi removed"*. Measuring the code found that line to be wrong in four ways, each of which
changes the shape of the chantier. Rediscovering them costs an afternoon; writing them down costs a
page.

## What the measurements say

**The Pixi figure is off by half.** `packages/renderer` is **10 888 lines**, not 5 228.
`renderer.ts` alone is **5 378** — the spec's number was that one file at the time it was written.

**Fourteen server systems read pixel geometry.** `movement`, `monster`, `navigation`, `skill`,
`rogue-skill`, `npc-movement`, both `peasant-*`, and others, across ~7 900 lines of
`packages/server/src/world/`. Moving the server to tile units is a migration, not a rewiring.

**The editor imports the renderer** — five files in `packages/editor/src`. So S3 as written cannot
retire the renderer without breaking the editor. **The programme orders S3 before S5, but S5's
package consumes exactly what S3 destroys.** That ordering does not hold.

**"Zero maps in production" is false.** Five authored adventures live in `scripts/`, 528 KB of
authoring code: `liin-adventure` (276 KB), `baie-cent-voiles` (116 KB), `cite-assiegee` (64 KB),
`sombregue` (44 KB), `brumeval` (28 KB). Three were seeded to production.

## The two decisions already taken with the author

**The editor comes forward into S3.** Rather than keeping a second render path alive or breaking
authoring for the duration, S3 rebuilds the game *and* the editor stage on hd2d. Pixi dies once,
and the editor gains WYSIWYG parity with the game — which is what S5 existed to deliver. S3 and S5
merge.

**The heightfield model wins, and grows.** The game's maps and the lab's are not two encodings of
one thing:

| | Game (`engine/map-data.ts`) | Lab (`engine/hd2d/map-data.ts`) |
| --- | --- | --- |
| Terrain | 3 layers of frozen tile ids over a `tilesetId` | `levels` per cell + `materials` |
| Height | painted — cliffs are tiles | real, `null` = water |
| Content | elements, events, markers | none |
| Units | pixels | tile units |

The lab's model is richer in terrain and poorer in content. The decision is that the **heightfield
wins** and the format **grows** to carry elements, events and markers — one model, no converter, no
lossy projection between two truths.

## The finding that makes that decision cheaper than it looks

The authored adventures call **`paintElevation`** (see `scripts/brumeval/maps.ts` and
`scripts/lib/island-terrain.ts`). **The game's maps already have elevation** — three levels, painted
into tile layers by a brush.

So the authoring scripts already *think in elevation*; the tile layers are the **derived result**
the brushes compute from that intent. **A heightfield is closer to what those scripts express than
the painted output is.** Re-authoring the terrain half is binding to an intent the scripts already
state, not reconstructing it.

The real migration cost is therefore in **elements, events and quests** — not terrain.

## The five pieces S3 now contains

Each stands alone; the order below is the dependency order, not a schedule.

1. **The map format grows** — elements, events, markers into the heightfield model, plus the
   database schema and a migration for the five authored adventures. Pure data and codec work,
   testable without a browser. **Everything else is blocked on it.**
2. **The editor authors heightfields** — the stage rebuilt on hd2d, painting height instead of
   cliffs.
3. **The game renders on hd2d** — the render path rebuilt, `packages/renderer` retired.
4. **The server moves to tile units** — fourteen world systems off the pixel geometry. **Independent
   of 1-3**, and verifiable without a browser, since `packages/server/test-api/` drives real HTTP and
   WebSockets. This is the other front that could start immediately.
5. **The protocol switches and prediction retires** — last, because it only means anything once the
   client owns movement end to end. S2 decided the rule (*the server decides outcomes; the client
   decides its own position*) and deliberately left the wire untouched.

## What the spec still has to decide

- Whether the grown map format keeps the `tilesetId` indirection, or whether materials picking an
  atlas (the lab's approach) is enough once terrain is a heightfield.
- What happens to the **baked collision** the game ships on the wire (`WorldInfo.tiles` +
  `WorldInfo.colliders`) once collision comes from a heightfield and rectangle colliders.
- Whether the five authored adventures are migrated by a script or re-run from their sources against
  the new format — the sources being generators, the second is plausible and cheaper.
- Whether `simulation.ts`/`collider.ts` (pixel units, on borrowed time since S2) are retired in
  piece 4 or survive until piece 5.

## What is already settled and must not be relitigated

- **The client owns player movement**; the server relays position without validating it. Decided in
  S2 on measured grounds: ACK latency is ~107 ms and **structural** (10 Hz broadcast, not load — the
  server holds 16 players at 138 ms with zero errors), so keeping server authority forces keeping
  prediction, a fixed tick and bit-exact determinism.
- **The GPU budget is not a constraint**: 2,11 ms/frame at game population, 12,6 % of 16,7 ms.
- **`packages/hd2d` must never learn the game's domain.** It mixes numbers and hands them to
  shaders; it does not know what a monster or a biome is.

See [the reboot spec](./2026-08-02-hd2d-reboot-design.md) for the programme and
[the S2 spec](./2026-08-03-s2-simulation-client-design.md) for what S2 decided and deferred here.
