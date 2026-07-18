# Layered Map Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-character `blocks` terrain with three layers of frozen tile ids over an authored tileset, giving the editor three-level elevation and per-tile draw priority without changing collision, movement or prediction.

**Architecture:** RPG Maker XP's model. A cell stores a tile id; what a tile *means* (passable, drawn behind or in front of characters) is a property of the tileset, not the cell. Autotiling is a paint-time brush that freezes the resolved variant, so an author can override a single tile. Cliff faces occupy their own impassable cells, which is why three-level elevation needs no directional passage and no engine change. Collision is baked at load into the same `TileMap` the movement code already consumes.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects, D1 + Drizzle, PixiJS, Vitest (in workerd), Biome.

**Spec:** `docs/superpowers/specs/2026-07-18-layered-map-model-design.md`

## Global Constraints

- Relative imports always carry the `.js` extension (`../shared/tilemap.js`).
- Biome: semicolons required; `noNonNullAssertion` is on — no `!`, narrow properly.
- `src/shared/` must compile under both `tsconfig.client.json` and `tsconfig.worker.json`. It imports nothing from Cloudflare or the DOM.
- Anything parsed off the wire returns `null` on malformed input; it never throws. Build-time decoders may throw.
- Three tile layers: `MAP_LAYERS = 3`. Layer index 0 is the ground.
- Tile id space: `EMPTY_TILE = 0`, `VARIANTS_PER_AUTOTILE = 16`, `AUTOTILE_SLOTS = 64`, `FIXED_BASE = 1025`.
- One wall row per elevation drop, regardless of level difference.
- `map_element` and the catalogue element system are **not** touched by this plan.
- Run `npm run check` before any commit that touches more than pure shared code.
- Tests live in `test/*.test.ts`, run in workerd, and import with `.js` extensions. The pool does not isolate storage: any test writing to D1 truncates in `afterEach`.

---

### Task 1: Tile id space

**Files:**
- Create: `src/shared/tileset.ts`
- Test: `test/tileset.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `EMPTY_TILE`, `VARIANTS_PER_AUTOTILE`, `AUTOTILE_SLOTS`, `FIXED_BASE`, `autotileId(slot, variant): number`, `fixedId(index): number`, `decodeTileId(id): TileRef`, and the types `TileRef`, `TilePriority`, `AutotileKind`, `Autotile`, `FixedTile`, `Tileset`.

- [ ] **Step 1: Write the failing test**

Create `test/tileset.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  AUTOTILE_SLOTS,
  autotileId,
  decodeTileId,
  EMPTY_TILE,
  FIXED_BASE,
  fixedId,
  VARIANTS_PER_AUTOTILE,
} from "../src/shared/tileset.js";

describe("tile id space", () => {
  it("reserves zero for an empty cell", () => {
    expect(EMPTY_TILE).toBe(0);
    expect(decodeTileId(EMPTY_TILE)).toEqual({ kind: "empty" });
  });

  it("packs an autotile slot and variant into one id", () => {
    expect(autotileId(0, 0)).toBe(1);
    expect(autotileId(0, 15)).toBe(16);
    expect(autotileId(1, 0)).toBe(17);
  });

  it("round-trips every autotile slot and variant", () => {
    for (let slot = 0; slot < AUTOTILE_SLOTS; slot += 1) {
      for (let variant = 0; variant < VARIANTS_PER_AUTOTILE; variant += 1) {
        expect(decodeTileId(autotileId(slot, variant))).toEqual({
          kind: "autotile",
          slot,
          variant,
        });
      }
    }
  });

  it("starts fixed tiles above the whole autotile space", () => {
    expect(FIXED_BASE).toBe(1 + AUTOTILE_SLOTS * VARIANTS_PER_AUTOTILE);
    expect(fixedId(0)).toBe(FIXED_BASE);
    expect(decodeTileId(fixedId(7))).toEqual({ kind: "fixed", index: 7 });
  });

  it("reads a negative or fractional id as empty rather than throwing", () => {
    expect(decodeTileId(-1)).toEqual({ kind: "empty" });
    expect(decodeTileId(1.5)).toEqual({ kind: "empty" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tileset.test.ts`
Expected: FAIL — cannot resolve `../src/shared/tileset.js`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/tileset.ts`:

```ts
/**
 * What a tile id means.
 *
 * A map cell stores an id; what the id *does* — whether you can walk on it, whether it draws in
 * front of a character — is a property of the tileset, authored once per tile. That indirection is
 * the whole design: collision stays derivable from what you see (`id -> tileset -> passable`), so
 * `tilemap.ts`'s rule that a cell stores what it IS rather than how it looks moves one level down
 * instead of being abandoned.
 *
 * The id space is RPG Maker XP's: a low band of autotile variants, then fixed tiles above it. One
 * decode rule covers both, which is worth more than the density lost to `run4` autotiles using
 * four of their sixteen variant slots.
 */

/** An empty cell. On the ground layer this reads as water — the void — when collision is baked. */
export const EMPTY_TILE = 0;

/** Every autotile reserves a full block, even `run4`, which uses only its first four. */
export const VARIANTS_PER_AUTOTILE = 16;

export const AUTOTILE_SLOTS = 64;

export const FIXED_BASE = 1 + AUTOTILE_SLOTS * VARIANTS_PER_AUTOTILE;

/** Drawn behind characters, or in front of them — an XP tile priority, reduced to two values. */
export type TilePriority = "below" | "above";

/**
 * `edge16` is the four-neighbour mask with sixteen variants — a full Wang set.
 * `run4` masks west and east only: cliff walls tile sideways and never vertically.
 */
export type AutotileKind = "edge16" | "run4";

export interface Autotile {
  atlas: string;
  /** Top-left cell of the tile group within the atlas. */
  origin: { col: number; row: number };
  kind: AutotileKind;
  passable: boolean;
  priority: TilePriority;
  /** Multiplicative colour, as PixiJS spends it. Carries elevation shading. */
  tint?: number;
}

export interface FixedTile {
  atlas: string;
  col: number;
  row: number;
  passable: boolean;
  priority: TilePriority;
  tint?: number;
}

export interface Tileset {
  id: string;
  autotiles: readonly Autotile[];
  fixed: readonly FixedTile[];
}

export type TileRef =
  | { kind: "empty" }
  | { kind: "autotile"; slot: number; variant: number }
  | { kind: "fixed"; index: number };

const EMPTY_REF: TileRef = { kind: "empty" };

export function autotileId(slot: number, variant: number): number {
  return 1 + slot * VARIANTS_PER_AUTOTILE + variant;
}

export function fixedId(index: number): number {
  return FIXED_BASE + index;
}

/**
 * Total: an id from a database row or a wire frame may be anything at all, and a cell nobody can
 * decode is an empty cell, not a crash on the first paint.
 */
export function decodeTileId(id: number): TileRef {
  if (!Number.isSafeInteger(id) || id <= EMPTY_TILE) return EMPTY_REF;
  if (id >= FIXED_BASE) return { kind: "fixed", index: id - FIXED_BASE };
  const offset = id - 1;
  return {
    kind: "autotile",
    slot: Math.floor(offset / VARIANTS_PER_AUTOTILE),
    variant: offset % VARIANTS_PER_AUTOTILE,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tileset.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/tileset.ts test/tileset.test.ts
git commit -m "add the tile id space and tileset types"
```

---

### Task 2: Autotile resolvers move to shared

`landMask` and `AUTOTILE_LUT` live in `src/client/game/autotile.ts` today and read a `TileMap`. They become slot-aware, move to `shared/`, and gain the `run4` family. The client file keeps re-exporting what the renderer still uses, so nothing else breaks in this task.

**Files:**
- Create: `src/shared/autotile.ts`
- Modify: `src/client/game/autotile.ts`
- Test: `test/autotile-resolve.test.ts`

**Interfaces:**
- Consumes: Task 1's `AutotileKind`.
- Produces: `EDGE16_LUT`, `RUN4_LUT`, `edge16Mask(same): number`, `run4Mask(same): number`, `autotileOffset(kind, mask): { col: number; row: number }`, where `same` is `(dCol: number, dRow: number) => boolean` — "is the neighbour at this offset the same autotile slot?".

- [ ] **Step 1: Write the failing test**

Create `test/autotile-resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { autotileOffset, edge16Mask, EDGE16_LUT, run4Mask, RUN4_LUT } from "../src/shared/autotile.js";

const none = () => false;
const all = () => true;

describe("edge16", () => {
  it("has one entry per neighbourhood", () => {
    expect(EDGE16_LUT).toHaveLength(16);
  });

  it("masks north, east, south and west as 1, 2, 4, 8", () => {
    expect(edge16Mask((dCol, dRow) => dCol === 0 && dRow === -1)).toBe(1);
    expect(edge16Mask((dCol, dRow) => dCol === 1 && dRow === 0)).toBe(2);
    expect(edge16Mask((dCol, dRow) => dCol === 0 && dRow === 1)).toBe(4);
    expect(edge16Mask((dCol, dRow) => dCol === -1 && dRow === 0)).toBe(8);
  });

  it("puts a lone tile on the island cell and a surrounded tile on the fill cell", () => {
    expect(autotileOffset("edge16", edge16Mask(none))).toEqual({ col: 3, row: 3 });
    expect(autotileOffset("edge16", edge16Mask(all))).toEqual({ col: 1, row: 1 });
  });
});

describe("run4", () => {
  it("masks west and east only", () => {
    expect(RUN4_LUT).toHaveLength(4);
    expect(run4Mask((dCol) => dCol === -1)).toBe(1);
    expect(run4Mask((dCol) => dCol === 1)).toBe(2);
    expect(run4Mask((dCol, dRow) => dRow === -1)).toBe(0);
  });

  it("walks a horizontal run from left end through middle to right end", () => {
    expect(autotileOffset("run4", run4Mask(none))).toEqual({ col: 3, row: 0 });
    expect(autotileOffset("run4", run4Mask((dCol) => dCol === 1))).toEqual({ col: 0, row: 0 });
    expect(autotileOffset("run4", run4Mask(all))).toEqual({ col: 1, row: 0 });
    expect(autotileOffset("run4", run4Mask((dCol) => dCol === -1))).toEqual({ col: 2, row: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/autotile-resolve.test.ts`
Expected: FAIL — cannot resolve `../src/shared/autotile.js`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/autotile.ts`:

```ts
/**
 * Which variant of an autotile a neighbourhood calls for, as a pure function.
 *
 * Shared, not client-only, because three callers must agree: the editor's brush freezes the
 * variant it returns, the migration replays it over old maps, and the property test recomputes a
 * whole grid with it to prove incremental painting never leaves a stale edge behind.
 *
 * The offsets are relative to an autotile's `origin` in its atlas, so the same table serves the
 * flat grass group at column 0 and the raised group at column 5.
 */
import type { AutotileKind } from "./tileset.js";

/** True when the neighbour at this offset belongs to the same autotile as the cell being resolved. */
export type SameNeighbour = (dCol: number, dRow: number) => boolean;

/** N=1, E=2, S=4, W=8. */
export function edge16Mask(same: SameNeighbour): number {
  return (
    (same(0, -1) ? 1 : 0) | (same(1, 0) ? 2 : 0) | (same(0, 1) ? 4 : 0) | (same(-1, 0) ? 8 : 0)
  );
}

/** W=1, E=2. A cliff wall runs sideways and never stacks, so its vertical neighbours say nothing. */
export function run4Mask(same: SameNeighbour): number {
  return (same(-1, 0) ? 1 : 0) | (same(1, 0) ? 2 : 0);
}

/**
 * The sixteen cells of a 4x4 autotile group, indexed by `edge16Mask`.
 *
 * The sheet carries no inner-corner tiles and does not need them: the rim is drawn inset along each
 * tile's edge, so two adjacent edge tiles close cleanly around a concave corner. Verified before
 * this was written — see docs/screenshots/autotile-proof.png.
 */
export const EDGE16_LUT: readonly { col: number; row: number }[] = [
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

/** Four cells of one row, indexed by `run4Mask`: the same left/middle/right/lone ordering the
 *  wall band of `Tilemap_color1.png` is drawn in. */
export const RUN4_LUT: readonly { col: number; row: number }[] = [
  { col: 3, row: 0 }, // 0  neither — a lone one-wide wall
  { col: 2, row: 0 }, // 1  W       — the right end of a run
  { col: 0, row: 0 }, // 2  E       — the left end of a run
  { col: 1, row: 0 }, // 3  W+E     — the middle of a run
];

export function autotileOffset(kind: AutotileKind, mask: number): { col: number; row: number } {
  const table = kind === "run4" ? RUN4_LUT : EDGE16_LUT;
  const offset = table[mask];
  // Every mask this module produces is in range and both tables are dense, so this cannot happen —
  // but the types do not know that and `noNonNullAssertion` is on.
  if (!offset) throw new Error(`no ${kind} variant for mask ${mask}`);
  return offset;
}
```

- [ ] **Step 4: Point the client file at the shared table**

Modify `src/client/game/autotile.ts` — delete its local `AUTOTILE_LUT` array and re-export the shared one, leaving `landMask`, `needsFoam`, `landTile`, `tileVisual` and `TILE_VISUALS` untouched. Replace the `AUTOTILE_LUT` declaration with:

```ts
import { EDGE16_LUT } from "../../shared/autotile.js";

/** Re-exported so the renderer keeps one import site while the table itself lives in `shared/`,
 *  where the editor brush and the migration also read it. */
export const AUTOTILE_LUT = EDGE16_LUT;
```

- [ ] **Step 5: Run the suite to verify nothing regressed**

Run: `npx vitest run test/autotile-resolve.test.ts test/map-terrain.test.ts test/tilemap.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/autotile.ts src/client/game/autotile.ts test/autotile-resolve.test.ts
git commit -m "move the autotile table to shared and add the run4 family"
```

---

### Task 3: Tile layer codec

**Files:**
- Create: `src/shared/tile-layer-codec.ts`
- Test: `test/tile-layer-codec.test.ts`

**Interfaces:**
- Consumes: Task 1's `EMPTY_TILE`.
- Produces: `TileLayer` (`{ cols: number; rows: number; ids: readonly number[] }`), `emptyLayer(cols, rows): TileLayer`, `encodeTileLayer(layer): string`, `decodeTileLayer(text, cols, rows): TileLayer` (throws), `parseTileLayer(value, cols, rows): TileLayer | null` (never throws).

- [ ] **Step 1: Write the failing test**

Create `test/tile-layer-codec.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  decodeTileLayer,
  emptyLayer,
  encodeTileLayer,
  parseTileLayer,
} from "../src/shared/tile-layer-codec.js";

describe("tile layer codec", () => {
  it("collapses a uniform layer to a single run", () => {
    expect(encodeTileLayer(emptyLayer(4, 2))).toBe("0*8");
  });

  it("writes singles bare and runs with a multiplier", () => {
    const layer = { cols: 4, rows: 1, ids: [0, 17, 17, 18] };
    expect(encodeTileLayer(layer)).toBe("0,17*2,18");
  });

  it("round-trips", () => {
    const layer = { cols: 3, rows: 3, ids: [0, 1, 1, 1, 1025, 0, 0, 0, 42] };
    expect(decodeTileLayer(encodeTileLayer(layer), 3, 3)).toEqual(layer);
  });

  it("throws on a payload whose cell count disagrees with the map size", () => {
    expect(() => decodeTileLayer("0*5", 3, 3)).toThrow();
  });

  it("returns null rather than throwing on anything off the wire", () => {
    expect(parseTileLayer("0*5", 3, 3)).toBeNull();
    expect(parseTileLayer("nope", 3, 3)).toBeNull();
    expect(parseTileLayer("1*-2", 3, 3)).toBeNull();
    expect(parseTileLayer(42, 3, 3)).toBeNull();
    expect(parseTileLayer("0*9", 3, 3)).toEqual(emptyLayer(3, 3));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tile-layer-codec.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write the implementation**

Create `src/shared/tile-layer-codec.ts`:

```ts
/**
 * One layer of tile ids, run-length encoded.
 *
 * Ids run past 255, so the one-character-per-cell encoding `blocks` used cannot carry them. Runs
 * were chosen over base64 because a map is mostly long uniform stretches — and because a run string
 * stays readable in a D1 row and in a failing test's output, which base64 does not.
 */
import { EMPTY_TILE } from "./tileset.js";

export interface TileLayer {
  cols: number;
  rows: number;
  /** Row-major, `cols * rows` entries. */
  ids: readonly number[];
}

/** The largest cell count any layer may claim, matching the map size cap in `server/maps.ts`. */
const MAX_CELLS = 100 * 100;

export function emptyLayer(cols: number, rows: number): TileLayer {
  return { cols, rows, ids: new Array<number>(cols * rows).fill(EMPTY_TILE) };
}

export function encodeTileLayer(layer: TileLayer): string {
  const runs: string[] = [];
  let index = 0;
  while (index < layer.ids.length) {
    const id = layer.ids[index] ?? EMPTY_TILE;
    let length = 1;
    while (index + length < layer.ids.length && layer.ids[index + length] === id) length += 1;
    runs.push(length === 1 ? String(id) : `${id}*${length}`);
    index += length;
  }
  return runs.join(",");
}

/** Throws. For content read at build time, where a malformed layer is a build bug. */
export function decodeTileLayer(text: string, cols: number, rows: number): TileLayer {
  const layer = parseTileLayer(text, cols, rows);
  if (!layer) throw new Error(`malformed tile layer for ${cols}x${rows}`);
  return layer;
}

/**
 * Never throws. A layer arriving over the wire or out of a database row is untrusted like any
 * other payload: a bad one is dropped, not a crash on the first paint.
 */
export function parseTileLayer(value: unknown, cols: number, rows: number): TileLayer | null {
  if (typeof value !== "string") return null;
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return null;
  if (cols <= 0 || rows <= 0 || cols * rows > MAX_CELLS) return null;
  const expected = cols * rows;
  const ids: number[] = [];
  for (const run of value.split(",")) {
    const star = run.indexOf("*");
    const idText = star === -1 ? run : run.slice(0, star);
    const countText = star === -1 ? "1" : run.slice(star + 1);
    if (!/^\d+$/.test(idText) || !/^\d+$/.test(countText)) return null;
    const id = Number(idText);
    const count = Number(countText);
    if (count < 1 || ids.length + count > expected) return null;
    for (let step = 0; step < count; step += 1) ids.push(id);
  }
  if (ids.length !== expected) return null;
  return { cols, rows, ids };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tile-layer-codec.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/tile-layer-codec.ts test/tile-layer-codec.test.ts
git commit -m "add the run-length tile layer codec"
```

---

### Task 4: The Tiny Swords tileset

`assets/Tiny Swords (Free Pack)/Terrain/Tileset/Tilemap_color1.png` is 576x384 — a 9x6 grid of 64px cells, byte-identical to the wireframe's `ts_grass.png`. Layout, verified against `wireframes/tmp/grid_grass.png`:

| Region | Content |
| --- | --- |
| cols 0-3, rows 0-3 | flat grass — a standard 4x4 autotile group |
| cols 5-8, rows 0-3 | raised grass tops — the same 4x4 arrangement |
| cols 5-8, rows 4-5 | cliff wall band |
| cols 0 and 3, rows 4-5 | ramp pieces |

**Files:**
- Create: `src/shared/tilesets/tiny-swords.ts`
- Create: `public/assets/lindocara/tiny-swords/terrain/Tilemap_color1.png` (copy)
- Modify: `src/client/game/tiny-swords-art.ts:21-25`
- Test: `test/tileset-tiny-swords.test.ts`

**Interfaces:**
- Consumes: Task 1's `Tileset`, `Autotile`, `FixedTile`.
- Produces: `TINY_SWORDS_TILESET_ID`, `TINY_SWORDS_TILESET: Tileset`, `GRASS_SLOTS: readonly [number, number, number]` (one autotile slot per elevation level), `CLIFF_WALL_SLOT: number`, `tilesetById(id): Tileset | null`, `elevationOfSlot(slot): number` (0-2, or `-1` when the slot is not grass).

- [ ] **Step 1: Copy the sheet into the served directory**

```bash
cp "assets/Tiny Swords (Free Pack)/Terrain/Tileset/Tilemap_color1.png" \
   public/assets/lindocara/tiny-swords/terrain/Tilemap_color1.png
```

Then add the URL beside the others in `src/client/game/tiny-swords-art.ts`, inside `TINY_SWORDS_TERRAIN`:

```ts
  tileset: `${TINY_SWORDS_ROOT}/terrain/Tilemap_color1.png`,
```

- [ ] **Step 2: Write the failing test**

Create `test/tileset-tiny-swords.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CLIFF_WALL_SLOT,
  elevationOfSlot,
  GRASS_SLOTS,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
  tilesetById,
} from "../src/shared/tilesets/tiny-swords.js";

describe("the Tiny Swords tileset", () => {
  it("resolves by id", () => {
    expect(tilesetById(TINY_SWORDS_TILESET_ID)).toBe(TINY_SWORDS_TILESET);
    expect(tilesetById("nope")).toBeNull();
  });

  it("gives level 0 the flat group and levels 1 and 2 the raised group", () => {
    const [flat, one, two] = GRASS_SLOTS;
    expect(TINY_SWORDS_TILESET.autotiles[flat]?.origin).toEqual({ col: 0, row: 0 });
    expect(TINY_SWORDS_TILESET.autotiles[one]?.origin).toEqual({ col: 5, row: 0 });
    expect(TINY_SWORDS_TILESET.autotiles[two]?.origin).toEqual({ col: 5, row: 0 });
  });

  it("shades the raised levels apart and leaves the ground untinted", () => {
    const [flat, one, two] = GRASS_SLOTS;
    expect(TINY_SWORDS_TILESET.autotiles[flat]?.tint).toBeUndefined();
    expect(TINY_SWORDS_TILESET.autotiles[one]?.tint).not.toBe(
      TINY_SWORDS_TILESET.autotiles[two]?.tint,
    );
  });

  it("makes every grass level walkable", () => {
    for (const slot of GRASS_SLOTS) {
      expect(TINY_SWORDS_TILESET.autotiles[slot]?.passable).toBe(true);
    }
  });

  it("makes the cliff wall a run4 you cannot walk through", () => {
    const wall = TINY_SWORDS_TILESET.autotiles[CLIFF_WALL_SLOT];
    expect(wall?.kind).toBe("run4");
    expect(wall?.origin).toEqual({ col: 5, row: 4 });
    expect(wall?.passable).toBe(false);
  });

  it("maps slots back to elevation levels", () => {
    expect(GRASS_SLOTS.map(elevationOfSlot)).toEqual([0, 1, 2]);
    expect(elevationOfSlot(CLIFF_WALL_SLOT)).toBe(-1);
  });

  it("keeps every declared slot inside the id space", () => {
    expect(TINY_SWORDS_TILESET.autotiles.length).toBeLessThanOrEqual(64);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/tileset-tiny-swords.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 4: Write the implementation**

Create `src/shared/tilesets/tiny-swords.ts`:

```ts
/**
 * The one tileset this slice ships, as data.
 *
 * A tileset is a versioned file in the repo, not a row an author edits: tile behaviour is set once
 * per tile by us, and the "Base de données" editor that would expose it is a later tranche. That is
 * also why deferred behaviours (terrain tag, counter) need no reserved columns — adding one later
 * is a code change, not a migration.
 *
 * `Tilemap_color1.png` is 576x384: a 9x6 grid of 64px cells holding the flat grass group at column
 * 0, the raised group at column 5, and the cliff wall band beneath the raised group.
 */
import type { Tileset } from "../tileset.js";

export const TINY_SWORDS_TILESET_ID = "tiny-swords";

const ATLAS = "tilemap-color1";

/**
 * Elevation shading, as a multiplicative tint. The wireframe darkens raised ground with a CSS
 * `brightness()` filter; a tint is the same multiply and is what PixiJS already spends per sprite.
 * Its `saturate()` companion has no tint equivalent and is dropped — the brightness step is what
 * reads as height.
 */
const RAISED_1_TINT = 0xdbdbdb;
const RAISED_2_TINT = 0xb8b8b8;

/** Autotile slots, in declaration order. The indices are the contract; the array below matches. */
export const GRASS_SLOTS: readonly [number, number, number] = [0, 1, 2];
export const CLIFF_WALL_SLOT = 3;

export const TINY_SWORDS_TILESET: Tileset = {
  id: TINY_SWORDS_TILESET_ID,
  autotiles: [
    { atlas: ATLAS, origin: { col: 0, row: 0 }, kind: "edge16", passable: true, priority: "below" },
    {
      atlas: ATLAS,
      origin: { col: 5, row: 0 },
      kind: "edge16",
      passable: true,
      priority: "below",
      tint: RAISED_1_TINT,
    },
    {
      atlas: ATLAS,
      origin: { col: 5, row: 0 },
      kind: "edge16",
      passable: true,
      priority: "below",
      tint: RAISED_2_TINT,
    },
    // The wall is drawn into the cell below its owner and is the reason three-level elevation needs
    // no directional passage: a cliff face is simply a cell you cannot walk into.
    { atlas: ATLAS, origin: { col: 5, row: 4 }, kind: "run4", passable: false, priority: "below" },
  ],
  fixed: [
    // Ramps: the only passable cells that join two elevation levels.
    { atlas: ATLAS, col: 0, row: 4, passable: true, priority: "below" },
    { atlas: ATLAS, col: 0, row: 5, passable: true, priority: "below" },
    { atlas: ATLAS, col: 3, row: 4, passable: true, priority: "below" },
    { atlas: ATLAS, col: 3, row: 5, passable: true, priority: "below" },
  ],
};

const BY_ID = new Map<string, Tileset>([[TINY_SWORDS_TILESET_ID, TINY_SWORDS_TILESET]]);

export function tilesetById(id: string): Tileset | null {
  return BY_ID.get(id) ?? null;
}

/** Which elevation level a ground slot stands at, or -1 for anything that is not grass. */
export function elevationOfSlot(slot: number): number {
  const level = GRASS_SLOTS.indexOf(slot);
  return level;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/tileset-tiny-swords.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared/tilesets/tiny-swords.ts public/assets/lindocara/tiny-swords/terrain/Tilemap_color1.png src/client/game/tiny-swords-art.ts test/tileset-tiny-swords.test.ts
git commit -m "ship the Tiny Swords tileset and its sheet"
```

---

### Task 5: The autotile brush

The correctness-critical task. Freezing variants means a missed neighbour re-resolution leaves a stale edge, so the test compares incremental painting against a full-grid recomputation.

**Files:**
- Create: `src/shared/tile-brush.ts`
- Test: `test/tile-brush.test.ts`

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: `paintAutotile(layer, tileset, slot, col, row): TileLayer`, `eraseTile(layer, tileset, col, row): TileLayer`, `resolveWholeLayer(layer, tileset): TileLayer`. All return a new layer; none mutate.

- [ ] **Step 1: Write the failing test**

Create `test/tile-brush.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyLayer } from "../src/shared/tile-layer-codec.js";
import { eraseTile, paintAutotile, resolveWholeLayer } from "../src/shared/tile-brush.js";
import { autotileId, decodeTileId } from "../src/shared/tileset.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET } from "../src/shared/tilesets/tiny-swords.js";

const GRASS = GRASS_SLOTS[0];
const set = TINY_SWORDS_TILESET;

function idAt(layer: { cols: number; ids: readonly number[] }, col: number, row: number): number {
  return layer.ids[row * layer.cols + col] ?? 0;
}

describe("the autotile brush", () => {
  it("paints a lone tile as the island variant", () => {
    const layer = paintAutotile(emptyLayer(5, 5), set, GRASS, 2, 2);
    expect(decodeTileId(idAt(layer, 2, 2))).toEqual({ kind: "autotile", slot: GRASS, variant: 0 });
  });

  it("re-resolves the neighbour it just joined", () => {
    let layer = paintAutotile(emptyLayer(5, 5), set, GRASS, 2, 2);
    layer = paintAutotile(layer, set, GRASS, 3, 2);
    // (2,2) now has an east neighbour: mask 2. (3,2) has a west neighbour: mask 8.
    expect(decodeTileId(idAt(layer, 2, 2))).toEqual({ kind: "autotile", slot: GRASS, variant: 2 });
    expect(decodeTileId(idAt(layer, 3, 2))).toEqual({ kind: "autotile", slot: GRASS, variant: 8 });
  });

  it("re-resolves the neighbours an erase orphaned", () => {
    let layer = paintAutotile(emptyLayer(5, 5), set, GRASS, 2, 2);
    layer = paintAutotile(layer, set, GRASS, 3, 2);
    layer = eraseTile(layer, set, 3, 2);
    expect(idAt(layer, 3, 2)).toBe(0);
    expect(decodeTileId(idAt(layer, 2, 2))).toEqual({ kind: "autotile", slot: GRASS, variant: 0 });
  });

  it("leaves a hand-placed fixed tile alone when a neighbour is repainted", () => {
    const base = emptyLayer(5, 5);
    const ids = [...base.ids];
    ids[2 * 5 + 2] = 1025;
    const layer = paintAutotile({ ...base, ids }, set, GRASS, 3, 2);
    expect(idAt(layer, 2, 2)).toBe(1025);
  });

  // The test that guards the whole frozen-variant design.
  it("matches a full recomputation after any sequence of paints and erases", () => {
    let layer = emptyLayer(8, 6);
    let seed = 12345;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % bound;
    };
    for (let step = 0; step < 400; step += 1) {
      const col = next(8);
      const row = next(6);
      layer = next(4) === 0 ? eraseTile(layer, set, col, row) : paintAutotile(layer, set, GRASS, col, row);
      expect(layer.ids).toEqual(resolveWholeLayer(layer, set).ids);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tile-brush.test.ts`
Expected: FAIL — cannot resolve `../src/shared/tile-brush.js`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/tile-brush.ts`:

```ts
/**
 * Painting, as pure functions over a layer.
 *
 * The variant is frozen at paint time — that is what lets an author override a single tile, and it
 * is also the design's one hazard: a cell whose neighbour changed but which was never re-resolved
 * keeps a stale edge forever. Every write here therefore re-resolves the four orthogonal
 * neighbours, and `resolveWholeLayer` exists so a test can assert that incremental painting and a
 * full recomputation never disagree.
 *
 * A fixed tile is never re-resolved: it is a hand placement, and the whole point of the fallback is
 * that the brush does not get to overrule it.
 */
import { edge16Mask, run4Mask, type SameNeighbour } from "./autotile.js";
import type { TileLayer } from "./tile-layer-codec.js";
import { autotileId, decodeTileId, EMPTY_TILE, type Tileset } from "./tileset.js";

function indexOf(layer: TileLayer, col: number, row: number): number {
  return row * layer.cols + col;
}

function inBounds(layer: TileLayer, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < layer.cols && row < layer.rows;
}

/** Which autotile slot occupies a cell, or -1 for empty, out of bounds, or a fixed tile. */
export function slotAt(layer: TileLayer, col: number, row: number): number {
  if (!inBounds(layer, col, row)) return -1;
  const ref = decodeTileId(layer.ids[indexOf(layer, col, row)] ?? EMPTY_TILE);
  return ref.kind === "autotile" ? ref.slot : -1;
}

/** The id a cell should hold given its neighbourhood, or null when it is not ours to decide. */
function resolvedId(layer: TileLayer, tileset: Tileset, col: number, row: number): number | null {
  const slot = slotAt(layer, col, row);
  if (slot < 0) return null;
  const autotile = tileset.autotiles[slot];
  if (!autotile) return null;
  const same: SameNeighbour = (dCol, dRow) => slotAt(layer, col + dCol, row + dRow) === slot;
  // The variant IS the mask. `autotileOffset` is the only place a mask becomes a sheet cell, and it
  // lives in the renderer's half of the world — so a stored id stays independent of how the sheet
  // happens to be laid out, and re-cutting the art never invalidates a saved map.
  const mask = autotile.kind === "run4" ? run4Mask(same) : edge16Mask(same);
  return autotileId(slot, mask);
}

function withNeighboursResolved(
  layer: TileLayer,
  tileset: Tileset,
  col: number,
  row: number,
): TileLayer {
  const ids = [...layer.ids];
  const draft: TileLayer = { ...layer, ids };
  const cells: readonly { col: number; row: number }[] = [
    { col, row },
    { col, row: row - 1 },
    { col: col + 1, row },
    { col, row: row + 1 },
    { col: col - 1, row },
  ];
  for (const cell of cells) {
    if (!inBounds(draft, cell.col, cell.row)) continue;
    const id = resolvedId(draft, tileset, cell.col, cell.row);
    if (id !== null) ids[indexOf(draft, cell.col, cell.row)] = id;
  }
  return { ...layer, ids };
}

export function paintAutotile(
  layer: TileLayer,
  tileset: Tileset,
  slot: number,
  col: number,
  row: number,
): TileLayer {
  if (!inBounds(layer, col, row)) return layer;
  const ids = [...layer.ids];
  ids[indexOf(layer, col, row)] = autotileId(slot, 0);
  return withNeighboursResolved({ ...layer, ids }, tileset, col, row);
}

export function eraseTile(
  layer: TileLayer,
  tileset: Tileset,
  col: number,
  row: number,
): TileLayer {
  if (!inBounds(layer, col, row)) return layer;
  const ids = [...layer.ids];
  ids[indexOf(layer, col, row)] = EMPTY_TILE;
  return withNeighboursResolved({ ...layer, ids }, tileset, col, row);
}

/** Every autotile cell re-resolved from scratch. The oracle the brush is tested against. */
export function resolveWholeLayer(layer: TileLayer, tileset: Tileset): TileLayer {
  const ids = [...layer.ids];
  for (let row = 0; row < layer.rows; row += 1) {
    for (let col = 0; col < layer.cols; col += 1) {
      const id = resolvedId(layer, tileset, col, row);
      if (id !== null) ids[indexOf(layer, col, row)] = id;
    }
  }
  return { ...layer, ids };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tile-brush.test.ts`
Expected: PASS, 5 tests. The property test runs 400 paint/erase steps and compares against a full recomputation after each.

- [ ] **Step 5: Commit**

```bash
git add src/shared/tile-brush.ts test/tile-brush.test.ts
git commit -m "add the autotile brush with neighbour re-resolution"
```

---

### Task 6: The elevation brush

**Files:**
- Modify: `src/shared/tile-brush.ts`
- Test: `test/tile-elevation-brush.test.ts`

**Interfaces:**
- Consumes: Task 5's `paintAutotile`, `eraseTile`, `slotAt`; Task 4's `GRASS_SLOTS`, `CLIFF_WALL_SLOT`, `elevationOfSlot`.
- Produces: `paintElevation(layers, tileset, level, col, row): TileLayer[]` — takes and returns all three layers, because a wall lands on layer 1 while its owner lands on layer 0.

- [ ] **Step 1: Write the failing test**

Create `test/tile-elevation-brush.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyLayer } from "../src/shared/tile-layer-codec.js";
import { paintElevation } from "../src/shared/tile-brush.js";
import { decodeTileId } from "../src/shared/tileset.js";
import { CLIFF_WALL_SLOT, GRASS_SLOTS, TINY_SWORDS_TILESET } from "../src/shared/tilesets/tiny-swords.js";

const set = TINY_SWORDS_TILESET;
const blank = (): ReturnType<typeof emptyLayer>[] => [emptyLayer(6, 6), emptyLayer(6, 6), emptyLayer(6, 6)];

function slotOf(layer: { cols: number; ids: readonly number[] }, col: number, row: number): number {
  const ref = decodeTileId(layer.ids[row * layer.cols + col] ?? 0);
  return ref.kind === "autotile" ? ref.slot : -1;
}

describe("the elevation brush", () => {
  it("writes the raised top on the ground layer", () => {
    const layers = paintElevation(blank(), set, 1, 2, 2);
    expect(slotOf(layers[0], 2, 2)).toBe(GRASS_SLOTS[1]);
  });

  it("drops a wall into the cell below a raised tile", () => {
    const layers = paintElevation(blank(), set, 1, 2, 2);
    expect(slotOf(layers[1], 2, 3)).toBe(CLIFF_WALL_SLOT);
  });

  it("draws one wall row whatever the drop, so level 2 beside level 0 is still one wall", () => {
    const layers = paintElevation(blank(), set, 2, 2, 2);
    expect(slotOf(layers[1], 2, 3)).toBe(CLIFF_WALL_SLOT);
    expect(slotOf(layers[1], 2, 4)).toBe(-1);
  });

  it("removes a wall the ground beneath no longer justifies", () => {
    let layers = paintElevation(blank(), set, 1, 2, 2);
    expect(slotOf(layers[1], 2, 3)).toBe(CLIFF_WALL_SLOT);
    layers = paintElevation(layers, set, 1, 2, 3);
    expect(slotOf(layers[1], 2, 3)).toBe(-1);
  });

  it("joins adjacent walls into a horizontal run", () => {
    let layers = paintElevation(blank(), set, 1, 2, 2);
    layers = paintElevation(layers, set, 1, 3, 2);
    // Left end has an east neighbour (mask 2); right end has a west neighbour (mask 1).
    const left = decodeTileId(layers[1].ids[3 * 6 + 2] ?? 0);
    const right = decodeTileId(layers[1].ids[3 * 6 + 3] ?? 0);
    expect(left).toEqual({ kind: "autotile", slot: CLIFF_WALL_SLOT, variant: 2 });
    expect(right).toEqual({ kind: "autotile", slot: CLIFF_WALL_SLOT, variant: 1 });
  });

  it("paints level 0 as flat grass with no wall at all", () => {
    const layers = paintElevation(blank(), set, 0, 2, 2);
    expect(slotOf(layers[0], 2, 2)).toBe(GRASS_SLOTS[0]);
    expect(slotOf(layers[1], 2, 3)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tile-elevation-brush.test.ts`
Expected: FAIL — `paintElevation` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/shared/tile-brush.ts`:

```ts
import { CLIFF_WALL_SLOT, elevationOfSlot, GRASS_SLOTS } from "./tilesets/tiny-swords.js";

/** Which elevation level a ground cell stands at. Empty and off-map read as -1: lower than any
 *  authored level, so a cliff at the map's edge still gets its face. */
function elevationAt(ground: TileLayer, col: number, row: number): number {
  return elevationOfSlot(slotAt(ground, col, row));
}

/**
 * Paint one cell of ground at `level`, and maintain the cliff face beneath it.
 *
 * The wall is an ordinary tile whose tileset entry says `passable: false`, which is the entire
 * reason three-level elevation costs nothing in the movement code: a cliff face is a cell you
 * cannot walk into, not a direction you cannot cross.
 *
 * One wall row per drop regardless of the level difference, matching the wireframe. The sheet's
 * second wall row stays available for a later proportional cliff.
 */
export function paintElevation(
  layers: readonly TileLayer[],
  tileset: Tileset,
  level: number,
  col: number,
  row: number,
): TileLayer[] {
  const slot = GRASS_SLOTS[level];
  if (slot === undefined) return [...layers];
  const ground = layers[0];
  const walls = layers[1];
  if (!ground || !walls) return [...layers];

  const paintedGround = paintAutotile(ground, tileset, slot, col, row);

  // Every cell whose wall may have changed: the one below what was just painted, and the one below
  // the painted cell itself (its own face may now be buried by higher ground above it).
  let paintedWalls = walls;
  for (const target of [{ col, row: row + 1 }, { col, row }]) {
    paintedWalls = syncWall(paintedGround, paintedWalls, tileset, target.col, target.row);
  }
  return [paintedGround, paintedWalls, ...layers.slice(2)];
}

/** A cell carries a wall exactly when the ground directly above it stands higher than it does. */
function syncWall(
  ground: TileLayer,
  walls: TileLayer,
  tileset: Tileset,
  col: number,
  row: number,
): TileLayer {
  if (col < 0 || row < 0 || col >= walls.cols || row >= walls.rows) return walls;
  const above = elevationAt(ground, col, row - 1);
  const here = elevationAt(ground, col, row);
  const wanted = above > 0 && above > here;
  const has = slotAt(walls, col, row) === CLIFF_WALL_SLOT;
  if (wanted === has) return walls;
  return wanted
    ? paintAutotile(walls, tileset, CLIFF_WALL_SLOT, col, row)
    : eraseTile(walls, tileset, col, row);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/tile-elevation-brush.test.ts test/tile-brush.test.ts`
Expected: PASS, 11 tests total.

- [ ] **Step 5: Commit**

```bash
git add src/shared/tile-brush.ts test/tile-elevation-brush.test.ts
git commit -m "add the elevation brush and its cliff faces"
```

---

### Task 7: Layers become the map, and collision is baked from them

`MapData.blocks` is replaced. `bakeCollision` keeps its signature and its meaning; only its input changes.

**Files:**
- Modify: `src/shared/map-data.ts` (`MapData` at :76-82, `bakeCollision` at :263-281, `parseMapData` at :319-359)
- Test: `test/map-layers.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4.
- Produces: `MapData { tilesetId: string; cols: number; rows: number; layers: readonly TileLayer[]; elements; spawn; markers? }`, `MAP_LAYERS = 3`, unchanged `bakeCollision(map): TileMap`, `parseMapData(value): MapData | null`.

- [ ] **Step 1: Write the failing test**

Create `test/map-layers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bakeCollision, MAP_LAYERS, parseMapData } from "../src/shared/map-data.js";
import { emptyLayer, encodeTileLayer } from "../src/shared/tile-layer-codec.js";
import { paintAutotile } from "../src/shared/tile-brush.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET, TINY_SWORDS_TILESET_ID } from "../src/shared/tilesets/tiny-swords.js";
import { kindAt } from "../src/shared/tilemap.js";

function grassField(cols: number, rows: number) {
  let ground = emptyLayer(cols, rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      ground = paintAutotile(ground, TINY_SWORDS_TILESET, GRASS_SLOTS[0], col, row);
    }
  }
  return [ground, emptyLayer(cols, rows), emptyLayer(cols, rows)];
}

describe("collision baked from layers", () => {
  it("reads an empty ground cell as water", () => {
    const layers = grassField(4, 4);
    const ids = [...layers[0].ids];
    ids[0] = 0;
    const baked = bakeCollision({
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: 4,
      rows: 4,
      layers: [{ ...layers[0], ids }, layers[1], layers[2]],
      elements: [],
      spawn: { col: 1, row: 1 },
    });
    expect(kindAt(baked, 0, 0)).toBe("water");
    expect(kindAt(baked, 1, 1)).toBe("grass");
  });

  it("reads an impassable tile on any layer as solid", () => {
    const layers = grassField(4, 4);
    const walls = paintAutotile(layers[1], TINY_SWORDS_TILESET, 3, 2, 2);
    const baked = bakeCollision({
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: 4,
      rows: 4,
      layers: [layers[0], walls, layers[2]],
      elements: [],
      spawn: { col: 0, row: 0 },
    });
    expect(kindAt(baked, 2, 2)).toBe("forest");
  });

  it("parses a wire payload and rejects a layer count that is not three", () => {
    const layers = grassField(20, 15);
    const payload = {
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: 20,
      rows: 15,
      layers: layers.map(encodeTileLayer),
      elements: [],
      spawn: { col: 1, row: 1 },
    };
    expect(parseMapData(payload)).not.toBeNull();
    expect(parseMapData({ ...payload, layers: payload.layers.slice(0, 2) })).toBeNull();
    expect(parseMapData({ ...payload, tilesetId: "nope" })).toBeNull();
    expect(MAP_LAYERS).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/map-layers.test.ts`
Expected: FAIL — `MAP_LAYERS` is not exported and `MapData` still requires `blocks`.

- [ ] **Step 3: Change `MapData`**

In `src/shared/map-data.ts`, replace the `MapData` interface at :76-82 with:

```ts
export const MAP_LAYERS = 3;

export interface MapData {
  tilesetId: string;
  cols: number;
  rows: number;
  /** Exactly `MAP_LAYERS`. Index 0 is the ground; an empty ground cell is the void. */
  layers: readonly TileLayer[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  /** Absent on legacy payloads; parseMapData always fills it (EMPTY_MARKERS when omitted). */
  markers?: MapMarkers;
}
```

Add the imports at the top of the file:

```ts
import { parseTileLayer, type TileLayer } from "./tile-layer-codec.js";
import { decodeTileId, EMPTY_TILE, type Tileset } from "./tileset.js";
import { tilesetById } from "./tilesets/tiny-swords.js";
```

and drop the now-unused `decodeTileMap` import.

- [ ] **Step 4: Rewrite `bakeCollision`**

Replace `bakeCollision` at :263-281 with:

```ts
/** Whether a tile blocks movement, resolved through the tileset. An empty cell blocks nothing —
 *  on the ground layer it is the void, which `groundKinds` has already called water. */
function tileBlocks(tileset: Tileset, id: number): boolean {
  const ref = decodeTileId(id);
  if (ref.kind === "empty") return false;
  const entry =
    ref.kind === "autotile" ? tileset.autotiles[ref.slot] : tileset.fixed[ref.index];
  // An id no tileset entry answers for is treated as solid: an unknown obstacle you cannot walk
  // into is recoverable, an invisible hole you fall through is not.
  return entry ? !entry.passable : true;
}

/**
 * The ground, plus everything standing on it that you bump into.
 *
 * Unchanged in meaning from the `blocks` era: colliding things are baked into the tilemap rather
 * than taught to the collision code, so `isWalkableBox`, `step` and `prediction.ts` never learn
 * that layers or elements exist. Only the input changed.
 */
export function bakeCollision(map: MapData): TileMap {
  const tileset = tilesetById(map.tilesetId);
  const cells = map.cols * map.rows;
  const kinds: TileKind[] = new Array<TileKind>(cells).fill("water");
  const ground = map.layers[0];
  for (let index = 0; index < cells; index += 1) {
    const id = ground?.ids[index] ?? EMPTY_TILE;
    kinds[index] = id === EMPTY_TILE ? "water" : "grass";
  }
  if (tileset) {
    for (const layer of map.layers) {
      for (let index = 0; index < cells; index += 1) {
        const id = layer.ids[index] ?? EMPTY_TILE;
        if (id !== EMPTY_TILE && tileBlocks(tileset, id)) kinds[index] = "forest";
      }
    }
  }
  const tiles: TileMap = { cols: map.cols, rows: map.rows, kinds };
  return bakeElements(tiles, map.elements);
}

/** The element pass, unchanged: walkable overrides reclaim water, collision footprints become
 *  forest. Split out only so `bakeCollision` reads as two steps rather than four loops. */
function bakeElements(tiles: TileMap, elements: readonly MapElement[]): TileMap {
  const kinds = [...tiles.kinds];
  for (const element of elements) {
    const asset = editorAsset(element.assetId);
    if (asset?.editor.terrainOverride !== "walkable") continue;
    for (const cell of elementCells(element)) {
      const index = cell.row * tiles.cols + cell.col;
      if (kinds[index] === "water") kinds[index] = "grass";
    }
  }
  for (const element of elements) {
    for (const cell of elementCells(element, "collision")) {
      const index = cell.row * tiles.cols + cell.col;
      if (kinds[index] === "grass") kinds[index] = "forest";
    }
  }
  return { ...tiles, kinds };
}
```

- [ ] **Step 5: Rewrite `parseMapData`**

Replace the `BLOCK_CHARS` constant and `parseMapData` at :308-359 with:

```ts
/**
 * Defensive, exactly like client intent already is.
 *
 * A malformed map that reaches the renderer throws on the first paint — a short layer, an unknown
 * tileset, a spawn off the edge. This returns null instead and the frame is dropped.
 */
export function parseMapData(value: unknown): MapData | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { tilesetId, cols, rows, layers, elements, spawn } = record;

  if (typeof tilesetId !== "string" || !tilesetById(tilesetId)) return null;
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return null;
  const width = cols as number;
  const height = rows as number;
  if (width <= 0 || height <= 0) return null;

  if (!Array.isArray(layers) || layers.length !== MAP_LAYERS) return null;
  const parsedLayers: TileLayer[] = [];
  for (const raw of layers) {
    const layer = parseTileLayer(raw, width, height);
    if (!layer) return null;
    parsedLayers.push(layer);
  }

  const parsed = parseMapElements(elements);
  if (!parsed) return null;
  for (const element of parsed) {
    if (element.col < 0 || element.col >= width || element.row < 0 || element.row >= height)
      return null;
  }

  if (typeof spawn !== "object" || spawn === null) return null;
  const spawnRecord = spawn as Record<string, unknown>;
  const { col: spawnCol, row: spawnRow } = spawnRecord;
  if (!Number.isSafeInteger(spawnCol) || !Number.isSafeInteger(spawnRow)) return null;
  if ((spawnCol as number) < 0 || (spawnCol as number) >= width) return null;
  if ((spawnRow as number) < 0 || (spawnRow as number) >= height) return null;

  const markers = parseMapMarkers(record.markers, width, height);
  if (!markers) return null;

  return {
    tilesetId,
    cols: width,
    rows: height,
    layers: parsedLayers,
    elements: parsed,
    spawn: { col: spawnCol as number, row: spawnRow as number },
    markers,
  };
}
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run test/map-layers.test.ts`
Expected: PASS, 3 tests. Other suites will fail to compile until Tasks 8-12 land — that is expected and is why this task's commit is not gated on `npm run check`.

- [ ] **Step 7: Commit**

```bash
git add src/shared/map-data.ts test/map-layers.test.ts
git commit -m "bake collision from tile layers instead of blocks"
```

---

### Task 8: Migration from `blocks`, with the safety assertion

**Files:**
- Create: `src/shared/map-migrate.ts`
- Test: `test/map-migrate.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 5, 7.
- Produces: `layersFromBlocks(blocks): { cols: number; rows: number; layers: TileLayer[] }`.

Authored `blocks` only ever contained `.` and `#` — the old `parseMapData` rejected every other character, and `forest`/`building` were products of `bakeCollision`, never of an author. So the mapping is total: `#` becomes an empty ground cell (the water background shows through), everything else becomes flat grass.

- [ ] **Step 1: Write the failing test**

Create `test/map-migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bakeCollision } from "../src/shared/map-data.js";
import { layersFromBlocks } from "../src/shared/map-migrate.js";
import { decodeTileMap } from "../src/shared/tilemap-codec.js";
import { kindAt } from "../src/shared/tilemap.js";
import { TINY_SWORDS_TILESET_ID } from "../src/shared/tilesets/tiny-swords.js";

const BLOCKS = [
  "####################",
  "#..................#",
  "#....####..........#",
  "#....####..........#",
  "#..................#",
  "#........###.......#",
  "#........###.......#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "####################",
];

describe("migrating blocks to layers", () => {
  it("keeps the map's size", () => {
    const migrated = layersFromBlocks(BLOCKS);
    expect(migrated.cols).toBe(20);
    expect(migrated.rows).toBe(15);
    expect(migrated.layers).toHaveLength(3);
  });

  it("leaves layers one and two empty", () => {
    const migrated = layersFromBlocks(BLOCKS);
    expect(migrated.layers[1]?.ids.every((id) => id === 0)).toBe(true);
    expect(migrated.layers[2]?.ids.every((id) => id === 0)).toBe(true);
  });

  // The test that says the migration is safe.
  it("bakes cell-for-cell identical collision to the blocks it replaced", () => {
    const migrated = layersFromBlocks(BLOCKS);
    const after = bakeCollision({
      tilesetId: TINY_SWORDS_TILESET_ID,
      cols: migrated.cols,
      rows: migrated.rows,
      layers: migrated.layers,
      elements: [],
      spawn: { col: 1, row: 1 },
    });
    const before = decodeTileMap(BLOCKS);
    expect(after.cols).toBe(before.cols);
    expect(after.rows).toBe(before.rows);
    for (let row = 0; row < before.rows; row += 1) {
      for (let col = 0; col < before.cols; col += 1) {
        expect({ col, row, kind: kindAt(after, col, row) }).toEqual({
          col,
          row,
          kind: kindAt(before, col, row),
        });
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/map-migrate.test.ts`
Expected: FAIL — cannot resolve `../src/shared/map-migrate.js`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/map-migrate.ts`:

```ts
/**
 * Old maps, once.
 *
 * `blocks` only ever held `.` and `#`: the parser rejected everything else, and `forest` and
 * `building` were baked from elements rather than authored. So water becomes an empty ground cell
 * and everything else becomes flat grass, and the mapping needs no special cases.
 *
 * The variant is resolved by the same brush the editor paints with, so a migrated map is
 * indistinguishable from one drawn by hand.
 */
import { resolveWholeLayer } from "./tile-brush.js";
import { emptyLayer, type TileLayer } from "./tile-layer-codec.js";
import { autotileId } from "./tileset.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET } from "./tilesets/tiny-swords.js";

const WATER = "#";

export function layersFromBlocks(blocks: readonly string[]): {
  cols: number;
  rows: number;
  layers: TileLayer[];
} {
  const cols = blocks[0]?.length ?? 0;
  const rows = blocks.length;
  const ground = emptyLayer(cols, rows);
  const ids = [...ground.ids];
  const grass = GRASS_SLOTS[0];
  for (let row = 0; row < rows; row += 1) {
    const line = blocks[row] ?? "";
    for (let col = 0; col < cols; col += 1) {
      if (line[col] === WATER) continue;
      // Variant 0 for now; the whole-layer pass below resolves every edge in one sweep, which is
      // cheaper and simpler than re-resolving neighbours cell by cell.
      ids[row * cols + col] = autotileId(grass, 0);
    }
  }
  const resolved = resolveWholeLayer({ cols, rows, ids }, TINY_SWORDS_TILESET);
  return { cols, rows, layers: [resolved, emptyLayer(cols, rows), emptyLayer(cols, rows)] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/map-migrate.test.ts`
Expected: PASS, 3 tests — in particular the cell-for-cell collision equality.

- [ ] **Step 5: Commit**

```bash
git add src/shared/map-migrate.ts test/map-migrate.test.ts
git commit -m "migrate blocks to tile layers with a collision-equality proof"
```

---

### Task 9: Database columns and the maps service

**Files:**
- Modify: `src/server/db/schema.ts:253-281` (the `map` table)
- Create: `migrations/0017_<drizzle-generated-name>.sql`
- Modify: `src/server/maps.ts` (`StoredMap` :41, `BUILTIN_MAP` :55, `MapInput` :75, `validateMapInput` :124, `toStoredMap` :200, `createMap` :286, `updateMap` :321)
- Test: `test/maps-layers.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 7, 8.
- Produces: `MapInput { name; tilesetId; cols; rows; layers: readonly TileLayer[]; elements; spawn; markers? }`; `validateMapInput(input): MapData & { name: string }` unchanged in signature; `StoredMap` unchanged in shape beyond inheriting the new `MapData`.

- [ ] **Step 1: Change the schema**

In `src/server/db/schema.ts`, inside the `map` table, replace the `blocks` column with:

```ts
    /** Tileset the layer ids index into. */
    tilesetId: text("tileset_id").notNull().default("tiny-swords"),
    /** JSON array of exactly three run-length encoded tile layers. Ground first. */
    layers: text("layers").notNull(),
```

`cols` and `rows` stay: they were derived from `blocks` before and are now the only source of a layer's shape.

- [ ] **Step 2: Generate the migration**

```bash
npm run db:generate
```

This writes `migrations/0017_*.sql` using the table-rebuild pattern (`PRAGMA foreign_keys=OFF`, `__new_map`, copy, drop, rename) that `0016_small_rocket_racer.sql` established.

- [ ] **Step 3: Hand-write the backfill**

drizzle-kit cannot autotile. Append to the generated file, before the closing `PRAGMA foreign_keys=ON`, a placeholder that marks every pre-existing row for the code-side backfill:

```sql
-- Layers cannot be computed in SQL: the autotile variant of each cell depends on its neighbours.
-- Rows carried over from the `blocks` era are written with an empty ground layer and re-derived by
-- `layersFromBlocks` on first load; `blocks` is preserved in `legacy_blocks` until that runs.
ALTER TABLE `map` ADD COLUMN `legacy_blocks` text;--> statement-breakpoint
UPDATE `map` SET `legacy_blocks` = (SELECT old_map.`blocks` FROM `__old_map` AS old_map WHERE old_map.`id` = `map`.`id`);
```

Adjust the subquery to whatever the generated file names the old table. If the generated migration drops the old table before this point, move these two statements above the `DROP TABLE`.

- [ ] **Step 4: Apply and verify locally**

```bash
npm run db:migrate
```

Expected: migration applies with no error.

- [ ] **Step 5: Write the failing test**

Create `test/maps-layers.test.ts`:

```ts
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import { createAccount } from "../src/server/accounts.js";
import { createDb } from "../src/server/db/index.js";
import { createMap, loadMap, updateMap, validateMapInput } from "../src/server/maps.js";
import { layersFromBlocks } from "../src/shared/map-migrate.js";
import { TINY_SWORDS_TILESET_ID } from "../src/shared/tilesets/tiny-swords.js";

const BLOCKS = [
  "####################",
  ...Array.from({ length: 13 }, () => "#..................#"),
  "####################",
];

function input(name: string) {
  const migrated = layersFromBlocks(BLOCKS);
  return {
    name,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: migrated.cols,
    rows: migrated.rows,
    layers: migrated.layers,
    elements: [],
    spawn: { col: 2, row: 2 },
  };
}

describe("maps stored as layers", () => {
  afterEach(async () => {
    await env.DB.exec("DELETE FROM map_element");
    await env.DB.exec("DELETE FROM map");
    await env.DB.exec("DELETE FROM account");
  });

  it("round-trips layers through D1", async () => {
    const db = createDb(env.DB);
    const account = await createAccount(db, "layers-owner", "correct horse battery");
    const created = await createMap(db, account.id, input("Riverwood"));
    const loaded = await loadMap(db, created.id);
    expect(loaded?.layers).toHaveLength(3);
    expect(loaded?.layers[0]?.ids).toEqual(created.layers[0]?.ids);
    expect(loaded?.tilesetId).toBe(TINY_SWORDS_TILESET_ID);
  });

  it("bumps the revision on a successful update", async () => {
    const db = createDb(env.DB);
    const account = await createAccount(db, "layers-rev", "correct horse battery");
    const created = await createMap(db, account.id, input("Riverwood"));
    const updated = await updateMap(db, account.id, created.id, input("Riverwood II"));
    expect(updated.revision).toBe(created.revision + 1);
  });

  it("refuses a spawn on a cell no hero can stand on", () => {
    expect(() => validateMapInput({ ...input("Bad"), spawn: { col: 0, row: 0 } })).toThrow(
      /spawn/,
    );
  });

  it("refuses a layer count that is not three", () => {
    const bad = input("Bad");
    expect(() => validateMapInput({ ...bad, layers: bad.layers.slice(0, 2) })).toThrow(/layers/);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run test/maps-layers.test.ts`
Expected: FAIL — `MapInput` still requires `blocks`.

- [ ] **Step 7: Change `maps.ts`**

Replace `MapInput` at :75 with:

```ts
export interface MapInput {
  name: string;
  tilesetId: string;
  cols: number;
  rows: number;
  layers: readonly TileLayer[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  markers?: MapMarkers | undefined;
}
```

Replace the `encodeBlocks`/`decodeBlocks` helpers at :95-100 with:

```ts
function encodeLayers(layers: readonly TileLayer[]): string {
  return JSON.stringify(layers.map(encodeTileLayer));
}

/** Never throws: a row written by an older build, or corrupted, yields empty layers rather than
 *  failing every map the account owns. */
function decodeLayers(text: string, cols: number, rows: number): TileLayer[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [emptyLayer(cols, rows), emptyLayer(cols, rows), emptyLayer(cols, rows)];
  }
  if (!Array.isArray(raw) || raw.length !== MAP_LAYERS) {
    return [emptyLayer(cols, rows), emptyLayer(cols, rows), emptyLayer(cols, rows)];
  }
  return raw.map((entry) => parseTileLayer(entry, cols, rows) ?? emptyLayer(cols, rows));
}
```

In `validateMapInput`, replace the size derivation and the `data` construction at :131-141:

```ts
  const { cols, rows } = input;
  if (cols < MAP_MIN_COLS || cols > MAP_MAX_COLS || rows < MAP_MIN_ROWS || rows > MAP_MAX_ROWS) {
    throw new Error(`size: ${MAP_MIN_COLS}x${MAP_MIN_ROWS} to ${MAP_MAX_COLS}x${MAP_MAX_ROWS}`);
  }
  if (input.layers.length !== MAP_LAYERS) {
    throw new Error(`layers: exactly ${MAP_LAYERS} required`);
  }
  for (const layer of input.layers) {
    if (layer.cols !== cols || layer.rows !== rows) {
      throw new Error("layers: every layer must match the map size");
    }
  }
  if (!tilesetById(input.tilesetId)) {
    throw new Error(`tileset: unknown tileset ${input.tilesetId}`);
  }
  if (input.elements.length > MAX_MAP_ELEMENTS) {
    throw new Error(`elements: at most ${MAX_MAP_ELEMENTS}`);
  }
  const data: MapData = {
    tilesetId: input.tilesetId,
    cols,
    rows,
    layers: input.layers,
    elements: input.elements,
    spawn: input.spawn,
  };
```

The rest of `validateMapInput` — element placement, spawn walkability, marker walkability — is unchanged: it all runs off `bakeCollision`, whose signature did not move.

In `createMap` and `updateMap`, replace `blocks: encodeBlocks(input.blocks)` with `tilesetId: input.tilesetId, layers: encodeLayers(input.layers)` and take `cols`/`rows` from `input` rather than from `blocksFirstRow`. Delete `blocksFirstRow`.

In `toStoredMap`, replace `blocks: decodeBlocks(row.blocks)` with:

```ts
    tilesetId: row.tilesetId,
    cols: row.cols,
    rows: row.rows,
    layers: decodeLayers(row.layers, row.cols, row.rows),
```

Replace `BUILTIN_MAP` at :55 with a layer-built equivalent:

```ts
const BUILTIN_BLOCKS = [
  "################",
  "#..............#",
  "#..............#",
  "#....######....#",
  "#....######....#",
  "#..............#",
  "#..............#",
  "################",
];

const BUILTIN_LAYERS = layersFromBlocks(BUILTIN_BLOCKS);

/** Deliberately 16x8 — below `MAP_MIN_*`, so it could never pass `validateMapInput`. It is the
 *  fallback room, not authored content. */
export const BUILTIN_MAP: StoredMap = {
  id: BUILTIN_MAP_ID,
  accountId: null,
  name: "Nowhere",
  revision: 1,
  tilesetId: TINY_SWORDS_TILESET_ID,
  cols: BUILTIN_LAYERS.cols,
  rows: BUILTIN_LAYERS.rows,
  layers: BUILTIN_LAYERS.layers,
  elements: [],
  spawn: { col: 2, row: 2 },
  markers: EMPTY_MARKERS,
};
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/maps-layers.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Commit**

```bash
git add src/server/db/schema.ts src/server/maps.ts migrations/ test/maps-layers.test.ts
git commit -m "store maps as tile layers in D1"
```

---

### Task 10: Layers reach the client

The welcome carries **baked** terrain (`tiles`) plus scenery `elements`, with collision already in `tiles`. Layers join as a third appearance-only field, under the same rule: `WorldInfo.layers` never feeds collision. That is why this task adds no invariant.

**Files:**
- Modify: `src/shared/protocol.ts:180-205` (`WorldInfo`), `:432-461` (`parseServerMessage`)
- Modify: `src/server/world/map-zone.ts` (`zoneFromMap`)
- Modify: `src/server/world.ts:512-535` (the welcome `#send`)
- Test: `test/protocol-layers.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 7.
- Produces: `WorldInfo.tilesetId: string` and `WorldInfo.layers: readonly string[]` (the three encoded layers).

- [ ] **Step 1: Write the failing test**

Create `test/protocol-layers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseServerMessage } from "../src/shared/protocol.js";
import { emptyLayer, encodeTileLayer } from "../src/shared/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "../src/shared/tilesets/tiny-swords.js";

function welcome(overrides: Record<string, unknown>) {
  const layer = encodeTileLayer(emptyLayer(4, 3));
  return {
    t: "welcome",
    tick: 0,
    selfId: "a",
    world: {
      zoneId: "verdant-reach",
      revision: 1,
      zoneNameKey: "zone.verdant",
      tiles: ["....", "....", "...."],
      elements: [],
      tilesetId: TINY_SWORDS_TILESET_ID,
      layers: [layer, layer, layer],
      width: 256,
      height: 192,
      playerSize: 32,
      obstacles: [],
      safeZone: null,
      questNpc: null,
      questNpcs: [],
      ...overrides,
    },
    players: [],
    monsters: [],
    guards: [],
    loot: [],
    corpses: [],
    self: null,
  };
}

describe("layers on the wire", () => {
  it("rejects a welcome whose layer count is not three", () => {
    expect(parseServerMessage(JSON.stringify(welcome({ layers: ["0*12"] })))).toBeNull();
  });

  it("rejects a welcome naming an unknown tileset", () => {
    expect(parseServerMessage(JSON.stringify(welcome({ tilesetId: "nope" })))).toBeNull();
  });

  it("rejects a layer that is not a string", () => {
    expect(parseServerMessage(JSON.stringify(welcome({ layers: [1, 2, 3] })))).toBeNull();
  });
});
```

The `questNpc`/`questNpcs` shapes above may need to match whatever `parseServerMessage` already demands; copy them from the existing welcome fixture in `test/protocol.test.ts` if these fail for an unrelated reason.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/protocol-layers.test.ts`
Expected: FAIL — the parser accepts all three, because it does not yet look at `layers`.

- [ ] **Step 3: Extend `WorldInfo`**

In `src/shared/protocol.ts`, add to `WorldInfo` beside `elements`:

```ts
  /** Which tileset `layers` index into. */
  tilesetId: string;
  /**
   * Appearance only. Collision is already in `tiles` above — exactly the rule `elements` follows,
   * and the reason adding layers to the wire introduces no new invariant.
   */
  layers: readonly string[];
```

- [ ] **Step 4: Validate it in `parseServerMessage`**

Add to the welcome branch's condition chain, beside the existing `parseTileMap` and `parseMapElements` checks:

```ts
        typeof value.world.tilesetId === "string" &&
        tilesetById(value.world.tilesetId) !== null &&
        Array.isArray(value.world.layers) &&
        value.world.layers.length === MAP_LAYERS &&
        value.world.layers.every((layer: unknown) => typeof layer === "string") &&
```

with the imports `import { MAP_LAYERS } from "./map-data.js";` and `import { tilesetById } from "./tilesets/tiny-swords.js";`.

- [ ] **Step 5: Carry layers through the zone**

In `src/server/world/map-zone.ts`, `zoneFromMap` already receives a `StoredMap`. Add `tilesetId: stored.tilesetId` and `layers: stored.layers.map(encodeTileLayer)` to the `ZoneDefinition` it builds, adding the matching optional fields to the `ZoneDefinition` type in `src/shared/zones.ts` (compiled catalogue zones have no layers and leave them undefined).

- [ ] **Step 6: Emit them in the welcome**

In `src/server/world.ts`, inside the `world:` object of the welcome `#send` (around :512-535), add:

```ts
    tilesetId: location.definition.tilesetId ?? TINY_SWORDS_TILESET_ID,
    layers: location.definition.layers ?? EMPTY_ENCODED_LAYERS,
```

where `EMPTY_ENCODED_LAYERS` is a module constant built once from the zone's own size for catalogue zones that predate layers.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run test/protocol-layers.test.ts test/protocol.test.ts test/world.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/protocol.ts src/shared/zones.ts src/server/world/map-zone.ts src/server/world.ts test/protocol-layers.test.ts
git commit -m "carry tile layers to the client as appearance-only world data"
```

---

### Task 11: Rendering frozen ids, with priority

**Files:**
- Modify: `src/client/game/tiny-swords-art.ts` (add a 9x6 slicer)
- Modify: `src/client/game/renderer.ts` (`#updateTerrain` at :1828, `buildWorld` at :941-969)
- Test: `test/ui/tileset-slicing.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 10.
- Produces: `sliceTilesetSheet(sheet, cols, rows): Texture[][]`, and two renderer containers, `#tilesBelow` and `#tilesAbove`.

- [ ] **Step 1: Write the failing test**

Create `test/ui/tileset-slicing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { autotileOffset } from "../../src/shared/autotile.js";
import { decodeTileId } from "../../src/shared/tileset.js";
import { CLIFF_WALL_SLOT, GRASS_SLOTS, TINY_SWORDS_TILESET } from "../../src/shared/tilesets/tiny-swords.js";

/** The arithmetic the renderer performs per cell, isolated so it can be asserted without Pixi. */
function sheetCell(id: number): { col: number; row: number } | null {
  const ref = decodeTileId(id);
  if (ref.kind !== "autotile") return null;
  const autotile = TINY_SWORDS_TILESET.autotiles[ref.slot];
  if (!autotile) return null;
  const offset = autotileOffset(autotile.kind, ref.variant);
  return { col: autotile.origin.col + offset.col, row: autotile.origin.row + offset.row };
}

describe("resolving a frozen id to a sheet cell", () => {
  it("puts flat grass in the first group", () => {
    expect(sheetCell(1 + GRASS_SLOTS[0] * 16 + 15)).toEqual({ col: 1, row: 1 });
  });

  it("puts raised grass in the group at column five", () => {
    expect(sheetCell(1 + GRASS_SLOTS[1] * 16 + 15)).toEqual({ col: 6, row: 1 });
  });

  it("puts a cliff wall in the wall band at row four", () => {
    expect(sheetCell(1 + CLIFF_WALL_SLOT * 16 + 3)).toEqual({ col: 6, row: 4 });
  });

  it("stays inside the 9x6 sheet for every declared slot and variant", () => {
    for (let slot = 0; slot < TINY_SWORDS_TILESET.autotiles.length; slot += 1) {
      const autotile = TINY_SWORDS_TILESET.autotiles[slot];
      const variants = autotile?.kind === "run4" ? 4 : 16;
      for (let variant = 0; variant < variants; variant += 1) {
        const cell = sheetCell(1 + slot * 16 + variant);
        expect(cell).not.toBeNull();
        expect(cell?.col).toBeLessThan(9);
        expect(cell?.row).toBeLessThan(6);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run -c vitest.ui.config.ts test/ui/tileset-slicing.test.ts`
Expected: FAIL until Task 4's module resolves — if Task 4 is already committed this passes immediately, which is fine: it pins the arithmetic the renderer must implement.

- [ ] **Step 3: Add the slicer**

In `src/client/game/tiny-swords-art.ts`, beside `sliceAutotileSheet`:

```ts
/**
 * A whole tileset sheet sliced into one `Texture` per cell, indexed `[row][col]`.
 *
 * `sliceAutotileSheet` reads only `Tilemap_Flat.png`'s first 4x4 group; a tileset's ids may land
 * anywhere in a 9x6 sheet, so this slices the lot. Sliced once per sheet, never per frame.
 */
export function sliceTilesetSheet(sheet: Texture, cols: number, rows: number): Texture[][] {
  return Array.from({ length: rows }, (_, row) =>
    Array.from(
      { length: cols },
      (_, col) =>
        new Texture({
          source: sheet.source,
          frame: new Rectangle(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE),
          label: `tileset:${col}:${row}`,
        }),
    ),
  );
}

export const TINY_SWORDS_TILESET_COLS = 9;
export const TINY_SWORDS_TILESET_ROWS = 6;
```

- [ ] **Step 4: Split the terrain containers**

In `renderer.ts#buildWorld` (:941-969), replace the single `#terrain` container with two, keeping every other container's position in the order:

```
#worldBackground -> #waterTerrain -> #foamTerrain -> #tilesBelow -> #gridOverlay
  -> #groundDecor -> #structures -> #ambient -> #actors (sorted) -> #tilesAbove
  -> #hitboxOverlay -> #worldLabels -> navigation debug -> #overlay -> #effects
```

`#tilesAbove` sits immediately after `#actors`: that placement is what makes a character's head pass under a treetop.

- [ ] **Step 5: Draw from ids in `#updateTerrain`**

Add these private members to the renderer class first — the loop below reads all four:

```ts
  #tilesBelow = new Container();
  #tilesAbove = new Container();
  #tileset: Tileset = TINY_SWORDS_TILESET;
  #layers: TileLayer[] = [];
  #tilesetTextures: Texture[][] = [];
```

`#layers` is filled when the welcome arrives, by `parseTileLayer(encoded, cols, rows)` for each of `world.layers`; `#tilesetTextures` by `sliceTilesetSheet(sheet, TINY_SWORDS_TILESET_COLS, TINY_SWORDS_TILESET_ROWS)` beside the existing texture loads. Add the small helper the loop calls:

```ts
function offsetCell(
  autotile: { origin: { col: number; row: number } },
  offset: { col: number; row: number },
): { col: number; row: number } {
  return { col: autotile.origin.col + offset.col, row: autotile.origin.row + offset.row };
}
```

Then rewrite the per-cell body of `#updateTerrain` (:1828) so that, instead of `tileVisual(kindAt(...))` and `landTile(...)`, it walks all three layers for each visible cell:

```ts
for (const layer of this.#layers) {
  const id = layer.ids[row * layer.cols + col] ?? 0;
  const ref = decodeTileId(id);
  if (ref.kind === "empty") continue;
  const entry = ref.kind === "autotile"
    ? this.#tileset.autotiles[ref.slot]
    : this.#tileset.fixed[ref.index];
  if (!entry) continue;
  const cell = ref.kind === "autotile"
    ? offsetCell(entry, autotileOffset(entry.kind, ref.variant))
    : { col: entry.col, row: entry.row };
  const sprite = this.#tilePool.acquire(entry.priority === "above" ? this.#tilesAbove : this.#tilesBelow);
  sprite.texture = this.#tilesetTextures[cell.row]?.[cell.col] ?? Texture.EMPTY;
  sprite.tint = entry.tint ?? 0xffffff;
  sprite.position.set(col * TILE_SIZE, row * TILE_SIZE);
}
```

Keep the existing repaint key (`zone:revision:startX:startY:cols:rows:showGrid`) and the sprite pooling; only the per-cell decision changes. The water and foam passes are untouched — `needsFoam` still reads the baked `tiles`, so a cliff meeting the sea gets its foam at the wall's cell, which is where the water actually meets something.

- [ ] **Step 6: Verify in a browser**

Run `npm run dev`, open an existing map, and confirm: grass reads as grass rather than tilled field, no seams along coastlines, and no horizontal scrollbar. The UI suite runs with `css: false` and cannot catch a visual regression — this step is not optional.

- [ ] **Step 7: Commit**

```bash
git add src/client/game/tiny-swords-art.ts src/client/game/renderer.ts test/ui/tileset-slicing.test.ts
git commit -m "render frozen tile ids with per-tile draw priority"
```

---

### Task 12: The editor stage paints layers

Minimal wiring only. The editor's shadcn chrome is tranche 2; this task keeps the existing editor working against the new model.

**Files:**
- Modify: `src/client/game/map-editor-stage.ts`
- Modify: `src/client/game/editor-state.ts`
- Modify: `src/client/ui/MapEditor.tsx`
- Test: `test/ui/map-editor.test.tsx` (update in place)

**Interfaces:**
- Consumes: Tasks 5, 6, 7, 11.
- Produces: an editor whose grass/water tools call `paintAutotile`/`eraseTile` and whose new elevation tool calls `paintElevation`.

- [ ] **Step 1: Run the existing editor tests to see the damage**

Run: `npx vitest run -c vitest.ui.config.ts test/ui/map-editor.test.tsx`
Expected: FAIL — the editor still builds `blocks`.

- [ ] **Step 2: Replace the editor's terrain state**

In `editor-state.ts`, change the undo/redo snapshot's `blocks: string[]` to `layers: TileLayer[]`, and replace the body of the terrain branch of `applyTool` with:

```ts
import { paintAutotile, paintElevation, eraseTile } from "../../shared/tile-brush.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET } from "../../shared/tilesets/tiny-swords.js";
import type { TileLayer } from "../../shared/tile-layer-codec.js";

/** Which layer a terrain stroke writes to. Elevation is the exception: it owns two, because a
 *  cliff face lands one layer up from the ground that casts it. */
export function applyTerrainTool(
  layers: readonly TileLayer[],
  tool: EditorTool,
  activeLayer: number,
  col: number,
  row: number,
): TileLayer[] {
  const set = TINY_SWORDS_TILESET;
  if (tool.kind === "elevation") {
    return paintElevation(layers, set, tool.level, col, row);
  }
  const target = layers[activeLayer];
  if (!target) return [...layers];
  const painted =
    tool.kind === "grass"
      ? paintAutotile(target, set, GRASS_SLOTS[0], col, row)
      : eraseTile(target, set, col, row);
  const next = [...layers];
  next[activeLayer] = painted;
  return next;
}
```

`water` and `eraser` both take the `eraseTile` branch: on the ground layer an empty cell *is* water, so the two tools were always the same operation wearing different names. Keep both names in the toolbar — the editor's vocabulary is tranche 2's problem, not this task's.

Add `elevation` to the `EditorTool` union with its `level: 0 | 1 | 2`.

- [ ] **Step 3: Point the stage at the tileset textures**

In `map-editor-stage.ts`, load `TINY_SWORDS_TERRAIN.tileset` alongside `flat`/`water`/`foam`, slice it with `sliceTilesetSheet`, and draw cells with the same id-walking loop Task 11 added to the renderer. The two must agree; if the loop is copied twice, extract it to a shared module under `src/client/game/`.

- [ ] **Step 4: Update the editor tests**

Rewrite the assertions in `test/ui/map-editor.test.tsx` that inspect `blocks` to inspect `layers[0].ids` instead. Add one test: selecting the elevation tool at level 1 and painting a cell puts a wall on layer 1 in the cell below.

- [ ] **Step 5: Run the full check**

Run: `npm run check`
Expected: PASS — catalog, map, lint, typecheck, tests, UI tests.

- [ ] **Step 6: Commit**

```bash
git add src/client/game/map-editor-stage.ts src/client/game/editor-state.ts src/client/ui/MapEditor.tsx test/ui/map-editor.test.tsx
git commit -m "paint tile layers in the map editor"
```

---

## Verification

After Task 12, before opening a pull request:

- [ ] `npm run check` passes.
- [ ] `npm run dev`, then walk a migrated map: the same walls block you as before.
- [ ] Paint a level-1 area, confirm the cliff face appears below it and that you cannot walk into it.
- [ ] Paint a ramp joining the two levels, confirm you can walk up.
- [ ] Confirm no horizontal scrollbar and no near-white game text (the `legacy.css` trap in CLAUDE.md).
