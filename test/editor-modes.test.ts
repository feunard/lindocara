import { applyTool, blankMap, type EditorMap } from "@lindocara/editor/game/editor-state.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

const TREE = "resource.terrain-resources-wood-trees.tree3" as const;
const BUSH = "decoration.terrain-decorations-bushes.bushe1" as const;
const CELL = { col: 2, row: 2 };
const ERASER = { kind: "eraser" } as const;

/** Place one element at an explicit quarter-cell sub-position, throwing if the placement is refused —
 *  the stack tests below need the full `(col, row, offsetX, offsetY)` identity the `withElement`
 *  helper never exposed. */
function placeElement(
  map: EditorMap,
  col: number,
  row: number,
  offsetX: number,
  offsetY: number,
  assetId: EditorAssetId,
): EditorMap {
  const next = applyTool(
    map,
    { kind: "element", assetId },
    col,
    row,
    true,
    "element",
    offsetX,
    offsetY,
  );
  if (!next) throw new Error("fixture: element placement refused");
  return next;
}

function grassMap(): EditorMap {
  return blankMap("m", 20, 15);
}

function withElement(
  map: EditorMap,
  cell: { col: number; row: number },
  assetId: EditorAssetId,
): EditorMap {
  const next = applyTool(map, { kind: "element", assetId }, cell.col, cell.row, true, "element");
  if (!next) throw new Error("fixture: element placement refused");
  return next;
}

function withEvent(map: EditorMap, cell: { col: number; row: number }): EditorMap {
  const next = applyTool(
    map,
    { kind: "event", eventKind: "normal" },
    cell.col,
    cell.row,
    true,
    "event",
  );
  if (!next) throw new Error("fixture: event placement refused");
  return next;
}

/** A grass map carrying one tree and one event on the same cell, so each test can prove that the
 *  eraser took EXACTLY the collection its mode owns and left the other two alone. */
function loaded(): EditorMap {
  return withEvent(withElement(grassMap(), CELL, TREE), CELL);
}

function groundIdAt(map: EditorMap, col: number, row: number): number {
  const ground = map.layers[0];
  return ground ? (ground.ids[row * ground.cols + col] ?? 0) : 0;
}

describe("editor modes", () => {
  it("erases only elements in element mode, never the terrain beneath", () => {
    const map = loaded();
    const next = applyTool(map, ERASER, CELL.col, CELL.row, true, "element");
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.elements).toHaveLength(0);
    expect(groundIdAt(next, CELL.col, CELL.row)).toBe(groundIdAt(map, CELL.col, CELL.row));
    expect(next.events).toHaveLength(1);
  });

  it("erases only terrain in field mode, leaving an element standing", () => {
    const map = loaded();
    const next = applyTool(map, ERASER, CELL.col, CELL.row, true, "field");
    expect(next).not.toBeNull();
    if (!next) return;
    expect(groundIdAt(next, CELL.col, CELL.row)).toBe(0);
    expect(next.elements).toHaveLength(1);
    expect(next.events).toHaveLength(1);
  });

  it("erases only events in event mode", () => {
    const map = loaded();
    const next = applyTool(map, ERASER, CELL.col, CELL.row, true, "event");
    expect(next).not.toBeNull();
    if (!next) return;
    expect(next.events).toHaveLength(0);
    expect(next.elements).toHaveLength(1);
    expect(groundIdAt(next, CELL.col, CELL.row)).toBe(groundIdAt(map, CELL.col, CELL.row));
  });

  it("refuses a tool that does not belong to the active mode", () => {
    const map = loaded();
    const place = { kind: "element", assetId: TREE } as const;
    expect(applyTool(map, place, 3, 3, true, "field")).toBeNull();
  });

  it("does not smear across a drag", () => {
    // The existing !isStrokeStart guard must survive the rewrite.
    const map = loaded();
    expect(applyTool(map, ERASER, CELL.col, CELL.row, false, "element")).toBeNull();
  });
});

/** Task 12b: a cell may hold a stack of decorations at distinct quarter-cell offsets. Identity is
 *  the full `(col, row, offsetX, offsetY)` slot, so a new sub-position ADDS and only an exact match
 *  REPLACES; selection and the eraser act on the topmost (last-placed) element of a stack. */
describe("stacked decorations", () => {
  it("stacks two decorations in one cell at different offsets", () => {
    let map = grassMap();
    map = placeElement(map, CELL.col, CELL.row, 0, 0, TREE);
    map = placeElement(map, CELL.col, CELL.row, 3, 1, TREE);
    expect(map.elements).toHaveLength(2);
    const offsets = map.elements.map((e) => `${e.offsetX},${e.offsetY}`).sort();
    expect(offsets).toEqual(["0,0", "3,1"]);
  });

  it("replaces only the element at the exact same sub-position", () => {
    let map = grassMap();
    map = placeElement(map, CELL.col, CELL.row, 0, 0, TREE);
    map = placeElement(map, CELL.col, CELL.row, 0, 0, BUSH);
    expect(map.elements).toHaveLength(1);
    expect(map.elements[0]?.assetId).toBe(BUSH);
  });

  it("erases the topmost element of a stack, leaving the rest", () => {
    let map = grassMap();
    map = placeElement(map, CELL.col, CELL.row, 0, 0, TREE);
    // Placed last, so it draws on top and is the eraser's first victim.
    map = placeElement(map, CELL.col, CELL.row, 3, 1, BUSH);
    const erased = applyTool(map, ERASER, CELL.col, CELL.row, true, "element");
    expect(erased).not.toBeNull();
    if (!erased) return;
    expect(erased.elements).toHaveLength(1);
    expect(erased.elements[0]?.assetId).toBe(TREE);
  });

  it("still refuses to place a decoration on the spawn cell", () => {
    const map = grassMap();
    const next = applyTool(
      map,
      { kind: "element", assetId: TREE },
      map.spawn.col,
      map.spawn.row,
      true,
      "element",
    );
    expect(next).toBeNull();
  });
});
