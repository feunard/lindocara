import {
  contentBounds,
  cropMapToRect,
  derivedMapRect,
  type MapCanvasContent,
  padMapToCanvas,
} from "@lindocara/engine/map-canvas.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import {
  MAP_MAX_COLS,
  MAP_MAX_ROWS,
  MAP_MIN_COLS,
  MAP_MIN_ROWS,
  MAP_OCEAN_MARGIN,
} from "@lindocara/engine/map-limits.js";
import { defaultMapInput } from "@lindocara/engine/map-template.js";
import { emptyLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { EMPTY_TILE } from "@lindocara/engine/tileset.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, test } from "vitest";

/** The default 20×15 all-grass template, centered pad offsets. */
const PAD_COL = Math.floor((MAP_MAX_COLS - MAP_MIN_COLS) / 2); // 118
const PAD_ROW = Math.floor((MAP_MAX_ROWS - MAP_MIN_ROWS) / 2); // 120

function anyAssetId(): EditorAssetId {
  return "resource.terrain-resources-wood-trees.tree3" as const;
}

function anyEvent(): MapEvent {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    col: 1,
    row: 1,
    name: "Event",
    ordinal: 0,
    kind: "normal",
    species: null,
    patrolRadius: null,
    monsterRank: null,
    monsterMaxHp: null,
    monsterDamage: null,
    monsterSpeed: null,
    monsterXp: null,
    monsterWeakness: null,
    monsterWeaknessPercent: null,
    monsterSpecialTechnique: null,
    pages: [
      {
        condSwitchId: null,
        condVariableId: null,
        condVariableMin: null,
        condSelfSwitch: null,
        graphicAssetId: null,
        graphicTint: 0,
        moveType: "fixed",
        moveRoute: [],
        moveSpeed: 3,
        moveFreq: 2,
        optMoveAnim: false,
        optStopAnim: false,
        optDirFix: false,
        optThrough: false,
        optOnTop: false,
        trigger: "action",
        commands: [],
      },
    ],
  };
}

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
      elements: [{ id: "e1", col: 129, row: 128, offsetX: 1, offsetY: 2, assetId: anyAssetId() }],
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
