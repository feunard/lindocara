import { describe, expect, it } from "vitest";
import {
  applyTool,
  blankMap,
  commitEditorHistory,
  createEditorHistory,
  type EditorMap,
  type EditorTool,
  isEditorHistoryDirty,
  markEditorHistorySaved,
  mintMarkerId,
  redoEditorHistory,
  setMarkerLabel,
  undoEditorHistory,
} from "../src/client/game/editor-state.js";
import {
  EMPTY_MARKERS,
  MAX_MAP_ELEMENTS,
  MAX_MAP_ENTRIES,
  type MapElement,
} from "../src/shared/map-data.js";

const TREE = "resource.terrain-resources-wood-trees.tree3" as const;
const BUSH = "decoration.terrain-decorations-bushes.bushe1" as const;
const STONE = "decoration.terrain-decorations-rocks.rock1" as const;
const SMALL_DECOR = "decoration.deco.01" as const;
const SMALL_DECOR_ALT = "decoration.deco.02" as const;

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
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
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
    const stoneTool: EditorTool = { kind: "element", assetId: STONE };
    const withStone = applyTool(map, stoneTool, 3, 4);
    expect(withStone).not.toBeNull();
    map = withStone as EditorMap;
    const beforeElements = map.elements.slice();
    const waterTool: EditorTool = { kind: "block", block: "water" };
    const next = applyTool(map, waterTool, 3, 4);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([{ col: 3, row: 4, assetId: STONE }]);
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
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
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
    const stoneTool: EditorTool = { kind: "element", assetId: STONE };
    const next = applyTool(map, stoneTool, 3, 4);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([{ col: 3, row: 4, assetId: STONE }]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("replaces the existing element on an occupied cell (one per cell)", () => {
    let map = blankMap("m", 20, 15);
    const bushTool: EditorTool = { kind: "element", assetId: BUSH };
    const withBush = applyTool(map, bushTool, 3, 4);
    expect(withBush).not.toBeNull();
    map = withBush as EditorMap;
    const beforeElements = map.elements.slice();
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
    const next = applyTool(map, treeTool, 3, 4);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([{ col: 3, row: 4, assetId: TREE }]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("refuses placing a colliding element on the spawn cell", () => {
    const map = blankMap("m", 20, 15);
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
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
      assetId: SMALL_DECOR,
    }));
    const full: EditorMap = { ...base, elements };

    // A new cell is refused: it would be element 401.
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
    expect(applyTool(full, treeTool, 10, 10)).toBeNull();

    // Replacing an element already on a cell is fine — the count does not grow.
    const replaced = applyTool(full, { kind: "element", assetId: SMALL_DECOR_ALT }, 10, 2);
    expect(replaced).not.toBeNull();
    expect(replaced?.elements).toHaveLength(MAX_MAP_ELEMENTS);
    expect(replaced?.elements.find((e) => e.col === 10 && e.row === 2)?.assetId).toBe(
      SMALL_DECOR_ALT,
    );
  });
});

describe("applyTool: eraser", () => {
  it("removes the element at the cell", () => {
    let map = blankMap("m", 20, 15);
    const bushTool: EditorTool = { kind: "element", assetId: BUSH };
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
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
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

describe("markers on the editor map", () => {
  it("blankMap starts with empty markers", () => {
    expect(blankMap("m", 20, 15).markers).toEqual(EMPTY_MARKERS);
  });

  it("every tool application preserves markers it did not touch", () => {
    const base = blankMap("m", 20, 15);
    const withMarkers: EditorMap = {
      ...base,
      markers: {
        entries: [{ id: "door", col: 2, row: 2 }],
        exits: [{ id: "gate", col: 4, row: 4 }],
        monsterSpawns: [],
      },
    };
    const painted = applyTool(withMarkers, { kind: "block", block: "water" }, 9, 9);
    expect(painted?.markers).toEqual(withMarkers.markers);
    const moved = applyTool(withMarkers, { kind: "spawn" }, 8, 8);
    expect(moved?.markers).toEqual(withMarkers.markers);
  });
});

describe("editor history", () => {
  it("undoes and redoes one committed operation", () => {
    const base = blankMap("m", 20, 15);
    const painted = applyTool(base, { kind: "block", block: "water" }, 1, 1) as EditorMap;
    const committed = commitEditorHistory(createEditorHistory(base), painted);

    expect(committed.past).toHaveLength(1);
    expect(isEditorHistoryDirty(committed)).toBe(true);
    const undone = undoEditorHistory(committed);
    expect(undone.present).toEqual(base);
    expect(isEditorHistoryDirty(undone)).toBe(false);
    expect(redoEditorHistory(undone).present).toEqual(painted);
  });

  it("records a continuous painted stroke as one operation when only its final map is committed", () => {
    const base = blankMap("m", 20, 15);
    let stroke = base;
    for (let col = 1; col <= 4; col += 1) {
      stroke = applyTool(stroke, { kind: "block", block: "water" }, col, 1) as EditorMap;
    }

    const history = commitEditorHistory(createEditorHistory(base), stroke);
    expect(history.past).toHaveLength(1);
    expect(undoEditorHistory(history).present).toEqual(base);
  });

  it("resets dirty state only at the saved revision", () => {
    const base = blankMap("m", 20, 15);
    const painted = applyTool(base, { kind: "block", block: "water" }, 1, 1) as EditorMap;
    const committed = commitEditorHistory(createEditorHistory(base), painted);
    const saved = markEditorHistorySaved(committed);
    expect(isEditorHistoryDirty(saved)).toBe(false);
    expect(isEditorHistoryDirty(undoEditorHistory(saved))).toBe(true);
  });
});

describe("marker labels", () => {
  it("keeps stable ids while trimming, changing and clearing labels", () => {
    const base = applyTool(blankMap("m", 20, 15), { kind: "marker-entry" }, 2, 2) as EditorMap;
    const labelled = setMarkerLabel(base, { kind: "entry", id: "entry-1" }, "  North gate  ");
    expect(labelled?.markers.entries).toEqual([
      { id: "entry-1", label: "North gate", col: 2, row: 2 },
    ]);
    expect(
      setMarkerLabel(labelled as EditorMap, { kind: "entry", id: "entry-1" }, "")?.markers.entries,
    ).toEqual([{ id: "entry-1", col: 2, row: 2 }]);
  });

  it("rejects labels longer than the shared maximum", () => {
    const base = applyTool(blankMap("m", 20, 15), { kind: "marker-exit" }, 2, 2) as EditorMap;
    expect(setMarkerLabel(base, { kind: "exit", id: "exit-1" }, "x".repeat(49))).toBeNull();
  });
});

describe("applyTool: markers", () => {
  const base = blankMap("m", 20, 15);

  it("places entries and exits with minted unique ids", () => {
    const one = applyTool(base, { kind: "marker-entry" }, 2, 2);
    expect(one?.markers.entries).toEqual([{ id: "entry-1", col: 2, row: 2 }]);
    const two = applyTool(one as EditorMap, { kind: "marker-entry" }, 3, 3);
    expect(two?.markers.entries.map((e) => e.id)).toEqual(["entry-1", "entry-2"]);
    const exit = applyTool(two as EditorMap, { kind: "marker-exit" }, 5, 5);
    expect(exit?.markers.exits).toEqual([{ id: "exit-1", col: 5, row: 5 }]);
  });

  it("mints the smallest free suffix", () => {
    expect(mintMarkerId("entry", ["entry-1", "entry-3"])).toBe("entry-2");
    expect(mintMarkerId("exit", [])).toBe("exit-1");
  });

  it("refuses markers on water, exits on spawn or entry cells, and duplicates on one cell", () => {
    const wet = applyTool(base, { kind: "block", block: "water" }, 2, 2);
    expect(applyTool(wet as EditorMap, { kind: "marker-entry" }, 2, 2)).toBeNull();
    expect(applyTool(base, { kind: "marker-exit" }, base.spawn.col, base.spawn.row)).toBeNull();
    const entry = applyTool(base, { kind: "marker-entry" }, 4, 4) as EditorMap;
    expect(applyTool(entry, { kind: "marker-exit" }, 4, 4)).toBeNull();
    expect(applyTool(entry, { kind: "marker-entry" }, 4, 4)).toBeNull();
  });

  it("enforces the entry cap", () => {
    let map: EditorMap = base;
    for (let i = 0; i < MAX_MAP_ENTRIES; i += 1) {
      map = applyTool(map, { kind: "marker-entry" }, i + 1, 1) as EditorMap;
    }
    expect(applyTool(map, { kind: "marker-entry" }, 1, 5)).toBeNull();
  });

  it("places monster spawns, replaces on the same cell, validates the radius", () => {
    const placed = applyTool(
      base,
      { kind: "marker-monster", species: "spear_goblin", patrolRadius: 96 },
      6,
      6,
    );
    expect(placed?.markers.monsterSpawns).toEqual([
      { col: 6, row: 6, species: "spear_goblin", patrolRadius: 96 },
    ]);
    const replaced = applyTool(
      placed as EditorMap,
      { kind: "marker-monster", species: "mire_troll", patrolRadius: 128 },
      6,
      6,
    );
    expect(replaced?.markers.monsterSpawns).toEqual([
      { col: 6, row: 6, species: "mire_troll", patrolRadius: 128 },
    ]);
    expect(
      applyTool(base, { kind: "marker-monster", species: "spear_goblin", patrolRadius: 8 }, 6, 6),
    ).toBeNull();
  });

  it("eraser removes markers, spawn and paint refuse to invalidate them", () => {
    const entry = applyTool(base, { kind: "marker-entry" }, 4, 4) as EditorMap;
    const erased = applyTool(entry, { kind: "eraser" }, 4, 4);
    expect(erased?.markers.entries).toEqual([]);
    expect(applyTool(entry, { kind: "eraser" }, 9, 9)).toBe(entry); // no-op keeps the same reference
    expect(applyTool(entry, { kind: "block", block: "water" }, 4, 4)).toBeNull(); // would drown the entry
    const exit = applyTool(base, { kind: "marker-exit" }, 7, 7) as EditorMap;
    expect(applyTool(exit, { kind: "spawn" }, 7, 7)).toBeNull(); // spawn may not land on an exit
  });
});
