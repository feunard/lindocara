# Editor Modes and Sub-Cell Collision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the editor's `Layer 1/2/3/EV` control with a Field/Element/Event segmented control, give placed elements a quarter-tile offset, and move element collision from baked tile cells to sub-cell AABB colliders authored on the catalogue.

**Architecture:** Colliders ride on `TerrainGeometry`, the single channel every collision caller already receives, so client prediction and the server pick them up together. `isWalkable` stays the one junction: tiles first, then the collider buckets of the cells the body overlaps. The editor's `activeLayer` becomes `activeMode`, which is what the data model always was.

**Tech Stack:** TypeScript, React, PixiJS, Vitest in workerd, Cloudflare Workers + D1, Biome.

**Spec:** `docs/superpowers/specs/2026-07-20-editor-modes-subcell-collision-design.md`

## Global Constraints

- `TILE_SIZE = 64`. A quarter step is exactly `16`. Never hardcode either — import `TILE_SIZE` and derive.
- `MAP_LAYERS` stays `3`. No map migration, no D1 migration in this plan.
- `src/shared/` must stay platform-free: no DOM, no Cloudflare, no React, no imports from `src/server/` or `src/client/`.
- `src/shared/simulation.ts` must not import `tilemap.ts` or `game.ts`. `step()` never learns about collision.
- `noNonNullAssertion` is on. No `!`. Narrow with a guard or `?? fallback`.
- Every player-facing string goes in **both** `src/shared/i18n/en.ts` and `src/shared/i18n/fr.ts`. The i18n parity test enforces it.
- Editor UI uses **stock shadcn** from `src/client/ui/components/`. Never import `ui/tiny-swords/` into the editor. Never hand-edit generated shadcn files.
- Run `npm run check` (lint + typecheck + test) before every commit. Three tsconfigs — a `shared/` change must typecheck under both the client and worker programs.
- Box convention everywhere: a position is the **top-left corner**, and the far edge is **exclusive** (`isWalkableBox` uses `position + size - 1`). Colliders use half-open intervals to match.

---

## File Structure

**Created:**
- `src/shared/collider.ts` — the `Rect` collider index: build, query, empty. Pure, no map knowledge.
- `test/shared/collider.test.ts`
- `src/client/ui/editor/EditorModeControl.tsx` — the three-segment control.
- `src/client/ui/editor/ElementPalette.tsx` — the Element-mode sidebar body, split out of `TerrainPalette`.
- `src/client/ui/editor/EventPalette.tsx` — the Event-mode sidebar body, split out of `TerrainPalette`.
- `src/client/ui/editor/EditorPalette.tsx` — the three-way dispatcher the screen renders.

**Modified (principal responsibility after the change):**
- `src/shared/tiny-swords-catalog.ts` — adds `collider?: Rect` to the placement metadata type.
- `scripts/tiny-swords-catalog-lib.ts` — emits colliders, enforces the build-time invariant.
- `src/shared/tiny-swords-catalog.generated.ts` — regenerated, never hand-edited.
- `src/shared/map-data.ts` — `MapElement` offsets, parsing/validation, `elementWorldCollider`, bake without the element forest pass.
- `src/shared/game.ts` — `TerrainGeometry.colliders`, `isWalkable` junction.
- `src/shared/tilemap.ts` — `isPathWalkableWith` collider-aware variant.
- `src/shared/directional-combat.ts` — projectile sweep over colliders.
- `src/shared/protocol.ts` — `WorldInfo.colliders`.
- `src/client/game/net.ts` — decode colliders into the client geometry.
- `src/client/game/catalog-element-render.ts` — the offset in the one shared anchor.
- `src/client/game/editor-state.ts` — `activeMode`, mode-scoped tools and eraser, quarter-cell placement.
- `src/client/game/map-editor-stage.ts` — mode plumbing, quarter-cell hover, sub-grid.
- `src/client/ui/editor/AdventureEditorScreen.tsx` — mode state and shortcuts.
- `src/client/ui/editor/EditorToolbar.tsx`, `EditorMenuBar.tsx`, `EditorStatusBar.tsx`, `TerrainPalette.tsx`.

`TerrainPalette.tsx` is split rather than grown: it currently branches on an `eventMode` boolean and would need a three-way branch over ~270 lines. Each mode body becomes its own file and `TerrainPalette` keeps only the Field body.

---

### Task 1: The collider index

A pure module with no knowledge of maps, elements or the catalogue: rectangles in, bucketed index out, overlap query. Everything later builds on it.

**Files:**
- Create: `src/shared/collider.ts`
- Test: `test/shared/collider.test.ts`

**Interfaces:**
- Consumes: `Rect` from `src/shared/game.ts` (`{x, y, width, height}`), `Vec2` from `src/shared/simulation.ts`, `TILE_SIZE` from `src/shared/tilemap.ts`.
- Produces:
  - `interface ColliderIndex { cols: number; rows: number; buckets: readonly (readonly Rect[])[] }`
  - `function emptyColliderIndex(cols: number, rows: number): ColliderIndex`
  - `function colliderIndexFrom(rects: readonly Rect[], cols: number, rows: number): ColliderIndex`
  - `function overlapsCollider(index: ColliderIndex, position: Vec2, size: number): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/shared/collider.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  colliderIndexFrom,
  emptyColliderIndex,
  overlapsCollider,
} from "../../src/shared/collider.js";
import { TILE_SIZE } from "../../src/shared/tilemap.js";

const COLS = 4;
const ROWS = 4;

describe("collider index", () => {
  it("reports no overlap when empty", () => {
    const index = emptyColliderIndex(COLS, ROWS);
    expect(overlapsCollider(index, { x: 0, y: 0 }, 32)).toBe(false);
  });

  it("detects a body overlapping a sub-cell rect", () => {
    // A 24x20 trunk in the middle of cell (1,1).
    const index = colliderIndexFrom(
      [{ x: TILE_SIZE + 20, y: TILE_SIZE + 40, width: 24, height: 20 }],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: TILE_SIZE + 16, y: TILE_SIZE + 36 }, 32)).toBe(true);
  });

  it("lets a body pass beside a sub-cell rect inside the same cell", () => {
    // This is the whole point of the tranche: the cell is occupied, the cell is not blocked.
    const index = colliderIndexFrom(
      [{ x: TILE_SIZE + 40, y: TILE_SIZE + 40, width: 16, height: 16 }],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: TILE_SIZE, y: TILE_SIZE }, 32)).toBe(false);
  });

  it("treats the far edge as exclusive, like isWalkableBox", () => {
    const index = colliderIndexFrom([{ x: 32, y: 0, width: 16, height: 16 }], COLS, ROWS);
    // Body [0,32) ends exactly where the rect starts: touching, not overlapping.
    expect(overlapsCollider(index, { x: 0, y: 0 }, 32)).toBe(false);
    expect(overlapsCollider(index, { x: 1, y: 0 }, 32)).toBe(true);
  });

  it("finds a rect from any cell it spans", () => {
    // Spans the (0,0)/(1,0)/(0,1)/(1,1) corner. A bucket lookup must never consult neighbours.
    const index = colliderIndexFrom(
      [{ x: TILE_SIZE - 8, y: TILE_SIZE - 8, width: 16, height: 16 }],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: TILE_SIZE - 12, y: TILE_SIZE - 12 }, 8)).toBe(true);
    expect(overlapsCollider(index, { x: TILE_SIZE + 4, y: TILE_SIZE + 4 }, 8)).toBe(true);
  });

  it("ignores rects outside the grid and degenerate bodies", () => {
    const index = colliderIndexFrom(
      [
        { x: -100, y: -100, width: 16, height: 16 },
        { x: 0, y: 0, width: 0, height: 16 },
      ],
      COLS,
      ROWS,
    );
    expect(overlapsCollider(index, { x: 0, y: 0 }, 32)).toBe(false);
    expect(overlapsCollider(emptyColliderIndex(COLS, ROWS), { x: 0, y: 0 }, 0)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shared/collider.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/shared/collider.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/collider.ts`:

```ts
/**
 * Sub-cell collision, as rectangles.
 *
 * The tile grid answers "is this cell solid"; this answers "is this *part* of a cell solid", which
 * is what a tree trunk needs. Platform-free for the same reason `tilemap.ts` is: the server decides
 * where a body actually is, and the browser predicts with the identical code. A collider only one
 * side could see would desync on the first trunk.
 *
 * Rectangles are bucketed per tile cell at build time and listed in EVERY cell they span, so a
 * query only ever reads the buckets of the cells the body itself touches — never a neighbour, and
 * never the whole list. That keeps the cost bounded by body size instead of by the map's element
 * count.
 */
import type { Rect } from "./game.js";
import type { Vec2 } from "./simulation.js";
import { TILE_SIZE } from "./tilemap.js";

export interface ColliderIndex {
  cols: number;
  rows: number;
  /** `cols * rows` buckets, row-major, indexed exactly like `TileMap.kinds`. */
  buckets: readonly (readonly Rect[])[];
}

export function emptyColliderIndex(cols: number, rows: number): ColliderIndex {
  const count = Math.max(0, cols) * Math.max(0, rows);
  return { cols, rows, buckets: new Array<readonly Rect[]>(count).fill(EMPTY_BUCKET) };
}

const EMPTY_BUCKET: readonly Rect[] = [];

export function colliderIndexFrom(
  rects: readonly Rect[],
  cols: number,
  rows: number,
): ColliderIndex {
  const count = Math.max(0, cols) * Math.max(0, rows);
  const buckets: Rect[][] = Array.from({ length: count }, () => []);
  for (const rect of rects) {
    // A degenerate rect has no interior, so it can never overlap a half-open body interval.
    // Dropping it here keeps the query loop free of the check.
    if (!(rect.width > 0) || !(rect.height > 0)) continue;
    if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) continue;
    const left = Math.max(0, Math.floor(rect.x / TILE_SIZE));
    const top = Math.max(0, Math.floor(rect.y / TILE_SIZE));
    const right = Math.min(cols - 1, Math.floor((rect.x + rect.width - 1) / TILE_SIZE));
    const bottom = Math.min(rows - 1, Math.floor((rect.y + rect.height - 1) / TILE_SIZE));
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        buckets[row * cols + col]?.push(rect);
      }
    }
  }
  return { cols, rows, buckets };
}

/**
 * `position` is the body's top-left corner and the far edge is exclusive — the same convention
 * `isWalkableBox` uses, so a body sitting exactly on a collider's edge is beside it, not inside it.
 */
export function overlapsCollider(index: ColliderIndex, position: Vec2, size: number): boolean {
  if (size <= 0) return false;
  const left = Math.max(0, Math.floor(position.x / TILE_SIZE));
  const top = Math.max(0, Math.floor(position.y / TILE_SIZE));
  const right = Math.min(index.cols - 1, Math.floor((position.x + size - 1) / TILE_SIZE));
  const bottom = Math.min(index.rows - 1, Math.floor((position.y + size - 1) / TILE_SIZE));
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      const bucket = index.buckets[row * index.cols + col];
      if (!bucket) continue;
      for (const rect of bucket) {
        if (
          position.x < rect.x + rect.width &&
          rect.x < position.x + size &&
          position.y < rect.y + rect.height &&
          rect.y < position.y + size
        ) {
          return true;
        }
      }
    }
  }
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/shared/collider.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Lint and typecheck**

Run: `npm run lint:fix && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/collider.ts test/shared/collider.test.ts
git commit -m "feat: add bucketed sub-cell collider index"
```

---

### Task 2: Author colliders on the catalogue

The collider is a property of the asset, resolved once, exactly like `tile id → tileset → passable`. It is expressed in **foot space**: the origin is where the art's visible foot lands, `(col*64 + 32, (row+1)*64)`.

Not the sprite container's position. `createCatalogElementView` places the container at `(row+1)*64 + footOffset`, and `footOffset` is `frameHeight - alphaBboxBottom`, so it cancels out — the visible pixels always end exactly on the cell's bottom edge, and the container point sits `footOffset` px *below* them. Authoring against the container would make every collider `footOffset`-dependent and would plant a tree's collider in the empty cell south of it. Foot space is `footOffset`-independent: measure the trunk up from the ground line on the PNG.

**Files:**
- Modify: `src/shared/tiny-swords-catalog.ts` (the `EditorPlacementMetadata` interface)
- Modify: `scripts/tiny-swords-catalog-lib.ts` (`editorMetadata`, around lines 250-344; the build invariant, around lines 552-558)
- Regenerate: `src/shared/tiny-swords-catalog.generated.ts`
- Test: `test/shared/catalog-collider.test.ts`

**Interfaces:**
- Consumes: `Rect` from `src/shared/game.ts`.
- Produces: `EditorPlacementMetadata.collider?: Rect` — pixels, relative to the sprite's visible foot. `collisionFootprint` is **removed** from the type and from the generator.

- [ ] **Step 1: Write the failing test**

Create `test/shared/catalog-collider.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TILE_SIZE } from "../../src/shared/tilemap.js";
import { CURATED_EDITOR_ASSET_IDS, editorAsset } from "../../src/shared/tiny-swords-catalog.js";

describe("catalogue colliders", () => {
  it("gives the curated tree a trunk collider, not a whole cell", () => {
    const tree = editorAsset("resource.terrain-resources-wood-trees.tree3");
    const collider = tree?.editor.collider;
    expect(collider).toBeDefined();
    if (!collider) return;
    expect(collider.width).toBeGreaterThan(0);
    expect(collider.width).toBeLessThan(TILE_SIZE);
    expect(collider.height).toBeLessThan(TILE_SIZE);
  });

  it("leaves the curated bush non-colliding, as before", () => {
    const bush = editorAsset("decoration.terrain-decorations-bushes.bushe1");
    expect(bush?.editor.collider).toBeUndefined();
  });

  it("keeps every collider inside its asset's visual footprint bounds", () => {
    for (const id of CURATED_EDITOR_ASSET_IDS) {
      const asset = editorAsset(id);
      const collider = asset?.editor.collider;
      if (!asset || !collider) continue;
      const cells = asset.editor.visualFootprint;
      const minCol = Math.min(...cells.map((c) => c.col));
      const maxCol = Math.max(...cells.map((c) => c.col));
      const minRow = Math.min(...cells.map((c) => c.row));
      const maxRow = Math.max(...cells.map((c) => c.row));
      // Foot space: x = 0 is the cell centre, so the footprint spans
      // [minCol*TILE_SIZE - TILE_SIZE/2, (maxCol+1)*TILE_SIZE - TILE_SIZE/2).
      expect(collider.x).toBeGreaterThanOrEqual(minCol * TILE_SIZE - TILE_SIZE / 2);
      expect(collider.x + collider.width).toBeLessThanOrEqual(
        (maxCol + 1) * TILE_SIZE - TILE_SIZE / 2,
      );
      // And y = 0 is the ground line. A collider must rise from it, never hang below it: a
      // collider with y + height > 0 sits in the cell SOUTH of the art it belongs to, blocking
      // empty ground while leaving the trunk walkable.
      expect(collider.y + collider.height).toBeLessThanOrEqual(0);
      expect(collider.y).toBeGreaterThanOrEqual((minRow - maxRow - 1) * TILE_SIZE);
    }
  });

  it("puts the curated tree's collider above the ground line, not below it", () => {
    // The regression guard for the coordinate-space bug: authoring against the sprite CONTAINER
    // (which sits footOffset px below the visible pixels) instead of the visible foot put this
    // collider entirely inside the next cell south.
    const collider = editorAsset("resource.terrain-resources-wood-trees.tree3")?.editor.collider;
    expect(collider).toBeDefined();
    if (!collider) return;
    expect(collider.y).toBeLessThan(0);
    expect(collider.y + collider.height).toBeLessThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shared/catalog-collider.test.ts`
Expected: FAIL — `collider` is not a property of `editor`, TypeScript error plus `expect(undefined).toBeDefined()`.

- [ ] **Step 3: Change the metadata type**

In `src/shared/tiny-swords-catalog.ts`, in `EditorPlacementMetadata` (around line 52): delete the `collisionFootprint` line and add, with its comment:

```ts
  /**
   * Sub-cell collision, in pixels relative to the sprite's VISIBLE FOOT — `col*64 + 32`
   * horizontally, `(row+1)*64` vertically. So `y` is negative: the collider rises from the ground
   * line the art stands on.
   *
   * Deliberately NOT the sprite container's position. `createCatalogElementView` places the
   * container at `(row+1)*64 + footOffset`, and `footOffset` is `frameHeight - alphaBboxBottom`, so
   * it cancels: the visible pixels always end exactly on the cell's bottom edge and the container
   * point sits `footOffset` px BELOW them. Authoring against the container would make every value
   * `footOffset`-dependent and would put a tree's collider in the empty cell south of the tree.
   *
   * Absent means the asset does not collide at all — the correct value for bushes, flowers and any
   * pure decoration. This replaces `collisionFootprint`: a whole-cell footprint was the only shape
   * expressible before, and it made every tree block a 64x64 square you could see straight through.
   */
  collider?: Rect;
```

Add `import type { Rect } from "./game.js";` at the top if it is not already imported. If importing `game.ts` from here would create a cycle, declare the shape inline instead:

```ts
export interface ColliderRect { x: number; y: number; width: number; height: number }
```

and use `collider?: ColliderRect`. Check with `npm run typecheck` and take whichever compiles.

- [ ] **Step 4: Change the generator**

In `scripts/tiny-swords-catalog-lib.ts`, in `editorMetadata()`: remove every `collisionFootprint` assignment and emit `collider` instead.

The two curated assets, measured against their art:

```ts
// Foot space: y = 0 is the ground line the art stands on, so a collider rises into negative y.
// Trees (Tree1-4, Stump): a trunk, not a canopy. ~24px wide, centred, rising ~20px from the ground.
const TREE_COLLIDER = { x: -12, y: -20, width: 24, height: 20 };

// Rocks: squatter and wider than a trunk.
const ROCK_COLLIDER = { x: -20, y: -14, width: 40, height: 14 };
```

Apply `TREE_COLLIDER` where the tree branch previously set `collisionFootprint: [{ col: 0, row: 0 }]` (around line 278), `ROCK_COLLIDER` on the rock branch, and emit **no** `collider` where the previous value was `[]` (bushes, line ~287, and every other decoration). Buildings keep whole-cell blocking: emit a collider covering their footprint cells in foot space, `{ x: minCol*64 - 32, y: -(rows*64), width: (maxCol-minCol+1)*64, height: rows*64 }` computed from their existing footprint, so building collision does not change in this tranche.

- [ ] **Step 5: Change the build invariant**

In `scripts/tiny-swords-catalog-lib.ts` around lines 552-558, replace the "every collision cell is in the visual footprint" check with the foot-space equivalent. In foot space `y = 0` is the ground line, so `y + height > 0` means the collider hangs below the art — which is exactly the failure that would put a tree's collider in the cell to its south. That check is load-bearing; do not relax it:

```ts
if (editor.collider) {
  const cols = editor.visualFootprint.map((cell) => cell.col);
  const rows = editor.visualFootprint.map((cell) => cell.row);
  const minX = Math.min(...cols) * TILE_PX - TILE_PX / 2;
  const maxX = (Math.max(...cols) + 1) * TILE_PX - TILE_PX / 2;
  const minY = (Math.min(...rows) - Math.max(...rows) - 1) * TILE_PX;
  if (
    editor.collider.x < minX ||
    editor.collider.x + editor.collider.width > maxX ||
    editor.collider.y < minY ||
    editor.collider.y + editor.collider.height > 0
  ) {
    throw new Error(`${id}: collider escapes its visual footprint`);
  }
}
```

`TILE_PX` is 64; use the constant the script already has for tile size, or declare `const TILE_PX = 64` beside the colliders. `y + height > 0` catches a collider hanging below the foot, which would block ground the art does not cover.

- [ ] **Step 6: Regenerate and run the test**

Run: `npm run catalog:generate` (check `package.json` for the exact script name — grep for `tiny-swords-catalog-lib` in `scripts/`; run the generator entry point directly with `npx tsx` if there is no npm script).
Then: `npx vitest run test/shared/catalog-collider.test.ts`
Expected: PASS, 3 tests. Typecheck will still fail elsewhere — `elementCells(element, "collision")` in `map-data.ts` now references a removed field. That is Task 4's job; do not fix it here.

- [ ] **Step 7: Commit**

```bash
git add src/shared/tiny-swords-catalog.ts src/shared/tiny-swords-catalog.generated.ts \
  scripts/tiny-swords-catalog-lib.ts test/shared/catalog-collider.test.ts
git commit -m "feat: author sub-cell colliders on catalogue assets"
```

---

### Task 3: Element offsets

`MapElement` gains two quarter-tile integers. Because elements are about to become collision, parsing must start bounds-checking what it never checked.

**Files:**
- Modify: `src/shared/map-data.ts` (`MapElement` ~line 23, `parseMapElements` ~line 340)
- Modify: `src/server/maps.ts` (`validateMapInput` — grep for `MAX_MAP_ELEMENTS`)
- Test: `test/shared/map-element-offset.test.ts`

**Interfaces:**
- Produces:
  - `MapElement` = `{ col: number; row: number; offsetX: number; offsetY: number; assetId: EditorAssetId }`
  - `export const ELEMENT_OFFSET_STEPS = 4`
  - `export const ELEMENT_OFFSET_PX = TILE_SIZE / ELEMENT_OFFSET_STEPS` (16)
  - `export function parseMapElements(value: unknown, cols: number, rows: number): MapElement[] | null` — **signature change**, bounds are now required.

- [ ] **Step 1: Write the failing test**

Create `test/shared/map-element-offset.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ELEMENT_OFFSET_PX,
  ELEMENT_OFFSET_STEPS,
  parseMapElements,
} from "../../src/shared/map-data.js";

const ASSET = "resource.terrain-resources-wood-trees.tree3";

describe("element offsets", () => {
  it("is a quarter tile", () => {
    expect(ELEMENT_OFFSET_STEPS).toBe(4);
    expect(ELEMENT_OFFSET_PX).toBe(16);
  });

  it("parses offsets", () => {
    const parsed = parseMapElements(
      [{ col: 1, row: 2, offsetX: 3, offsetY: 0, assetId: ASSET }],
      10,
      10,
    );
    expect(parsed).toEqual([{ col: 1, row: 2, offsetX: 3, offsetY: 0, assetId: ASSET }]);
  });

  it("defaults a legacy element without offsets to zero", () => {
    const parsed = parseMapElements([{ col: 1, row: 2, assetId: ASSET }], 10, 10);
    expect(parsed?.[0]).toMatchObject({ offsetX: 0, offsetY: 0 });
  });

  it("rejects an offset outside 0..3", () => {
    expect(parseMapElements([{ col: 0, row: 0, offsetX: 4, offsetY: 0, assetId: ASSET }], 10, 10))
      .toBeNull();
    expect(parseMapElements([{ col: 0, row: 0, offsetX: -1, offsetY: 0, assetId: ASSET }], 10, 10))
      .toBeNull();
    expect(parseMapElements([{ col: 0, row: 0, offsetX: 1.5, offsetY: 0, assetId: ASSET }], 10, 10))
      .toBeNull();
  });

  it("rejects a cell outside the map, now that elements are collision", () => {
    expect(parseMapElements([{ col: 10, row: 0, assetId: ASSET }], 10, 10)).toBeNull();
    expect(parseMapElements([{ col: 0, row: -1, assetId: ASSET }], 10, 10)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shared/map-element-offset.test.ts`
Expected: FAIL — `ELEMENT_OFFSET_STEPS` is not exported.

- [ ] **Step 3: Change the type and the parser**

In `src/shared/map-data.ts`, replace the `MapElement` interface (line 23):

```ts
/** A quarter tile. The offset space covers exactly one cell — no overlap, no gap between
 *  neighbours — so every sub-cell position has exactly one `(col, offset)` encoding. */
export const ELEMENT_OFFSET_STEPS = 4;
export const ELEMENT_OFFSET_PX = TILE_SIZE / ELEMENT_OFFSET_STEPS;

export interface MapElement {
  col: number;
  row: number;
  /** Integer in `0..ELEMENT_OFFSET_STEPS - 1`, quarter tiles right of the cell origin. */
  offsetX: number;
  /** Integer in `0..ELEMENT_OFFSET_STEPS - 1`, quarter tiles below the cell origin. */
  offsetY: number;
  assetId: EditorAssetId;
}
```

Replace `parseMapElements` (line 340) entirely:

```ts
/**
 * Elements off the wire, checked like the untrusted data they are.
 *
 * Bounds ARE checked here now, and the caller must supply them. They deliberately were not before:
 * collision was fully baked into the tiles by the time elements arrived, so a silly cell drew
 * nowhere and collided with nothing. Elements now carry colliders, so an out-of-range element is a
 * collider somewhere no author put one.
 */
export function parseMapElements(value: unknown, cols: number, rows: number): MapElement[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: MapElement[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const item = raw as Record<string, unknown>;
    const { col, row } = item;
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row)) return null;
    if ((col as number) < 0 || (col as number) >= cols) return null;
    if ((row as number) < 0 || (row as number) >= rows) return null;
    const offsetX = parseOffsetStep(item.offsetX);
    const offsetY = parseOffsetStep(item.offsetY);
    if (offsetX === null || offsetY === null) return null;
    let assetId: EditorAssetId;
    if (isEditorAssetId(item.assetId)) assetId = item.assetId;
    else if (isElementKind(item.kind) && Number.isSafeInteger(item.variant)) {
      assetId = legacyElementAssetId(item.kind, item.variant as number);
    } else return null;
    parsed.push({ col: col as number, row: row as number, offsetX, offsetY, assetId });
  }
  return parsed;
}

/** Absent is 0: maps authored before offsets existed are aligned to their cell. */
function parseOffsetStep(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value)) return null;
  const step = value as number;
  if (step < 0 || step >= ELEMENT_OFFSET_STEPS) return null;
  return step;
}
```

- [ ] **Step 4: Fix the call sites**

Run `npx tsc -p tsconfig.worker.json --noEmit` and `npx tsc -p tsconfig.client.json --noEmit` to list them. Expected callers: `parseMapData` in the same file (pass `cols`/`rows`, which it has already validated at that point — move the `elements` parse *after* the `cols`/`rows` checks if it is not already), and `validateMapInput` in `src/server/maps.ts`. Any construction of a `MapElement` literal (editor, tests, fixtures) needs `offsetX: 0, offsetY: 0`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/shared/map-element-offset.test.ts && npx vitest run test/db.test.ts`
Expected: the offset tests PASS. `map-data.ts` still references `collisionFootprint` via `elementCells(element, "collision")` — typecheck stays red until Task 4. Do not fix it here.

- [ ] **Step 6: Commit**

```bash
git add src/shared/map-data.ts src/server/maps.ts test/shared/map-element-offset.test.ts
git commit -m "feat: give map elements a quarter-tile offset and bounds-checked parsing"
```

---

### Task 4: Bake colliders and make `isWalkable` the junction

The load-bearing task. After it, collision has two sources and exactly one query.

**Files:**
- Modify: `src/shared/map-data.ts` (`elementCells`, `bakeElements`, `terrainFromMap`, add `elementWorldCollider`)
- Modify: `src/shared/game.ts` (`TerrainGeometry` ~line 26, `isWalkable` ~line 836, `VERDANT_REACH_TERRAIN`)
- Test: `test/shared/subcell-collision.test.ts`

**Interfaces:**
- Consumes: `colliderIndexFrom`, `emptyColliderIndex`, `overlapsCollider`, `ColliderIndex` (Task 1); `EditorPlacementMetadata.collider` (Task 2); `MapElement.offsetX/offsetY`, `ELEMENT_OFFSET_PX` (Task 3).
- Produces:
  - `TerrainGeometry.colliders: ColliderIndex` — **required**, not optional. TypeScript then finds every construction site, which is the point.
  - `export function elementWorldCollider(element: MapElement): Rect | null`
  - `isWalkable` unchanged in signature, now testing both sources.

- [ ] **Step 1: Write the failing test**

Create `test/shared/subcell-collision.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isWalkable, resolveTerrain } from "../../src/shared/game.js";
import {
  elementWorldCollider,
  type MapData,
  terrainFromMap,
} from "../../src/shared/map-data.js";
import { encodeTileLayer } from "../../src/shared/tile-layer-codec.js";
import { TILE_SIZE } from "../../src/shared/tilemap.js";
import { parseTileLayer } from "../../src/shared/tile-layer-codec.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET_ID } from "../../src/shared/tilesets/tiny-swords.js";

const COLS = 6;
const ROWS = 6;
const TREE = "resource.terrain-resources-wood-trees.tree3";

/** All grass, so nothing but an element can block. */
function grassMap(elements: MapData["elements"]): MapData {
  const grassId = (GRASS_SLOTS[0] ?? 0) * 16;
  const ground = parseTileLayer(encodeTileLayer({
    cols: COLS,
    rows: ROWS,
    ids: new Array<number>(COLS * ROWS).fill(grassId),
  }), COLS, ROWS);
  const empty = parseTileLayer("", COLS, ROWS);
  if (!ground || !empty) throw new Error("fixture layers");
  return {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: COLS,
    rows: ROWS,
    layers: [ground, empty, empty],
    elements,
    spawn: { col: 0, row: 0 },
  };
}

describe("sub-cell element collision", () => {
  it("blocks a body standing on the trunk", () => {
    const element = { col: 3, row: 3, offsetX: 0, offsetY: 0, assetId: TREE } as const;
    const terrain = terrainFromMap(grassMap([element]));
    const trunk = elementWorldCollider(element);
    expect(trunk).not.toBeNull();
    if (!trunk) return;
    expect(isWalkable({ x: trunk.x, y: trunk.y }, 8, terrain)).toBe(false);
  });

  it("lets a body walk through the same cell beside the trunk", () => {
    // The regression this whole tranche exists to fix: before, the cell was solid.
    const element = { col: 3, row: 3, offsetX: 0, offsetY: 0, assetId: TREE } as const;
    const terrain = terrainFromMap(grassMap([element]));
    expect(isWalkable({ x: 3 * TILE_SIZE, y: 3 * TILE_SIZE }, 8, terrain)).toBe(true);
  });

  it("moves the collider with the offset", () => {
    const aligned = elementWorldCollider({
      col: 2, row: 2, offsetX: 0, offsetY: 0, assetId: TREE,
    });
    const shifted = elementWorldCollider({
      col: 2, row: 2, offsetX: 3, offsetY: 1, assetId: TREE,
    });
    expect(aligned).not.toBeNull();
    expect(shifted).not.toBeNull();
    if (!aligned || !shifted) return;
    expect(shifted.x - aligned.x).toBe(48);
    expect(shifted.y - aligned.y).toBe(16);
  });

  it("stands the collider exactly on the cell's ground line", () => {
    // THE regression guard for the coordinate-space bug, and the only place it is mechanically
    // checkable: this is the one function that turns an authored rect into world pixels. The
    // catalogue authors in foot space, so a tree's collider must end exactly on `(row+1)*TILE_SIZE`.
    // Reintroducing the renderer's `footOffset` here — "to match createCatalogElementView" — pushes
    // it 22 px south, into the next cell, and this assertion is what catches that.
    const rect = elementWorldCollider({
      col: 2, row: 3, offsetX: 0, offsetY: 0, assetId: TREE,
    });
    expect(rect).not.toBeNull();
    if (!rect) return;
    expect(rect.y + rect.height).toBe(4 * TILE_SIZE);
    // And horizontally centred on the cell, not on its left edge.
    expect(rect.x + rect.width / 2).toBe(2 * TILE_SIZE + TILE_SIZE / 2);
  });

  it("gives a non-colliding asset no collider", () => {
    expect(elementWorldCollider({
      col: 1, row: 1, offsetX: 0, offsetY: 0,
      assetId: "decoration.terrain-decorations-bushes.bushe1",
    })).toBeNull();
  });

  it("slides along a trunk instead of stopping dead", () => {
    const element = { col: 3, row: 3, offsetX: 0, offsetY: 0, assetId: TREE } as const;
    const terrain = terrainFromMap(grassMap([element]));
    const trunk = elementWorldCollider(element);
    if (!trunk) return;
    const from = { x: trunk.x - 40, y: trunk.y };
    const desired = { x: trunk.x - 4, y: trunk.y + 8 };
    const resolved = resolveTerrain(from, desired, terrain);
    // Blocked on x, free on y: wall sliding still works against a sub-cell collider.
    expect(resolved.y).toBe(desired.y);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shared/subcell-collision.test.ts`
Expected: FAIL — `elementWorldCollider` is not exported.

- [ ] **Step 3: Add `elementWorldCollider` and rebuild the bake**

In `src/shared/map-data.ts`:

Add the import `import { type ColliderIndex, colliderIndexFrom } from "./collider.js";` and `import type { Rect } from "./game.js";` if absent.

Change `elementCells` to drop the `footprint` parameter — only the visual footprint survives:

```ts
export function elementCells(element: MapElement): { col: number; row: number }[] {
  const asset = editorAsset(element.assetId);
  if (!asset) return [];
  return asset.editor.visualFootprint.map((offset) => ({
    col: element.col + offset.col,
    row: element.row + offset.row,
  }));
}
```

Add, next to it:

```ts
/**
 * An element's collider in world pixels, or null when the asset does not collide.
 *
 * The catalogue authors the rect in foot space, so this translation needs no `footOffset`: the
 * art's visible foot always lands on the cell's bottom edge, because the renderer's `footOffset`
 * cancels against the frame's own bottom padding. Do NOT reintroduce `footOffset` here to "match"
 * `createCatalogElementView` — that would push every collider a padding's worth south of its sprite.
 */
export function elementWorldCollider(element: MapElement): Rect | null {
  const collider = editorAsset(element.assetId)?.editor.collider;
  if (!collider) return null;
  const footX = element.col * TILE_SIZE + TILE_SIZE / 2 + element.offsetX * ELEMENT_OFFSET_PX;
  const footY = (element.row + 1) * TILE_SIZE + element.offsetY * ELEMENT_OFFSET_PX;
  return {
    x: footX + collider.x,
    y: footY + collider.y,
    width: collider.width,
    height: collider.height,
  };
}

export function elementColliders(elements: readonly MapElement[]): Rect[] {
  const rects: Rect[] = [];
  for (const element of elements) {
    const rect = elementWorldCollider(element);
    if (rect) rects.push(rect);
  }
  return rects;
}
```

Fix `elementPlacementCells` (line 246): it called `elementCells(element, "collision")`. It now becomes:

```ts
export function elementPlacementCells(element: MapElement): { col: number; row: number }[] {
  const asset = editorAsset(element.assetId);
  if (!asset) return [];
  if (asset.editor.terrainOverride) return elementCells(element);
  // No collision footprint to stand on any more: an asset is placed on its anchor cell, and its
  // collider — if any — is checked as geometry, not as ground.
  return [{ col: element.col, row: element.row }];
}
```

Delete the second loop of `bakeElements` (lines 324-329, the `"grass" → "forest"` pass). Keep the `terrainOverride` pass. Update its doc comment:

```ts
/** The element pass. Walkable overrides still reclaim water in the grid, because that is a grid
 *  operation. Collision footprints are gone: an element's solidity is a sub-cell collider now
 *  (`elementWorldCollider`), carried on the geometry beside the tiles rather than burned into them. */
```

Change `terrainFromMap` (line 203) to build the index:

```ts
export function terrainFromMap(data: MapData): TerrainGeometry {
  const tiles = bakeCollision(data);
  const width = tiles.cols * TILE_SIZE;
  const height = tiles.rows * TILE_SIZE;
  return {
    width,
    height,
    obstacles: [],
    spawnPoints: [mapSpawnPoint(data)],
    safeZone: null,
    tiles,
    colliders: colliderIndexFrom(elementColliders(data.elements), tiles.cols, tiles.rows),
  };
}
```

- [ ] **Step 4: Wire the geometry and the junction**

In `src/shared/game.ts`, add to `TerrainGeometry` (after `tiles`, line 42):

```ts
  /**
   * The OTHER half of collision truth: sub-cell rectangles, for things that occupy part of a cell
   * (a tree trunk under a canopy). Required, not optional — a geometry silently missing its
   * colliders is a world where trees are walk-through, and TypeScript should refuse it at every
   * construction site rather than let one slip.
   */
  colliders: ColliderIndex;
```

Add `import { type ColliderIndex, emptyColliderIndex, overlapsCollider } from "./collider.js";`.

Replace `isWalkable`'s body (line 841):

```ts
export function isWalkable(
  position: Vec2,
  size: number = PLAYER_SIZE,
  geometry: TerrainGeometry = VERDANT_REACH_TERRAIN,
): boolean {
  if (!isWalkableBox(geometry.tiles, position, size)) return false;
  return !overlapsCollider(geometry.colliders, position, size);
}
```

Its doc comment already says it is "the single collision entry point" — extend it to say the two sources meet here and nowhere else.

Give `VERDANT_REACH_TERRAIN` and every other compiled zone geometry `colliders: emptyColliderIndex(<its tiles.cols>, <its tiles.rows>)`. Find them with the typecheck in the next step.

- [ ] **Step 5: Fix every construction site, then run**

Run: `npm run typecheck`
Expected: errors at every `TerrainGeometry` literal. Add `colliders: emptyColliderIndex(cols, rows)` to each, using that geometry's own tile dimensions. Compiled zones under `src/shared/zones.ts` and any test fixture are the expected list.

Then run: `npx vitest run test/shared/subcell-collision.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the whole suite**

Run: `npm run check`
Expected: PASS. If a `game.test.ts` assertion about a tree cell being solid fails, that is the intended behaviour change — update the assertion to check the trunk rather than the cell, and note it in the commit body.

- [ ] **Step 7: Commit**

```bash
git add src/shared/map-data.ts src/shared/game.ts src/shared/zones.ts \
  test/shared/subcell-collision.test.ts
git commit -m "feat: bake element colliders onto terrain geometry

Trees now block their trunk instead of a whole 64x64 cell. isWalkable is
still the one junction; the collider index rides TerrainGeometry so every
existing caller — prediction, movement, skills, monsters — picks it up."
```

---

### Task 5: Carry colliders over the wire

The client must receive the same colliders the server baked, never re-derive them. `elements` stays appearance-only.

**Files:**
- Modify: `src/shared/protocol.ts` (`WorldInfo` ~lines 270-309)
- Modify: `src/server/world.ts` (~line 711, where `tiles: encodeTileMap(...)` is built)
- Modify: `src/client/game/net.ts` (`geometryFrom` ~lines 300-309)
- Test: `test/shared/protocol-colliders.test.ts`

**Interfaces:**
- Produces:
  - `WorldInfo.colliders: readonly [number, number, number, number][]` — flat `[x, y, w, h]` tuples in world pixels.
  - `export function parseWorldColliders(value: unknown): Rect[] | null` in `protocol.ts`.

- [ ] **Step 1: Write the failing test**

Create `test/shared/protocol-colliders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseWorldColliders } from "../../src/shared/protocol.js";

describe("wire colliders", () => {
  it("parses well-formed tuples", () => {
    expect(parseWorldColliders([[1, 2, 3, 4]])).toEqual([
      { x: 1, y: 2, width: 3, height: 4 },
    ]);
  });

  it("accepts an empty list", () => {
    expect(parseWorldColliders([])).toEqual([]);
  });

  it("rejects a malformed payload rather than throwing", () => {
    expect(parseWorldColliders("nope")).toBeNull();
    expect(parseWorldColliders([[1, 2, 3]])).toBeNull();
    expect(parseWorldColliders([[1, 2, 3, "4"]])).toBeNull();
    expect(parseWorldColliders([[1, 2, 3, Number.NaN]])).toBeNull();
  });

  it("rejects more colliders than a map could hold", () => {
    const many = Array.from({ length: 401 }, () => [0, 0, 1, 1] as const);
    expect(parseWorldColliders(many)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shared/protocol-colliders.test.ts`
Expected: FAIL — `parseWorldColliders` is not exported.

- [ ] **Step 3: Add the field and the parser**

In `src/shared/protocol.ts`, add to `WorldInfo` beside `tiles`:

```ts
  /**
   * The second half of baked collision truth: sub-cell rectangles in world pixels, `[x, y, w, h]`.
   *
   * This does NOT weaken the appearance-only rule below. Collision is still baked server-side and
   * shipped as collision; it simply needs two structures now, because a tile grid cannot express a
   * tree trunk. `elements` remains appearance. A client that derived colliders from `elements`
   * would be a second, disagreeing bake — exactly the desync the baked contract exists to prevent.
   */
  colliders: readonly (readonly [number, number, number, number])[];
```

Extend the existing "appearance only — collision is already in `tiles` above" comment on `elements`/`layers`/`events` to read "already in `tiles` and `colliders` above".

Add the parser beside the other defensive parsers:

```ts
import { MAX_MAP_ELEMENTS } from "./map-data.js";

export function parseWorldColliders(value: unknown): Rect[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_MAP_ELEMENTS) return null;
  const parsed: Rect[] = [];
  for (const raw of value) {
    if (!Array.isArray(raw) || raw.length !== 4) return null;
    const [x, y, width, height] = raw;
    if (
      !Number.isFinite(x) || !Number.isFinite(y) ||
      !Number.isFinite(width) || !Number.isFinite(height)
    ) return null;
    parsed.push({
      x: x as number, y: y as number,
      width: width as number, height: height as number,
    });
  }
  return parsed;
}
```

Wherever `WorldInfo` itself is validated on arrival, call `parseWorldColliders` and drop the frame on `null`, matching how `tiles` is handled.

- [ ] **Step 4: Emit on the server**

In `src/server/world.ts` around line 711, beside `tiles: encodeTileMap(location.definition.terrain.tiles)`, add:

```ts
      colliders: flattenColliderIndex(location.definition.terrain.colliders),
```

Add `flattenColliderIndex` to `src/shared/collider.ts` (it is the inverse of `colliderIndexFrom`, and must de-duplicate, since a rect spanning cells is listed in several buckets):

```ts
/** The index back to a flat rect list, each rect once. The wire ships rects, not buckets: the
 *  receiver rebuilds its own index, so bucket layout never has to be a wire concern. */
export function flattenColliderIndex(
  index: ColliderIndex,
): [number, number, number, number][] {
  const seen = new Set<string>();
  const rects: [number, number, number, number][] = [];
  for (const bucket of index.buckets) {
    for (const rect of bucket) {
      const key = `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rects.push([rect.x, rect.y, rect.width, rect.height]);
    }
  }
  return rects;
}
```

- [ ] **Step 5: Decode on the client, and delete the temporary re-bake**

Task 4 made `TerrainGeometry.colliders` required before the wire could carry it, so `geometryFrom`
currently rebuilds the index from `world.elements` via the shared `elementColliders`. That was the
right stopgap — an empty index there would have been the silent desync — but it is a SECOND bake,
and this step is where it dies. Delete the `elementColliders(world.elements)` call and its imports;
the client must consume what the server baked, never re-derive it.

Restore the appearance-only contract in `protocol.ts` at the same time: Task 4 rewrote the comment
on `elements` to say it is now a collision source. With `colliders` on the wire that is false again —
`elements`, `layers` and `events` are all appearance, and collision is `tiles` plus `colliders`.

In `src/client/game/net.ts`, `geometryFrom` (~line 300):

```ts
    const tiles = decodeTileMap(world.tiles);
    return {
      width: tiles.cols * TILE_SIZE,
      height: tiles.rows * TILE_SIZE,
      obstacles: [],
      spawnPoints: [],
      safeZone: null,
      tiles,
      colliders: colliderIndexFrom(
        parseWorldColliders(world.colliders) ?? [],
        tiles.cols,
        tiles.rows,
      ),
    };
```

Keep the existing surrounding code; only add the `colliders` line and the imports.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run test/shared/protocol-colliders.test.ts && npm run check`
Expected: PASS. Existing protocol/resync integration tests must still pass — if one asserts an exact `WorldInfo` shape, add `colliders: []`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/protocol.ts src/shared/collider.ts src/server/world.ts \
  src/client/game/net.ts test/shared/protocol-colliders.test.ts
git commit -m "feat: ship baked sub-cell colliders in WorldInfo"
```

---

### Task 6: Teach the direct tile readers about colliders

Three consumers read `terrain.tiles` without going through `isWalkable`. Two must learn colliders; one deliberately must not.

**Files:**
- Modify: `src/shared/tilemap.ts` (`isPathWalkable` ~line 118)
- Modify: `src/server/world/monster-system.ts` (~line 214, the `isPathWalkable` call)
- Modify: `src/shared/directional-combat.ts` (`sweptProjectileTerrainImpact` ~lines 330-366)
- Test: `test/shared/subcell-sweep.test.ts`

**Interfaces:**
- Produces:
  - `isPathWalkable(map, from, to, size, colliders?: ColliderIndex): boolean` — optional fifth argument, so existing callers keep compiling and only the monster path opts in.
  - `sweptProjectileTerrainImpact(start, end, radius, tiles, colliders?: ColliderIndex): TerrainImpact | null`
  - `TerrainImpact.id` widens: cell impacts stay `` `${row}:${col}` ``, collider impacts become `` `c${index}` ``. `col`/`row` become optional.

- [ ] **Step 1: Write the failing test**

Create `test/shared/subcell-sweep.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { colliderIndexFrom, emptyColliderIndex } from "../../src/shared/collider.js";
import { sweptProjectileTerrainImpact } from "../../src/shared/directional-combat.js";
import { isPathWalkable, TILE_SIZE, type TileMap } from "../../src/shared/tilemap.js";

const COLS = 6;
const ROWS = 6;
const GRASS: TileMap = {
  cols: COLS,
  rows: ROWS,
  kinds: new Array(COLS * ROWS).fill("grass"),
};
const TRUNK = colliderIndexFrom(
  [{ x: 3 * TILE_SIZE + 24, y: 3 * TILE_SIZE + 24, width: 16, height: 16 }],
  COLS,
  ROWS,
);

describe("sub-cell sweeps", () => {
  it("stops a projectile on a trunk", () => {
    const hit = sweptProjectileTerrainImpact(
      { x: 0, y: 3 * TILE_SIZE + 32 },
      { x: 5 * TILE_SIZE, y: 3 * TILE_SIZE + 32 },
      4,
      GRASS,
      TRUNK,
    );
    expect(hit).not.toBeNull();
    expect(hit?.fraction).toBeGreaterThan(0);
    expect(hit?.fraction).toBeLessThan(1);
  });

  it("lets a projectile past the same cell above the trunk", () => {
    const hit = sweptProjectileTerrainImpact(
      { x: 0, y: 3 * TILE_SIZE + 4 },
      { x: 5 * TILE_SIZE, y: 3 * TILE_SIZE + 4 },
      2,
      GRASS,
      TRUNK,
    );
    expect(hit).toBeNull();
  });

  it("stops a monster body walking into a trunk", () => {
    expect(
      isPathWalkable(
        GRASS,
        { x: 0, y: 3 * TILE_SIZE + 24 },
        { x: 5 * TILE_SIZE, y: 3 * TILE_SIZE + 24 },
        32,
        TRUNK,
      ),
    ).toBe(false);
  });

  it("is unchanged without colliders", () => {
    expect(
      isPathWalkable(GRASS, { x: 0, y: 0 }, { x: 5 * TILE_SIZE, y: 0 }, 32,
        emptyColliderIndex(COLS, ROWS)),
    ).toBe(true);
    expect(isPathWalkable(GRASS, { x: 0, y: 0 }, { x: 5 * TILE_SIZE, y: 0 }, 32)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/shared/subcell-sweep.test.ts`
Expected: FAIL — both functions reject the extra argument.

- [ ] **Step 3: Extend `isPathWalkable`**

In `src/shared/tilemap.ts`, add the parameter and the check inside the existing midpoint loop:

```ts
export function isPathWalkable(
  map: TileMap,
  from: Vec2,
  to: Vec2,
  size: number,
  colliders?: ColliderIndex,
): boolean {
  // ... unchanged crossings setup ...
    const position = { x: from.x + dx * midpoint, y: from.y + dy * midpoint };
    if (!isWalkableBox(map, position, size)) return false;
    if (colliders && overlapsCollider(colliders, position, size)) return false;
  }
  return true;
}
```

Also add the collider rects' own edges to `crossings`. Without them, a collider narrower than a cell can sit entirely between two tile-boundary midpoints and be stepped over:

```ts
  if (colliders) {
    for (const rect of collidersOnSegment(colliders, from, to, size)) {
      addEdgeCrossings(crossings, from.x, dx, size, rect.x, rect.width);
      addEdgeCrossings(crossings, from.y, dy, size, rect.y, rect.height);
    }
  }
```

Add both helpers to `src/shared/collider.ts`:

```ts
/** Every rect in any bucket the segment's bounding box touches, each once. */
export function collidersOnSegment(
  index: ColliderIndex,
  from: Vec2,
  to: Vec2,
  size: number,
): Rect[] {
  const left = Math.max(0, Math.floor(Math.min(from.x, to.x) / TILE_SIZE));
  const top = Math.max(0, Math.floor(Math.min(from.y, to.y) / TILE_SIZE));
  const right = Math.min(
    index.cols - 1,
    Math.floor((Math.max(from.x, to.x) + size - 1) / TILE_SIZE),
  );
  const bottom = Math.min(
    index.rows - 1,
    Math.floor((Math.max(from.y, to.y) + size - 1) / TILE_SIZE),
  );
  const seen = new Set<Rect>();
  for (let row = top; row <= bottom; row++) {
    for (let col = left; col <= right; col++) {
      for (const rect of index.buckets[row * index.cols + col] ?? []) seen.add(rect);
    }
  }
  return [...seen];
}

/** The `t` values where a moving body's near and far edges cross a rect's near and far edges. */
export function addEdgeCrossings(
  into: number[],
  origin: number,
  delta: number,
  size: number,
  rectStart: number,
  rectLength: number,
): void {
  if (!Number.isFinite(origin) || !Number.isFinite(delta) || delta === 0) return;
  for (const boundary of [rectStart, rectStart + rectLength]) {
    for (const edge of [0, size - 1]) {
      const t = (boundary - (origin + edge)) / delta;
      if (t > 0 && t < 1) into.push(t);
    }
  }
}
```

In `src/server/world/monster-system.ts` line ~214, pass the geometry's colliders as the fifth argument.

- [ ] **Step 4: Extend the projectile sweep**

In `src/shared/directional-combat.ts`, after the existing per-cell loop in `sweptProjectileTerrainImpact`, sweep the colliders with the same `segmentAabbEntry` the cells already use, dilated by the radius:

```ts
  if (colliders) {
    const candidates = collidersOnSegment(colliders, start, end, radius * 2);
    for (let index = 0; index < candidates.length; index++) {
      const rect = candidates[index];
      if (!rect) continue;
      const entry = segmentAabbEntry(
        start, end,
        rect.x - radius, rect.y - radius,
        rect.x + rect.width + radius, rect.y + rect.height + radius,
      );
      if (entry === null) continue;
      if (nearest === null || entry.fraction < nearest.fraction) {
        nearest = { fraction: entry.fraction, point: entry.point, kind: "terrain", id: `c${index}` };
      }
    }
  }
```

Adapt to the function's existing local variable names — keep whatever accumulator it already uses for the nearest cell impact rather than introducing a second one. Make `col`/`row` optional on `TerrainImpact` and check the two or three places that read them (grep `\.col` near `TerrainImpact`).

Update the caller in `src/server/world/projectile-system.ts` (~line 191) to pass `context.terrain.colliders`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/shared/subcell-sweep.test.ts && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/tilemap.ts src/shared/collider.ts src/shared/directional-combat.ts \
  src/server/world/monster-system.ts src/server/world/projectile-system.ts \
  test/shared/subcell-sweep.test.ts
git commit -m "feat: sweep sub-cell colliders for monster paths and projectiles

hasLineOfSight stays tile-only on purpose: it tests centres, not bodies,
and it is an AI heuristic rather than damage truth."
```

---

### Task 7: Prove client and server agree

The load-bearing task of the whole tranche. Prediction is only correct because both sides run the
identical collision code; a collider the client applies and the server does not (or vice versa)
would not throw, would not log, and would simply draw your square short of where the server put it.

**Files:**
- Modify: `test/prediction.test.ts`
- Modify: `test/world.test.ts` (or whichever file owns the real Durable Object harness — grep for
  `awayFromNearestWall`)
- Modify: `test/db.test.ts`

**Interfaces:**
- Consumes: everything through Task 6. Adds no production code.

- [ ] **Step 1: Add the prediction assertion**

In `test/prediction.test.ts`, beside the existing "replaying commands over a stale position lands
exactly where the server lands" test, add the same assertion against a geometry whose only obstacle
is a sub-cell collider:

```ts
it("replays commands identically against a sub-cell collider", () => {
  // All grass, one 16x16 rect in the middle of cell (2,2): nothing in `tiles` blocks anything, so
  // if the two sides disagree it can only be about the collider.
  const cols = 5;
  const rows = 5;
  const terrain = {
    width: cols * TILE_SIZE,
    height: rows * TILE_SIZE,
    obstacles: [],
    spawnPoints: [],
    safeZone: null,
    tiles: { cols, rows, kinds: new Array(cols * rows).fill("grass" as const) },
    colliders: colliderIndexFrom(
      [{ x: 2 * TILE_SIZE + 24, y: 2 * TILE_SIZE + 24, width: 16, height: 16 }],
      cols,
      rows,
    ),
  };
  const start = { x: TILE_SIZE, y: 2 * TILE_SIZE + 24 };
  const commands = Array.from({ length: 12 }, (_, index) => ({
    seq: index + 1,
    input: { x: 1, y: 0 },
  }));

  // The "server": apply every command authoritatively.
  let server = start;
  for (const command of commands) {
    server = resolveTerrain(server, step(server, command.input, TICK_DT, PLAYER_SPEED, terrain), terrain);
  }

  // The "client": reconcile from the stale start and replay the same pending commands.
  const client = reconcile(start, start, commands, "alive", terrain);

  expect(client.x).toBeCloseTo(server.x, 6);
  expect(client.y).toBeCloseTo(server.y, 6);
  // And the collider actually did something, or this test proves nothing.
  expect(server.x).toBeLessThan(2 * TILE_SIZE + 24);
});
```

Adapt `reconcile`'s argument list to its real signature (read `src/shared/prediction.ts`) — the
shape of the assertion is what matters: same inputs, same geometry, identical landing point, and a
guard that the collider was in the way at all.

- [ ] **Step 2: Run it**

Run: `npx vitest run test/prediction.test.ts`
Expected: PASS. If the two sides differ, a caller is bypassing `isWalkable` — find it before going on.

- [ ] **Step 3: Add the authoritative flow test**

In the real Durable Object harness, add a test that connects a player onto a map carrying one tree,
sends movement commands straight at the trunk, and asserts on the server's own snapshot that the
player stopped short of it — then a second player walking at the same cell but offset above the
trunk passes through. Follow the file's existing conventions: assert on *which* player ids are
present, never on how many (the object is a singleton across the file), and use
`awayFromNearestWall()` for any spawn-relative arithmetic.

- [ ] **Step 4: Add the D1 round-trip**

In `test/db.test.ts`, save a map containing an element with `offsetX: 3, offsetY: 2`, read it back,
and assert both offsets survived. The file truncates in `afterEach`; do not reach for `reset()` from
`cloudflare:test`, which wipes Durable Object storage too.

- [ ] **Step 5: Run the whole suite**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add test/
git commit -m "test: pin client/server agreement on sub-cell collision"
```

---

### Task 7b: Persist element offsets in D1

Added mid-execution. Task 3 put `offsetX`/`offsetY` on `MapElement` and the wire, but the `map_element`
D1 table has no offset columns and `elementsOf` reads them back as a hardcoded `0`. So an authored
offset is lost the moment the map is saved — the core of the Element-mode feature is broken at the
persistence boundary. This task closes it. **User decision:** the offset is part of the row's
identity — the primary key becomes `(mapId, col, row, offsetX, offsetY)`, so up to 16 decorations can
share a cell at different quarter positions.

**Files:**
- Modify: `src/server/db/schema.ts` (`mapElement`, ~line 304)
- Create: `migrations/NNNN_*.sql` (generated, committed)
- Modify: `src/server/maps.ts` (`elementsOf` ~458, `elementRows` ~619, `MAP_ELEMENT_PARAMS_PER_ROW` ~640)
- Test: `test/db.test.ts`

**Interfaces:**
- Consumes: `MapElement.offsetX/offsetY` (Task 3).
- Produces: no new exported symbol; the D1 boundary now round-trips offsets instead of zeroing them.

- [ ] **Step 1: Write the failing test**

In `test/db.test.ts`, following the file's existing map-save/read conventions (it truncates in
`afterEach`; never call `reset()` from `cloudflare:test`):

```ts
it("round-trips element offsets through D1", async () => {
  // save a map with an element at offsetX: 3, offsetY: 2, read it back, assert both survived.
});

it("keeps two elements in one cell at different offsets", async () => {
  // two elements sharing col/row but differing in offsetX/offsetY both persist — the PK change.
  // Assert the read-back contains both, matched by their offsets, not by count alone.
});
```

Fill both bodies against the real save/read helpers already in `test/db.test.ts`. Do not leave them
as comments.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/db.test.ts -t "offset"`
Expected: FAIL — offsets read back as 0, and the same-cell pair collides on the old PK.

- [ ] **Step 3: Change the schema**

In `src/server/db/schema.ts`, add to `mapElement` after `row`:

```ts
    offsetX: integer("offset_x").notNull().default(0),
    offsetY: integer("offset_y").notNull().default(0),
```

and change the primary key to `primaryKey({ columns: [table.mapId, table.col, table.row, table.offsetX, table.offsetY] })`.
Update the table's doc comment: the offset is now part of the row identity, and a cell can hold up
to `ELEMENT_OFFSET_STEPS²` = 16 decorations.

- [ ] **Step 4: Generate and apply the migration**

Run: `npm run db:generate` — inspect the emitted `migrations/NNNN_*.sql`. SQLite cannot ALTER a
primary key, so drizzle-kit emits a table rebuild (create new, copy, drop, rename). Confirm the copy
carries `offset_x`/`offset_y` defaulting to 0 for existing rows, and that no existing row set can
collide under the new PK (the old PK `(map,col,row)` was already unique, and `(…,0,0)` preserves
that). Then `npm run db:migrate`. Do NOT run `cf-typegen` — this is a table change, not a binding
change. Commit the generated `.sql`.

- [ ] **Step 5: Write and read the columns**

In `src/server/maps.ts`:
- `elementRows` (~619): add `offsetX: element.offsetX, offsetY: element.offsetY`.
- `elementsOf` (~458): replace both hardcoded `offsetX: 0, offsetY: 0` with `row.offsetX`/`row.offsetY`,
  and rewrite the "no offset columns yet" comment — the columns exist now.
- `MAP_ELEMENT_PARAMS_PER_ROW` (~640): `5` → `7`, and update its inline comment and the block comment
  above it (`mapId, col, row, offsetX, offsetY, kind, variant`). The chunk size auto-derives; confirm
  it stays comfortably under the cap.

The write path is delete-then-insert (`clearElements` at ~889 wipes the map's element rows before
`insertElementStatements` rewrites them), so the PK widening needs no conflict-target change.

- [ ] **Step 6: Run the tests**

Run: `npm run check`
Expected: PASS, including the two new round-trip tests. If a fixture elsewhere inserts a `map_element`
row directly, it now gets `offset_x`/`offset_y` defaults for free — no change needed unless it asserts
the old column set.

- [ ] **Step 7: Commit**

```bash
git add src/server/db/schema.ts migrations/ src/server/maps.ts test/db.test.ts
git commit -m "feat: persist element quarter-tile offsets in D1"
```

---

### Task 8: Render the offset

One shared anchor, so the editor stage and the game renderer cannot drift.

**Files:**
- Modify: `src/client/game/catalog-element-render.ts:24-25`
- Test: `test/client/catalog-element-offset.test.ts`

**Interfaces:**
- Consumes: `MapElement.offsetX/offsetY`, `ELEMENT_OFFSET_PX` (Task 3).
- Produces: `createCatalogElementView` unchanged in signature; its returned `x`/`y` now include the offset.

- [ ] **Step 1: Write the failing test**

Create `test/client/catalog-element-offset.test.ts` (follow the existing client test setup — check an existing file under `test/client/` or `test/ui/` for the PixiJS/jsdom harness and mirror it):

```ts
import { describe, expect, it } from "vitest";
import { createCatalogElementView } from "../../src/client/game/catalog-element-render.js";
import { ELEMENT_OFFSET_PX } from "../../src/shared/map-data.js";
import { stubEditorAssetArt } from "./helpers/editor-asset-art-stub.js";

describe("element render offset", () => {
  it("shifts the anchor by a quarter tile per offset step", () => {
    const art = stubEditorAssetArt("resource.terrain-resources-wood-trees.tree3");
    const aligned = createCatalogElementView(
      { col: 2, row: 2, offsetX: 0, offsetY: 0, assetId: art.definition.id }, art,
    );
    const shifted = createCatalogElementView(
      { col: 2, row: 2, offsetX: 2, offsetY: 3, assetId: art.definition.id }, art,
    );
    expect(aligned).not.toBeNull();
    expect(shifted).not.toBeNull();
    if (!aligned || !shifted) return;
    expect(shifted.x - aligned.x).toBe(2 * ELEMENT_OFFSET_PX);
    expect(shifted.y - aligned.y).toBe(3 * ELEMENT_OFFSET_PX);
  });
});
```

Write `test/client/helpers/editor-asset-art-stub.ts` returning `{ definition: editorAsset(id), frames: [Texture.EMPTY] }` shaped to `EditorAssetArt`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/client/catalog-element-offset.test.ts`
Expected: FAIL — both views share the same `x`/`y`.

- [ ] **Step 3: Add the offset**

In `src/client/game/catalog-element-render.ts`, replace lines 24-25:

```ts
  const x =
    element.col * TILE_SIZE + TILE_SIZE / 2 + element.offsetX * ELEMENT_OFFSET_PX;
  const y =
    (element.row + 1) * TILE_SIZE +
    art.definition.footOffset +
    element.offsetY * ELEMENT_OFFSET_PX;
```

Import `ELEMENT_OFFSET_PX` from `../../shared/map-data.js`. Add to the function's doc comment: this arithmetic is duplicated by `elementWorldCollider` in `map-data.ts` on purpose (shared cannot import client), and the two must be changed together or a collider stops sitting under its sprite.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run test/client/catalog-element-offset.test.ts && npm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/game/catalog-element-render.ts test/client/
git commit -m "feat: render element quarter-tile offsets"
```

---

### Task 9: `activeMode` replaces `activeLayer` in editor state

**Files:**
- Modify: `src/client/game/editor-state.ts` (`EditorHistory.activeLayer` ~line 157, `setActiveLayer` ~line 183, `applyTool` ~lines 789-1011, the eraser branch ~lines 917-935)
- Modify: `src/client/game/map-editor-stage.ts` (~lines 129-134, 772, 830, 1059-1062)
- Test: `test/client/editor-modes.test.ts`

**Interfaces:**
- Produces:
  - `export type EditorMode = "field" | "element" | "event"`
  - `EditorHistory.activeMode: EditorMode` (replacing `activeLayer`)
  - `export function setActiveMode(history: EditorHistory, mode: EditorMode): EditorHistory`
  - Stage handle: `setActiveMode(mode: EditorMode): void` (replacing `setActiveLayer`)

- [ ] **Step 1: Write the failing test**

Create `test/client/editor-modes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyTool, blankMap, setActiveMode } from "../../src/client/game/editor-state.js";

const TREE = "resource.terrain-resources-wood-trees.tree3";
const CELL = { col: 2, row: 2 };
const ERASER = { kind: "eraser" } as const;

/** A grass map carrying one tree and one event on the same cell, so each test can prove that the
 *  eraser took EXACTLY the collection its mode owns and left the other two alone. */
function loaded() {
  const map = withEvent(withElement(grassMap(), CELL, TREE), CELL);
  return { map, history: setActiveMode(historyFor(map), "field") };
}

function groundIdAt(map: EditorMap, col: number, row: number): number {
  return map.layers[0]?.ids[row * map.cols + col] ?? 0;
}

describe("editor modes", () => {
  it("erases only elements in element mode, never the terrain beneath", () => {
    const { map, history } = loaded();
    const next = applyTool(map, setActiveMode(history, "element"), ERASER, CELL.col, CELL.row, true);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.elements).toHaveLength(0);
    expect(groundIdAt(next, CELL.col, CELL.row)).toBe(groundIdAt(map, CELL.col, CELL.row));
    expect(next.events).toHaveLength(1);
  });

  it("erases only terrain in field mode, leaving an element standing", () => {
    const { map, history } = loaded();
    const next = applyTool(map, setActiveMode(history, "field"), ERASER, CELL.col, CELL.row, true);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(groundIdAt(next, CELL.col, CELL.row)).toBe(0);
    expect(next.elements).toHaveLength(1);
    expect(next.events).toHaveLength(1);
  });

  it("erases only events in event mode", () => {
    const { map, history } = loaded();
    const next = applyTool(map, setActiveMode(history, "event"), ERASER, CELL.col, CELL.row, true);
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.events).toHaveLength(0);
    expect(next.elements).toHaveLength(1);
    expect(groundIdAt(next, CELL.col, CELL.row)).toBe(groundIdAt(map, CELL.col, CELL.row));
  });

  it("refuses a tool that does not belong to the active mode", () => {
    const { map, history } = loaded();
    const place = { kind: "element", assetId: TREE } as const;
    expect(applyTool(map, setActiveMode(history, "field"), place, 3, 3, true)).toBeNull();
  });

  it("does not smear across a drag", () => {
    // The existing !isStrokeStart guard must survive the rewrite.
    const { map, history } = loaded();
    expect(applyTool(map, setActiveMode(history, "element"), ERASER, CELL.col, CELL.row, false))
      .toBeNull();
  });
});
```

`grassMap`, `withElement`, `withEvent` and `historyFor` are small local fixtures — write them against
the real `blankMap`/`EditorMap` shape by mirroring the setup an existing editor-state test already
uses, and adjust `applyTool`'s argument order to its real signature. The assertions above are the
contract and must not be weakened; only the fixture plumbing is yours to adapt.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/client/editor-modes.test.ts`
Expected: FAIL — `setActiveMode` is not exported.

- [ ] **Step 3: Rename the state**

In `src/client/game/editor-state.ts`:

- Replace `activeLayer: 0 | 1 | 2` on `EditorHistory` with `activeMode: EditorMode`, keeping the existing comment explaining why it lives on the history rather than on `EditorMap` (it must survive undo/redo).
- Rename `setActiveLayer` to `setActiveMode`, same no-undo-entry behaviour.
- `blankMap`/initial history default to `"field"`.

- [ ] **Step 4: Make the eraser mode-scoped**

Replace the eraser branch (lines ~917-935) with:

```ts
    case "eraser": {
      // Mode-scoped, not cascading. The old order (event, then element, then terrain) meant an
      // eraser stroke aimed at a bush could silently take the ground out from under it once the
      // bush was gone. A mode owns exactly one collection, so the eraser can only take from that.
      if (!isStrokeStart) return null;
      switch (history.activeMode) {
        case "event":
          return erasedEvent(map, col, row);
        case "element":
          return erasedElement(map, col, row);
        case "field":
          return { ...map, layers: erasedTerrain(map, col, row) };
      }
    }
```

Split the existing cascading body into `erasedEvent` / `erasedElement` helpers rather than writing new logic — the per-collection removal code already exists inline, only the dispatch changes. Delete `eraseOnLayer` and its call site: no mode targets layer 1 or 2 any more.

- [ ] **Step 5: Gate the other tools by mode**

At the top of `applyTool`, before the switch:

```ts
  // A tool belongs to exactly one mode. Reaching applyTool with a mismatched pair means the UI let
  // a stale tool survive a mode switch; drop the stroke rather than write to a collection the
  // author is not looking at.
  if (!toolAllowedInMode(tool, history.activeMode)) return null;
```

```ts
const MODE_TOOLS: Record<EditorMode, readonly EditorTool["kind"][]> = {
  field: ["block", "elevation", "rect", "fill", "stairs", "spawn", "eraser", "select", "pan"],
  element: ["element", "eraser", "select", "pan"],
  event: ["event", "eraser", "select", "pan"],
};

export function toolAllowedInMode(tool: EditorTool, mode: EditorMode): boolean {
  return MODE_TOOLS[mode].includes(tool.kind);
}
```

Leave the layer targeting of `block`/`elevation`/`rect`/`fill`/`stairs` exactly as it is — they still write layer 0 and layer 1 by their own rules. Delete only the `activeLayer` reads.

- [ ] **Step 6: Update the stage**

In `src/client/game/map-editor-stage.ts`:

- `setActiveLayer(layer)` on the handle becomes `setActiveMode(mode)`, calling `setActiveMode(history, mode)`.
- `applyLayerDim(tileLayers, layer, dim)` (~line 129) becomes `applyModeDim(tileLayers, elementContainers, eventOverlay, mode, dim)`: in Field mode dim the element and event overlays; in Element mode dim the tile layers and the event overlay; in Event mode dim the tile layers and the element containers. Same `DIM_ALPHA`.
- The hover path (~line 772) and `applyTool` call (~line 830) read `activeMode` instead of `activeLayer`.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/client/editor-modes.test.ts && npm run typecheck`
Expected: the editor-state tests PASS. `AdventureEditorScreen.tsx` and the three chrome components still reference `activeLayer` — that is Task 10. Commit anyway only if typecheck is clean; if it is not, do Task 10 before committing and use one commit for both.

- [ ] **Step 8: Commit**

```bash
git add src/client/game/editor-state.ts src/client/game/map-editor-stage.ts \
  test/client/editor-modes.test.ts
git commit -m "feat: replace editor activeLayer with Field/Element/Event mode"
```

---

### Task 10: The segmented control and the chrome

**Files:**
- Create: `src/client/ui/editor/EditorModeControl.tsx`
- Modify: `src/client/ui/editor/EditorToolbar.tsx:46` (`LAYERS`), `:130-152` (the pill group)
- Modify: `src/client/ui/editor/EditorMenuBar.tsx:118-133` (the "Mode" menu)
- Modify: `src/client/ui/editor/EditorStatusBar.tsx:50`
- Modify: `src/client/ui/editor/AdventureEditorScreen.tsx:264` (`pendingLayerRef`), `:287` (state), `:571` (`selectLayer`), `:808-879` (shortcuts), `:965`/`:977`/`:986` (props)
- Modify: `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts`
- Test: `test/ui/editor-mode-control.test.tsx`

**Interfaces:**
- Consumes: `EditorMode`, the stage handle's `setActiveMode` (Task 9).
- Produces: `<EditorModeControl mode={EditorMode} onSelect={(mode: EditorMode) => void} />`

- [ ] **Step 1: Add the shadcn primitive**

Check whether `src/client/ui/components/toggle-group.tsx` exists. If not:

```bash
npm run ui:add -- toggle-group && npm run lint:fix
```

Do **not** run `npx shadcn@latest add` — it resolves aliases only from a file literally named `tsconfig.json` and this repo's paths live in `tsconfig.client.json`.

- [ ] **Step 2: Add the i18n keys**

In `src/shared/i18n/en.ts`, remove `editor.shell.layer`, `editor.shell.events` and `editor.shell.events.short`; add:

```ts
  "editor.shell.mode.field": "Field",
  "editor.shell.mode.element": "Element",
  "editor.shell.mode.event": "Event",
  "editor.shell.mode.label": "Layer",
```

In `src/shared/i18n/fr.ts`:

```ts
  "editor.shell.mode.field": "Terrain",
  "editor.shell.mode.element": "Élément",
  "editor.shell.mode.event": "Événement",
  "editor.shell.mode.label": "Calque",
```

Grep for the removed keys and fix every use before moving on. The i18n parity test will catch a miss.

- [ ] **Step 3: Write the failing test**

Create `test/ui/editor-mode-control.test.tsx` (mirror the harness an existing `test/ui/` test uses — the suite runs with `css: false`):

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditorModeControl } from "../../src/client/ui/editor/EditorModeControl.js";

describe("EditorModeControl", () => {
  it("marks the active mode pressed", () => {
    render(<EditorModeControl mode="element" onSelect={() => {}} />);
    expect(screen.getByRole("radio", { name: /element|élément/i })).toBeChecked();
  });

  it("reports a selection", () => {
    const onSelect = vi.fn();
    render(<EditorModeControl mode="field" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("radio", { name: /event|événement/i }));
    expect(onSelect).toHaveBeenCalledWith("event");
  });

  it("never reports a deselection", () => {
    // A segmented control has no empty state: clicking the active segment is a no-op.
    const onSelect = vi.fn();
    render(<EditorModeControl mode="field" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("radio", { name: /field|terrain/i }));
    expect(onSelect).not.toHaveBeenCalledWith(undefined);
  });
});
```

Adjust `getByRole` to whatever role the generated `toggle-group` actually renders (`radio` for `type="single"`, otherwise `button` with `aria-pressed`) — read the generated file and match it.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run test/ui/editor-mode-control.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 5: Write the control**

Create `src/client/ui/editor/EditorModeControl.tsx`:

```tsx
import type { EditorMode } from "../../game/editor-state.js";
import { t } from "../../i18n.js";
import { ToggleGroup, ToggleGroupItem } from "../components/toggle-group.js";

const MODES: readonly EditorMode[] = ["field", "element", "event"];

/** The editor's one mode selector. A mode owns a collection — tiles, elements or events — so this
 *  is not the old layer pill renamed: `activeLayer` only ever moved the eraser. */
export function EditorModeControl({
  mode,
  onSelect,
}: {
  mode: EditorMode;
  onSelect: (mode: EditorMode) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(next) => {
        // A segmented control has no empty state; Radix reports "" when the active item is clicked.
        if (next) onSelect(next as EditorMode);
      }}
      aria-label={t("editor.shell.mode.label")}
    >
      {MODES.map((value) => (
        <ToggleGroupItem key={value} value={value} aria-label={t(`editor.shell.mode.${value}`)}>
          {t(`editor.shell.mode.${value}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
```

- [ ] **Step 6: Replace the pill and rename the screen state**

In `EditorToolbar.tsx`: delete `LAYERS` (line 46) and the whole pill `<div>` (lines 130-152); render `<EditorModeControl mode={mode} onSelect={onSelectMode} />` in its place. Replace the `activeLayer`/`onSelectLayer`/`eventActive`/`onSelectEvents` props with `mode`/`onSelectMode`.

In `EditorMenuBar.tsx` (lines 118-133): the "Mode" menu becomes three items calling `onSelectMode("field"|"element"|"event")`, no separator, no "Événements" entry.

In `EditorStatusBar.tsx` line 50: show `t(`editor.shell.mode.${mode}`)` instead of the layer number.

In `AdventureEditorScreen.tsx`: rename `pendingLayerRef` → `pendingModeRef`, the `useState<0|1|2>(0)` → `useState<EditorMode>("field")`, and `selectLayer` → `selectMode`:

```ts
  function selectMode(mode: EditorMode): void {
    pendingModeRef.current = mode;
    setActiveMode(mode);
    handleRef.current?.setActiveMode(mode);
  }
```

Delete `selectEvents` (line 531) — Event is a mode now, not a tool toggle. Where it set the event tool, `selectMode("event")` plus the existing default-tool-for-mode selection covers it.

- [ ] **Step 7: Rebind the shortcuts**

In the keyboard handler (lines 851-859), `1`/`2`/`3` now call `selectMode("field")`, `selectMode("element")`, `selectMode("event")`. Leave every other binding and every guard (dialog open, `data-slot="dialog-content"`, INPUT/TEXTAREA/SELECT, modifier keys) untouched.

When the mode changes, reset the active tool to that mode's default — `pencil` for Field, the element placement tool for Element, the event tool for Event — so a Field-only tool never survives into Element mode and gets dropped by `toolAllowedInMode`.

- [ ] **Step 8: Run the tests**

Run: `npm run check`
Expected: PASS, including the i18n parity test.

- [ ] **Step 9: Verify in a browser**

Run `npm run dev`, open the editor. Confirm: three segments, the active one visibly selected; `1`/`2`/`3` switch modes; the status bar follows; the segments render as stock shadcn (grey/neutral), **not** as green Tiny Swords pills. The UI suite runs with `css: false`, so no test can catch that last one. If they are green, the `legacy.css` fence is the cause — see the `:not(:where([data-slot], .editor-root *))` rule.

- [ ] **Step 10: Commit**

```bash
git add src/client/ui/editor/ src/client/ui/components/ src/shared/i18n/ test/ui/
git commit -m "feat: segmented Field/Element/Event control in the editor chrome"
```

---

### Task 11: The mode-scoped sidebar

**Files:**
- Create: `src/client/ui/editor/ElementPalette.tsx`
- Create: `src/client/ui/editor/EventPalette.tsx`
- Modify: `src/client/ui/editor/TerrainPalette.tsx` (drop `eventMode` and the Décor section; keep the Field body)
- Modify: `src/client/ui/editor/AdventureEditorScreen.tsx:1001-1022` (the palette render)
- Test: `test/ui/editor-palette-modes.test.tsx`

**Interfaces:**
- Consumes: `EditorMode` (Task 9).
- Produces: three palettes, each taking only the props its own mode needs. `TerrainPalette` no longer takes `eventMode`, `elementCount` or any catalogue prop.

- [ ] **Step 1: Write the failing test**

Create `test/ui/editor-palette-modes.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditorPalette } from "../../src/client/ui/editor/EditorPalette.js";

describe("mode-scoped palette", () => {
  it("shows terrain controls and no catalogue in field mode", () => {
    render(<EditorPalette mode="field" {...fieldProps()} />);
    expect(screen.getByRole("button", { name: /grass|herbe/i })).toBeInTheDocument();
    expect(screen.queryByTestId("catalogue-picker")).toBeNull();
  });

  it("shows the catalogue and the element counter in element mode", () => {
    render(<EditorPalette mode="element" {...elementProps()} />);
    expect(screen.getByTestId("catalogue-picker")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /grass|herbe/i })).toBeNull();
  });

  it("shows event kinds in event mode", () => {
    render(<EditorPalette mode="event" {...eventProps()} />);
    expect(screen.getByTestId("event-kinds")).toBeInTheDocument();
  });
});
```

Write the three prop factories against the real component props. Add the `data-testid` attributes to `CatalogueAssetPicker`'s root and the event-kind group as part of Step 3.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/ui/editor-palette-modes.test.tsx`
Expected: FAIL — `EditorPalette` does not exist.

- [ ] **Step 3: Split the palette**

Move `TerrainPalette.tsx`'s event body (lines ~114-177) into `EventPalette.tsx` verbatim, taking only its own props. Move the "Décor" section (the `{elementCount}/{MAX_MAP_ELEMENTS}` counter and `CatalogueAssetPicker`) into `ElementPalette.tsx`. `TerrainPalette` keeps grass/water, elevation, stairs and spawn, and loses its `eventMode` prop entirely.

Add the thin dispatcher `src/client/ui/editor/EditorPalette.tsx`:

```tsx
export function EditorPalette({ mode, ...props }: EditorPaletteProps) {
  switch (mode) {
    case "field":
      return <TerrainPalette {...props.field} />;
    case "element":
      return <ElementPalette {...props.element} />;
    case "event":
      return <EventPalette {...props.event} />;
  }
}
```

Update `AdventureEditorScreen.tsx:1001-1022` to render `<EditorPalette mode={activeMode} …/>`.

- [ ] **Step 4: Run the tests**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 5: Verify in a browser**

Run `npm run dev`. Switch modes and confirm the sidebar swaps and that nothing in it renders as Tiny Swords chrome.

- [ ] **Step 6: Commit**

```bash
git add src/client/ui/editor/ test/ui/
git commit -m "feat: split the editor sidebar into mode-scoped palettes"
```

---

### Task 12: Quarter-cell placement and the offset inspector

**Files:**
- Modify: `src/client/game/map-editor-stage.ts` (the hover/pointer path ~line 772, the grid overlay)
- Modify: `src/client/game/editor-state.ts` (the `element` branch of `applyTool`)
- Modify: `src/client/ui/editor/AdventureEditorScreen.tsx` (the selection inspector)
- Test: `test/client/quarter-cell-placement.test.ts`

**Interfaces:**
- Produces: `export function quarterCellAt(x: number, y: number): { col, row, offsetX, offsetY }` in `src/shared/map-data.ts`.

- [ ] **Step 1: Write the failing test**

Create `test/client/quarter-cell-placement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ELEMENT_OFFSET_PX, quarterCellAt } from "../../src/shared/map-data.js";
import { TILE_SIZE } from "../../src/shared/tilemap.js";

describe("quarter-cell quantisation", () => {
  it("splits a cell into four steps per axis", () => {
    expect(quarterCellAt(0, 0)).toEqual({ col: 0, row: 0, offsetX: 0, offsetY: 0 });
    expect(quarterCellAt(TILE_SIZE - 1, 0)).toEqual({ col: 0, row: 0, offsetX: 3, offsetY: 0 });
    expect(quarterCellAt(TILE_SIZE, 0)).toEqual({ col: 1, row: 0, offsetX: 0, offsetY: 0 });
  });

  it("round-trips back to the quantised pixel", () => {
    for (let px = 0; px < TILE_SIZE * 3; px += 7) {
      const q = quarterCellAt(px, px);
      const back = q.col * TILE_SIZE + q.offsetX * ELEMENT_OFFSET_PX;
      expect(back).toBeLessThanOrEqual(px);
      expect(px - back).toBeLessThan(ELEMENT_OFFSET_PX);
    }
  });

  it("clamps negatives to the origin cell rather than producing a negative offset", () => {
    expect(quarterCellAt(-1, -1)).toEqual({ col: -1, row: -1, offsetX: 3, offsetY: 3 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/client/quarter-cell-placement.test.ts`
Expected: FAIL — `quarterCellAt` is not exported.

- [ ] **Step 3: Add the quantiser**

In `src/shared/map-data.ts`:

```ts
/** A world pixel to the cell and quarter-step it lands in. `Math.floor` on both, so a negative
 *  pixel yields a negative col with a non-negative offset rather than a negative offset. */
export function quarterCellAt(
  x: number,
  y: number,
): { col: number; row: number; offsetX: number; offsetY: number } {
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);
  return {
    col,
    row,
    offsetX: Math.floor((x - col * TILE_SIZE) / ELEMENT_OFFSET_PX),
    offsetY: Math.floor((y - row * TILE_SIZE) / ELEMENT_OFFSET_PX),
  };
}
```

- [ ] **Step 4: Use it in the stage**

In `map-editor-stage.ts`, the pointer handler currently derives `col`/`row` by flooring on `TILE_SIZE`. In Element mode, call `quarterCellAt` and pass all four numbers to `applyTool`; in Field and Event modes keep the existing whole-cell derivation, so those two stay grid-forced. The hover preview sprite in Element mode positions at the quantised pixel, not the cell corner.

Draw quarter sub-divisions on the grid overlay in Element mode only, at a lower alpha than the cell lines.

In `editor-state.ts`, the `element` branch of `applyTool` writes `offsetX`/`offsetY` into the new `MapElement` instead of defaulting them to 0.

- [ ] **Step 5: Add the inspector fields**

In the selection inspector in `AdventureEditorScreen.tsx`, when the selection is an element show four stock shadcn number `Input`s — col, row, offsetX, offsetY — with offsets bounded `min={0} max={3} step={1}`. Editing one pushes a normal history entry, so undo works. Remember the inspector floats over the pointer-transparent `.editor-body`, so it must re-enable pointer events on itself (`.editor-chrome`).

- [ ] **Step 6: Run the tests**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 7: Verify in a browser**

Run `npm run dev`. In Element mode, place two trees a quarter cell apart and confirm the sprites are 16 px apart, the sub-grid is visible, and switching to Field mode restores whole-cell snapping. Then run the map in-game (Tester) and walk between two offset trees: you should pass between the trunks and be blocked by each trunk.

- [ ] **Step 8: Commit**

```bash
git add src/shared/map-data.ts src/client/game/ src/client/ui/editor/ test/client/
git commit -m "feat: quarter-cell element placement and offset inspector"
```

---

### Task 12b: Stack multiple decorations per cell

Added mid-execution. Task 7b widened the D1 primary key to `(mapId, col, row, offsetX, offsetY)` so
up to 16 decorations can share a cell, but editor placement still keys element identity on `(col,
row)` — placing in an occupied cell REPLACES, and `elementsOverlap` (visual footprint) rejects any
two elements sharing a cell. So the 16-per-cell capacity is reachable in D1 but not through the
editor. **User decision:** the editor should let decorations stack in a cell at different offsets.

The change couples five seams — placement, selection identity, the inspector, the stage highlight,
the eraser — because the selection descriptor `{kind:"element", col, row}` cannot tell two stacked
elements apart. All must move together.

**Design decisions (flag to the user if any looks wrong, do not silently vary):**
- **Identity becomes the full 4-tuple** `(col, row, offsetX, offsetY)`. Placing at a sub-position that
  is empty ADDS; placing at one already occupied by the same sub-position REPLACES only that one.
- **The visual-footprint overlap rejection is dropped.** Decorations may overlap visually — that is
  the point of stacking. The spawn-clear guard and the terrain-validity guard STAY. Overlapping
  colliders are harmless (both simply block).
- **Selection and the eraser pick the TOPMOST element** covering the clicked cell — the last match in
  render order (elements later in the array draw on top). The eraser removes that ONE element, so a
  stack peels one click at a time rather than clearing wholesale.

**Files:**
- Modify: `src/client/game/editor-state.ts` — the `element` branch of `applyTool` (~987), the
  selection descriptor type and `selectionAt` (~259), `erasedElement`/`withoutElementAt` (~634, ~745),
  and the inspector-commit helpers that find the selected element by identity.
- Modify: `src/shared/map-data.ts` — a helper to test full-identity equality if one is warranted;
  leave `elementsOverlap`/`elementCoversCell` intact (other callers may still need footprint logic).
- Modify: `src/client/game/map-editor-stage.ts` — the selection highlight, which reads the descriptor.
- Modify: `src/client/ui/editor/AdventureEditorScreen.tsx` — the inspector reads the selected element
  by the new descriptor identity.
- Test: `test/editor-modes.test.ts` (or the editor-state test file).

**Interfaces:**
- The element selection descriptor gains `offsetX`/`offsetY`:
  `{ kind: "element"; col: number; row: number; offsetX: number; offsetY: number }`.

- [ ] **Step 1: Write the failing tests**

In the editor-state test file:

```ts
it("stacks two decorations in one cell at different offsets", () => {
  // Place TREE at (2,2) offset (0,0), then at (2,2) offset (3,1). Both survive.
  // Assert elements has length 2 and both offsets are present.
});

it("replaces only the element at the exact same sub-position", () => {
  // Place at (2,2,0,0), then a different asset at (2,2,0,0). Length stays 1, asset is the new one.
});

it("erases the topmost element of a stack, leaving the rest", () => {
  // Two elements in one cell; eraser at that cell removes one (the topmost), length goes 2 -> 1.
});

it("still refuses to place a decoration on the spawn cell", () => {
  // The spawn guard survives the overlap-rule relaxation.
});
```

Fill each body against the real `applyTool`/fixture shapes. The assertions are the contract.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/editor-modes.test.ts`
Expected: the stack test fails (second placement replaces the first — length 1, not 2).

- [ ] **Step 3: Rework placement**

In the `element` branch of `applyTool` (`editor-state.ts` ~987):

```ts
    case "element": {
      const placed: MapElement = { col, row, offsetX, offsetY, assetId: tool.assetId };
      if (!placementTerrainValid(map, placed)) return null;
      if (elementCoversCell(placed, map.spawn.col, map.spawn.row)) return null;
      // Identity is the full sub-position now, so a new sub-position ADDS and only an exact match
      // REPLACES — that is what lets a cell hold a stack. The visual-footprint overlap rejection is
      // gone on purpose: stacked decor is meant to overlap. Spawn and terrain guards stay.
      const isReplacement = map.elements.some((e) => sameElementSlot(e, placed));
      const retained = map.elements.filter((e) => !sameElementSlot(e, placed));
      if (!isReplacement && map.elements.length >= MAX_MAP_ELEMENTS) return null;
      const next = { ...map, elements: [...retained, placed] };
      return keepsSpawnClear(next) ? next : null;
    }
```

Add `sameElementSlot(a, b)` (col/row/offsetX/offsetY equality) wherever the other element helpers
live (`map-data.ts` if shared, else `editor-state.ts`).

- [ ] **Step 4: Rework selection and the eraser to topmost**

`selectionAt` (~259): pick the LAST element covering the cell (topmost), and return the full identity:

```ts
  const covering = map.elements.filter((candidate) => elementCoversCell(candidate, col, row));
  const element = covering[covering.length - 1];
  if (element) {
    return { kind: "element", col: element.col, row: element.row,
             offsetX: element.offsetX, offsetY: element.offsetY };
  }
```

Update the `ElementSelection` descriptor type to carry `offsetX`/`offsetY`. `erasedElement` removes
the topmost single covering element instead of all:

```ts
function erasedElement(map: EditorMap, col: number, row: number): EditorMap {
  const covering = map.elements.filter((e) => elementCoversCell(e, col, row));
  const target = covering[covering.length - 1];
  if (!target) return map;
  const elements = map.elements.filter((e) => e !== target);
  return { ...map, elements };
}
```

- [ ] **Step 5: Thread the identity through the stage and inspector**

Every reader of the element selection descriptor must match by the full 4-tuple, not `(col, row)`:
`map-editor-stage.ts`'s selection highlight, and `AdventureEditorScreen.tsx`'s inspector lookup and
its offset/asset edit commits. When the inspector edits a field, the selection descriptor must follow
to the element's NEW identity so the inspector stays bound to the same element. Grep for the
descriptor's construction/consumption and fix each site; a missed site leaves the highlight or
inspector pointing at the wrong element of a stack.

- [ ] **Step 6: Run the tests**

Run: `npm run check`
Expected: PASS, including the four new tests. Watch for an existing test that asserted
"placing replaces the cell's element" — that behaviour is intentionally gone for distinct
sub-positions; update it to the new model (replace only on an exact sub-position match) and note it.

- [ ] **Step 7: Commit**

```bash
git add src/shared/map-data.ts src/client/game/ src/client/ui/editor/ test/
git commit -m "feat: stack multiple decorations per cell at different offsets"
```

---

### Task 13: Update the load-bearing comments and docs

The "one source of collision truth" invariant is asserted in four places. Left alone, all four now lie.

**Files:**
- Modify: `src/shared/map-data.ts:276-282` (`bakeCollision`'s doc comment)
- Modify: `src/shared/protocol.ts:277-300` (the appearance-only contract)
- Modify: `src/server/world/navigation-system.ts:66-76`
- Modify: `CLAUDE.md` ("Maps and the editor", and the editor description that names the layer pill)

- [ ] **Step 1: Rewrite `bakeCollision`'s comment**

Replace the "colliding things are baked into the tilemap rather than taught to the collision code, so `isWalkableBox`, `step` and `prediction.ts` never learn that layers or elements exist" paragraph:

```
 * Tiles are still baked, and `step` still knows nothing. What changed is that an element is no
 * longer expressible as a cell: its collider is a sub-cell rect, carried on `TerrainGeometry`
 * beside these tiles and queried through the same `isWalkable`. Two structures, still one bake and
 * still one query — `prediction.ts` and the server read the identical geometry.
```

- [ ] **Step 2: Extend the protocol contract**

In `protocol.ts`, the "appearance only — collision is already in `tiles` above" note becomes "collision is already in `tiles` and `colliders` above". Add: a client must never derive collision from `elements`; that would be a second bake, and two bakes that "should" agree is how prediction becomes unfixable.

- [ ] **Step 3: Update the navigation comment**

At `navigation-system.ts:66-76`, add that the second pass (`isWalkable` at the waypoint) is what gives A* sub-cell colliders for free, and state the resulting rule: a partially blocked cell is walkable if the `PLAYER_SIZE` body fits at the waypoint, blocked otherwise.

- [ ] **Step 4: Update CLAUDE.md**

In "Maps and the editor": replace the description of the layer pill with the Field/Element/Event modes; state that elements carry a quarter-tile offset and a catalogue-authored sub-cell collider; state that `WorldInfo` now carries `colliders` beside `tiles` and that `elements`/`layers`/`events` remain appearance-only. Keep the existing warning that reading `layers` for walkability is the desync this design prevents — it is still true and now has a second half.

- [ ] **Step 5: Final verification**

Run: `npm run check`
Expected: PASS.

Then run `npm run dev` and confirm end to end: author a map with offset trees, save it, reload it, run it in-game, walk between the trunks.

- [ ] **Step 6: Commit**

```bash
git add src/shared/map-data.ts src/shared/protocol.ts \
  src/server/world/navigation-system.ts CLAUDE.md
git commit -m "docs: record the two-source collision model"
```
