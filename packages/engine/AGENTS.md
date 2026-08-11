# @lindocara/engine

The platform-free core: pure rules and shared contracts. **Imports nothing from Cloudflare, the
DOM, React or Node.** Valid in a browser *and* in workerd — its tsconfig gives it neither `DOM` nor
`@cloudflare` types, so a leaked platform global fails the typecheck (that is the point).

## Responsibility

- `hd2d/hero-step.ts` — the single source of movement truth: `stepHero(state, input, dt, deps)`,
  in tile units, run by the CLIENT (see `hd2d/` below).
- `simulation.ts` — the simulation's CLOCK and the shape of a movement intent, and nothing else:
  `TICK_HZ`/`TICK_DT`/`NETWORK_SNAPSHOT_HZ`, the pixel-era `PLAYER_SIZE`/`WORLD_*`/`clampToWorld`
  the unconverted zone catalogue in `game.ts` still reads, and `Input`. `step()` and `PLAYER_SPEED`
  are DELETED, and `prediction.ts` with them — S3 moved movement to the client, so there is nothing
  left to predict or replay. `Input` is no longer a command: nothing stamps, sends, queues or
  replays it, and it never crosses the wire.
- `death.ts` — the corpse/ghost state machine, plus `speedForLife`, which is how a client folds its
  life state into the one speed `stepHero` reads.
- `game.ts` — map geometry, collision, combat/progression constants. `protocol.ts` — the wire
  format with defensive parsing (`parseClientMessage` returns `null`, never throws).
- `tileset.ts`/`autotile.ts`/`tile-brush.ts`/`tile-layer-codec.ts`/`map-data.ts` — the layered map
  model and paint-time brushes. `zones.ts` — the zone catalogue.
- `i18n/` — FR/EN dictionaries (data only; the server sends codes, never prose). `skills.ts`,
  `combat-actions.ts`, `cooperation.ts`, `resources.ts`, `character.ts`, `adventure*.ts`,
  `event-commands.ts`/`event-interpreter.ts` (the pure, clockless command stepper).
- `hd2d/` — **the game's geometry and movement rule**, in its own subfolder rather than the flat
  root above (moved from `apps/lab` across two S2 tasks): `terrain-query.ts`
  (world-space collision queries over a heightmap), `collider-index.ts` (the sparse rect index
  disc queries test against), `map-data.ts` (a map as pure, defensively-parsed data),
  `hero-state.ts` (`HeroState`/`HeroInput`/`HeroSettings`/`HeroEvent`, the data the rule reads and
  writes), `locomotion.ts` (the friction-based movement model — one `pasAmorti` integrator, three
  materials' worth of friction/speed/skid) and `hero-step.ts` (`stepHero`, the per-frame rule that
  ties the others together and narrates what happened as `HeroEvent`s rather than playing sound or touching a billboard
  itself). These read in **tile units** — as does the whole game now; what is left in **pixels** is
  the unconverted zone catalogue in `game.ts`/`collider.ts` and the `clampToWorld` it calls, which
  no live party reaches. The subfolder is still the visible fence between the two.

  **The reprieve is over: `hd2d/` IS the game's movement.** S3's second increment (2026-08-06)
  wired `stepHero` into the client — `packages/client/src/game/hero-controller.ts` owns a
  `HeroState` and feeds it every animation frame — and deleted `step()`, `PLAYER_SPEED`,
  `prediction.ts` and the whole command-queue model with it. The server no longer steps a hero; it
  validates the position the client reports (`applyReportedMove`, `worldTick.ts`). `apps/lab` is
  still a witness that exercises the same rule outside the game, not a second copy of it.

  **So: anything about hero movement belongs here, and nowhere else.** There is no second movement
  path left to do it twice in.

- `ground.ts` and `terrain-access.ts` — tile units, at the ROOT rather than behind that fence, and
  deliberately: they are the vocabulary the whole game speaks now, not the lab's. `ground.ts` owns
  `GroundVector {x, z}` (the ground plane — there is no ground `y` any more), `WorldPosition`
  (`+ y`, ELEVATION) and `groundDistance`; the one-field-name difference from `Vec2` is the only
  reason a half-finished conversion fails to compile instead of shipping a world on its side.
  `terrain-access.ts` is the terrain junction — `zoneTerrainFromHeightfield` bakes a stored
  heightfield into a `ZoneTerrain`, and `canStand`/`resolveGroundMovement`/`groundUnder` answer
  every "can a body be here" question. It moved here from `packages/server/src/world/` when the
  client started moving against the same terrain: **both sides bake from the same string with the
  same function** — the client to move, the server to validate — which is the same argument that
  keeps `stepHero` here.

## Graph

- **Depends on:** nothing.
- **Depended on by:** everyone (`server`, `renderer`, `client`, `editor`, `testing`) plus
  `apps/lab`, for `hd2d/` only.

## Commands

```bash
npm run typecheck:engine        # tsc, pure ES2022 (no DOM/Workers)
npm test -w @lindocara/engine   # or: npm run test:engine  — Node env, no workerd
```

## Rules

- Keep it pure. If a change needs `document`, `WebSocket`, `DurableObject` or `react`, it belongs in
  a consumer package, not here.
- `stepHero` has exactly one copy on purpose — the client, the lab witness and every suite run the
  identical function. Never fork it. The terrain it walks on has one bake for the same reason
  (`zoneTerrainFromHeightfield`): the client moves against it and the server validates against it,
  and two bakes would let a hero walk through a wall on one side of the wire and into it on the
  other.
- **Pure also means no `Math.random`, no clock (`performance.now()`, `Date.now()`), and no `dt`
  silently assumed to be a fixed value instead of read from the parameter.** These three typecheck
  clean, compile clean, and pass in `apps/lab` where nobody but a human eye would notice — and the
  rule now runs at the client's own frame rate, on whatever `dt` that frame happened to be, against
  terrain a server baked separately. A hardcoded `dt` or a clock read inside the rule breaks that
  immediately; `Math.random()` would make the position a client reports unreproducible by the room
  that has to judge it. See `apps/lab/AGENTS.md`'s "The snow island" section for the fuller
  argument and the concrete traps this guards against.
- Server events are codes, not sentences: add an `EventCode` + both dictionary entries, never an
  English string. The i18n test enforces FR/EN parity.
- **`hd2d/`'s identifiers and event-tag strings stay FRENCH, on purpose** — unlike the rest of this
  package. Renaming them during the S2 extraction from `apps/lab` would have destroyed the parity
  argument every `git mv`-based move in that chantier relied on (the reviewer diffing old vs. new
  code line by line), and the repo's author works in French day to day. Don't "clean up" a French
  identifier in `hd2d/` into English on sight; that decision was made deliberately, not by neglect.
- **`TerrainMaterial`'s four values (`hd2d/terrain-query.ts`) are DATA, not just a type.** They are
  already serialized by name, thousands of times over, in `apps/lab/public/maps/ile.json`
  (`MapData.materials`, `hd2d/map-data.ts`). Renaming one today costs a `build:map` regeneration;
  the day an editor has produced maps of its own that nobody regenerates from source, the same
  rename costs a format migration instead. Know which cost you're signing up for before renaming.
  **`"glace-fine"` (thin ice) is the worked example.** The mechanic — crack, break, refreeze — was
  removed; the NAME was not, because `decodeMap` rejects a map OUTRIGHT on one unknown material and
  authored maps live in the database where nothing here can inspect them. It is coerced to
  `"glace"` on the way in (`hd2d/map-data.ts`), and the tile slots its brush painted are coerced the
  same way (`RETIRED_THIN_ICE_SLOTS`, `tilesets/tiny-swords.ts`) so they do not fall down
  `materialOfSlot`'s grass fallback and turn an authored frozen lake into a lawn. Both are safe to
  delete only once no stored map carries either — which is not something this repo can prove.
- Tests are pure logic and run in Node (`packages/engine/test/`).

See the root [`AGENTS.md`](../../AGENTS.md) for the full architecture and the monorepo layout.
