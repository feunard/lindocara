# Minimap and world map — design

**Date:** 2026-07-13
**Status:** approved, not yet implemented

A World-of-Warcraft-style minimap in the top-right corner, plus a full-world map on `M`.

## Goal

Give the player spatial awareness the camera cannot: who is nearby, where the quest givers
are, and — above all — **where your body is when you are a ghost**. The corpse run added in
`4fa0c8c` sends you walking across a 4800×2700 world with no navigation aid. The map is what
makes that run winnable instead of a guessing game.

## Constraint that shapes everything

Area-of-interest culling means the client only receives entities within 650–900 px
(`src/shared/interest.ts`). Anything further away does not exist client-side. A minimap
radius therefore cannot exceed the smallest radius of what it displays, or it would draw
empty space where entities actually are.

This is not a limitation to work around. It is the same contract WoW's minimap has, and the
chosen contents respect it:

| Layer | Source | Radius available |
| --- | --- | --- |
| Terrain | static, client-side | whole world |
| Self | always sent | — |
| Other players | `world.delta` | 900 px |
| Quest NPCs / sites | `welcome.world`, static | whole world |
| Your corpse | `SelfState.corpse` | always sent, any distance |

The minimap radius is **900 px of world**, matching the player visibility radius exactly. No
layer on the minimap has a shorter radius than the view itself, so the minimap never lies.

Monsters (850 px) and loot (650 px) are deliberately excluded — see *Out of scope*.

## Architecture

### One baked texture, two views

`world-layout.ts` already exposes `terrainAt(x, y, variation) -> TerrainSample`, a pure
function returning the ground kind, palette and tint of any world point. That is a complete
description of the map's appearance, so the map can be **baked once** into an offscreen
canvas and thereafter only ever blitted.

```
welcome ──▶ bakeWorldTexture(world, sampler)  ── once, ~5ms
                      │
              offscreen canvas
              600×338 (1/8 scale)
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
   circular crop                whole image
   ╭────────╮                 ┌──────────────┐
   │  · ● · │                 │      ●       │
   ╰────────╯                 └──────────────┘
    minimap                     world map (M)
   every frame                  while open
```

Both surfaces read the same texture. Baking never runs again for the life of the connection.

### Zone correctness

`terrainAt` reads `TERRAIN_BLOCKERS` and `SAFE_ZONE` from `shared/game.ts` directly, so it
describes **Verdant Reach and nothing else**. Multizone routing is now live, and
`mmo-test-zone` has different geometry entirely. Baking Verdant Reach's roads over a test
zone would draw a confident, detailed lie.

So the sampler is chosen by zone:

- `verdant-reach` → the rich sampler: `terrainAt` per texel.
- any other zone → a plain sampler built from `WorldInfo` alone (base ground, obstacles
  painted dark, safe zone tinted).

Both produce a correct map; only the fidelity differs. No protocol change is needed —
`WorldInfo.zoneNameKey` already identifies the zone.

**This requires `session.ts` to retain `welcome.world`, which it currently discards**
(`session.ts:216` reads only `zoneNameKey`). `WorldInfo` already carries `width`, `height`,
`obstacles`, `safeZone`, `questNpcs`, `questSites`, `cemeteries` and `portals` — everything
the bake and the blips need is already on the wire and being thrown away.

### Components

```
src/client/game/minimap.ts          pure. No DOM, no Pixi, no React.
src/client/game/minimap-surface.ts  the canvas shell: bake once, draw per frame.
src/client/ui/hud/Minimap.tsx       React owns the <canvas> and the frame.
src/client/ui/WorldMap.tsx          React owns the full-screen overlay.
test/minimap.test.ts                unit tests for minimap.ts.
```

`minimap.ts` is pure and holds everything worth testing:

| Function | Responsibility |
| --- | --- |
| `projectToMinimap(point, center, worldRadius, sizePx)` | world → minimap pixel; reports whether it fell inside the circle |
| `projectToWorldMap(point, world, sizePx)` | world → full-map pixel, preserving aspect ratio |
| `clampToRing(point, center, worldRadius)` | the corpse edge-arrow: where on the ring, and at what angle |
| `groundColor(sample)` | `TerrainSample` → RGB, via a `GroundPalette` → base-colour table multiplied by tint |

This mirrors `src/client/game/feedback.ts`, which is pure and tested by
`test/client-feedback.test.ts`. Same pattern, same test story.

`minimap-surface.ts` is the thin part: hold the baked texture and the attached canvases,
and draw. Per frame that is one `drawImage` for the terrain crop plus roughly ten `arc`
calls for blips. It has no logic worth unit-testing, by design — the logic is next door in
`minimap.ts`.

### The React ↔ game bridge

`store.ts` deliberately excludes x/y from `SelfHud` "so it does not churn 60×/s"
(`store.ts:27`). Pushing entity positions through zustand would break exactly the thing that
comment protects, and throttling them to 10 Hz would make the terrain pan visibly choppy.

Instead React hands its canvas *down* to the game loop, through the boundary CLAUDE.md
already sanctions:

```ts
// GameHandle, in store.ts — the existing exception and boundary
attachMinimap(canvas: HTMLCanvasElement | null): void
attachWorldMap(canvas: HTMLCanvasElement | null): void
```

`Minimap.tsx` calls `game.attachMinimap(el)` in a `useEffect` and `attachMinimap(null)` on
unmount. The frame loop in `session.ts` — which already calls `client.sample(now)` and hands
the result to the renderer — hands it to the map surface too. **Zero React re-renders**, so
panning stays smooth at 60 fps, and no world coordinates enter the store.

`src/client/game/` still imports no React, and `src/client/ui/` still never calls into
net or renderer. The rule holds.

### Data flow

```
welcome ──▶ session retains WorldInfo ──▶ bake texture (once)

frame ──▶ client.sample(now) ──┬──▶ renderer.render(...)     (unchanged)
                               └──▶ mapSurface.draw(sample, self, corpse)
                                       │
                                       ├──▶ minimap canvas   (always, while in game)
                                       └──▶ world map canvas (only while open)
```

## Contents

**Minimap** (900 px world radius, fixed north):

- you, at the centre
- other players
- quest NPCs and quest sites
- your corpse, as a skull — and when it is outside the radius, an arrow pinned to the ring
  pointing at it

**World map** (`M`, full 4800×2700):

- the whole baked texture
- you
- quest NPCs and quest sites
- your corpse

Fixed north on both. The camera never rotates and `PlayerSnapshot` carries no facing, so a
rotating minimap would have nothing to rotate against.

## Interaction

`M` joins `ActionHandlers` in `input.ts` as `toggleMap()`. That handler already returns early
on `event.target instanceof HTMLInputElement`, so `M` cannot fire while the player is typing
in chat — no new guard needed.

Map open/closed is UI state: `mapOpen` in the store, toggled exactly the way `settingsOpen`
already is (`session.ts:498`).

**Escape closes the map before it opens settings.** Z-order, from the existing stack:

| Layer | z-index |
| --- | --- |
| HUD, event log | 3 |
| skill bar | 5 |
| **world map** | **10** |
| settings menu | 20 |
| connection overlay | 40 |

The minimap and world map only mount on `screen === "game"`, like the rest of the HUD.

## HUD layout

The minimap takes the top-right corner — WoW's position, currently occupied by the event log.
The event log slides down beneath it, keeping its right alignment. The locale toggle moves
into the settings menu.

```
┌──────────────────────────────────────┐
│ ┌─HUD───┐                ╭──────╮   │
│ │ hp/xp │                │ ·●·  │   │  minimap
│ │ quest │                ╰──────╯   │
│ └───────┘                ┌────────┐ │
│                          │ events │ │  event log, moved down
│                          └────────┘ │
│ ┌─chat──┐      ┌─skills─┐           │
└──────────────────────────────────────┘
```

## Errors and edges

- **No corpse** — `SelfState.corpse` is null while alive; the skull and the ring arrow simply
  do not draw. No special-casing beyond the null check.
- **Corpse on screen vs off** — `clampToRing` decides. On-map draws a skull at its projected
  position; off-map draws an arrow on the ring. Both come from the same pure function, so
  they cannot disagree about direction.
- **Canvas not yet attached** — the surface draws nothing. React mounts on its own schedule
  and the game loop must not care.
- **Disconnect** — `attachMinimap(null)` on unmount; `GameHandle` is already nulled on
  disconnect (`session.ts:328`), so the loop stops before the canvas goes away.
- **Retina** — the canvas backing store is sized by `devicePixelRatio`, capped at 2, matching
  what Pixi already does (`resolution: min(2, dpr)`).
- **Resize** — the minimap is a fixed pixel size, so it does not react to window size. The
  world map is sized on open.

## Testing

`test/minimap.test.ts`, pure, no DOM — the same shape as `test/client-feedback.test.ts`:

- `projectToMinimap` puts the player at the centre, and a point at exactly the radius on the
  edge.
- A point beyond the radius reports itself outside, and is not drawn.
- `projectToWorldMap` preserves aspect ratio and maps the world corners to the image corners.
- `clampToRing` returns a point on the ring and an angle that actually points at the target —
  asserted in all four quadrants, since a sign error here sends a ghost the wrong way and is
  the single most expensive bug this feature can ship.
- `clampToRing` on a target inside the radius reports it as inside, not clamped.
- `groundColor` maps every `GroundPalette` member, and tint multiplication stays in range.

No server tests and no protocol tests: nothing on the wire changes.

`session.ts` retaining `WorldInfo` is covered by the map rendering at all — it cannot bake
without it. Verified by driving the app, not by a unit test.

## Out of scope

Deliberately not built, and each for a reason:

- **Monster and loot blips** — declined. WoW does not show hostiles on the minimap without
  tracking, and the loot radius (650 px) is shorter than the minimap's, so loot would pop in
  closer than the view suggests.
- **Zoom** — the server sends 900 px of entities. Zooming out reveals terrain the client has
  no information about, which looks like an empty world rather than an unknown one.
- **Rotation** — nothing to rotate against; the camera is fixed and players have no facing.
- **Fog of war / exploration** — would need a persisted per-character explored mask, i.e. a D1
  column and a migration, for a cosmetic gain.
- **Cemetery and portal icons** — declined for now. The data is already in `WorldInfo`, so
  this is a few lines whenever it is wanted.
- **Zone name label** — declined for now. `zoneAt(x, y)` already exists, so likewise cheap
  later.

## Files touched

| File | Change |
| --- | --- |
| `src/client/game/minimap.ts` | new — pure projection, clamping, colour |
| `src/client/game/minimap-surface.ts` | new — bake and draw |
| `src/client/ui/hud/Minimap.tsx` | new |
| `src/client/ui/WorldMap.tsx` | new |
| `test/minimap.test.ts` | new |
| `src/client/game/session.ts` | retain `WorldInfo`; drive the map from the frame loop |
| `src/client/game/input.ts` | `KeyM` → `toggleMap()` |
| `src/client/store.ts` | `mapOpen`; `attachMinimap` / `attachWorldMap` on `GameHandle` |
| `src/client/ui/App.tsx` | mount `Minimap` and `WorldMap` on the game screen |
| `src/client/styles/legacy.css` | minimap frame; move the event log down |
| `src/shared/i18n/{en,fr}.ts` | map title, corpse label (parity test enforces both) |
