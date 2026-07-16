import { describe, expect, it } from "vitest";
import {
  applyTool,
  blankMap,
  type EditorMap,
  type EditorTool,
} from "../src/client/game/editor-state.js";
import { MAX_MAP_ELEMENTS, type MapElement } from "../src/shared/map-data.js";

describe("blankMap", () => {
  it("starts all grass, spawn centred", () => {
    const map = blankMap("m", 20, 15);
    expect(map.name).toBe("m");
    expect(map.blocks).toHaveLength(15);
    for (const row of map.blocks) expect(row).toBe(".".repeat(20));
    expect(map.elements).toEqual([]);
    expect(map.spawn).toEqual({ col: 10, row: 7 });
  });
});

describe("applyTool: block", () => {
  it("writes the block at the cell and nowhere else, returning a NEW object", () => {
    const map = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "block", block: "water" };
    const next = applyTool(map, tool, 3, 4);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    const row = next?.blocks[4];
    expect(row?.[3]).toBe("#");
    // nowhere else on that row changed
    expect(row?.slice(0, 3)).toBe("...");
    expect(row?.slice(4)).toBe(".".repeat(16));
    // the row above and below are untouched
    expect(next?.blocks[3]).toBe(".".repeat(20));
    expect(next?.blocks[5]).toBe(".".repeat(20));
    // input untouched
    expect(map.blocks[4]).toBe(".".repeat(20));
  });

  it("painting water under a tree removes it (a tree cannot stand on water)", () => {
    let map = blankMap("m", 20, 15);
    const treeTool: EditorTool = { kind: "element", element: "tree", variant: 0 };
    const withTree = applyTool(map, treeTool, 3, 4);
    expect(withTree).not.toBeNull();
    map = withTree as EditorMap;
    const beforeElements = map.elements.slice();
    const waterTool: EditorTool = { kind: "block", block: "water" };
    const next = applyTool(map, waterTool, 3, 4);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("painting water under a stone keeps it (a stone stands in the shallows)", () => {
    let map = blankMap("m", 20, 15);
    const stoneTool: EditorTool = { kind: "element", element: "stone", variant: 0 };
    const withStone = applyTool(map, stoneTool, 3, 4);
    expect(withStone).not.toBeNull();
    map = withStone as EditorMap;
    const beforeElements = map.elements.slice();
    const waterTool: EditorTool = { kind: "block", block: "water" };
    const next = applyTool(map, waterTool, 3, 4);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([{ col: 3, row: 4, kind: "stone", variant: 0 }]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("refuses painting water onto the spawn cell", () => {
    const map = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "block", block: "water" };
    const next = applyTool(map, tool, map.spawn.col, map.spawn.row);
    expect(next).toBeNull();
  });
});

describe("applyTool: element", () => {
  it("refuses placing a tree on water", () => {
    let map = blankMap("m", 20, 15);
    const waterTool: EditorTool = { kind: "block", block: "water" };
    const withWater = applyTool(map, waterTool, 3, 4);
    expect(withWater).not.toBeNull();
    map = withWater as EditorMap;
    const treeTool: EditorTool = { kind: "element", element: "tree", variant: 0 };
    const next = applyTool(map, treeTool, 3, 4);
    expect(next).toBeNull();
  });

  it("allows placing a stone on water", () => {
    let map = blankMap("m", 20, 15);
    const waterTool: EditorTool = { kind: "block", block: "water" };
    const withWater = applyTool(map, waterTool, 3, 4);
    expect(withWater).not.toBeNull();
    map = withWater as EditorMap;
    const beforeElements = map.elements.slice();
    const stoneTool: EditorTool = { kind: "element", element: "stone", variant: 0 };
    const next = applyTool(map, stoneTool, 3, 4);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([{ col: 3, row: 4, kind: "stone", variant: 0 }]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("replaces the existing element on an occupied cell (one per cell)", () => {
    let map = blankMap("m", 20, 15);
    const bushTool: EditorTool = { kind: "element", element: "bush", variant: 0 };
    const withBush = applyTool(map, bushTool, 3, 4);
    expect(withBush).not.toBeNull();
    map = withBush as EditorMap;
    const beforeElements = map.elements.slice();
    const treeTool: EditorTool = { kind: "element", element: "tree", variant: 2 };
    const next = applyTool(map, treeTool, 3, 4);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([{ col: 3, row: 4, kind: "tree", variant: 2 }]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("refuses placing a colliding element on the spawn cell", () => {
    const map = blankMap("m", 20, 15);
    const treeTool: EditorTool = { kind: "element", element: "tree", variant: 0 };
    const next = applyTool(map, treeTool, map.spawn.col, map.spawn.row);
    expect(next).toBeNull();
  });

  it("refuses a new element once the map already holds the cap, but still allows replacing one", () => {
    // A 100x100 blank map so geometry is not the limit — the cap is. Fill rows 0-3 with bushes
    // (400 cells, all grass, clear of the centred spawn).
    const base = blankMap("m", 100, 100);
    const elements: MapElement[] = Array.from({ length: MAX_MAP_ELEMENTS }, (_, i) => ({
      col: i % 100,
      row: Math.floor(i / 100),
      kind: "bush",
      variant: 0,
    }));
    const full: EditorMap = { ...base, elements };

    // A new cell is refused: it would be element 401.
    const treeTool: EditorTool = { kind: "element", element: "tree", variant: 0 };
    expect(applyTool(full, treeTool, 10, 10)).toBeNull();

    // Replacing an element already on a cell is fine — the count does not grow.
    const replaced = applyTool(full, treeTool, 0, 0);
    expect(replaced).not.toBeNull();
    expect(replaced?.elements).toHaveLength(MAX_MAP_ELEMENTS);
    expect(replaced?.elements.find((e) => e.col === 0 && e.row === 0)?.kind).toBe("tree");
  });
});

describe("applyTool: eraser", () => {
  it("removes the element at the cell", () => {
    let map = blankMap("m", 20, 15);
    const bushTool: EditorTool = { kind: "element", element: "bush", variant: 0 };
    const withBush = applyTool(map, bushTool, 3, 4);
    expect(withBush).not.toBeNull();
    map = withBush as EditorMap;
    const beforeElements = map.elements.slice();
    const eraserTool: EditorTool = { kind: "eraser" };
    const next = applyTool(map, eraserTool, 3, 4);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("returns the SAME reference (not null) on an empty cell", () => {
    const map = blankMap("m", 20, 15);
    const eraserTool: EditorTool = { kind: "eraser" };
    const next = applyTool(map, eraserTool, 3, 4);
    expect(next).toBe(map);
  });
});

describe("applyTool: spawn", () => {
  it("moves the spawn onto a walkable cell", () => {
    const map = blankMap("m", 20, 15);
    const beforeSpawn = { ...map.spawn };
    const tool: EditorTool = { kind: "spawn" };
    const next = applyTool(map, tool, 5, 6);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.spawn).toEqual({ col: 5, row: 6 });
    expect(map.spawn).toEqual(beforeSpawn);
  });

  it("refuses moving the spawn onto water", () => {
    let map = blankMap("m", 20, 15);
    const waterTool: EditorTool = { kind: "block", block: "water" };
    const withWater = applyTool(map, waterTool, 5, 6);
    expect(withWater).not.toBeNull();
    map = withWater as EditorMap;
    const spawnTool: EditorTool = { kind: "spawn" };
    const next = applyTool(map, spawnTool, 5, 6);
    expect(next).toBeNull();
  });

  it("refuses moving the spawn under a colliding element", () => {
    let map = blankMap("m", 20, 15);
    const treeTool: EditorTool = { kind: "element", element: "tree", variant: 0 };
    const withTree = applyTool(map, treeTool, 5, 6);
    expect(withTree).not.toBeNull();
    map = withTree as EditorMap;
    const spawnTool: EditorTool = { kind: "spawn" };
    const next = applyTool(map, spawnTool, 5, 6);
    expect(next).toBeNull();
  });
});

describe("applyTool: bounds", () => {
  it("refuses any out-of-bounds col/row", () => {
    const map = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "block", block: "water" };
    expect(applyTool(map, tool, -1, 0)).toBeNull();
    expect(applyTool(map, tool, 0, -1)).toBeNull();
    expect(applyTool(map, tool, 20, 0)).toBeNull();
    expect(applyTool(map, tool, 0, 15)).toBeNull();
  });
});
