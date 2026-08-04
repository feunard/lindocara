# S3 — tile units everywhere, and the hero moves itself — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every part of the game that reasons about position to tile units, and make
`stepHero` the hero's movement rule, running on the client.

**Architecture:** Two phases in one increment. Phase A converts the server, storage and wire to
tile units with movement semantics unchanged, and ends at a hard verification gate. Phase B
replaces `step()` with `stepHero` on the client, inverts the movement half of the wire, and
retires prediction. The gate is what keeps a regression attributable when the two land together.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Alepha (`$entity`, `$room`), Three.js
via `@lindocara/hd2d`, Vitest, Biome.

**Spec:** [`2026-08-05-s3-tile-units-and-client-movement-design.md`](../specs/2026-08-05-s3-tile-units-and-client-movement-design.md)

---

## Global Constraints

- **Tile units, grid centre as origin.** `createTerrainQuery`'s `toCell = floor(w + size/2)`;
  coordinates run `-size/2`..`+size/2`. After Phase A there is no scale factor anywhere:
  `TILE_SIZE` remains only the pixel size of a source texture tile.
- **The axis convention is the trap.** Pixel world: `x`,`y` are both ground axes, no elevation.
  `HeroState`: `x`,`z` are ground, **`y` is elevation**. Every ported `{x, y}` ground position
  becomes `{x, z}`. A mechanical rename typechecks and puts the world on its side.
- **The server decides outcomes, with exactly two exceptions:** where a hero is, and where a
  mobility skill puts it. Damage, healing, loot, XP, quests, deaths, monster AI and projectiles
  all stay server-decided. Moving a third decision to the client misreads this piece.
- **Nothing in production is protected.** No migration, no back-compat. Stored hero positions are
  cleared, not converted.
- **Both bridges are deleted, not relocated** — `packages/engine/src/hd2d/tile-pixel-bridge.ts`
  and `packages/server/src/world/heightfield-pixel-bridge.ts`. `grep -rn "TILE→PIXEL BRIDGE"`
  must return nothing but history when this is done.
- **`INTERPOLATION_DELAY_MS` (150 ms, `packages/client/src/game/net.ts:79`) stays.** It is not
  prediction machinery; it is what buys smooth remote motion out of a snapshot stream, and it never
  applied to your own hero. Deleting it while deleting prediction is the obvious wrong move.
- **`stepHero` mutates its `HeroState` in place** and returns `HeroEvent[]`. It is not a pure
  function of state. Fine for a single owner; a trap for anything expecting `newState = step(old)`.
- **Purity still binds `packages/engine/src/hd2d/`:** no `Math.random`, no clock, no assumed `dt`.
  See `packages/engine/CLAUDE.md` — those rules were written against this day.
- **Language:** English everywhere, except pre-existing French under
  `packages/engine/src/hd2d/` and `apps/lab/`, which stays French.
- Biome: `noNonNullAssertion` is on. Alepha classes use no TypeScript `private`; JSDoc is
  `/** … */`.
- Tests drive the real app (`packages/server/test-api/` boots Alepha over real HTTP/WebSocket).
  No `vi.mock`.

## The gate between phases is load-bearing

The author chose one increment over two, knowing the attribution cost. Task 8 is the mitigation:
**Phase A must be green and played before any Phase B task starts.** A regression found later that
reproduces at Task 8 is a unit bug; one that does not is a movement bug. Interleaving Phase B work
into Phase A tasks throws that away and is the one deviation from this plan that is not allowed.

At the gate, cliffs are solid and high ground is unreachable. That is expected and temporary —
jumping arrives in Phase B.

## File Structure

**Phase A — units**
- Modify: `packages/engine/src/interest.ts` — the six radii become tile units in one place.
- Modify: `packages/server/src/world/world-runtime.ts` — runtime types carry `x`,`y`,`z`.
- Modify: `packages/server/src/api/realtime/worldState.ts` — `ZoneDefinition.terrain` becomes a
  `TerrainQuery` + `ColliderIndex` pair instead of a pixel `TerrainGeometry`.
- Modify: the thirteen systems under `packages/server/src/world/` that read geometry.
- Modify: `packages/engine/src/protocol.ts` — snapshot positions gain `z`; `WorldInfo.tiles` and
  `WorldInfo.colliders` are removed.
- Modify: `packages/server/src/api/entities/heroes.ts` — `z` column; positions cleared.
- Delete: both bridge files.

**Phase B — movement**
- Modify: `packages/engine/src/protocol.ts` — `{t:"input"}` becomes `{t:"move"}`.
- Create: `packages/client/src/game/hero-controller.ts` — owns the client's `HeroState`, feeds
  `stepHero`, emits the wire message. The one new file; it is the seam that replaces prediction.
- Modify: `packages/client/src/game/net.ts`, `session.ts`.
- Modify: `packages/server/src/world/movement-system.ts` — keeps its non-movement duties, loses
  the step.
- Delete: `packages/engine/src/prediction.ts`, `simulation.ts`'s `step()`/`PLAYER_SPEED`,
  `MAX_STARVED_TICKS` and its starve branch.

---

### Task 1: The interest radii become tile units

The smallest possible first move, and the one that proves the conversion discipline: all six radii
live together in one file, so this is one edit rather than a scatter. Doing it first also means
every later task reads tile-unit radii and cannot half-convert a call site.

**Files:**
- Modify: `packages/engine/src/interest.ts`
- Test: `packages/engine/test/interest-units.test.ts`

**Interfaces:**
- Produces: the same six exported constants, re-expressed in tile units —
  `PLAYER_VISIBILITY_RADIUS`, `GUARD_VISIBILITY_RADIUS`, `CORPSE_VISIBILITY_RADIUS` (900 px →
  `14.0625`), `MONSTER_VISIBILITY_RADIUS` (850 → `13.28125`), `LOCAL_CHAT_RADIUS` (700 →
  `10.9375`), `LOOT_VISIBILITY_RADIUS` (650 → `10.15625`), `INTEREST_HYSTERESIS` (96 → `1.5`).
  Exact quotients of the pixel values by `TILE_SIZE = 64`; do not round them to "nicer" numbers,
  because a changed radius is a gameplay change and this task is not one.

- [ ] **Step 1: Write the failing test**

```ts
// packages/engine/test/interest-units.test.ts
import { describe, expect, it } from "vitest";
import {
  CORPSE_VISIBILITY_RADIUS,
  GUARD_VISIBILITY_RADIUS,
  INTEREST_HYSTERESIS,
  LOCAL_CHAT_RADIUS,
  LOOT_VISIBILITY_RADIUS,
  MONSTER_VISIBILITY_RADIUS,
  PLAYER_VISIBILITY_RADIUS,
} from "../src/interest.js";

// The pixel values these replace, kept here as the record of what was converted. When the same
// world is measured in tiles instead of pixels, every radius must cover the SAME ground — a
// rounded-off radius is a balance change wearing a refactor's clothes.
const TILE_SIZE = 64;

describe("interest radii, in tile units", () => {
  it("covers exactly the ground the pixel radii covered", () => {
    expect(PLAYER_VISIBILITY_RADIUS).toBe(900 / TILE_SIZE);
    expect(GUARD_VISIBILITY_RADIUS).toBe(900 / TILE_SIZE);
    expect(CORPSE_VISIBILITY_RADIUS).toBe(900 / TILE_SIZE);
    expect(MONSTER_VISIBILITY_RADIUS).toBe(850 / TILE_SIZE);
    expect(LOCAL_CHAT_RADIUS).toBe(700 / TILE_SIZE);
    expect(LOOT_VISIBILITY_RADIUS).toBe(650 / TILE_SIZE);
    expect(INTEREST_HYSTERESIS).toBe(96 / TILE_SIZE);
  });

  it("keeps the ordering the AOI design depends on", () => {
    // Players are seen furthest, loot nearest, and hysteresis is far smaller than any radius —
    // an exit band wider than the band it guards would make entries and exits flap.
    expect(PLAYER_VISIBILITY_RADIUS).toBeGreaterThan(MONSTER_VISIBILITY_RADIUS);
    expect(MONSTER_VISIBILITY_RADIUS).toBeGreaterThan(LOCAL_CHAT_RADIUS);
    expect(LOCAL_CHAT_RADIUS).toBeGreaterThan(LOOT_VISIBILITY_RADIUS);
    expect(INTEREST_HYSTERESIS).toBeLessThan(LOOT_VISIBILITY_RADIUS / 4);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -w @lindocara/engine -- interest-units
```

Expected: FAIL — every radius is still its pixel value (e.g. `expected 900 to be 14.0625`).

- [ ] **Step 3: Convert the constants**

Rewrite each value in `packages/engine/src/interest.ts` as the tile-unit quotient, and replace the
file's header comment so it says the radii are tile units with the grid centre as origin. Keep
each constant's existing docblock; only the unit changes.

- [ ] **Step 4: Run it and watch it pass**

```bash
npm test -w @lindocara/engine -- interest-units
```

- [ ] **Step 5: Expect the rest of the suite to go red, and leave it red**

```bash
npm run test:server 2>&1 | tail -20
```

Server AOI tests now compare tile radii against pixel positions and will fail. **Do not fix them
here** — Task 7 converts positions, and a test patched now would be patched twice. Record which
suites went red in your report so Task 7 can confirm they come back.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/interest.ts packages/engine/test/interest-units.test.ts
git commit -m "refactor(engine): interest radii in tile units"
```

---

### Task 2: Runtime types carry three axes

`world-runtime.ts` (871 lines) defines every runtime entity the systems share — players, monsters,
guards, loot, projectiles — plus attachment hydration and the entity factories. Everything
downstream reads these types, so converting them first makes the compiler enumerate the rest of
Phase A for you.

**Files:**
- Modify: `packages/server/src/world/world-runtime.ts`
- Test: `packages/server/test-api/world-runtime-axes.test.ts`

**Interfaces:**
- Produces: every runtime entity's ground position is `x`/`z` and its elevation is `y`, in tile
  units. `PlayerRuntime`, `MonsterRuntime`, `GuardRuntime`, `LootRuntime`, `ProjectileRuntime` all
  follow the same convention — no entity keeps a two-axis `{x, y}`.
- Consumes: nothing from Task 1 directly; the radii it will be compared against are already tiles.

- [ ] **Step 1: Read before writing**

Read `world-runtime.ts` end to end first. It is the file every later task depends on, and its
attachment serialization (`toAttachment`) is a persistence boundary — a field renamed there without
its reader changes what a reconnecting hero restores.

- [ ] **Step 2: Write the failing test**

```ts
// packages/server/test-api/world-runtime-axes.test.ts
import { describe, expect, it } from "vitest";
import { createPlayerRuntime, toAttachment } from "../src/world/world-runtime.js";

describe("runtime entities use ground x/z and elevation y", () => {
  it("gives a fresh player three axes", () => {
    // Follow the real factory's signature — read world-runtime.ts and pass what it actually takes.
    const player = createPlayerRuntime(/* … */);
    expect(player).toMatchObject({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) });
  });

  it("round-trips all three axes through the attachment", () => {
    const player = createPlayerRuntime(/* … */);
    player.x = -3.5;
    player.y = 1;
    player.z = 7.25;
    const restored = toAttachment(player);
    expect(restored).toMatchObject({ x: -3.5, y: 1, z: 7.25 });
  });
});
```

The second assertion is the one that matters: attachment round-trip is where a dropped axis
survives typecheck and only shows up as a hero at elevation 0 after a reconnect.

- [ ] **Step 3: Run it, watch it fail, then convert**

```bash
npm run test:server -- world-runtime-axes
```

Expected: FAIL — `z` is not a property. Then convert the types and factories: the old `y` (ground)
becomes `z`, and a new `y` (elevation, default `0` at Phase A since nothing is airborne yet) is
added.

- [ ] **Step 4: Let the compiler enumerate the damage**

```bash
npm run typecheck:server 2>&1 | tail -40
```

This will produce a long list across the thirteen systems. **Do not fix them here.** Capture the
list in your report — Tasks 3-6 work through it, and the list is how they know when they are done.

- [ ] **Step 5: Run the axis test and commit**

```bash
npm run test:server -- world-runtime-axes
git add packages/server/src/world/world-runtime.ts packages/server/test-api/world-runtime-axes.test.ts
git commit -m "refactor(server): runtime entities carry ground x/z and elevation y"
```

Note the branch does not typecheck at this commit. That is deliberate and bounded: Tasks 3-6 close
it, and Task 8 is the gate that refuses to pass until it is closed.

---

### Task 3: The zone's terrain becomes a heightfield query

The junction. `ZoneDefinition.terrain` is a pixel `TerrainGeometry` (`tiles` + `colliders` +
`width`/`height`), and every system that asks "can I stand here" goes through
`isWalkable`/`resolveTerrain`. Those give way to what `apps/lab` already proved:
`createTerrainQuery` + `ColliderIndex` + `canEnter`'s rule.

**Files:**
- Modify: `packages/server/src/api/realtime/worldState.ts`
- Modify: `packages/engine/src/zones.ts` (`ZoneDefinition.terrain`'s type)
- Create: `packages/server/src/world/terrain-access.ts`
- Test: `packages/server/test-api/terrain-access.test.ts`

**Interfaces:**
- Produces: `interface ZoneTerrain { query: TerrainQuery; colliders: ColliderIndex; size: number; levelHeight: number; waterLevel: number }`, built by `zoneFromMapPayload` from the decoded
  heightfield, and `canStand(terrain: ZoneTerrain, x: number, z: number, radius: number, groundY: number): boolean` — the server's single walkability question, mirroring `canEnter`
  (`packages/engine/src/hd2d/hero-step.ts:48`).
- Consumes: `decodeMap`, `mapToQuerySource`, `createTerrainQuery`, `createColliderIndex` (all
  existing).

- [ ] **Step 1: Read `canEnter` first**

`packages/engine/src/hd2d/hero-step.ts:48-90` is the rule being mirrored. Read it before writing
`canStand`: the disc test (`maxHeightAround` against the body radius, not the centre point) and
water-as-a-surface are the two things a naive port drops, and both produce a world that looks fine
until something walks into a cliff.

- [ ] **Step 2: Write the failing test**

```ts
// packages/server/test-api/terrain-access.test.ts
import { describe, expect, it } from "vitest";
import { canStand, type ZoneTerrain } from "../src/world/terrain-access.js";

// A 4x4 grid: row 0 at level 0, row 1 water, rows 2-3 at level 1 — one flat strip, one channel,
// one plateau, which is every case that matters.
function terrain(): ZoneTerrain { /* build from a MapData literal via the real constructors */ }

describe("canStand", () => {
  it("allows flat ground at the hero's own level", () => {
    expect(canStand(terrain(), -1.5, -1.5, 0.3, 0)).toBe(true);
  });

  it("refuses water", () => {
    expect(canStand(terrain(), -1.5, -0.5, 0.3, 0)).toBe(false);
  });

  it("refuses a step up onto the plateau, because maxStep is 0", () => {
    expect(canStand(terrain(), -1.5, 0.5, 0.3, 0)).toBe(false);
  });

  it("allows standing on the plateau once already at its height", () => {
    expect(canStand(terrain(), -1.5, 0.5, 0.3, /* groundY */ 0.5)).toBe(true);
  });

  it("tests the disc, not the centre — a body cannot half-enter a cliff", () => {
    // A point just short of the plateau edge whose DISC overlaps it must be refused, while the
    // same point with a zero radius is allowed. This is the assertion that fails if the port
    // uses heightAt instead of maxHeightAround.
    expect(canStand(terrain(), -1.5, 0.5 - 0.2, 0.3, 0)).toBe(false);
    expect(canStand(terrain(), -1.5, 0.5 - 0.2, 0, 0)).toBe(true);
  });
});
```

Use the real `levelHeight` from the map you build; do not hardcode `0.5` if your fixture differs.

- [ ] **Step 3: Run it, watch it fail, implement**

```bash
npm run test:server -- terrain-access
```

Then write `terrain-access.ts`, and change `zoneFromMapPayload` to build a `ZoneTerrain` from the
decoded heightfield. A map with **no** heightfield can no longer produce a zone at all — the tile
path is gone — so it throws with a message naming the map id. That is a real behaviour change and
the reason the legacy adventures are parked.

- [ ] **Step 4: Run it, watch it pass, commit**

```bash
npm run test:server -- terrain-access
git add packages/server/src/world/terrain-access.ts packages/server/test-api/terrain-access.test.ts packages/server/src/api/realtime/worldState.ts packages/engine/src/zones.ts
git commit -m "feat(server): the zone's terrain is a heightfield query"
```

---

### Task 4: Movement, monsters and NPC movement

The three systems that move things across the ground. They convert together because they share the
same question (`canStand`) and the same grid update, and splitting them would mean three passes
over the same call sites.

**Files:**
- Modify: `packages/server/src/world/movement-system.ts`,
  `monster-system.ts`, `npc-movement-system.ts`
- Test: extend the existing system suites in `packages/server/test-api/`

**Interfaces:**
- Consumes: `canStand`, `ZoneTerrain` (Task 3); three-axis runtimes (Task 2).
- Produces: no new exports. `advancePlayers` keeps its signature and every non-movement duty —
  resource regen, presence heartbeat, corpse reclaim, loot collection, dirty-flag persistence.

- [ ] **Step 1: Note what does NOT change**

`advancePlayers` is not a movement function; movement is one branch inside it
(`movement-system.ts:60-131`). Its other duties stay exactly as they are. In Phase B the movement
branch is removed and everything else survives — so do not restructure the function here in a way
that makes that removal harder.

- [ ] **Step 2: Convert, keeping `step()` semantics**

`step()` still runs — in tile units, with `PLAYER_SPEED` re-expressed as tiles/second
(`260 / 64 = 4.0625`). Movement semantics are unchanged in Phase A; only the units and the
walkability question move. Replace `resolveTerrain(player, desired, terrain)` with a `canStand`
test against the destination, keeping the same slide-along-walls behaviour the old resolver had —
read it before replacing it.

Monster patrol, chase and return-to-spawn convert the same way; monsters read `heightAt` for the
ground under them and do not jump.

- [ ] **Step 3: Add the one test that catches a half-conversion**

```ts
it("a monster cannot chase a hero onto a plateau it has no path to", async () => {
  // Place a monster at level 0 and a hero on a level-1 plateau within its aggro radius.
  // The monster must approach, fail to enter, and abandon rather than grind against the cliff.
});
```

This is the case the spec calls out as having no equivalent in `apps/lab` to copy. Extend
`monster-system.ts`'s existing unreachable-target abandonment rather than adding a second one.

- [ ] **Step 4: Verify and commit**

```bash
npm run test:server && npm run typecheck:server
git commit -am "refactor(server): movement, monsters and NPCs in tile units"
```

---

### Task 5: Projectiles, skills and the class variants

**Files:**
- Modify: `packages/server/src/world/projectile-system.ts`, `skill-system.ts`,
  `rogue-skill-system.ts`, `priest-variant-system.ts`, `warrior-variant-system.ts`,
  `ranger-variant-system.ts`, `peasant-harvest-system.ts`, `peasant-support-system.ts`
- Test: the existing suites for each

**Interfaces:**
- Consumes: `canStand`, `ZoneTerrain`, three-axis runtimes.
- Produces: no new exports. Every distance, range, radius and speed in these files is tile units.

- [ ] **Step 1: Convert ranges at their definition, not their use**

`PLAYER_ACTIONS` (`packages/engine/src/combat-actions.ts`) and `CLASS_SKILLS`
(`packages/engine/src/skills.ts`) are the balance tables carrying every geometry value. Convert
them there. A range divided by 64 at a call site is how half a conversion hides.

- [ ] **Step 2: Keep swept projectile collision swept**

`projectile-system.ts` advances bounded swept projectiles so a fast projectile cannot tunnel
between ticks. The sweep is unchanged; only its units and its terrain question move. A projectile
that stops tunnelling being tested is a projectile that will tunnel.

- [ ] **Step 3: Verify and commit**

```bash
npm run test:server && npm run typecheck:server
git commit -am "refactor(server): projectiles, skills and class variants in tile units"
```

---

### Task 6: Navigation becomes elevation-aware

**Files:**
- Modify: `packages/server/src/world/navigation-system.ts`, `spatial-grid.ts`
- Test: `packages/server/test-api/navigation-elevation.test.ts`

**Interfaces:**
- Consumes: `canStand`, `ZoneTerrain`.
- Produces: no new exports. The A* grid's walkability comes from `canStand`; its **pacing is
  unchanged** — same per-tick node budget, same 128-entry path cache, same unique request queue,
  same 650 ms repath interval, same 72 px → `1.125` tile minimum target movement.

- [ ] **Step 1: Write the failing test**

```ts
describe("navigation with elevation", () => {
  it("refuses to path up a cliff face", () => { /* … */ });
  it("paths around a plateau to a target on the same level", () => { /* … */ });
  it("reports no path to a target standing on unreachable high ground", () => { /* … */ });
  it("still respects the per-tick node budget", () => { /* … */ });
});
```

The last one is not padding: it is the guard against "make it elevation-aware" turning into "make
it search more", which is how a per-tick budget quietly becomes a frame hitch.

- [ ] **Step 2: Implement, verify, commit**

```bash
npm run test:server -- navigation-elevation
npm run test:server && npm run typecheck:server
git commit -am "feat(server): navigation refuses to path up a cliff"
```

---

### Task 7: The wire, storage and the bridges

Everything left in Phase A: snapshot positions gain `z`, `WorldInfo` loses its pixel projection,
the hero row gains an elevation column and loses its stored positions, and both bridge files are
deleted.

**Files:**
- Modify: `packages/engine/src/protocol.ts`, `packages/server/src/api/entities/heroes.ts`,
  `packages/server/src/api/services/HeroSaveService.ts`,
  `packages/server/src/world/interest-system.ts`, `snapshot-system.ts`,
  `packages/client/src/game/net.ts` (decode side only)
- Delete: `packages/engine/src/hd2d/tile-pixel-bridge.ts`,
  `packages/server/src/world/heightfield-pixel-bridge.ts`
- Create: `apps/main/migrations/sqlite/<generated>`
- Test: `packages/server/test-api/wire-tile-units.test.ts`

**Interfaces:**
- Produces: `PlayerSnapshot`/`MonsterSnapshot`/`GuardSnapshot`/`LootSnapshot`/`ProjectileSnapshot`
  carry `x`, `y`, `z` in tile units. `WorldInfo` keeps `heightfield` and drops `tiles` and
  `colliders`. `hero` gains a `z` column; `x`/`y`/`z` default to the map spawn.

- [ ] **Step 1: Clear stored positions rather than convert them**

The migration adds `z` and resets `x`/`y`/`z` to `0` for every existing row. `0,0,0` is the grid
centre in the new system, and admission already clamps a restored position to walkable ground, so
a hero lands somewhere sane rather than at a converted pixel coordinate. Say this in the
migration's own comment — a reset column with no explanation reads like data loss.

**`npm run db:generate` is broken repo-wide** (a top-level `await` inside an `if` in
`apps/main/src/main.ts` defeats drizzle-kit's esbuild bundling). Write the migration by hand, model
it on `apps/main/migrations/sqlite/20260804172904_maps_heightfield/`, and prove it with
`npm run check:migrations -w @lindocara/main`.

- [ ] **Step 2: Write the failing wire test**

```ts
it("ships every position in tile units and no pixel projection", async () => {
  // Join a heightfield room over a real WebSocket, parse the welcome through parseServerMessage
  // (NOT JSON.parse — the last increment shipped an unjoinable room because a test used the
  // latter), and assert: world.heightfield decodes, "tiles" and "colliders" are absent, and the
  // self player's position is within +/- size/2 rather than in the thousands.
});
```

The magnitude assertion is the cheap guard against a world uniformly wrong by a factor of 64,
which looks entirely plausible in a screenshot.

- [ ] **Step 3: Delete the bridges**

```bash
git rm packages/engine/src/hd2d/tile-pixel-bridge.ts packages/server/src/world/heightfield-pixel-bridge.ts
grep -rn "TILE→PIXEL BRIDGE" packages apps scripts docs
```

The grep must return only documentation and this plan. Any code hit is a conversion that was
missed, not a comment to delete.

- [ ] **Step 4: Verify and commit**

```bash
npm run check:migrations -w @lindocara/main && npm run test:server && npm run typecheck
git add -A && git commit -m "feat: tile units on the wire and in storage, bridges deleted"
```

---

### Task 8: THE GATE — Phase A is green and played

Not a code task. It is the checkpoint that makes the two phases attributable, and no Phase B task
may start before it passes.

- [ ] **Step 1: Full pipeline**

```bash
npm run v
```

Must be exit 0. If `typecheck:lab` is red for reasons belonging to another in-flight increment,
say so explicitly rather than treating the gate as passed.

- [ ] **Step 2: Play it**

Regenerate a heightfield adventure and play it via the `playwright-cli` skill (never the
Claude-in-Chrome extension):

```bash
npm run adventure:proving
```

Confirm, and screenshot each: terrain renders; the hero walks; **water blocks**; **a cliff face
now blocks** — walk into the plateau that the previous increment let you walk through, and be
stopped; monsters move and do not path up cliffs.

- [ ] **Step 3: Record the expected temporary state**

High ground is unreachable at this point. Note it in the report as expected, not as a defect —
jumping arrives in Task 10.

- [ ] **Step 4: Commit the gate**

```bash
git commit --allow-empty -m "chore: phase A gate — tile units green and played"
```

An empty commit is deliberate: it puts a named point in history that a later bisect can land on.

---

### Task 9: The wire's movement half inverts

**Files:**
- Modify: `packages/engine/src/protocol.ts`
- Test: `packages/engine/test/protocol-move.test.ts`

**Interfaces:**
- Produces: `{ t: "move"; x: number; y: number; z: number; facing: Vec2; airborne: boolean; swimming: boolean; gliding: boolean }`, replacing `{ t: "input", seq, input }`.
  `PlayerSnapshot` gains `airborne`/`swimming`/`gliding` and loses `ack`.
- Removed: `seq`, `ack`, `Input`'s wire role.

- [ ] **Step 1: Write the failing test**

```ts
describe("the move message", () => {
  it("accepts a well-formed position", () => { /* … */ });
  it("drops a frame whose position is not finite", () => { /* … */ });
  it("drops a frame whose position is off the map", () => { /* … */ });
  it("drops a frame missing a state flag rather than defaulting it", () => { /* … */ });
});
```

The last assertion follows this repo's established wire rule — an absent key is malformed, not a
default (see `WorldInfo.heightfield`'s absent-key handling and the map-events "explicit null"
precedent). Defensive parsing does not relax just because authority moved.

- [ ] **Step 2: Implement, verify, commit**

```bash
npm test -w @lindocara/engine -- protocol-move
npm run typecheck
git commit -am "feat(protocol): the client reports its position"
```

---

### Task 10: The client owns the hero

The heart of Phase B.

**Files:**
- Create: `packages/client/src/game/hero-controller.ts`
- Modify: `packages/client/src/game/net.ts`, `session.ts`
- Test: `packages/client/test/hero-controller.test.ts`

**Interfaces:**
- Consumes: `stepHero`, `HeroState`, `HeroInput`, `HeroSettings`, `WorldSettings`, `StepDeps`
  (`packages/engine/src/hd2d/`); `createTerrainQuery`, `ColliderIndex` from the decoded
  heightfield.
- Produces: `createHeroController(opts): { step(input: HeroInput, dt: number): HeroEvent[]; state: Readonly<HeroState>; }` — owns the single `HeroState`, runs `stepHero`, and returns the
  events the renderer and sound turn into footsteps, splashes and the canopy.

- [ ] **Step 1: Copy the lab's wiring, do not invent one**

`apps/lab/src/world/hero.ts` is the reference: it owns a `HeroState`, calls `stepHero` each frame
with `StepDeps`, and turns `HeroEvent`s into sound and sprite changes. Read it first. The client's
controller is that adapter minus the lab's billboard, plus the wire emit.

- [ ] **Step 2: Write the failing test**

```ts
describe("the hero controller", () => {
  it("runs stepHero and exposes the resulting state", () => { /* … */ });
  it("does not let a grounded hero climb a level", () => { /* … */ });
  it("lets a jumping hero land on the plateau", () => { /* … */ });
  it("reports the events stepHero emitted, in order", () => { /* … */ });
});
```

The jump test is the one that proves the increment's headline: it is the case that was impossible
before this piece and that made "units only" unacceptable.

- [ ] **Step 3: Wire it, delete prediction**

`net.ts` stops replaying and stops holding pending commands; `session.ts` feeds input to the
controller and sends `{t:"move"}` at the existing send cadence. Then:

```bash
git rm packages/engine/src/prediction.ts packages/engine/test/prediction.test.ts
```

Remove `step()`, `PLAYER_SPEED` and `NO_INPUT`'s command role from `simulation.ts`, and
`MAX_STARVED_TICKS` plus its branch from `world-runtime.ts`/`movement-system.ts`.

**`INTERPOLATION_DELAY_MS` stays.** It is not prediction.

- [ ] **Step 4: Verify and commit**

```bash
npm run check
git add -A && git commit -m "feat(client): the hero runs stepHero and reports where it is"
```

---

### Task 11: Mobility skills, applied by the client

Per spec decision 6, chosen over the server-displacement alternative with the exposure accepted.

**Files:**
- Modify: `packages/client/src/game/hero-controller.ts`, `packages/server/src/world/movement-system.ts`, `skill-system.ts`, `rogue-skill-system.ts`
- Test: `packages/client/test/hero-mobility.test.ts`

**Interfaces:**
- Produces: the controller applies a granted mobility skill's displacement to its own `HeroState`.
- Removed: the server's `heldBlink` clamp (`movement-system.ts:90-107`) and its
  `mobilityDistance` debit.

- [ ] **Step 1: Keep the grant server-side**

Cost, cooldown, resource spend, invulnerability windows and every effect stay exactly where they
are. Only the displacement moves. A task that also moves the cost has misread the spec.

- [ ] **Step 2: Test, implement, verify, commit**

```ts
it("moves the hero by a granted blink and no further", () => { /* … */ });
it("ignores a displacement the server never granted", () => { /* … */ });
```

```bash
npm run check
git commit -am "feat(client): mobility skills displace the hero locally"
```

---

### Task 12: Remote heroes are drawn in their real state, and the docs catch up

**Files:**
- Modify: `packages/renderer/src/hd2d/billboards.ts`, `game-renderer.ts`
- Modify: `AGENTS.md`, `packages/engine/CLAUDE.md`, `packages/server/AGENTS.md`,
  `docs/hd2d-rendering.md`
- Test: `packages/renderer/test/hd2d-remote-state.test.ts`

- [ ] **Step 1: Draw the flags**

`ActorView` gains `airborne`/`swimming`/`gliding` from the snapshot, so a remote hero mid-jump is
drawn at its reported elevation rather than snapped to the ground, and a swimmer is drawn at the
water line. Ground-snapping a remote hero would make every other player's jump invisible.

- [ ] **Step 2: Correct every doc this increment falsified**

Root `AGENTS.md` still describes `step()` as the single source of movement truth, the
one-command-per-tick invariant, and the two-players-two-rules prediction model — all now false.
`packages/engine/CLAUDE.md` says `simulation.ts` is in reprieve and `hd2d/` is proven only in
`apps/lab`; both change. `docs/hd2d-rendering.md` gains the elevation gap's closure.

This step is not bookkeeping: those documents are what the next reader trusts, and this increment
invalidates more of them than any before it.

- [ ] **Step 3: Full verification and the browser pass**

```bash
npm run v
npm run adventure:proving
```

Via the `playwright-cli` skill: jump onto a plateau, swim and watch breath fall, open the glider,
and confirm a second window's hero is drawn mid-jump rather than snapped to the ground. Screenshot
each.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: remote heroes draw their real state, and the docs match the game again"
```

---

## Self-review notes

**Spec coverage.** Tile units everywhere (Tasks 1-7); cleared hero positions (7); `stepHero`
adopted whole (10); client-authored movement and prediction retired (9, 10); mobility client-applied
(11); both bridges deleted (7); `WorldInfo.tiles`/`colliders` removed (7); elevation-aware
navigation (6); monsters on terrain height and abandoning unreachable targets (4); the attribution
gate (8); docs (12).

**Known soft spots, named rather than hidden:**

- Tasks 4, 5 and 6 give test *names* and conversion *rules* rather than full test bodies. Writing
  them blind would invent APIs that thirteen existing system suites contradict. Each names the
  file to read first, and the one assertion that catches a half-conversion.
- Task 2 leaves the branch not typechecking until Task 6. That is deliberate and bounded, and
  Task 8 is what refuses to let it escape — but it does mean Tasks 3-6 cannot each end green, and
  a reviewer should judge them on their own diff plus the shrinking error list.
- Task 3's `canStand` is the piece most likely to be subtly wrong, because the disc test and
  water-as-surface are easy to drop and produce a world that looks right. Its fifth test exists
  for exactly that and should not be weakened if it proves inconvenient.
- The plan assumes `step()` can operate in tile units unchanged in Phase A by re-expressing
  `PLAYER_SPEED` as `4.0625`. If any caller turns out to bake a pixel assumption deeper than the
  speed constant, Task 4 should stop and report rather than widen.
