# Sunken Isles — a second zone, and the portal to it

## What this is

A second playable zone, `sunken-isles`, reached through a portal in Verdant Reach's top-left. It is
an archipelago in the composition of Tiny Swords' own promo art: a lobed landmass in a teal sea,
a castle to the north-west, a blue-roofed village east, a lone tower south, trees and rocks over
the rest, water channels cutting between.

Scenery only. No monsters, no quests, no guards. The point is the place; content is cheap to add
to a zone that already exists and expensive to unpick from one designed around it.

## What it deliberately is not

The reference's defining feature is **elevated ground**: cliff walls, drop shadows, stairs. The
engine cannot draw it. `plateau` exists in `TILE_KINDS` and `autotile.ts` maps it to `"land"` — the
same visual as grass — with a comment recording that as a decision rather than an oversight.
Nothing emits it.

So Sunken Isles reproduces the reference's silhouette, palette and furniture, and skips its height.
From a top-down camera the cliffs mostly read as outline anyway, which is why this is worth
shipping without them. Elevation is a separate feature (cliff autotiling, a shadow layer, stairs as
walkable links, and collision rules for cliff edges); it is out of scope here and should get its own
spec.

## The islands must be one island

The promo's isles look separate. The walkable ones are not — they are one landmass with inlets, and
only small rock islets are genuinely detached.

Sunken Isles has to work the same way, and for a harder reason than looks: there are no bridges, so
detached land is land no player can ever stand on. A zone whose castle sits across a channel from
its spawn is a zone with an unreachable castle.

Therefore:

- every walkable cell is one connected component;
- detached islets are permitted, but they are **scenery** — no spawn, no portal, no building a
  player is meant to enter;
- `test/zone-connectivity.test.ts` already flood-fills `ZONES` and will cover the new zone as soon
  as it is in the catalogue. It must assert spawn → return portal.

## Terrain: a third rasteriser

`src/shared/zones/*-tiles.ts` are generated. `scripts/build-map.ts` rasterises typed rects into one
character per cell, and `npm run map:check` fails CI if the committed output drifts from the
source. Hand-authoring the ASCII is not an option — it would be reverted by the next `map:build`.

The existing rasterisers both treat **land as the default**:

- `rasteriseVerdant` — every cell starts `grass`; `BOUNDARY_OBSTACLES`, `TERRAIN_BLOCKERS` and
  landmark colliders paint water/forest/building on top;
- `rasteriseFlat` — every cell starts `grass`; one obstacle list paints water.

An archipelago inverts that: the sea is the default and land is the positive space. So:

```
rasteriseIslands(bounds, landRects, layers)
  cell starts as "water"
  coverage(landRects, col, row) >= SOLID_COVERAGE  -> "grass"
  then layers (forest, building) paint on top, last-wins, exactly as paintKind does today
```

`SOLID_COVERAGE` (0.5) and the 8×8 sub-grid sampling are reused unchanged. The rule that decides
whether a cell is land must be the *same* rule that decides Verdant Reach's walls, or the two zones
disagree about what half-covered means.

Emits `src/shared/zones/sunken-isles-tiles.ts`. `map:check`'s file list must grow to include it —
a generated file outside that list is a file CI stops guarding.

## Where things live

Terrain source (island rects, forest rects, building colliders, spawn points) is **shared**: the
build script rasterises colliders into `building` tiles, and the client renders the same landmarks.
Two descriptions of one castle drift. Following how `WORLD_LANDMARKS` already serves both, the
Sunken Isles terrain lives in `src/shared/zones/sunken-isles.ts` and both sides import it.

- `src/shared/zones.ts` — `ZoneId` gains `"sunken-isles"`; a `ZONES` entry with terrain, empty
  quests/monsters/guards, portals, navigation.
- `src/client/game/world-layout.ts` — a `ZONE_VISUALS` entry: landmarks, decor regions for the
  trees, a `worldRegions` entry so the water and land take a biome tint, `safeZone: null`,
  no roads, no POIs.
- `src/shared/i18n/{en,fr}.ts` — zone name and both portal names. The i18n parity test enforces
  both languages.

## Size

2560 × 1920 — 40 × 30 tiles, 4:3, matching the reference's framing. Verdant Reach is 4800 × 2700
and the test zone 640 × 480; this sits between them: enough room for a castle, a village and a
tower with real water between them, small enough that every cell is placed on purpose.

`maxPlayers`: 16. Nothing here needs a crowd.

## Portals

Verdant Reach's top-left is walkable grass from roughly (128, 192): columns 0–1 are the boundary
wall and rows 1–2 a treeline, so the portal sits at **(256, 320)** — clear of both, and clear of the
building at columns 12–15.

Paired, exactly as `mmo-test-zone` already does it, so the existing epoch-fenced handoff carries
this with no new machinery:

| id | zone | at | destination |
| --- | --- | --- | --- |
| `sunken-isles-gate` | verdant-reach | (256, 320) | sunken-isles / main, at its spawn |
| `sunken-isles-return` | sunken-isles | by spawn | verdant-reach / main, beside (256, 320) |

The return destination must not land the player *on* the outbound portal — `#interact` takes the
first portal within `INTERACTION_RANGE` (92), and arriving inside that radius makes the two gates a
revolving door. Verdant Reach's return spawn sits clear of it.

Portals stay server-owned. The browser only asks to interact near one; it never names a
destination.

## Portals are invisible

They render nothing. `world.ts` already sends `WorldInfo.portals` (id, nameKey, x, y) and the
client currently ignores them.

The only way to see one is the grid toggle: with it on, each portal in the current zone draws a
circle of radius `INTERACTION_RANGE` in the debug overlay — the true radius, so what you see is the
distance `#interact` actually tests, not a decorative ring.

This means plumbing `WorldInfo.portals` through to the renderer, which is new: the client stores
the zone's portals on `configureZone` and clears them on a zone change, so a portal from the zone
you left cannot draw over the one you arrived in.

## Tests

- **Catalogue** — `sunken-isles` resolves; `buildRoomKey` builds `sunken-isles:main`; an unknown
  instance is still rejected.
- **Connectivity** — spawn reaches the return portal; the flood fill covers the new zone.
- **Tiles** — the generated map is the expected size; the border is water; no walkable cell touches
  the world edge.
- **`map:check`** — regenerating produces no diff, with the new file in the guarded list.
- **Handoff** — a real Durable Object round trip: Verdant Reach → Sunken Isles → back, asserting
  position, epoch fencing, and that a stale source save is refused. Follows the existing
  `mmo-test-zone` handoff tests rather than inventing a pattern.
- **i18n** — FR/EN parity for the zone and portal keys.
- **Renderer** — portals draw only with the grid on; a zone change drops the previous zone's.

## Risks

- **A generated file outside `map:check`.** It would silently drift from its source. Mitigated by
  adding it to the script in the same change that creates it.
- **An unreachable castle.** The connectivity test is the guard, and it must assert a real target,
  not merely that *some* land is reachable.
- **Portal ping-pong.** Two gates within `INTERACTION_RANGE` of each other's spawn make an
  inescapable loop. The spawns are placed apart, and the handoff test walks the round trip.
- **`rasteriseIslands` diverging from `paintKind`.** If the island rasteriser invents its own
  coverage rule, the two zones disagree about collision. It reuses `coverage` and `SOLID_COVERAGE`.
