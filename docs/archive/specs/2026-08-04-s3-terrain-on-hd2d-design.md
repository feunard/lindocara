# S3, first increment — the game's world becomes a heightfield, end to end

Date: 2026-08-04
Status: validated in brainstorming, ready for an implementation plan

## What this delivers

**The game renders its terrain through `@lindocara/hd2d` instead of PixiJS**, and the heightfield is
the world model everywhere it appears — authored, stored, shipped on the wire, collided against,
and drawn.

You log in and the world is HD-2D: real elevation, lit sprites, tilt-shift, day and night. That is
the whole point of the increment — it is the first one that produces something you can look at.

This is the first of five pieces of S3 (see
[the scoping notes](./2026-08-04-s3-scoping-notes.md) for the other four and why the chantier
splits). It depends on none of them.

## The framing that makes this cheap

**This is development. Nothing is protected.** No migration, no back-compat, no rollback. The five
authored adventures' terrain, the tilemap model, the baked-collision wire fields and the old
renderer are all disposable, and the author has said so explicitly.

That single fact removes most of what would otherwise make this expensive. Do not reintroduce it:
any task that finds itself writing a converter, a compatibility shim, or a "legacy" branch has
misunderstood the increment.

## Why the world model must change on the wire, not just in the client

`WorldInfo` (`packages/engine/src/protocol.ts`) ships the terrain from server to client, baked, one
character per cell, plus sub-cell collider rectangles in world pixels. Its own comment states the
reason and it is a good one:

> *The server bakes its map — ground plus everything solid standing on it — and ships the result.
> The client decodes exactly these bytes and collides against them. There is only ever one baking,
> and it happens on the authority.*

That principle survives this increment intact. What changes is **what** gets baked and shipped: a
heightfield, not a character grid.

Converting the tilemap into a heightfield in the client at load would leave two world models with a
lossy projection between them — the dual truth this programme has refused at every turn. The wire
carries the heightfield or the increment is not done.

## The world model

`packages/engine/src/hd2d/map-data.ts` already defines it, and it is already loaded, validated and
rendered by `apps/lab`:

```ts
interface MapData {
  version: 1;
  size: number;              // grid side, in cells
  levelHeight: number;
  waterLevel: number;
  levels: readonly (number | null)[];    // size², row-major; null = water
  materials: readonly TerrainMaterial[]; // size²
  colliders: readonly ColliderRect[];    // tile units
  spawns: readonly { name: string; x: number; z: number }[];
}
```

**Units are tile units throughout.** The game's pixels do not survive into it.

**It grows by exactly two fields in this increment** — the game has content the lab never had:

- `elements` — the game's decoration, at their existing quarter-cell offsets, carrying the catalogue
  id and nothing more. Appearance only.
- `events` — the authored events' cell, active-page appearance and options. Appearance only, exactly
  as `WorldInfo.events` carries them today.

**It does not grow further.** Markers, the tileset indirection and quest metadata stay out until
something needs them; materials already pick an atlas, which is what `tilesetId` existed to do.

## What the client becomes

`packages/renderer` is replaced, not adapted. Its 10 888 lines assume a 2D painter's-algorithm world
and there is nothing in that assumption worth carrying forward.

The replacement follows the shape `apps/lab/src/main.ts` has already proven twice: a composition
root that builds an `Hd2dContext`, meshes terrain from the map, and registers billboards. **The lab
is the reference implementation** — read it before writing anything, and prefer copying its
structure to inventing a new one.

The seam stays where it is. `packages/client/src/game/` keeps its current shape — `net.ts` owns
prediction and interpolation, `session.ts` owns the store writes, neither imports React. Only what
they hand to the renderer changes.

**What must not leak:** `@lindocara/hd2d` never learns the game's domain. It mixes numbers and hands
them to shaders; it does not know what a monster, a quest or a biome is. Three chantiers have held
that line and it holds here — the game's knowledge lives in the adapter.

### This breaks the editor, deliberately

`packages/editor` imports five files from `packages/renderer`. Replacing the renderer breaks map
authoring, and **that is accepted**: the editor is coming forward into S3 anyway, and it is blocked
on this increment settling the format before it can be rebuilt.

Do not keep the old renderer alive to spare it. A second render path is exactly the coexistence the
author rejected when deciding to pull the editor forward. **Let the editor break, and say so in its
`AGENTS.md`** so the next reader is not left guessing whether they caused it.

## What the server does

The server keeps baking, on the same principle. It loads a map, and ships its heightfield, materials
and colliders in `WorldInfo`.

**Its own geometry does not move in this increment.** Monsters, guards, projectiles and navigation
keep running on the pixel-unit `simulation.ts`/`collider.ts` — that migration is a separate piece,
independent of this one, and doing both at once would make a regression unattributable.

That means the server holds two coordinate systems for the length of this increment: tile units for
the map it ships, pixels for the entities it simulates. **This is the one place where the increment
is deliberately ugly**, and it is bounded: it ends when the server-geometry piece lands. Mark the
conversion sites clearly so they are trivial to find and delete.

## Content

The game's maps are regenerated as heightfields. The five authored adventures under `scripts/` are
**generators, not hand-painted artefacts** — they already call `paintElevation`, so they already
express terrain as height. Binding them to a heightfield is closer to what they say than the tile
layers they currently compute.

Porting them is **not** part of this increment. This increment needs one map to prove itself; the
adventures follow once the format is stable. If they are broken meanwhile, that is acceptable and
expected.

## Risks

**The scene is empty before it is full.** Terrain lands before elements and events are wired, so
there will be a period where the world renders as bare ground. That is honest progress, not a
regression — but it must be sequenced so that each task leaves the game *runnable*, even if sparse.

**`renderer.ts` is 5 378 lines and knows things nobody wrote down.** Deleting it will surface
behaviour that exists only there — camera clamping, draw ordering, feedback effects. Expect to
rediscover rules, and write them down as they surface rather than reimplementing them by guess.

**The GPU budget is not a risk.** Measured at game population: 2,11 ms/frame, 12,6 % of the 16,7 ms
budget, with `heavy` at 4,72 ms. There is no performance wall here. Use `?bench=game` and re-arm the
load on site with `labBench.armer()` — three of this programme's measurements were wrong because the
population was culled.

**Two coordinate systems on the server** is the one deliberate compromise. Bounded and marked, per
above.

## Out of scope, explicitly

- The server's own geometry migration — fourteen world systems, its own piece.
- The protocol switching from movement intent to client-authored position, and the retirement of
  `prediction.ts`. S2 decided the rule; the wire change belongs with the piece that can prove it.
- The editor on hd2d. It is coming forward into S3, but it is blocked on this increment defining the
  format first — so it **breaks** here and is rebuilt in its own piece. See above.
- Porting the five authored adventures.
- Markers, the tileset indirection, quest metadata in the map format.

## What is settled and must not be relitigated

- **The heightfield wins**, and the map format grows to carry the game's content. One model, no
  converter.
- **The editor comes forward into S3** rather than keeping a second render path alive.
- **The client owns player movement**; the server relays position without validating it. Decided in
  S2 on measured grounds — ACK latency is ~107 ms and structural, so server authority forces keeping
  prediction, a fixed tick and bit-exact determinism.
- **`packages/hd2d` never learns the game's domain.**
- **Nothing in production is protected.** Break what needs breaking.

See [the scoping notes](./2026-08-04-s3-scoping-notes.md) for the measurements behind the split,
[the S2 spec](./2026-08-03-s2-simulation-client-design.md) for what S2 decided, and
[`docs/hd2d-rendering.md`](../../hd2d-rendering.md) — the rendering-pitfall registry, paid for once
already — **before touching the render path.**
