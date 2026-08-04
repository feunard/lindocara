# S3 — the world moves to tile units, and the hero moves itself

Date: 2026-08-05
Status: validated in brainstorming, ready for an implementation plan

## What this delivers

**One coordinate system, and one movement rule.** Every part of the game that reasons about
position moves to **tile units with the grid centre as origin**, and `stepHero`
(`packages/engine/src/hd2d/hero-step.ts`) becomes the hero's movement rule, running on the client.

You log in and the hero has weight: it accelerates and skids, it jumps, it swims and runs out of
breath, thin ice gives way, the canopy opens. Cliffs are solid — you climb them by jumping, not by
walking through them. That last sentence is the point: today the drawn world has geometry the
collided world does not.

This is the second of five pieces of S3 (see
[the scoping notes](./2026-08-04-s3-scoping-notes.md)). It depends on the first
([the heightfield increment](./2026-08-04-s3-terrain-on-hd2d-design.md)), which has landed.

## The framing

**This is development. Nothing is protected.** No migration, no back-compat, no rollback. Stored
hero positions are cleared rather than converted; the five authored adventures are already parked
in `scripts/legacy/` and are not part of this.

**The bridge dies here.** `packages/engine/src/hd2d/tile-pixel-bridge.ts` and
`packages/server/src/world/heightfield-pixel-bridge.ts` were written to be deleted, under a
banner that makes every call site greppable. Deleting them is a deliverable of this piece, not a
side effect. If either survives, the piece is not done.

## What was settled in brainstorming, and must not be relitigated

1. **Tile units reach everywhere** — server internals, storage and the wire. Keeping the wire in
   pixels would relocate the bridge instead of deleting it.
2. **Stored hero positions are cleared, not converted.** A stored `x: 2176` reinterpreted as tile
   units is 2176 tiles. Rather than carry a one-shot conversion nobody runs twice, heroes re-enter
   at their map's spawn.
3. **`stepHero` is adopted whole** — friction, jump, gravity, coyote time, swimming, breath, thin
   ice, the glider. Not a unit change to today's movement: a replacement of it. This was chosen
   after the alternative ("units only") was found to make high ground unreachable, because the lab
   climbs with `maxStep: 0` and gets onto plateaus by jumping.
4. **The client owns movement.** `stepHero` runs once, on the client. The server stores and
   relays position and never re-simulates it. `prediction.ts` and `reconcile()` retire. Decided in
   S2 on measured grounds — ACK latency is ~107 ms and structural.
5. **One increment, not two.** The author chose this knowing the attribution cost; see
   *Keeping regressions attributable* below for the mitigation the plan must carry.
6. **Mobility skills are applied by the client.** `blink`, Shadow Dance and rogue mobility work
   today by the server computing the hero's step — a held blink clamps the desired movement to its
   remaining `mobilityDistance` and debits it (`movement-system.ts:90-107`). Client-authored
   movement makes that undecidable. The server therefore keeps **granting** each skill — cost,
   cooldown, resource, effects, all still server-decided — and the **client performs the
   displacement**, reporting the resulting position like any other movement.

   The author chose this over the alternative (the server issuing an authoritative displacement
   the client accepts, as teleport already does) with the tradeoff stated: a modified client gains
   free repositioning that is indistinguishable from a legitimate blink. That is an extension of
   the movement authority already given up in decision 4, not a new category of exposure — but it
   is a second thing a cheat can do, and it is recorded here so it is not rediscovered as a bug.

## The coordinate system

`@lindocara/engine/hd2d/*` is already the target and needs no change: **tile units, grid centre as
origin** (`createTerrainQuery`: `toCell = floor(w + size/2)`, so coordinates run `-size/2`..`+size/2`).

The axis convention is the trap, and it is worth stating plainly because a mechanical port
typechecks and puts the world on its side:

| | ground axis 1 | ground axis 2 | elevation |
| --- | --- | --- | --- |
| pixel world (dying) | `x` | `y` | — none — |
| `HeroState` (surviving) | `x` | `z` | `y` |

Every site that reads a pixel `{x, y}` as a ground position becomes `{x, z}`, and `y` becomes a
real third axis. There is no scale factor left to apply anywhere: `TILE_SIZE` stops being a unit
conversion and remains only what it always physically was, the size of a source texture tile.

## What the wire becomes

Movement inverts. Everything else does not.

**Today:** the client sends `{ t: "input", seq, input }`; the server applies exactly one command
per tick, echoes the highest sequence as `ack`, and ships an authoritative position.

**After:** the client sends its own position. The message carries `x`, `y`, `z` in tile units,
`facing`, and the state flags a remote client needs in order to draw it — `airborne`, `swimming`,
`gliding`. The server stores and relays.

Retiring with it: `seq`/`ack`, the one-command-per-tick rule, the starved-tick repeat, and
`prediction.ts` entirely. `INTERPOLATION_DELAY_MS` (150 ms, `packages/client/src/game/net.ts:79`)
**stays** — remote players are still drawn in the past, still interpolated between snapshots, and
that is unrelated to who computes the position. Do not "fix" it while the surrounding code is
open: it is what buys smooth remote motion out of a snapshot stream, and it never applied to your
own hero.

Defensive parsing does not relax. A position off the map, a non-finite float or a missing flag
drops the frame the way every malformed message already does. That is frame hygiene, not
authority.

### What the server gives up, stated plainly

A modified client can walk through walls, cross water, and teleport. This is the deliberate cost
of decision 4, and the spec records it so nobody rediscovers it as a bug.

What a modified client still cannot do: deal damage, heal, take loot, gain XP, complete a quest,
resurrect, change its own health, or move another player. Every one of those remains
server-decided. **The rule "the server decides outcomes" survives with exactly one exception —
where a hero is**, including where a mobility skill puts it (decision 6). A task that finds itself
moving a third decision to the client has misread this piece.

## What the server keeps simulating

Monsters, guards, projectiles, loot, navigation, quests, area-of-interest, combat resolution —
all of it stays authoritative and all of it moves to tile units. The fourteen systems under
`packages/server/src/world/` are the bulk of the work; `world-runtime.ts` (871 lines) carries the
runtime types they all share and is the natural first domino.

Three consequences that are not mechanical:

- **Distances are re-expressed, not rescaled by hand at each site.** The interest radii all live
  together in `packages/engine/src/interest.ts` — players, guards and corpses 900 px, monsters
  850, chat 700, loot 650, hysteresis 96 — and become tile-unit constants there. Every skill range
  follows. Dividing by 64 at each call site is how a unit migration leaves half of itself behind.
- **Navigation becomes elevation-aware.** `navigation-system.ts`'s A* grid must stop pathing up a
  cliff face. Its per-tick node budget, 128-entry cache and repath interval are unchanged
  behaviour and must stay — this is a change of what "walkable" means, not of how the search is
  paced.
- **Monsters walk on terrain height.** They do not jump. They query `heightAt` for the ground
  under them the way the hero does.

## Collision

`isWalkable`/`resolveTerrain`/`isWalkableBox` (pixel, whole-cell plus sub-cell rects) give way to
the heightfield's own semantics, already written and already proven in `apps/lab`:
`createTerrainQuery` (`heightAt`, `maxHeightAround`, `levelAt`, `kindAt`), `ColliderIndex`, and
`canEnter`'s rule — `maxStep` against the last ground stood on, water as a surface you swim on
rather than a wall, and the disc tested rather than the centre point so a body cannot sink half
into a cliff.

`maxStep` for the game is **0**, as in the lab: no grounded climbing at all. High ground is
reached by jumping.

## What is deleted

- `packages/engine/src/prediction.ts` and its tests.
- `packages/engine/src/simulation.ts`'s `step()` and `PLAYER_SPEED`; `TICK_HZ` loses its
  command-rate role and survives only if the server's tick still wants it.
- `MAX_STARVED_TICKS` (`packages/server/src/world/world-runtime.ts:92`) and the starve branch that
  reads it in `movement-system.ts:65` — there is no last intent to repeat once the client sends
  positions.
- `packages/engine/src/hd2d/tile-pixel-bridge.ts`,
  `packages/server/src/world/heightfield-pixel-bridge.ts`.
- The pixel-geometry halves of `collider.ts` and `game.ts` — the parts, not the files: `game.ts`
  is 1337 lines and most of it is balance tables and zone data that have nothing to do with units.
- `WorldInfo.tiles` and `WorldInfo.colliders` — the pixel projection the last increment shipped
  alongside the heightfield precisely so it could die here. `WorldInfo.heightfield` becomes the
  only terrain on the wire.

## Risks

**Monster AI is where elevation and a jumping target meet, and there is nothing to copy.** The lab
has no monsters. A hero who climbs onto a plateau is visible, in range, and unreachable — the AI
must abandon rather than grind against a cliff, and `monster-system.ts` already has an
unreachable-target abandonment path that this must extend rather than duplicate.

**`stepHero`'s purity has never been load-bearing before.** `packages/engine/CLAUDE.md` forbids
`Math.random`, clocks and assumed `dt` in `hd2d/` explicitly against this day. It has been proven
at 60 Hz in one app; it is about to be the sole authority for a networked hero. Note it **mutates
its `HeroState` in place** and returns events — a shape that is fine for a single owner and would
be a trap for anything that expected a pure function of state.

**The wire change and the movement change land together**, so a movement bug could be either. See
the mitigation below.

**Nothing observable proves the units are right.** A world uniformly wrong by a factor of 64 looks
plausible in a screenshot. Round-trip and origin-shift assertions are the guard, exactly as they
were for the bridge.

## Keeping regressions attributable inside one increment

The author chose one increment over two, knowing the cost. The plan must therefore order the work
so a failure still has a side to fall on:

1. Units first, across server, storage and wire, with movement semantics **unchanged** — the
   existing `step()` simply operating in tile units.
2. A full verification gate here: `npm run v` green, and the game played. Cliffs are solid and high
   ground is unreachable at this point, which is expected and temporary.
3. Only then `stepHero`, client-authored movement, and the retirement of `prediction.ts`.

A regression found after step 3 that reproduces at step 2 is a unit bug; one that does not is a
movement bug. That distinction is the whole reason for the ordering, and collapsing the two halves
into interleaved tasks throws it away.

## Out of scope, explicitly

- The editor's rebuild on hd2d. Still quarantined; still its own piece.
- Porting the five legacy adventures. Parked in `scripts/legacy/`, and the README there records
  what would revive them — this piece removes one of its two blockers (elevation collision) and
  not the other (a seeding path that reaches a deployed instance).
- Ramps or stairs in the heightfield format. Jumping is how high ground is reached now.
- Anti-cheat for movement. Given up deliberately; see above.
- Monsters jumping, swimming or gliding.

See [`docs/hd2d-rendering.md`](../../hd2d-rendering.md) before touching the render path,
[the S2 spec](./2026-08-03-s2-simulation-client-design.md) for the measurements behind
client-authored movement, and `packages/engine/CLAUDE.md` for the purity rules `hd2d/` has been
holding in advance of exactly this.
