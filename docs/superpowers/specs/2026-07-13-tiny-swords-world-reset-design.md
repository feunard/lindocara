# Tiny Swords world reset — design

**Date:** 2026-07-13
**Status:** approved, not yet implemented

A global reset of lindocara's world: a tile grid replaces hand-authored rectangles, the real Tiny
Swords art replaces procedurally tinted squares, and every foreign asset pack is deleted.

Movement does not change. It never was the problem.

## Why

Three facts, each verifiable in the code today:

1. **The world is not a grid, but four derived grids pretend it is.** Collision truth is 36
   hand-authored rectangles at arbitrary pixel coordinates (`x: 1560, y: 1100, width: 340`).
   Rendering rasterises a *procedural function* into 32px tiles. Navigation rasterises the rects
   into a 48px grid. Interest uses 256px cells. None of them agree.

2. **`stuckTicks` is the scar.** `createNavigationGrid` samples **one point** per 48px cell
   (`navigation-system.ts:73`) and asks whether a 32px player fits there. The cell is bigger than
   the sample, so A* routes monsters through corners the continuous collision then refuses. Twenty
   ticks later `monster-system.ts:253` gives up and throws the path away. That heuristic is not a
   safety net; it is the cost of two models disagreeing about what the world is.

3. **The art is six packs by five artists.** `tiny-swords`, `skeleton`, `orc`, `fantasy-trolls`,
   `ForgottenMemories`, `Resurrected RPG`. Coherence was never achievable.

The Tiny Swords Enemy Pack closes the last gap — it is the same artist, the same 64px world, and it
ships ~18 enemies. Tiny Swords is now a *complete kit*, so one pack can own everything.

## The decision that shapes everything

**Production character rows are wiped.** Accounts survive; characters do not.

This is not laziness — it deletes two entire classes of migration work. Nobody has to be pushed out
of a tile that just became solid, and no D1 migration has to remap persisted quest progress from a
species that no longer exists. The world these characters knew will not exist either way.

## Slice 1 — The world becomes a grid

### The tilemap

**64px tiles** — Tiny Swords' native size, so the art is used at full resolution and one grid serves
both collision and rendering. Verdant Reach becomes **75 × 43 tiles**, i.e. 4800 × 2752. The world
grows 52px taller so it is a whole number of tiles; the boundary wall is already 96px deep, so no
player can reach the difference.

The map lives in `src/shared/`. This is not a preference: the client collides *locally* during
prediction (`net.ts:103`, `prediction.ts:45`) using the same code as the server. A tilemap only the
server could see would break reconciliation on the first wall.

Authored in **Tiled**, committed as `.tmj`, and compiled to a typed TS module by a script
(`npm run map:build`). Committing generated TS rather than importing JSON keeps `src/shared/`
platform-free and importable by both the worker and the browser programs, which is the constraint
that governs everything in that directory.

### Terrain kinds

Only what Tiny Swords can actually draw:

| Kind | Walkable | Art |
| --- | --- | --- |
| `grass` | yes | flat grass autotile |
| `plateau` | yes | elevated grass; its rim is a cliff face |
| `water` | no | water + animated foam, water rocks |
| `bridge` | yes | `Bridge_All` — the only way to cross water |

Props (trees, rocks, bushes, dead trees, bones) live on a **decor layer** and carry their own solid
flag, so a forest is walkable grass made impassable by the trees standing on it rather than by an
invisible rectangle.

### Tiles are derived, never painted

**This is the mechanism that makes "every tile perfectly chosen" a guarantee rather than a hope.**

The map stores *kinds*, not tile indices. The tile to draw is computed from the four orthogonal
neighbours — a 4-bit mask (N=1, E=2, S=4, W=8) into a 16-entry table. `Tilemap_Flat.png` is exactly
a 16-tile edge autotile: a 3×3 block, a vertical strip, a horizontal strip and an isolated tile,
which is precisely the 16 combinations. `Tilemap_Elevation.png` is the same set for plateaus.

Because the tile is a pure function of the neighbourhood, **it is impossible to author a bad seam.**
There is no hand-placement step in which a human can put the wrong tile next to another one. Paint a
kind; the correct tile follows.

The set has no dedicated inner-corner tiles, which looked like a fatal limitation. It is not: the
rim is drawn *inset along tile edges*, so two adjacent edge tiles close cleanly around a concave
corner. Verified before committing to this design — `docs/screenshots/autotile-proof.png` is a real
render of these tiles autotiled over a deliberately hostile shape (L-bends, an interior hole, a
notch, a peninsula, a narrow neck). The border is continuous everywhere.

A build-time validator (`npm run map:check`, wired into `npm run check`) asserts that every cell's
kind resolves to a defined tile and that no zone contains a kind the tileset cannot draw. A map that
would render a seam fails the build.

### The whole change hides behind one function

`isWalkable(position, size, geometry)` is the **single collision entry point** in the codebase.
`resolveTerrain`, `step`, the navigation grid, monster movement and mobility skills all funnel
through it. Replace its body — "iterate 36 rectangles" becomes "look up the tiles under this box" —
and continuous movement keeps working untouched, client prediction included.

That is the entire trick, and it is why this is a contained change rather than a rewrite.

### Two things fall out for free

**`stuckTicks` is deleted, not fixed.** The navigation grid *is* the tilemap: same 64px cells, no
rasterisation, no lossy sampling. A* can no longer route a monster somewhere the collision will
refuse, so the heuristic has nothing left to catch.

**The minimap bakes from tiles** instead of sampling `terrainAt` 200,000 times. Faster, exact, and
it finally agrees with the world it draws.

### Bootstrap

A generator rasterises today's rects into the initial map, so the layout, spawns, quest sites,
patrol rings and cemeteries land exactly where they are now and `game.test.ts` stays green. Then it
is a `.tmj` you open in Tiled and reshape by hand.

Today's blockers map onto the four kinds:

| Today | Becomes |
| --- | --- |
| `TERRAIN_BLOCKERS` kind `water` | `water` |
| `TERRAIN_BLOCKERS` kind `cliff` | `water` (a sheer drop reads as impassable either way) |
| `TERRAIN_BLOCKERS` kind `forest` | `grass` with solid tree props on the decor layer |
| `WORLD_LANDMARKS` colliders (buildings) | `grass` with the building sprite and its solid footprint |

`plateau` is not used by the bootstrap — nothing in today's world is elevated. It exists because the
tileset ships it and hand-authoring will want it immediately.

### Roads are dropped; bridges replace them

Tiny Swords has no path tiles, and the current roads are a lie anyway — `roadStrength()` tints the
ground and changes nothing about collision. On the new tileset they simply become grass.

Geography does the navigating instead: water, plateaus and **bridges**. `Bridge_All.png` is the one
sanctioned crossing over water, which turns a decorative road network into an actual traversal rule
— a bridge is a place you *must* go through, and therefore a place worth defending, ambushing, or
gating. That is a better system than a brown tint, and it costs less.

## Slice 2 — The world gets its real skin

The renderer stops sampling `terrainAt()` and starts drawing the actual Tiny Swords terrain
autotiles from the tilemap. `world-layout.ts`'s procedural terrain — zones, roads, decor regions,
biome tints — retires, because the map now says what is where.

This is the slice where the game stops looking like a prototype.

## Slice 3 — One pack, no strangers

`skeleton`, `orc`, `fantasy-trolls`, `ForgottenMemories`, `Resurrected RPG` and `Icons32x32` are
deleted from `assets/`, and `vendor-art.ts` with them.

The nine species are **redefined**, not remapped, because a reset lets us pick names the art
actually has:

| Today | Becomes | From |
| --- | --- | --- |
| `goblin_scout`, `goblin_raider` | `spear_goblin`, `torch_goblin` | Goblin Raiders |
| `orc_marauder` | `gnoll` | Gnoll |
| `ogre_brute` | `minotaur` | Minotaur |
| `bone_guard`, `bone_crusader`, `bone_warden` | `skull` (+ tiers) | Skull |
| `mire_troll`, `gate_troll` | `troll` | Troll |

`bone_choir` survives as a quest chapter — it counts Skulls instead of skeletons. Quest state is
wiped with the characters, so nothing persisted refers to the old names.

The Enemy Pack also brings a Hex Shaman (projectiles), a Turtle that guards, and a Troll with a full
**Idle → Walk → Windup → Attack → Recovery → Dead** cycle. Those are not used in this project. They
are the reason the *next* one is worth doing.

## Slice 4 — Tiny Swords UI

The HUD chrome is reskinned with the pack's own UI: bars, buttons, banners, papers, ribbons,
avatars, icons. React structure is unchanged — the store, the boundaries, and the minimap's canvas
bridge all stay exactly as they are. Only the skin changes.

## Risks

- **The client bundle grows.** The tilemap is ~3,200 tiles per zone across two layers, plus the
  terrain tileset. Small, but it ships to every browser.
- **`mmo-test-zone` needs a tilemap too.** It is a real zone reachable through a live portal, and
  its collision must come from the same model or the two zones will disagree about what a wall is.
- **`game.test.ts` asserts** that spawn points, monster patrol rings and quest sites all sit on
  walkable ground and collide with nothing. The generated map must satisfy it, and it will catch us
  if it does not.
- **Every distance constant is unchanged.** Attack ranges, interest radii, `REWARD_DISTANCE`,
  `MINIMAP_WORLD_RADIUS` — all still in pixels, all still correct. The grid changes what a *wall*
  is, not what a *distance* is. This is precisely why grid *movement* was rejected.

## Out of scope

**Combat.** Attacks still auto-aim at the nearest monster in a 360° circle
(`combat-system.ts:10`), `player.facing` is still tracked but never sent, and there is no knockback,
no i-frames, no hitstop. Standing a Troll with a visible wind-up in front of that combat model will
feel wrong — and that is the argument for the next project, not a reason to widen this one.

**Grid movement.** Rejected on the evidence: both reference games (Minish Cap, Golden Sun) use free
continuous movement, `step()` already normalises diagonals, and quantising position would make
reconciliation errors snap a whole tile instead of a sub-pixel. We grid the world, not the walking.

**Object layers.** Spawns, quest sites, portals and cemeteries stay in code for now. Moving level
design into the map is a good idea and a separate one.

## Files touched

| Slice | Files |
| --- | --- |
| 1 | new `src/shared/tilemap.ts`, generated `src/shared/zones/*-tiles.ts`, `assets/maps/*.tmj`, `scripts/build-map.mjs`; rewritten `isWalkable` in `game.ts`; `navigation-system.ts` (grid + `stuckTicks` removal); `minimap.ts` bake |
| 2 | `renderer.ts` terrain drawing; retire `world-layout.ts` terrain |
| 3 | `assets/` deletions, `vendor-art.ts`, `MonsterSpecies` in `game.ts`, `MONSTER_SPAWNS`, `i18n/{en,fr}.ts`, `renderer.ts` monster sprites |
| 4 | `src/client/ui/**`, `styles/legacy.css`, `pixelact-ui/` |

Each slice is planned, coded, `npm run check` green, deployed, and reviewed on the live site before
the next begins.
