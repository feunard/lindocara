# Dynamic Map Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The adventure editor edits an always-256×256 ocean canvas — grid everywhere, paint anywhere — and the saved map is the bounding rect of painted content plus a 2-cell ocean margin, derived automatically.

**Architecture:** New pure engine primitives (`map-canvas.ts`) pad a stored map into the canvas at session open and crop it back to its derived content rect at save. The stored format, server validation, wire format and runtime are untouched; the editor stage gains a save-rect outline, a derived-rect-restricted collision overlay and a cached grid. Spec: `docs/archive/specs/2026-08-13-dynamic-map-size-design.md`.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Vitest (engine=node, editor=jsdom, server=test-api real app), Three.js via `@lindocara/hd2d`, Biome.

## Global Constraints

- The canvas is `MAP_MAX_COLS × MAP_MAX_ROWS` = 256×256 (`packages/engine/src/map-limits.ts`). Never raise it — `MAX_HEIGHTFIELD_SIZE` and `MOVE_COORDINATE_LIMIT` are coupled to it.
- `MAP_OCEAN_MARGIN = 2` cells on every side of the content rect.
- Saved maps keep the existing floor `MAP_MIN_COLS × MAP_MIN_ROWS` (20×15) and format (`cols`/`rows` + dense RLE layers). No schema, wire, or server-validation change anywhere in this plan.
- Water/ocean = `EMPTY_TILE` (0) on the ground layer. There is no water tile id; do not invent one.
- All strings English in code/commits; player-facing strings go in BOTH `packages/engine/src/i18n/en.ts` and `fr.ts` (the i18n test enforces parity).
- Biome: no non-null assertions (`!`); narrow instead. Multi-line JSDoc (`/** … */`).
- Tests: no `vi.mock`. Server coverage drives the real app (`packages/server/test-api/`).
- Run tests per package: `npm run test:engine`, `npm run test:editor`, `npm run test:renderer`, `npm run test:server`. Before finishing: `npm run check`.
- Never add a `Co-authored-by` trailer to any commit.

---

### Task 1: Engine canvas/crop primitives (`map-canvas.ts`)

**Files:**
- Modify: `packages/engine/src/map-limits.ts` (add `MAP_OCEAN_MARGIN`)
- Create: `packages/engine/src/map-canvas.ts`
- Test: `packages/engine/test/map-canvas.test.ts`

**Interfaces:**
- Consumes: `TileLayer` (`tile-layer-codec.ts`), `EMPTY_TILE` (`tileset.ts`), `MapElement`/`MapMarkers`/`EMPTY_MARKERS`/`MAP_LAYERS` (`map-data.ts`), `MapEvent` (`map-events.ts`), `MAP_MIN_COLS`/`MAP_MIN_ROWS`/`MAP_MAX_COLS`/`MAP_MAX_ROWS` (`map-limits.ts`).
- Produces (later tasks import from `@lindocara/engine/map-canvas.js`):
  - `interface MapRect { col: number; row: number; cols: number; rows: number }`
  - `interface MapCanvasContent { readonly layers: readonly TileLayer[]; readonly elements: readonly MapElement[]; readonly spawn: { readonly col: number; readonly row: number }; readonly markers?: MapMarkers | undefined; readonly events?: readonly MapEvent[] | undefined }`
  - `interface CanvasMapPatch { layers: TileLayer[]; elements: MapElement[]; spawn: { col: number; row: number }; markers: MapMarkers; events: MapEvent[] }`
  - `contentBounds(map: MapCanvasContent): MapRect`
  - `derivedMapRect(map: MapCanvasContent): MapRect`
  - `padMapToCanvas(map: MapCanvasContent): CanvasMapPatch`
  - `cropMapToRect(map: MapCanvasContent, rect: MapRect): CanvasMapPatch`
  - `MAP_OCEAN_MARGIN` (from `map-limits.ts`)

Patch objects (not generics) keep the functions cast-free: callers spread them over their own richer map type (`{ ...editorMap, ...padMapToCanvas(editorMap) }`), so `EditorMap`'s extra fields (name, audio, …) ride along untouched.

- [ ] **Step 1: Write the failing tests**

`packages/engine/test/map-canvas.test.ts`:

```ts
import { defaultMapInput } from "@lindocara/engine/map-template.js";
import {
  contentBounds,
  cropMapToRect,
  derivedMapRect,
  type MapCanvasContent,
  padMapToCanvas,
} from "@lindocara/engine/map-canvas.js";
import {
  MAP_MAX_COLS,
  MAP_MAX_ROWS,
  MAP_MIN_COLS,
  MAP_MIN_ROWS,
  MAP_OCEAN_MARGIN,
} from "@lindocara/engine/map-limits.js";
import { emptyLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { EMPTY_TILE } from "@lindocara/engine/tileset.js";
import { describe, expect, test } from "vitest";

/** The default 20×15 all-grass template, centered pad offsets. */
const PAD_COL = Math.floor((MAP_MAX_COLS - MAP_MIN_COLS) / 2); // 118
const PAD_ROW = Math.floor((MAP_MAX_ROWS - MAP_MIN_ROWS) / 2); // 120

function paddedDefault(): MapCanvasContent {
  const input = defaultMapInput("canvas-test");
  return { ...input, ...padMapToCanvas(input) };
}

function idAt(layer: TileLayer, col: number, row: number): number {
  return layer.ids[row * layer.cols + col] ?? EMPTY_TILE;
}

/** A canvas doc that is pure ocean except one painted cell and the spawn on it. */
function lonelyTile(col: number, row: number): MapCanvasContent {
  const ground = emptyLayer(MAP_MAX_COLS, MAP_MAX_ROWS);
  const ids = [...ground.ids];
  ids[row * MAP_MAX_COLS + col] = 500;
  return {
    layers: [
      { cols: MAP_MAX_COLS, rows: MAP_MAX_ROWS, ids },
      emptyLayer(MAP_MAX_COLS, MAP_MAX_ROWS),
      emptyLayer(MAP_MAX_COLS, MAP_MAX_ROWS),
    ],
    elements: [],
    spawn: { col, row },
    events: [],
  };
}

describe("padMapToCanvas", () => {
  test("centers a stored map in the 256×256 canvas and shifts every coordinate", () => {
    const input = defaultMapInput("canvas-test");
    const padded = padMapToCanvas(input);
    expect(padded.layers).toHaveLength(3);
    for (const layer of padded.layers) {
      expect(layer.cols).toBe(MAP_MAX_COLS);
      expect(layer.rows).toBe(MAP_MAX_ROWS);
    }
    const source = input.layers[0];
    const target = padded.layers[0];
    if (!source || !target) throw new Error("missing ground layer");
    for (let row = 0; row < MAP_MIN_ROWS; row += 1) {
      for (let col = 0; col < MAP_MIN_COLS; col += 1) {
        expect(idAt(target, col + PAD_COL, row + PAD_ROW)).toBe(idAt(source, col, row));
      }
    }
    expect(padded.spawn).toEqual({
      col: input.spawn.col + PAD_COL,
      row: input.spawn.row + PAD_ROW,
    });
  });

  test("pads a degraded empty document to three empty canvas layers", () => {
    const padded = padMapToCanvas({ layers: [], elements: [], spawn: { col: 0, row: 0 } });
    expect(padded.layers).toHaveLength(3);
    const ground = padded.layers[0];
    if (!ground) throw new Error("missing ground layer");
    expect(ground.ids.every((id) => id === EMPTY_TILE)).toBe(true);
  });
});

describe("contentBounds", () => {
  test("bounds the padded default template exactly", () => {
    expect(contentBounds(paddedDefault())).toEqual({
      col: PAD_COL,
      row: PAD_ROW,
      cols: MAP_MIN_COLS,
      rows: MAP_MIN_ROWS,
    });
  });

  test("counts tiles on upper layers, elements, events and the spawn", () => {
    const base = lonelyTile(100, 100);
    const cliff = emptyLayer(MAP_MAX_COLS, MAP_MAX_ROWS);
    const cliffIds = [...cliff.ids];
    cliffIds[40 * MAP_MAX_COLS + 60] = 900; // a lone cliff tile far north-west
    const map: MapCanvasContent = {
      ...base,
      layers: [base.layers[0] ?? cliff, { ...cliff, ids: cliffIds }, cliff],
    };
    const bounds = contentBounds(map);
    expect(bounds.col).toBe(60);
    expect(bounds.row).toBe(40);
    expect(bounds.col + bounds.cols - 1).toBe(100);
    expect(bounds.row + bounds.rows - 1).toBe(100);
  });
});

describe("derivedMapRect", () => {
  test("adds the ocean margin around content", () => {
    expect(derivedMapRect(paddedDefault())).toEqual({
      col: PAD_COL - MAP_OCEAN_MARGIN,
      row: PAD_ROW - MAP_OCEAN_MARGIN,
      cols: MAP_MIN_COLS + 2 * MAP_OCEAN_MARGIN,
      rows: MAP_MIN_ROWS + 2 * MAP_OCEAN_MARGIN,
    });
  });

  test("floors a tiny content rect to the 20×15 minimum", () => {
    const rect = derivedMapRect(lonelyTile(128, 128));
    expect(rect.cols).toBe(MAP_MIN_COLS);
    expect(rect.rows).toBe(MAP_MIN_ROWS);
    expect(rect.col).toBeLessThanOrEqual(128);
    expect(rect.col + rect.cols).toBeGreaterThan(128);
  });

  test("clamps to the canvas at its edge", () => {
    const rect = derivedMapRect(lonelyTile(0, 0));
    expect(rect.col).toBe(0);
    expect(rect.row).toBe(0);
    expect(rect.cols).toBe(MAP_MIN_COLS);
    expect(rect.rows).toBe(MAP_MIN_ROWS);
  });
});

describe("cropMapToRect", () => {
  test("crop after pad preserves content relative to the margin", () => {
    const input = defaultMapInput("canvas-test");
    const canvas = paddedDefault();
    const cropped = cropMapToRect(canvas, derivedMapRect(canvas));
    const ground = cropped.layers[0];
    const source = input.layers[0];
    if (!ground || !source) throw new Error("missing ground layer");
    expect(ground.cols).toBe(MAP_MIN_COLS + 2 * MAP_OCEAN_MARGIN);
    expect(ground.rows).toBe(MAP_MIN_ROWS + 2 * MAP_OCEAN_MARGIN);
    for (let row = 0; row < MAP_MIN_ROWS; row += 1) {
      for (let col = 0; col < MAP_MIN_COLS; col += 1) {
        expect(idAt(ground, col + MAP_OCEAN_MARGIN, row + MAP_OCEAN_MARGIN)).toBe(
          idAt(source, col, row),
        );
      }
    }
    expect(cropped.spawn).toEqual({
      col: input.spawn.col + MAP_OCEAN_MARGIN,
      row: input.spawn.row + MAP_OCEAN_MARGIN,
    });
  });

  test("cropping twice at the derived rect is idempotent", () => {
    const canvas = paddedDefault();
    const once = { ...canvas, ...cropMapToRect(canvas, derivedMapRect(canvas)) };
    const twice = { ...once, ...cropMapToRect(once, derivedMapRect(once)) };
    expect(twice.layers).toEqual(once.layers);
    expect(twice.spawn).toEqual(once.spawn);
  });

  test("shifts elements, events and markers by the rect origin", () => {
    const base = lonelyTile(128, 128);
    const map: MapCanvasContent = {
      ...base,
      elements: [
        { id: "e1", col: 129, row: 128, offsetX: 1, offsetY: 2, assetId: anyAssetId() },
      ],
      events: [{ ...anyEvent(), col: 127, row: 129 }],
      markers: {
        entries: [{ id: "north-gate", col: 128, row: 127 }],
        exits: [],
        monsterSpawns: [],
      },
    };
    const rect = derivedMapRect(map);
    const cropped = cropMapToRect(map, rect);
    expect(cropped.elements[0]?.col).toBe(129 - rect.col);
    expect(cropped.elements[0]?.offsetX).toBe(1);
    expect(cropped.events[0]?.col).toBe(127 - rect.col);
    expect(cropped.events[0]?.row).toBe(129 - rect.row);
    expect(cropped.markers.entries[0]?.col).toBe(128 - rect.col);
  });
});
```

For `anyAssetId()` / `anyEvent()`, reuse whatever fixture the existing `packages/engine/test/map-data.test.ts` and `map-events` tests build events/elements with (an `EditorAssetId` literal that `isEditorAssetId` accepts, and a minimal single-page `MapEvent` — copy the literal from an existing engine test rather than inventing one).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:engine -- map-canvas`
Expected: FAIL — `Cannot find module '@lindocara/engine/map-canvas.js'`

- [ ] **Step 3: Implement**

Add to `packages/engine/src/map-limits.ts`:

```ts
/** Ocean cells kept around the derived content rect when the editor crops a map for saving. */
export const MAP_OCEAN_MARGIN = 2;
```

Create `packages/engine/src/map-canvas.ts`:

```ts
/**
 * The editor's virtual canvas: a session always edits a MAP_MAX_COLS × MAP_MAX_ROWS ocean document
 * (`padMapToCanvas`), and a save stores only the bounding rect of authored content plus
 * MAP_OCEAN_MARGIN cells of ocean (`derivedMapRect` + `cropMapToRect`). Pure and platform-free —
 * the stored map format does not change, so the server never sees any of this.
 *
 * Markers count toward content bounds even though they are quarantined: `parseMapMarkers` bounds-
 * checks them at parse time, so a legacy marker left outside the crop would fail the save.
 */
import type { MapElement, MapMarkers } from "./map-data.js";
import { EMPTY_MARKERS, MAP_LAYERS } from "./map-data.js";
import type { MapEvent } from "./map-events.js";
import {
  MAP_MAX_COLS,
  MAP_MAX_ROWS,
  MAP_MIN_COLS,
  MAP_MIN_ROWS,
  MAP_OCEAN_MARGIN,
} from "./map-limits.js";
import type { TileLayer } from "./tile-layer-codec.js";
import { EMPTY_TILE } from "./tileset.js";

export interface MapRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** The slice of a map document these functions read. Every field is accepted readonly so both
 *  `MapInput` and the editor's `EditorMap` satisfy it structurally. */
export interface MapCanvasContent {
  readonly layers: readonly TileLayer[];
  readonly elements: readonly MapElement[];
  readonly spawn: { readonly col: number; readonly row: number };
  readonly markers?: MapMarkers | undefined;
  readonly events?: readonly MapEvent[] | undefined;
}

/** What pad/crop return: exactly the shifted fields, to be spread over the caller's own map type. */
export interface CanvasMapPatch {
  layers: TileLayer[];
  elements: MapElement[];
  spawn: { col: number; row: number };
  markers: MapMarkers;
  events: MapEvent[];
}

function layerDims(map: MapCanvasContent): { cols: number; rows: number } {
  const ground = map.layers[0];
  return { cols: ground?.cols ?? 0, rows: ground?.rows ?? 0 };
}

function shiftLayer(
  source: TileLayer | undefined,
  dCol: number,
  dRow: number,
  cols: number,
  rows: number,
): TileLayer {
  const ids = new Array<number>(cols * rows).fill(EMPTY_TILE);
  if (source) {
    for (let row = 0; row < source.rows; row += 1) {
      for (let col = 0; col < source.cols; col += 1) {
        const id = source.ids[row * source.cols + col] ?? EMPTY_TILE;
        if (id === EMPTY_TILE) continue;
        const targetCol = col + dCol;
        const targetRow = row + dRow;
        if (targetCol < 0 || targetRow < 0 || targetCol >= cols || targetRow >= rows) continue;
        ids[targetRow * cols + targetCol] = id;
      }
    }
  }
  return { cols, rows, ids };
}

function shiftMapContent(
  map: MapCanvasContent,
  dCol: number,
  dRow: number,
  cols: number,
  rows: number,
): CanvasMapPatch {
  const inside = (item: { col: number; row: number }): boolean => {
    const col = item.col + dCol;
    const row = item.row + dRow;
    return col >= 0 && row >= 0 && col < cols && row < rows;
  };
  const shift = <P extends { col: number; row: number }>(item: P): P => ({
    ...item,
    col: item.col + dCol,
    row: item.row + dRow,
  });
  const markers = map.markers ?? EMPTY_MARKERS;
  return {
    layers: Array.from({ length: MAP_LAYERS }, (_unused, index) =>
      shiftLayer(map.layers[index], dCol, dRow, cols, rows),
    ),
    elements: map.elements.filter(inside).map(shift),
    spawn: shift({ col: map.spawn.col, row: map.spawn.row }),
    markers: {
      entries: markers.entries.filter(inside).map(shift),
      exits: markers.exits.filter(inside).map(shift),
      monsterSpawns: markers.monsterSpawns.filter(inside).map(shift),
    },
    events: (map.events ?? []).filter(inside).map(shift),
  };
}

/** The stored map, centered in the maximum authorable rect. Every cell of the canvas is paintable;
 *  everything outside the stored rect starts as ocean. */
export function padMapToCanvas(map: MapCanvasContent): CanvasMapPatch {
  const { cols, rows } = layerDims(map);
  const dCol = Math.max(0, Math.floor((MAP_MAX_COLS - cols) / 2));
  const dRow = Math.max(0, Math.floor((MAP_MAX_ROWS - rows) / 2));
  return shiftMapContent(map, dCol, dRow, MAP_MAX_COLS, MAP_MAX_ROWS);
}

/** Bounding rect of everything authored: non-empty tiles on any layer, elements, events, markers
 *  and the spawn cell. The spawn always exists, so there is always at least one content cell. */
export function contentBounds(map: MapCanvasContent): MapRect {
  let minCol = map.spawn.col;
  let maxCol = map.spawn.col;
  let minRow = map.spawn.row;
  let maxRow = map.spawn.row;
  const include = (col: number, row: number): void => {
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  };
  for (const layer of map.layers) {
    for (let row = 0; row < layer.rows; row += 1) {
      for (let col = 0; col < layer.cols; col += 1) {
        if ((layer.ids[row * layer.cols + col] ?? EMPTY_TILE) !== EMPTY_TILE) include(col, row);
      }
    }
  }
  for (const element of map.elements) include(element.col, element.row);
  for (const event of map.events ?? []) include(event.col, event.row);
  const markers = map.markers ?? EMPTY_MARKERS;
  for (const marker of markers.entries) include(marker.col, marker.row);
  for (const marker of markers.exits) include(marker.col, marker.row);
  for (const marker of markers.monsterSpawns) include(marker.col, marker.row);
  return { col: minCol, row: minRow, cols: maxCol - minCol + 1, rows: maxRow - minRow + 1 };
}

/** Grow `[lo, hi)` to at least `min` cells, distributing the growth evenly, inside `[0, limit)`. */
function widenSpan(lo: number, hi: number, min: number, limit: number): { lo: number; hi: number } {
  if (hi - lo >= min) return { lo, hi };
  const grownLo = Math.max(0, lo - Math.floor((min - (hi - lo)) / 2));
  const grownHi = Math.min(limit, grownLo + min);
  return { lo: Math.max(0, grownHi - min), hi: grownHi };
}

/** The rect a save stores: content bounds + the ocean margin, floored to the map size minimum and
 *  clamped to the document. This IS "the size calculated from my tile addition". */
export function derivedMapRect(map: MapCanvasContent): MapRect {
  const { cols: docCols, rows: docRows } = layerDims(map);
  const bounds = contentBounds(map);
  const horizontal = widenSpan(
    Math.max(0, bounds.col - MAP_OCEAN_MARGIN),
    Math.min(docCols, bounds.col + bounds.cols + MAP_OCEAN_MARGIN),
    Math.min(MAP_MIN_COLS, docCols),
    docCols,
  );
  const vertical = widenSpan(
    Math.max(0, bounds.row - MAP_OCEAN_MARGIN),
    Math.min(docRows, bounds.row + bounds.rows + MAP_OCEAN_MARGIN),
    Math.min(MAP_MIN_ROWS, docRows),
    docRows,
  );
  return {
    col: horizontal.lo,
    row: vertical.lo,
    cols: horizontal.hi - horizontal.lo,
    rows: vertical.hi - vertical.lo,
  };
}

/** Slice the document down to `rect`, shifting every coordinate to the rect's origin. */
export function cropMapToRect(map: MapCanvasContent, rect: MapRect): CanvasMapPatch {
  return shiftMapContent(map, -rect.col, -rect.row, rect.cols, rect.rows);
}
```

Note: a document smaller than the 20×15 floor (a legacy fixture used directly, without padding) keeps working — `Math.min(MAP_MIN_COLS, docCols)` caps the floor at the document's own size, so `derivedMapRect` of an unpadded 20×15 all-grass map is the whole document and `cropMapToRect` is the identity. Existing editor tests that call `toSaveInput` on unpadded fixtures stay green.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:engine -- map-canvas`
Expected: PASS. Also run `npm run typecheck:engine`.

- [ ] **Step 5: Commit**

```bash
git add packages/engine/src/map-limits.ts packages/engine/src/map-canvas.ts packages/engine/test/map-canvas.test.ts
git commit -m "feat(engine): map canvas pad/derive/crop primitives for dynamic map size"
```

---

### Task 2: Editor opens on the canvas, saves the derived crop

**Files:**
- Modify: `packages/editor/src/game/editor-state.ts` (`toSaveInput`, new `canvasEditorMap`/`croppedForSave`)
- Modify: `packages/editor/src/ui/editor/AdventureEditorScreen.tsx` (`toEditorMap` ~line 180, `memberInfoFromEditor` ~line 199, the preview launch ~line 646)
- Test: `packages/editor/test/editor-state.test.ts`

**Interfaces:**
- Consumes: Task 1's `padMapToCanvas`, `cropMapToRect`, `derivedMapRect` from `@lindocara/engine/map-canvas.js`.
- Produces (exported from `editor-state.ts`):
  - `canvasEditorMap(map: EditorMap): EditorMap` — the padded working document
  - `croppedForSave(map: EditorMap): EditorMap` — the derived-rect crop a save/preview/thumbnail uses

- [ ] **Step 1: Write the failing tests**

Add to `packages/editor/test/editor-state.test.ts` (follow its existing imports/fixtures):

```ts
describe("dynamic map size", () => {
  test("canvasEditorMap pads the document to the full canvas", () => {
    const canvas = canvasEditorMap(blankMap("m", 20, 15));
    expect(editorMapSize(canvas)).toEqual({ cols: MAP_MAX_COLS, rows: MAP_MAX_ROWS });
  });

  test("toSaveInput saves the derived rect, not the canvas", () => {
    const canvas = canvasEditorMap(blankMap("m", 20, 15));
    const saved = toSaveInput(canvas);
    expect(saved.cols).toBe(20 + 2 * MAP_OCEAN_MARGIN);
    expect(saved.rows).toBe(15 + 2 * MAP_OCEAN_MARGIN);
    // Spawn was dead centre of the 20×15 grass; the crop keeps it there, margin included.
    expect(saved.spawn).toEqual({ col: 10 + MAP_OCEAN_MARGIN, row: 7 + MAP_OCEAN_MARGIN });
    // The heightfield is compiled from the CROPPED map, so its square side follows the crop.
    const heightfield = decodeMap(saved.heightfield);
    expect(heightfield.size).toBe(Math.max(saved.cols, saved.rows));
  });

  test("painting far out on the canvas grows the next save", () => {
    const canvas = canvasEditorMap(blankMap("m", 20, 15));
    const ground = canvas.layers[0];
    if (!ground) throw new Error("missing ground layer");
    const ids = [...ground.ids];
    // One grass tile 30 cells east of the padded content.
    const col = 118 + 20 + 30;
    const row = 120 + 7;
    ids[row * ground.cols + col] = ids[120 * ground.cols + 118] ?? 0;
    const painted = { ...canvas, layers: [{ ...ground, ids }, ...canvas.layers.slice(1)] };
    const saved = toSaveInput(painted);
    expect(saved.cols).toBeGreaterThan(20 + 2 * MAP_OCEAN_MARGIN + 25);
  });

  test("erasing the outlier shrinks the save back (pure derivation)", () => {
    const canvas = canvasEditorMap(blankMap("m", 20, 15));
    expect(toSaveInput(canvas).cols).toBe(20 + 2 * MAP_OCEAN_MARGIN);
  });
});
```

Imports needed there: `canvasEditorMap`, `croppedForSave` (from `../src/game/editor-state.js`), `MAP_MAX_COLS`/`MAP_MAX_ROWS`/`MAP_OCEAN_MARGIN` (engine `map-limits.js`), `decodeMap` (engine `hd2d/map-data.js`).

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:editor -- editor-state`
Expected: FAIL — `canvasEditorMap` is not exported.

- [ ] **Step 3: Implement**

In `packages/editor/src/game/editor-state.ts`, import from the engine:

```ts
import { cropMapToRect, derivedMapRect, padMapToCanvas } from "@lindocara/engine/map-canvas.js";
```

Add beside `blankMap`:

```ts
/** The whole-canvas working document a session edits: the stored map centered in the maximum
 *  authorable rect. Every cell is paintable; empty cells are ocean. Applied ONCE at session open —
 *  coordinates never shift again for the life of the session. */
export function canvasEditorMap(map: EditorMap): EditorMap {
  return { ...map, ...padMapToCanvas(map) };
}

/** What a save stores: the derived content rect (+ ocean margin) cropped out of the canvas. Also
 *  what the playable preview and the member thumbnail read, so they match the runtime exactly. */
export function croppedForSave(map: EditorMap): EditorMap {
  return { ...map, ...cropMapToRect(map, derivedMapRect(map)) };
}
```

Change `toSaveInput` to crop first — replace `const data = toMapData(map);` with:

```ts
  const cropped = croppedForSave(map);
  const data = toMapData(cropped);
```

and switch every `map.` read below it that carries coordinates to `cropped.` (`elements`, `spawn`, `events`, and the heightfield compile `compileAuthoredMap(data, cropped.events)`). Name/audio/heroSettings/dayNightCycle/fixedLighting stay off `map` (they carry no coordinates).

In `packages/editor/src/ui/editor/AdventureEditorScreen.tsx`:

1. `toEditorMap` (~line 180) wraps its return in the canvas:

```ts
function toEditorMap(map: MapPayload): EditorMap {
  return canvasEditorMap({
    /* existing object literal unchanged */
  });
}
```

2. `memberInfoFromEditor` (~line 208): thumbnail mask from the crop —

```ts
  solid: solidMaskFromMapPayload(toMapData(croppedForSave(edited))),
```

3. The preview launch (~line 646): compile the crop so preview bounds match runtime —

```ts
    const cropped = croppedForSave(edited);
    const data: MapData = toMapData(cropped);
    const previewStart = startMapPreview(data, cropped.events, {
```

(keep the options object as-is).

Both `canvasEditorMap` and `croppedForSave` are imported from `../../game/editor-state.js` where the screen already imports `toSaveInput`.

Do NOT touch `currentQuestMap` (~line 1515) or the `sandboxMap` prop (~line 1743): quest references are event-uuid-based and those `cols`/`rows` are display-only stored dims.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:editor` and `npm run typecheck:editor`
Expected: PASS. If an existing test asserts `toSaveInput(...).cols === 20` on an UNPADDED fixture, it still passes (see Task 1's floor-capping note). If one asserts on a PADDED fixture, update it to the derived dims — that changed behavior is the feature.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/game/editor-state.ts packages/editor/src/ui/editor/AdventureEditorScreen.tsx packages/editor/test/editor-state.test.ts
git commit -m "feat(editor): edit on the full ocean canvas, save the derived content rect"
```

---

### Task 3: Stage overlays — save-rect outline, bounded collision overlay, cached grid, content-centered camera

**Files:**
- Modify: `packages/renderer/src/hd2d/visual-layer.ts` (`Hd2dEditorOverlay` + `setEditorOverlay`, ~lines 119-138 and 1281-1335)
- Modify: `packages/editor/src/game/map-editor-stage.ts` (`blockedCells` ~line 144, `centreCamera` ~line 228, `drawOverlay` ~line 238)
- Test: `packages/editor/test/map-editor-stage.test.tsx`

**Interfaces:**
- Consumes: Task 1's `derivedMapRect`, `MapRect`.
- Produces: `Hd2dEditorOverlay.saveRect?: { x: number; z: number; cols: number; rows: number } | null` — world-coordinate origin + size of the rect a save would store.

- [ ] **Step 1: Write the failing test**

In `packages/editor/test/map-editor-stage.test.tsx`, following that file's existing harness (it already opens a stage and inspects renderer interactions — copy its setup verbatim for a new case):

```ts
test("the overlay carries the derived save rect and bounds the collision overlay to it", async () => {
  // Open the stage on canvasEditorMap(blankMap("m", 20, 15)) using this file's existing helper.
  // Capture the last Hd2dEditorOverlay handed to setEditorOverlay (existing pattern in this file).
  const overlay = lastEditorOverlay();
  const size = MAP_MAX_COLS; // canvas is square at 256
  const expected = {
    x: 116 - size / 2,
    z: 118 - size / 2,
    cols: 24,
    rows: 19,
  };
  expect(overlay.saveRect).toEqual(expected);
  // Ocean outside the derived rect must NOT be marked blocked: every collider stays inside it.
  for (const cell of overlay.colliders) {
    expect(cell.x).toBeGreaterThanOrEqual(expected.x - 1);
    expect(cell.x).toBeLessThanOrEqual(expected.x + expected.cols + 1);
    expect(cell.z).toBeGreaterThanOrEqual(expected.z - 1);
    expect(cell.z).toBeLessThanOrEqual(expected.z + expected.rows + 1);
  }
});
```

(The exact helper names come from the file — reuse whatever it already uses to reach the overlay; do not add `vi.mock`.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:editor -- map-editor-stage`
Expected: FAIL — `saveRect` is `undefined` on the overlay.

- [ ] **Step 3: Implement — renderer side**

In `packages/renderer/src/hd2d/visual-layer.ts`:

1. Extend the overlay contract (after `cursorCells` in `Hd2dEditorOverlay`):

```ts
  /** World-coordinate outline of the rect a save would store — origin corner + size in cells.
   *  Drawn as a bright boundary so the author always sees what will be saved. */
  saveRect?: { x: number; z: number; cols: number; rows: number } | null;
```

2. Cache the grid. The grid is by far the heaviest overlay child (a 256×256 canvas is ~263k vertices, each with a `#groundY` lookup) and `setEditorOverlay` runs on every hover — rebuilding it there stalls the pointer. Give the class two private fields:

```ts
  #gridLines: THREE.LineSegments | null = null;
  #gridKey = "";
```

In `setEditorOverlay`, detach the cached grid before the clear loop so `disposeObject` does not destroy it, and rebuild only when its inputs change:

```ts
  setEditorOverlay(overlay: Hd2dEditorOverlay | null): void {
    this.#editorOverlay = overlay;
    if (this.#gridLines) this.#gridLines.removeFromParent();
    for (const child of [...this.#editorRoot.children]) disposeObject(child);
    this.#editorRoot.clear();
    if (!overlay) {
      this.#positionEditorPreview();
      return;
    }

    const half = this.#size / 2;
    const lift = overlay.dim ? 0.085 : 0.06;
    if (overlay.showGrid) {
      const key = `${overlay.cols}:${overlay.rows}:${overlay.dim}:${this.#size}`;
      if (!this.#gridLines || this.#gridKey !== key) {
        if (this.#gridLines) disposeObject(this.#gridLines);
        this.#gridLines = this.#buildEditorGrid(overlay, half, lift);
        this.#gridKey = key;
      }
      this.#editorRoot.add(this.#gridLines);
    }
    // ... existing showCollisions / cursor / preview blocks unchanged ...
```

`#buildEditorGrid` is the existing grid-construction block (lines ~1293-1320) moved verbatim into a private method returning the `THREE.LineSegments`.

The cache key deliberately excludes terrain edits: grid lines hug the terrain via `#groundY`, so also invalidate the cache where the visual layer learns of a new terrain (the same method that updates `#size` / the ground query — set `this.#gridKey = ""` there). Find it by following who assigns `#size`.

3. Draw the save rect (after the `showCollisions` block, before the cursor block):

```ts
    if (overlay.saveRect) {
      const rect = overlay.saveRect;
      const positions: number[] = [];
      const point = (x: number, z: number): void => {
        positions.push(x, this.#groundY(x, z, lift + 0.04), z);
      };
      for (let col = 0; col < rect.cols; col += 1) {
        point(rect.x + col, rect.z);
        point(rect.x + col + 1, rect.z);
        point(rect.x + col, rect.z + rect.rows);
        point(rect.x + col + 1, rect.z + rect.rows);
      }
      for (let row = 0; row < rect.rows; row += 1) {
        point(rect.x, rect.z + row);
        point(rect.x, rect.z + row + 1);
        point(rect.x + rect.cols, rect.z + row);
        point(rect.x + rect.cols, rect.z + row + 1);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color: 0x57d6ff,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: false,
      });
      this.#editorRoot.add(new THREE.LineSegments(geometry, material));
    }
```

(One segment per cell, like the grid, so the outline follows the terrain instead of clipping through cliffs.)

- [ ] **Step 4: Implement — stage side**

In `packages/editor/src/game/map-editor-stage.ts`:

1. Import `derivedMapRect, type MapRect` from `@lindocara/engine/map-canvas.js`.

2. `blockedCells` iterates only the derived rect (256² ocean marked red is noise):

```ts
function blockedCells(
  map: EditorMap,
  levels: readonly (number | null)[],
  rect: MapRect,
): ColliderRect[] {
  const { cols, rows } = editorMapSize(map);
  const size = Math.max(cols, rows);
  const cells: ColliderRect[] = [];
  for (let row = rect.row; row < rect.row + rect.rows; row += 1) {
    for (let col = rect.col; col < rect.col + rect.cols; col += 1) {
      if (levels[row * size + col] !== null) continue;
      cells.push({ x: col - size / 2, z: row - size / 2, w: 1, h: 1 });
    }
  }
  return cells;
}
```

3. Inside `openMapEditorStage`, memoize the rect per document identity (the map is immutable per edit):

```ts
    let rectCache: { map: EditorMap; rect: MapRect } | null = null;
    const derivedRect = (): MapRect => {
      if (!rectCache || rectCache.map !== map) rectCache = { map, rect: derivedMapRect(map) };
      return rectCache.rect;
    };
```

4. `centreCamera` targets the content rect, not the canvas center:

```ts
    const centreCamera = (): void => {
      const { cols, rows } = dimensions();
      const size = Math.max(cols, rows);
      const rect = derivedRect();
      cameraX = rect.col + rect.cols / 2 - size / 2;
      cameraZ = rect.row + rect.rows / 2 - size / 2;
      renderer.setCameraFocus(cameraX, cameraZ);
    };
```

5. `drawOverlay` feeds both the bounded colliders and the save rect:

```ts
      const rect = derivedRect();
      renderer.setEditorOverlay({
        // ...existing fields...
        colliders: [...heightfield.colliders, ...blockedCells(map, heightfield.levels, rect)],
        saveRect: {
          x: rect.col - size / 2,
          z: rect.row - size / 2,
          cols: rect.cols,
          rows: rect.rows,
        },
        // ...existing fields...
      });
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test:editor -- map-editor-stage`, then `npm run test:renderer`, `npm run typecheck:editor`, `npm run typecheck:renderer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/hd2d/visual-layer.ts packages/editor/src/game/map-editor-stage.ts packages/editor/test/map-editor-stage.test.tsx
git commit -m "feat(editor): save-rect outline, bounded collision overlay and cached canvas grid"
```

---

### Task 4: New-map dialog loses size inputs; status bar shows the derived size; i18n

**Files:**
- Modify: `packages/editor/src/ui/editor/MapListPanel.tsx` (state ~lines 112-113, seed effect ~149-155, `create()` ~162, `validNewSize` ~234-240, dialog ~395-427)
- Modify: `packages/editor/src/ui/editor/AdventureEditorScreen.tsx` (status bar props ~line 1937)
- Modify: `packages/engine/src/i18n/en.ts` (~line 1310) and `packages/engine/src/i18n/fr.ts` (~line 1327)
- Test: `packages/editor/test/map-list-panel.test.tsx`

**Interfaces:**
- Consumes: Task 1's `derivedMapRect`; Task 2's `croppedForSave` is NOT needed here.
- Produces: no new exports. i18n keys: removes `editor.shell.maps.size_hint`, adds `editor.shell.maps.ocean_hint`.

- [ ] **Step 1: Write the failing test**

In `packages/editor/test/map-list-panel.test.tsx` (follow its existing render harness):

```ts
test("the new-map dialog has no size inputs and creates at the engine minimum", async () => {
  // Render the panel with the dialog open, using this file's existing setup.
  expect(screen.queryByLabelText(/Width X/i)).toBeNull();
  expect(screen.queryByLabelText(/Height Y/i)).toBeNull();
  // Confirm creation calls the API with the engine minimum dims (assert on the fetch/request
  // the file's harness already intercepts): cols === MAP_MIN_COLS, rows === MAP_MIN_ROWS.
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:editor -- map-list-panel`
Expected: FAIL — the size inputs are still rendered.

- [ ] **Step 3: Implement**

`MapListPanel.tsx`:
- Delete `newCols`/`newRows` state (lines ~112-113), their reset in the dialog-open effect (~152-153), and `validNewSize` (~234-240; remove it from the create button's `disabled`).
- `create()` sends the engine minimum — the map grows by painting:

```ts
      const created = await createMapApi(adventureId, newName.trim(), MAP_MIN_COLS, MAP_MIN_ROWS);
```

- Replace the two size `Input` blocks and the `size_hint` paragraph with one hint:

```tsx
            <p className="text-xs text-muted-foreground">{t("editor.shell.maps.ocean_hint")}</p>
```

- Drop the now-unused `MAP_MAX_COLS`/`MAP_MAX_ROWS` imports (keep `MAP_MIN_COLS`/`MAP_MIN_ROWS` for `create()`).

i18n — in `en.ts`, replace the `editor.shell.maps.size_hint` entry with:

```ts
  "editor.shell.maps.ocean_hint": "Paint anywhere — the map's size follows your tiles, and empty cells are ocean.",
```

in `fr.ts`, replace its `editor.shell.maps.size_hint` with:

```ts
  "editor.shell.maps.ocean_hint": "Peignez où vous voulez — la taille de la carte suit vos tuiles, et les cases vides sont l'océan.",
```

(French IS required here: these are player-facing dictionary entries, and the i18n parity test fails on a missing half. The English-only rule governs code, comments and commits, not the FR dictionary.)

`AdventureEditorScreen.tsx` — the status bar shows the LIVE derived size. Near `currentMap` (~line 1509):

```ts
  const derivedDims = currentMap ? derivedMapRect(currentMap) : null;
```

and at the status bar (~1937):

```tsx
          cols={derivedDims?.cols ?? map?.cols ?? 0}
          rows={derivedDims?.rows ?? map?.rows ?? 0}
```

(`derivedMapRect` imported from `@lindocara/engine/map-canvas.js`; it scans the canvas once per render, ~200k integer compares — fine at render cadence.)

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:editor` and `npm run test:engine -- i18n`
Expected: PASS, including i18n parity. Fix any existing panel/shell test that asserted the size inputs or the old hint.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/ui/editor/MapListPanel.tsx packages/editor/src/ui/editor/AdventureEditorScreen.tsx packages/engine/src/i18n/en.ts packages/engine/src/i18n/fr.ts packages/editor/test/map-list-panel.test.tsx
git commit -m "feat(editor): derived-size status bar and sizeless new-map dialog"
```

---

### Task 5: History depth cap

**Files:**
- Modify: `packages/editor/src/game/editor-state.ts` (`commitEditorHistory`, ~line 280)
- Test: `packages/editor/test/editor-state.test.ts`

**Interfaces:**
- Produces: `EDITOR_HISTORY_LIMIT` (exported const, 100).

History was unbounded; canvas-sized snapshots (~0.5 MB of changed layer per stroke) make that worth fixing now.

- [ ] **Step 1: Write the failing test**

```ts
test("history keeps at most EDITOR_HISTORY_LIMIT undo steps", () => {
  const base = blankMap("m", 20, 15);
  let history = createEditorHistory(base);
  for (let step = 0; step < EDITOR_HISTORY_LIMIT + 5; step += 1) {
    history = commitEditorHistory(history, { ...history.present, name: `m${step}` });
  }
  expect(history.past.length).toBe(EDITOR_HISTORY_LIMIT);
  // The oldest snapshots fell off the far end; the newest survive.
  expect(history.past[history.past.length - 1]?.name).toBe(`m${EDITOR_HISTORY_LIMIT + 3}`);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:editor -- editor-state`
Expected: FAIL — `past.length` is 105.

- [ ] **Step 3: Implement**

```ts
/** Undo depth. Canvas documents make snapshots heavy (one changed 256×256 layer each), so history
 *  is bounded: the oldest snapshot falls off rather than the tab growing without limit. */
export const EDITOR_HISTORY_LIMIT = 100;
```

and in `commitEditorHistory`, replace the `past` spread:

```ts
  const past = [...history.past, history.present].slice(-EDITOR_HISTORY_LIMIT);
  return { ...history, past, present: next, future: [] };
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:editor -- editor-state`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/game/editor-state.ts packages/editor/test/editor-state.test.ts
git commit -m "feat(editor): cap undo history depth"
```

---

### Task 6: Server proof — editor-shaped save round-trips, and a stranded hero snaps to the entry

**Files:**
- Create: `packages/server/test-api/map-resize-join.test.ts`

**Interfaces:**
- Consumes: the real app via `createTestApp` (`test-api/helpers.ts`) and the fixture/socket/welcome patterns of `packages/server/test-api/peasant-persistence.test.ts` (`FakeClock`, `fakeSocket`, `messages`, `welcome` — copy them; they are file-local there by convention).

No production code changes: `restoreStandablePosition` (`AdmissionService.ts:290`) already snaps a non-standable persisted position to the map entry. This task PROVES it for the re-crop scenario the spec's auto-trim decision leans on, and proves an editor-shaped (cropped) save round-trips into a joinable room.

- [ ] **Step 1: Write the test**

Structure (replicate the peasant-persistence fixture: register a user over real HTTP, create party/hero/adventure/map through the controllers, then drive `WorldRoom` through `RoomEngine` with fake sockets):

```ts
describe("dynamic map size at the server boundary", () => {
  test("an editor-cropped save round-trips: PUT smaller dims, join, bounds agree", async () => {
    // 1. Fixture: user + party + hero + adventure with one map (the fixture's default).
    // 2. Build the update body the way the editor now does: take the stored map payload,
    //    spread { ...payload, ...padMapToCanvas(payload-as-content) }, then toSaveInput-equivalent:
    //    since the server test cannot import editor code, apply the engine primitives directly —
    //    cropMapToRect(canvas, derivedMapRect(canvas)) — and encode layers with encodeTileLayer.
    //    PUT /api/maps/:id with the cropped cols/rows/layers/spawn/events + compiled heightfield.
    // 3. Expect 200 and a revision bump.
    // 4. Join the map through WorldRoom (RoomEngine + fake socket, as peasant-persistence does).
    // 5. welcome(socket): decode the heightfield; expect size === Math.max(cols, rows) of the
    //    cropped body, and the self position standable (canStand true at welcome self x/z).
  });

  test("a persisted position outside the shrunken map snaps to the entry on join", async () => {
    // 1. Same fixture; join once and disconnect so the hero has a persisted position.
    // 2. Directly update the hero row ($repository(heroes)) to a position far outside the
    //    playable ground — e.g. x/z beyond the map's terrain.size / 2 (open water/out of bounds).
    // 3. Re-join. welcome(socket) must place the hero at the map's entry cell
    //    (mapEntryPosition of the stored terrain), not at the doctored coordinates:
    //    assert canStand(terrain, self.x, self.z) and that (x, z) differs from the doctored pair.
  });
});
```

Write it as real code following `peasant-persistence.test.ts` — the comments above are the required assertions, not placeholders to leave in. Engine imports available to the test: `padMapToCanvas`, `derivedMapRect`, `cropMapToRect` (`map-canvas.js`), `encodeTileLayer` (`tile-layer-codec.js`), `compileAuthoredMap`/`encodeMap` (`hd2d/authored-map.js`, `hd2d/map-data.js`), `zoneTerrainFromHeightfield`/`canStand`/`mapEntryPosition` (`terrain-access.js`).

- [ ] **Step 2: Run the new suite**

Run: `npm run test:server -- map-resize-join`
Expected: PASS on first run (this task adds coverage, not behavior). If the snap test FAILS, stop and report — that falsifies the spec's §5 assumption and needs a design decision, not a silent fix.

- [ ] **Step 3: Commit**

```bash
git add packages/server/test-api/map-resize-join.test.ts
git commit -m "test(server): prove cropped saves round-trip and stranded heroes snap to the entry"
```

---

### Task 7: Full verification and a manual pass

**Files:** none (verification only).

- [ ] **Step 1: Full pipeline**

Run: `npm run check`
Expected: catalog/map checks, lint, typecheck and every package's tests green. Fix anything red before proceeding (Biome will flag the unused imports Task 4 removed).

- [ ] **Step 2: Manual smoke in the real editor**

Start `npm run dev` (port **5273**, never 5173) and drive it with the **playwright-cli** skill (never Claude-in-Chrome):

1. Log in, open the editor (sandbox): the starter island floats in ocean, grid visible across the whole canvas, save-rect outline hugging the island + 2 cells.
2. Paint terrain 20+ cells outside the outline: painting works on open ocean, the outline grows to follow, the status bar dims grow.
3. Toggle the collision overlay: red cells appear only inside the outline.
4. Erase the far tiles: outline and status bar shrink back.
5. Watch pointer latency while hovering across the canvas — the cached grid must keep hover smooth; if hovering stutters, profile `setEditorOverlay` before shipping.
6. Save (first save creates the adventure), reload the page, reopen: content re-centers on the canvas, saved dims = outline dims.

- [ ] **Step 3: Report**

Summarize verification output honestly — command results, screenshots from the manual pass, and any deviation from the plan.
