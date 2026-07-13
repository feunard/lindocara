# Slice 2 — The World Gets Its Real Skin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the world from the tilemap using the real Tiny Swords terrain autotiles, so that **what you see is exactly what you collide with**.

**Architecture:** Slice 1 made a 64px tilemap the collision truth but kept the old renderer, which samples a procedural function and draws 32px tinted squares from the *old rectangles*. Those two now disagree by up to half a tile — 2.65% of walkable ground is an invisible wall, and you can stand inside a drawn tree. This slice closes that by deleting the procedural terrain and drawing the tilemap itself: land is autotiled grass with a rocky rim, void is water. The tile chosen for each cell is a pure function of its four neighbours, so a seam is not merely unlikely — it is unrepresentable.

**Tech Stack:** TypeScript, PixiJS, Vitest inside workerd, `tsx` for the map generator.

**Spec:** `docs/superpowers/specs/2026-07-13-tiny-swords-world-reset-design.md` (Slice 2)

## The thing you must understand before you start

Slice 1's generator only had `OBSTACLES` — a flat list of 37 rectangles with **no type information** — so it labelled *everything solid* as `water`. Forests, cliffs, and the ground beneath every building are all `water` in the committed tilemap today.

For collision that was harmless: solid is solid. **For rendering it is fatal** — draw those tiles literally and you get blue lakes where the Gloamwood and the guildhall are.

So Task 1 regenerates the map with the kinds restored, and proves the **solid/walkable mask comes out bit-identical**, so collision does not shift a second time.

The mental model for the rest of the slice:

- **Land** = `grass`, `forest`, `building`, `bridge`, `plateau`. It is drawn as autotiled grass.
- **Void** = `water`. It is drawn as water, and it is what the land's rocky rim is drawn *against*.
- Solidity is a separate question from appearance: `forest` and `building` are **land you cannot walk into** (trees / a house stand there). That is why you can see a forest and not enter it.

## Global Constraints

- **`src/shared/` is platform-free.** Compiled by BOTH `tsconfig.client.json` and `tsconfig.worker.json`. No DOM, no Workers API, no Node API. The browser imports the tilemap for client-side prediction.
- **Collision must not change.** Slice 1 already moved it; this slice only changes what is *drawn*. Task 1's regeneration must produce a bit-identical solid mask, and every later task must leave `isWalkable` alone.
- **Movement must not change.** `step()`, `PLAYER_SPEED = 260`, the 20Hz tick, diagonal normalisation. Nothing may quantise a position.
- **`TILE_SIZE` is 64** — Tiny Swords' native size. The renderer's current `TILE_SIZE = 32` is the *old* procedural grid and dies with it.
- **Tiles are derived, never authored.** The tile sprite for a cell is a pure function of its four orthogonal neighbours (a 4-bit mask into a 16-entry table). It must be impossible to place a wrong tile.
- Biome's `noNonNullAssertion` is ON. No `!` assertions.
- Player-facing strings live in `src/shared/i18n/` in BOTH `en.ts` and `fr.ts`.
- **`src/client/game/` must not import React.** The store is the only bridge.
- `npm run check` must be green before every commit. **Never run two `npm run check` invocations at once** — the World Durable Object is a process-wide singleton and concurrent runs make `test/mission-2a.test.ts` time out spuriously.

## What this slice deliberately defers

- **Bridges.** The `bridge` kind exists in the model and the pack ships `Bridge_All.png`, but today's world has no bridge anywhere — the generator has nothing to emit one from. Bridges arrive when the map is hand-authored, not now.
- **Animated water foam.** The pack ships `Foam.png` for shorelines. It is polish, it is not needed to make the world legible, and it would be the third thing in the frame loop to get wrong. Later.
- **Elevation / plateaus.** `Tilemap_Elevation.png` exists and the `plateau` kind exists, but nothing in the current world is elevated. Hand-authoring will want it immediately; the bootstrap does not.

---

### Task 1: Restore the tile kinds

**Files:**
- Modify: `src/shared/tilemap.ts` (extend `TileKind`, add `isLandKind`)
- Modify: `src/shared/tilemap-codec.ts` (new characters)
- Modify: `scripts/build-map.ts` (rasterise by blocker kind, not from the flat `OBSTACLES` list)
- Regenerate: `src/shared/zones/verdant-reach-tiles.ts`, `src/shared/zones/mmo-test-zone-tiles.ts`
- Test: `test/tilemap.test.ts`, `test/tilemap-data.test.ts`

**Interfaces:**
- Produces, for Tasks 2–5: `TileKind` extended with `"forest" | "building"`; `isLandKind(kind: TileKind): boolean`.

- [ ] **Step 1: Write the failing tests**

Add to `test/tilemap.test.ts`:

```ts
import { isLandKind } from "../src/shared/tilemap.js";

describe("land versus void", () => {
  // Solidity and appearance are different questions. A forest is land you cannot walk into:
  // you see grass with trees standing on it, and the rocky shoreline is drawn against water,
  // not against the treeline.
  it("counts everything except water as land", () => {
    expect(isLandKind("grass")).toBe(true);
    expect(isLandKind("forest")).toBe(true);
    expect(isLandKind("building")).toBe(true);
    expect(isLandKind("bridge")).toBe(true);
    expect(isLandKind("plateau")).toBe(true);
    expect(isLandKind("water")).toBe(false);
  });

  it("makes forests and buildings solid even though they are land", () => {
    expect(isSolidKind("forest")).toBe(true);
    expect(isSolidKind("building")).toBe(true);
    expect(isSolidKind("water")).toBe(true);
    expect(isSolidKind("grass")).toBe(false);
    expect(isSolidKind("bridge")).toBe(false);
  });
});
```

Add to `test/tilemap-data.test.ts` — **this is the test that matters most in the whole slice**:

```ts
// Slice 1 labelled every solid cell "water" because the generator only had an untyped rect list.
// Restoring the kinds must change what each cell LOOKS like and nothing about what it DOES.
// If this fails, collision moved a second time and the whole slice is unsafe.
it("keeps the solid mask bit-identical to the collision the game already ships", () => {
  const SOLID_BEFORE = solidMaskFromSlice1();
  const solidNow = VERDANT_REACH_TILES.kinds.map((kind) => (isSolidKind(kind) ? 1 : 0));
  expect(solidNow).toEqual(SOLID_BEFORE);
});

it("labels the forests as forest, the water as water, and the ground under buildings as building", () => {
  // A forest blocker: gloamwood-north-thicket. A water blocker: river-north-deepwater.
  const forest = TERRAIN_BLOCKERS.find((b) => b.kind === "forest");
  const water = TERRAIN_BLOCKERS.find((b) => b.kind === "water");
  if (!forest || !water) throw new Error("expected a forest and a water blocker");
  expect(kindAtPoint(VERDANT_REACH_TILES, forest.rect.x + 96, forest.rect.y + 96)).toBe("forest");
  expect(kindAtPoint(VERDANT_REACH_TILES, water.rect.x + 96, water.rect.y + 96)).toBe("water");
  // No blue lakes where the buildings are.
  expect(VERDANT_REACH_TILES.kinds.filter((k) => k === "building").length).toBeGreaterThan(0);
});
```

**You must write `solidMaskFromSlice1()` yourself, and it must be honest.** Before you change the generator, capture the *current committed* map's solid mask (it is `kind === "water"` for every solid cell today) and freeze it as test data — a committed array or a checksum. Do not compute it from the new map; that would make the test compare the new code to itself and assert nothing.

- [ ] **Step 2: Run the tests and watch them fail**

```bash
npx vitest run test/tilemap.test.ts test/tilemap-data.test.ts
```

Expected: FAIL — `isLandKind` is not exported; `"forest"` is not a `TileKind`.

- [ ] **Step 3: Extend the model**

In `src/shared/tilemap.ts`:

```ts
/**
 * What a cell IS. Appearance and solidity are separate questions, which is why `forest` and
 * `building` exist: they are land you cannot walk into. You see grass with trees or a house
 * standing on it — not a lake.
 */
export type TileKind = "grass" | "plateau" | "forest" | "building" | "water" | "bridge";

/** Water is the void. Forests and buildings are land, but you still cannot walk through them. */
export function isSolidKind(kind: TileKind): boolean {
  return kind === "water" || kind === "forest" || kind === "building";
}

/**
 * Land is everything that is not the void. The autotiled rocky rim is drawn where land meets
 * water — NOT where grass meets a treeline, because a forest is grass with trees standing on it.
 */
export function isLandKind(kind: TileKind): boolean {
  return kind !== "water";
}
```

In `src/shared/tilemap-codec.ts`, extend the character table:

```ts
const KIND: Record<string, TileKind> = {
  ".": "grass",
  "^": "plateau",
  "T": "forest",
  "B": "building",
  "#": "water",
  "=": "bridge",
};
```

- [ ] **Step 4: Rasterise by kind**

Rewrite `scripts/build-map.ts` to rasterise from typed sources rather than the flat `OBSTACLES` list. The three inputs, in the order they must be applied:

1. `BOUNDARY_OBSTACLES` → `water` (the world's edge is the void)
2. `TERRAIN_BLOCKERS` → by its own `kind`: `"water"` → `water`, `"forest"` → `forest`, **`"cliff"` → `water`** (a sheer drop and deep water are the same thing to a player, and the spec says so)
3. `WORLD_LANDMARKS[].collider` → `building` (a structure stands here; the renderer already draws the sprite on its own layer)

Keep `SOLID_COVERAGE = 0.5` and the 8×8 sub-sampling **exactly as they are** — a reviewer verified all 3,225 cells of the current map against an independent reimplementation, and changing the rule would move collision.

Where two sources cover the same cell, the **later one in that list wins**, so a building on a forest edge reads as a building. Note in a comment that this ordering is a decision, not an accident.

`TERRAIN_BLOCKERS`, `BOUNDARY_OBSTACLES` and `WORLD_LANDMARKS` may not all be exported from `src/shared/game.ts` — export what you need. Do not duplicate their data.

- [ ] **Step 5: Regenerate and run the tests**

```bash
npm run map:build
npx vitest run test/tilemap.test.ts test/tilemap-data.test.ts
```

Expected: PASS, including the bit-identical solid-mask test.

**If the solid mask changed, STOP.** Do not adjust the test. Find out which cells moved and why — you have changed collision, which this slice is not allowed to do.

- [ ] **Step 6: Full check, then commit**

```bash
npm run check
git add src/shared/tilemap.ts src/shared/tilemap-codec.ts scripts/build-map.ts src/shared/zones/ test/
git commit -m "Restore the tile kinds the rasteriser threw away, with collision unchanged"
```

---

### Task 2: The autotiler

The pure function that makes a seam unrepresentable.

**Files:**
- Create: `src/client/game/autotile.ts`
- Test: `test/autotile.test.ts`

**Interfaces:**
- Consumes: `TileMap`, `TileKind`, `kindAt`, `isLandKind` (Task 1).
- Produces, for Tasks 4–5: `landMask(map, col, row): number`, `AUTOTILE_LUT: readonly { col: number; row: number }[]`, `landTile(map, col, row): { col: number; row: number }`.

- [ ] **Step 1: Write the failing test**

Create `test/autotile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AUTOTILE_LUT, landMask, landTile } from "../src/client/game/autotile.js";
import type { TileKind, TileMap } from "../src/shared/tilemap.js";

function map(rows: string[]): TileMap {
  const kinds: TileKind[] = [];
  for (const row of rows) {
    for (const char of row) kinds.push(char === "." ? "grass" : "water");
  }
  const first = rows[0];
  if (first === undefined) throw new Error("no rows");
  return { cols: first.length, rows: rows.length, kinds };
}

describe("the land mask", () => {
  // N=1, E=2, S=4, W=8. A bit is set when that neighbour is land.
  it("reads its four orthogonal neighbours", () => {
    const m = map([
      "###",
      "#..",
      "###",
    ]);
    // centre cell (1,1): E is land, everything else is water.
    expect(landMask(m, 1, 1)).toBe(2);
  });

  it("treats everything off the map as water, so the world's edge is a shoreline", () => {
    const m = map(["."]);
    expect(landMask(m, 0, 0)).toBe(0);
  });

  it("sees a cell surrounded by land as fully enclosed", () => {
    const m = map([
      "...",
      "...",
      "...",
    ]);
    expect(landMask(m, 1, 1)).toBe(15);
  });

  // A forest is land. The rocky rim must NOT be drawn along a treeline, or every forest would
  // look like an island.
  it("counts a forest as land, not as a shoreline", () => {
    const m: TileMap = { cols: 3, rows: 1, kinds: ["grass", "forest", "water"] };
    expect(landMask(m, 0, 0)).toBe(2); // E (the forest) is land
  });
});

describe("the autotile table", () => {
  it("has exactly one tile for each of the 16 neighbourhoods", () => {
    expect(AUTOTILE_LUT).toHaveLength(16);
    for (let mask = 0; mask < 16; mask++) {
      const tile = AUTOTILE_LUT[mask];
      expect(tile, `mask ${mask} has no tile`).toBeDefined();
    }
  });

  // These four pin the table against the actual Tiny Swords sheet layout. Get one wrong and the
  // whole world renders with its edges inside out.
  it("maps the neighbourhood to the right cell of the sheet", () => {
    expect(AUTOTILE_LUT[15]).toEqual({ col: 1, row: 1 }); // surrounded: the plain fill
    expect(AUTOTILE_LUT[0]).toEqual({ col: 3, row: 3 });  // alone: an island of one tile
    expect(AUTOTILE_LUT[6]).toEqual({ col: 0, row: 0 });  // land E+S only: a top-left corner
    expect(AUTOTILE_LUT[14]).toEqual({ col: 1, row: 0 }); // land E+S+W, no N: a top edge
    expect(AUTOTILE_LUT[7]).toEqual({ col: 0, row: 1 });  // land N+E+S, no W: a left edge
  });

  it("picks a tile straight from a map", () => {
    const m = map([
      "###",
      "#..",
      "###",
    ]);
    expect(landTile(m, 1, 1)).toEqual(AUTOTILE_LUT[2]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/autotile.test.ts
```

Expected: FAIL — cannot resolve `../src/client/game/autotile.js`.

- [ ] **Step 3: Write the autotiler**

Create `src/client/game/autotile.ts`:

```ts
/**
 * Choosing which grass tile to draw, as a pure function of the neighbourhood.
 *
 * The map stores what a cell IS; it never stores which sprite to draw. The sprite is derived from
 * the four orthogonal neighbours, so there is no step in which a human could place the wrong tile
 * beside another one. A seam is not unlikely here — it is unrepresentable.
 *
 * `Tilemap_Flat.png` is a 4x4 block: a 3x3 of edges and corners, a one-wide column, a one-tall
 * row, and a lone island. Those sixteen tiles are exactly the sixteen combinations of which
 * neighbours are land, which is why a 4-bit mask indexes it directly.
 *
 * The sheet has no inner-corner tiles, which looks fatal and is not: the rocky rim is drawn inset
 * along each tile's edge, so two adjacent edge tiles close cleanly around a concave corner.
 * Verified before this was written — see docs/screenshots/autotile-proof.png.
 */
import { isLandKind, kindAt, type TileMap } from "../../shared/tilemap.js";

/** N=1, E=2, S=4, W=8. A bit is set when that neighbour is land. */
export function landMask(map: TileMap, col: number, row: number): number {
  return (
    (isLandKind(kindAt(map, col, row - 1)) ? 1 : 0) |
    (isLandKind(kindAt(map, col + 1, row)) ? 2 : 0) |
    (isLandKind(kindAt(map, col, row + 1)) ? 4 : 0) |
    (isLandKind(kindAt(map, col - 1, row)) ? 8 : 0)
  );
}

/** Indexed by the mask above. Coordinates are cells of `Tilemap_Flat.png`'s first 4x4 group. */
export const AUTOTILE_LUT: readonly { col: number; row: number }[] = [
  { col: 3, row: 3 }, //  0  alone
  { col: 3, row: 2 }, //  1  N          — the foot of a column
  { col: 0, row: 3 }, //  2  E          — the left end of a row
  { col: 0, row: 2 }, //  3  N+E        — a bottom-left corner
  { col: 3, row: 0 }, //  4  S          — the head of a column
  { col: 3, row: 1 }, //  5  N+S        — the middle of a column
  { col: 0, row: 0 }, //  6  E+S        — a top-left corner
  { col: 0, row: 1 }, //  7  N+E+S      — a left edge
  { col: 2, row: 3 }, //  8  W          — the right end of a row
  { col: 2, row: 2 }, //  9  N+W        — a bottom-right corner
  { col: 1, row: 3 }, // 10  E+W        — the middle of a row
  { col: 1, row: 2 }, // 11  N+E+W      — a bottom edge
  { col: 2, row: 0 }, // 12  S+W        — a top-right corner
  { col: 2, row: 1 }, // 13  N+S+W      — a right edge
  { col: 1, row: 0 }, // 14  E+S+W      — a top edge
  { col: 1, row: 1 }, // 15  all        — plain fill
];

export function landTile(map: TileMap, col: number, row: number): { col: number; row: number } {
  const tile = AUTOTILE_LUT[landMask(map, col, row)];
  // Every mask is 0..15 and the table has all sixteen, so this cannot happen — but the types do
  // not know that and `noNonNullAssertion` is on.
  if (!tile) throw new Error(`no tile for mask at ${col},${row}`);
  return tile;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
npx vitest run test/autotile.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Full check, then commit**

```bash
npm run check
git add src/client/game/autotile.ts test/autotile.test.ts
git commit -m "Add the autotiler: the tile is a function of its neighbours, so a seam cannot be authored"
```

---

### Task 3: Bring the terrain art into the game

**Files:**
- Create: `public/assets/lindocara/tiny-swords/terrain/Tilemap_Flat.png`, `Water.png` (copied from the pack)
- Modify: `src/client/game/tiny-swords-art.ts` (export the terrain paths)
- Commit: the source pack under `assets/vendor/tiny-swords/` if it is not already tracked

**Interfaces:**
- Produces: `TINY_SWORDS_TERRAIN = { flat: string; water: string }` — URLs the renderer can hand to Pixi's `Assets.load`.

- [ ] **Step 1: Find the art and check what is tracked**

The user added a newer pack. It is at `assets/Tiny Swords (Update 010)/Terrain/Ground/Tilemap_Flat.png` (640×256, 10×4 cells at 64px) and `assets/Tiny Swords (Update 010)/Terrain/Water/Water.png` (64×64, a single tile).

```bash
git status --short assets/
```

That pack is **untracked**. The older `assets/vendor/tiny-swords/` copy IS tracked but its tileset is a different, older layout — **do not use it**. The autotile table in Task 2 was derived from `Tilemap_Flat.png` in the *Update 010* pack, and using the old sheet would render the world with its edges wrong.

Copy the two files into the vendored tree and into `public/` (which is how every other Tiny Swords texture reaches the browser — see `TINY_SWORDS_ROOT = "/assets/lindocara/tiny-swords"` in `src/client/game/tiny-swords-art.ts`). Commit both the vendored source and the served copy, matching whatever the existing buildings/units do.

Directory names with spaces and parentheses are a nuisance; normalise the destination paths (e.g. `assets/vendor/tiny-swords/Terrain/Ground/Tilemap_Flat.png`).

- [ ] **Step 2: Export the paths**

In `src/client/game/tiny-swords-art.ts`, beside `TINY_SWORDS_ROOT`:

```ts
/**
 * The terrain sheet, at its native 64px. `Tilemap_Flat.png` is a 4x4 autotile block (see
 * `autotile.ts`); `Water.png` is a single tile of open water.
 */
export const TINY_SWORDS_TERRAIN = {
  flat: `${TINY_SWORDS_ROOT}/terrain/Tilemap_Flat.png`,
  water: `${TINY_SWORDS_ROOT}/terrain/Water.png`,
};
```

- [ ] **Step 3: Verify the art actually loads**

```bash
npm run dev
```

Open the game in a browser and confirm both files fetch with HTTP 200 (Network tab, or `curl -sI http://localhost:5173/assets/lindocara/tiny-swords/terrain/Tilemap_Flat.png`). A 404 here becomes a blank world in the next task and will waste an hour.

- [ ] **Step 4: Check and commit**

```bash
npm run check
git add assets/ public/ src/client/game/tiny-swords-art.ts
git commit -m "Vendor the Tiny Swords 64px terrain tileset"
```

---

### Task 4: The renderer draws the tilemap

The slice's payload. When this lands, what you see is what you collide with.

**Files:**
- Modify: `src/client/game/renderer.ts` (`TILE_SIZE`, `#updateTerrain`, terrain loading)
- Modify: `src/client/game/world-layout.ts` (retire the procedural terrain)

**Interfaces:**
- Consumes: `landTile` (Task 2), `TINY_SWORDS_TERRAIN` (Task 3), `TILE_SIZE`, `kindAt`, `isLandKind` (Task 1), and the zone's `TileMap` (available on `TerrainGeometry.tiles`).

- [ ] **Step 1: Understand what you are deleting**

Read `#updateTerrain` at `src/client/game/renderer.ts:1440`. It walks the visible bounds in **32px** steps, samples the procedural `terrainAt(x, y)` from `world-layout.ts`, and paints a tinted square. It is pooled and culled to the camera — **keep that pooling and culling**, it is why the renderer is fast. Only the *source of truth* and the *tile size* change.

`const TILE_SIZE = 32` at `renderer.ts:93` is the old procedural grid. Delete it and import the real `TILE_SIZE` (64) from `src/shared/tilemap.js`. Anything else in the renderer that assumed 32px terrain cells must follow.

- [ ] **Step 2: Load the two textures**

Load `TINY_SWORDS_TERRAIN.flat` and `.water` the same way the renderer already loads its other textures (Pixi `Assets.load`). Slice the flat sheet into 16 sub-textures indexed by the autotile table — one `Texture` per cell of the first 4×4 group, each 64×64, using the sheet's frame rectangles. Build that once, not per frame.

- [ ] **Step 3: Draw from the tilemap**

Rewrite `#updateTerrain` so that, for each visible cell `(col, row)`:

- If `isLandKind(kindAt(tiles, col, row))` → draw the sub-texture at `landTile(tiles, col, row)`.
- Otherwise → draw the water texture.

Keep the existing sprite pool, the visible-bounds culling, and the `#terrainKey` early-out that skips the rebuild when the camera has not moved a whole cell.

**A forest is land with trees standing on it.** Cells of kind `forest` get the same autotiled grass as any other land, plus a tree sprite drawn on the decor layer above. Scatter the trees deterministically from the cell coordinates (there is already a `hashSeed` in `src/shared/game.ts`) — a forest that reshuffles itself every time the camera moves is worse than no forest.

Cells of kind `building` get plain autotiled grass and nothing else: the building sprite is already drawn on the `#structures` layer from `WORLD_LANDMARKS`, and drawing it twice would be a bug.

- [ ] **Step 4: Retire the procedural terrain**

`world-layout.ts`'s `terrainAt`, `roadStrength`, `WORLD_ZONES`, `ROADS` and `DECOR_REGIONS` described a world that no longer exists. Delete `terrainAt` and whatever becomes unused with it.

**Be careful:** `world-layout.ts` also exports `POINTS_OF_INTEREST` and `zoneAt`, which the renderer uses for world-space *labels* ("Heartroot Crossing", "Gloamwood"). Those are still wanted. Delete only the terrain generation, and say in your report exactly what you removed and what you kept.

The minimap (`src/client/game/minimap.ts`) also calls `terrainAt`. **Do not fix it here** — Task 5 does, and doing it in this task will tangle two reviews. If deleting `terrainAt` breaks the build, do Task 5's minimap change first and note it, or leave `terrainAt` in place for one commit and delete it in Task 5. Either is fine; say which you chose.

- [ ] **Step 5: Look at it**

```bash
npm run dev
```

Drive it in a browser. You are looking for:
- Grass with a rocky rim where it meets water. **No seams.** Follow a shoreline around a concave corner and confirm the rim closes.
- Water where the rivers and cliffs are. **Not where the forests and buildings are** — if you see a lake under a house, Task 1's kinds did not survive.
- Trees on the forest cells, stable when the camera moves.
- The world lines up with where you are blocked. Walk into a treeline and confirm you stop *at* the trees, not before or inside them.

Screenshot to `docs/screenshots/tile-render.png`.

- [ ] **Step 6: Check and commit**

```bash
npm run check
git add src/client/game/renderer.ts src/client/game/world-layout.ts docs/screenshots/tile-render.png
git commit -m "Draw the world from the tilemap with the real Tiny Swords autotiles"
```

---

### Task 5: The minimap bakes from tiles

**Files:**
- Modify: `src/client/game/minimap.ts` (`terrainColorAt`)
- Modify: `src/client/game/minimap-surface.ts` (the bake)
- Modify: `src/client/game/world-layout.ts` (delete `terrainAt` if Task 4 left it)
- Test: `test/minimap.test.ts`

**Interfaces:**
- Consumes: `kindAt`, `TileKind`, `TILE_SIZE` (Task 1).

- [ ] **Step 1: Understand what is there**

`minimap.ts`'s `terrainColorAt(zoneNameKey, world, x, y)` samples the *procedural* `terrainAt` for Verdant Reach and falls back to a flat colour elsewhere. `minimap-surface.ts` bakes the whole world by calling it ~200,000 times.

With a tilemap, both get simpler and exact: the colour of a cell is a function of its **kind**. No sampling, no zone special-case, no procedural fallback — and the minimap finally agrees with the world it is drawing.

- [ ] **Step 2: Write the failing test**

Replace the `terrainColorAt` tests in `test/minimap.test.ts` with:

```ts
describe("minimap colour", () => {
  it("gives every tile kind its own colour", () => {
    const kinds: TileKind[] = ["grass", "forest", "building", "water", "bridge", "plateau"];
    const colors = kinds.map((kind) => colorForKind(kind));
    expect(new Set(colors).size).toBeGreaterThan(1);
    for (const color of colors) {
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("draws water and land differently, so a shoreline is legible at a glance", () => {
    expect(colorForKind("water")).not.toBe(colorForKind("grass"));
  });

  // The minimap exists to be trusted. If it paints a forest as walkable grass, a player will
  // plan a route through a wall.
  it("does not paint a forest the same as open grass", () => {
    expect(colorForKind("forest")).not.toBe(colorForKind("grass"));
  });
});
```

Import `TileKind` from `../src/shared/tilemap.js` and `colorForKind` from `../src/client/game/minimap.js`.

- [ ] **Step 3: Replace `terrainColorAt` with `colorForKind`**

In `src/client/game/minimap.ts`, delete `terrainColorAt` and its palette machinery, and add:

```ts
/** The minimap is a map of what the world IS, so it colours by tile kind — not by sampling a
 *  function that no longer describes anything. */
export function colorForKind(kind: TileKind): number {
  switch (kind) {
    case "water":
      return 0x3f6f9c;
    case "forest":
      return 0x4e7340;
    case "building":
      return 0x8d7256;
    case "bridge":
      return 0xa9855c;
    case "plateau":
      return 0x9dbd6d;
    default:
      return 0x7fa653;
  }
}
```

In `src/client/game/minimap-surface.ts`, bake straight from the tilemap: for each texel, read `kindAt(tiles, col, row)` and write `colorForKind(kind)`. The bake no longer needs `zoneNameKey` or the obstacle list — remove those parameters if nothing else uses them, and delete the `VERDANT_REACH_ZONE_KEY` special-case with them.

- [ ] **Step 4: Delete `terrainAt`**

If Task 4 left `terrainAt` alive in `world-layout.ts` because the minimap still needed it, delete it now. Nothing should reference it. Keep `POINTS_OF_INTEREST` and `zoneAt` — the renderer still uses them for world labels.

- [ ] **Step 5: Run and look**

```bash
npx vitest run test/minimap.test.ts
npm run dev
```

Open the minimap and the `M` map. The rivers must be blue, the forests dark green, the city legible. The minimap must agree with the world under it — walk to a shoreline and confirm the minimap shows you at one.

- [ ] **Step 6: Check and commit**

```bash
npm run check
git add src/client/game/minimap.ts src/client/game/minimap-surface.ts src/client/game/world-layout.ts test/minimap.test.ts
git commit -m "Bake the minimap from the tilemap and retire the procedural terrain"
```

---

### Task 6: Verify in the running game, then deploy Slices 1 and 2 together

**Files:** none unless you find a bug.

- [ ] **Step 1: Drive the real game**

```bash
npm run dev
```

**The trap from CLAUDE.md:** `vite dev` stacks Worker versions across hot reloads and a stale Durable Object keeps broadcasting. If a square teleports between fixed positions, restart the dev server — it is not the tilemap.

The single question this whole slice exists to answer: **does what you see match what you collide with?**

- Walk into a treeline. You must stop *at the trees*, not a tile early and not inside them.
- Walk along a shoreline. The rim must be continuous — no seams at concave corners.
- Confirm there are **no invisible walls in open grass** and **no walkable ground inside a drawn tree**. These were the two symptoms of the Slice-1-alone state; they must both be gone.
- Confirm no blue water under any building.
- Movement is still free, continuous, sub-pixel. Read `window.__lindocara.self()` and confirm the coordinates are floats, not multiples of 64.
- The minimap and `M` map agree with the world.
- Complete a corpse run: die, press R, walk your ghost back to your body.

Screenshot to `docs/screenshots/tile-render-live.png`.

- [ ] **Step 2: Deploy**

```bash
npm run check
git push
```

CI deploys on push to `main`. Confirm:

```bash
gh run list --branch main --limit 1
curl -s -o /dev/null -w "%{http_code}\n" https://lindocara.alepha.dev/
```

- [ ] **Step 3: Verify on live**

Drive the deployed site the same way. Report what you saw, with coordinates.
