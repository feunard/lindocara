# Legacy adventures

The five authored adventures — Brumeval, Sombregué, La Baie des Cent Voiles, La Cité Assiégée and
Liin — and the scripts that build and seed them. They are parked here, not deleted.

## Why they are here

They are **tile-map adventures**, and since S3's first increment (2026-08-04) the game no longer
renders a tile map. The renderer builds its scene from a heightfield
(`packages/renderer/src/hd2d/game-renderer.ts`); a map whose `heightfield` column is empty draws
nothing at all. Every adventure in this directory is in exactly that state, so seeding one today
produces a party that joins successfully and stares at a blank screen.

That was the increment's accepted cost, not an accident — the spec put porting the adventures in a
later piece. See the root [`AGENTS.md`](../../AGENTS.md) and
[`docs/archive/specs/2026-08-04-s3-terrain-on-hd2d-design.md`](../../docs/archive/specs/2026-08-04-s3-terrain-on-hd2d-design.md).

## What still works, and what does not

The build scripts still run and still produce valid bundles: they only exercise the tile model and
the authoring API, both of which are intact. `yarn adventure:build:baie` and its siblings write
into [`adventures/legacy/`](../../adventures/legacy/). Import/export through
`scripts/adventure-io.ts` is unchanged, and so is the shared tooling in `scripts/lib/` — nothing in
here was rewritten beyond the import paths the move itself broke.

What does not work is *playing* the result. That is the whole reason for this directory.

## What would revive them

Each adventure's maps have to be regenerated as heightfields — `MapData` in
`packages/engine/src/hd2d/map-data.ts`, the same format
[`scripts/build-proving-map.ts`](../build-proving-map.ts) writes. These scripts already call
`paintElevation`, so they already express their terrain as height; binding that to a heightfield is
closer to what they say than the tile layers they currently compute.

Both things that were missing are now in place:

- **A seeding path that reaches a deployed instance.** RESOLVED: `PUT /api/maps/:id/heightfield`
  (`MapController.saveHeightfield`) writes the column over HTTP, owner-fenced and validated through
  `decodeMap`, so terrain no longer has to travel through a database file this process can open —
  which production's, living inside the Bay process, never was.
  [`scripts/seed-proving-adventure.ts`](../seed-proving-adventure.ts) walks that route against any
  target, under the usual `--allow-remote`/`--allow-production` + `SEED_PASSWORD` gating.
- **Elevation collision.** RESOLVED as of S3's tile-units increment: the server simulates in tile
  units against the heightfield itself (`canStand`, `packages/engine/src/terrain-access.ts`), so a
  cliff is solid on both sides of the wire. High ground is reachable too — `MAX_STEP` is still 0, so
  nothing CLIMBS while grounded, but the client runs `stepHero` and a hero jumps onto a plateau.

For a heightfield adventure you can actually play right now, see
[`scripts/seed-proving-adventure.ts`](../seed-proving-adventure.ts).
