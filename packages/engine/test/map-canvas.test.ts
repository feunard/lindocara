import type { EventCommand } from "@lindocara/engine/event-commands.js";
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

function anyEvent(commands: EventCommand[] = []): MapEvent {
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
        commands,
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

  test("shifts an interior architectural mask through pad and crop", () => {
    const input: MapCanvasContent = {
      ...defaultMapInput("inner-room"),
      interiorShell: {
        style: "cave",
        openOuterWalls: false,
        openInnerWalls: true,
        innerWalls: [{ col: 3, row: 4, length: 2 }],
      },
    };
    const padded: MapCanvasContent = { ...input, ...padMapToCanvas(input) };
    expect(padded.interiorShell?.innerWalls).toEqual([
      { col: 3 + PAD_COL, row: 4 + PAD_ROW, length: 2 },
    ]);
    expect(padded.interiorShell).toMatchObject({
      openOuterWalls: false,
      openInnerWalls: true,
    });

    const cropped = cropMapToRect(padded, derivedMapRect(padded));
    expect(cropped.interiorShell?.innerWalls).toEqual([
      { col: 3 + MAP_OCEAN_MARGIN, row: 4 + MAP_OCEAN_MARGIN, length: 2 },
    ]);
    expect(cropped.interiorShell).toMatchObject({
      openOuterWalls: false,
      openInnerWalls: true,
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

  test("counts a same-map teleport target given selfMapId, ignoring a cross-map one", () => {
    const selfMapId = "22222222-2222-4222-8222-222222222222";
    const otherMapId = "33333333-3333-4333-8333-333333333333";
    // Nested inside a loop body, to prove the recursive walk `contentBounds` runs matches the one
    // `shiftMapContent` uses to shift these same commands.
    const sameMapTeleport: EventCommand = {
      t: "teleport",
      mapId: selfMapId,
      col: 200,
      row: 20,
      category: "geographic",
    };
    const crossMapTeleport: EventCommand = {
      t: "teleport",
      mapId: otherMapId,
      col: 250,
      row: 5,
      category: "geographic",
    };
    const base = lonelyTile(100, 100);
    const map: MapCanvasContent = {
      ...base,
      events: [
        {
          ...anyEvent([{ t: "loop", body: [sameMapTeleport] }, crossMapTeleport]),
          col: 101,
          row: 101,
        },
      ],
    };
    // Without `selfMapId`, no teleport target is known to be "self", so bounds stay tight around
    // the lonely tile, the event and the spawn.
    expect(contentBounds(map)).toEqual({ col: 100, row: 100, cols: 2, rows: 2 });
    // With it, the same-map target (200, 20) extends the rect; the cross-map target (250, 5) —
    // further out on both axes — must not, since the runtime never uses its authored cell.
    expect(contentBounds(map, selfMapId)).toEqual({ col: 100, row: 20, cols: 101, rows: 82 });
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

  test("grows to include a far-away same-map teleport target given selfMapId", () => {
    const selfMapId = "22222222-2222-4222-8222-222222222222";
    const teleport: EventCommand = {
      t: "teleport",
      mapId: selfMapId,
      col: 200,
      row: 100,
      category: "geographic",
    };
    const map: MapCanvasContent = {
      ...lonelyTile(100, 100),
      events: [{ ...anyEvent([teleport]), col: 100, row: 100 }],
    };
    // Without `selfMapId`, the far target is invisible to the derivation, so the rect floors to
    // the 20×15 minimum around the lonely tile exactly as `lonelyTile(100, 100)` does elsewhere.
    const withoutSelf = derivedMapRect(map);
    expect(withoutSelf.cols).toBe(MAP_MIN_COLS);
    // With it, the rect must widen enough east to cover the teleport's own target column — never
    // stranding it outside the rect a save would crop to.
    const withSelf = derivedMapRect(map, selfMapId);
    expect(withSelf.cols).toBeGreaterThan(withoutSelf.cols);
    expect(withSelf.col + withSelf.cols).toBeGreaterThan(200);
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

  test("shifts a same-map teleport command through pad + an origin-moving crop, leaving a cross-map one untouched", () => {
    const selfMapId = "22222222-2222-4222-8222-222222222222";
    const otherMapId = "33333333-3333-4333-8333-333333333333";
    const eventCol = 5;
    const eventRow = 5;
    const nestedTeleport: Extract<EventCommand, { t: "teleport" }> = {
      t: "teleport",
      mapId: selfMapId,
      col: eventCol + 2,
      row: eventRow + 1,
      category: "geographic",
    };
    const crossMapTeleport: Extract<EventCommand, { t: "teleport" }> = {
      t: "teleport",
      mapId: otherMapId,
      col: eventCol + 2,
      row: eventRow + 1,
      category: "geographic",
    };
    // Nested inside a conditional's `then` branch — the recursion `shiftCommand` runs must reach
    // it exactly like `event-interpreter.ts` would when actually executing the program.
    const commands: EventCommand[] = [
      crossMapTeleport,
      { t: "if", cond: { type: "switch", switchId: "0001" }, then: [nestedTeleport], else: [] },
    ];
    const input = defaultMapInput("canvas-test");
    const withEvent: MapCanvasContent = {
      ...input,
      events: [{ ...anyEvent(commands), col: eventCol, row: eventRow }],
    };
    // A session always opens by padding, so pad first — this exercises `padMapToCanvas`'s own
    // `selfMapId` threading, not just `cropMapToRect`'s.
    const padded: MapCanvasContent = { ...withEvent, ...padMapToCanvas(withEvent, selfMapId) };

    // Simulate painting west of the original template during the editing session, which pushes
    // the derived rect's origin further west than the plain ocean-margin case below — the exact
    // "painting/erasing west/north" scenario Finding 1 describes, not a uniform, symmetric shift.
    const ground = padded.layers[0];
    if (!ground) throw new Error("missing ground layer");
    const ids = [...ground.ids];
    ids[(PAD_ROW + 3) * MAP_MAX_COLS + (PAD_COL - 5)] = 500;
    const withWestPaint: MapCanvasContent = {
      ...padded,
      layers: [{ ...ground, ids }, ...padded.layers.slice(1)],
    };

    const rect = derivedMapRect(withWestPaint, selfMapId);
    expect(rect.col).toBeLessThan(PAD_COL - MAP_OCEAN_MARGIN);

    const cropped = cropMapToRect(withWestPaint, rect, selfMapId);
    const finalEvent = cropped.events[0];
    if (!finalEvent) throw new Error("missing event");
    const deltaCol = finalEvent.col - eventCol;
    const deltaRow = finalEvent.row - eventRow;
    expect(deltaCol).not.toBe(0);

    const page = finalEvent.pages[0];
    if (!page) throw new Error("missing page");
    const [crossCmd, ifCmd] = page.commands;
    if (crossCmd?.t !== "teleport") throw new Error("expected cross-map teleport");
    // Cross-map: untouched by pad AND crop, still its authored cell.
    expect(crossCmd.col).toBe(eventCol + 2);
    expect(crossCmd.row).toBe(eventRow + 1);

    if (ifCmd?.t !== "if") throw new Error("expected conditional command");
    const nestedCmd = ifCmd.then[0];
    if (nestedCmd?.t !== "teleport") throw new Error("expected nested same-map teleport");
    // Same-map, nested inside the conditional: shifted exactly like its own event, end to end.
    expect(nestedCmd.col).toBe(eventCol + 2 + deltaCol);
    expect(nestedCmd.row).toBe(eventRow + 1 + deltaRow);
  });
});
