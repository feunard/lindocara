import { describe, expect, it } from "vitest";
import {
  applyTool,
  beginEventDraft,
  blankMap,
  commitEditorHistory,
  commitEventDraft,
  createEditorHistory,
  defaultEventPage,
  deleteSelection,
  type EditorMap,
  type EditorTool,
  editorLayersFromPayload,
  isEditorHistoryDirty,
  markEditorHistorySaved,
  moveSelection,
  placementLegalAt,
  redoEditorHistory,
  selectionAt,
  setActiveLayer,
  setEventDraftName,
  toSaveInput,
  undoEditorHistory,
  updateEventDraftPage,
} from "../src/client/game/editor-state.js";
import { isUuid } from "../src/shared/identifiers.js";
import { EMPTY_MARKERS, MAX_MAP_ELEMENTS, type MapElement } from "../src/shared/map-data.js";
import { entryEvents, exitEvents, type MapEvent } from "../src/shared/map-events.js";
import { eraseRect, paintRectAutotile, paintStairs, slotAt } from "../src/shared/tile-brush.js";
import type { TileLayer } from "../src/shared/tile-layer-codec.js";
import { autotileId, EMPTY_TILE } from "../src/shared/tileset.js";
import {
  CLIFF_WALL_SLOT,
  GRASS_SLOTS,
  TINY_SWORDS_TILESET,
} from "../src/shared/tilesets/tiny-swords.js";
import { EDITOR_ASSETS, type EditorAssetId } from "../src/shared/tiny-swords-catalog.js";

/** The ground slot at a cell, or -1 for the void. Every terrain assertion below reads this rather
 *  than a raw id: the id carries an autotile variant the neighbourhood decides, and no test here is
 *  about which edge variant was chosen. */
function groundSlot(map: EditorMap, col: number, row: number): number {
  const ground = map.layers[0];
  return ground ? slotAt(ground, col, row) : -1;
}

function wallSlot(map: EditorMap, col: number, row: number): number {
  const walls = map.layers[1];
  return walls ? slotAt(walls, col, row) : -1;
}

const TREE = "resource.terrain-resources-wood-trees.tree3" as const;
const BUSH = "decoration.terrain-decorations-bushes.bushe1" as const;
const STONE = "decoration.terrain-decorations-rocks.rock1" as const;
const SMALL_DECOR = "decoration.deco.01" as const;
const SMALL_DECOR_ALT = "decoration.deco.02" as const;

describe("blankMap", () => {
  it("starts all grass, spawn centred", () => {
    const map = blankMap("m", 20, 15);
    expect(map.name).toBe("m");
    expect(map.layers).toHaveLength(3);
    expect(map.layers[0]?.cols).toBe(20);
    expect(map.layers[0]?.rows).toBe(15);
    for (let row = 0; row < 15; row += 1) {
      for (let col = 0; col < 20; col += 1) expect(groundSlot(map, col, row)).toBe(GRASS_SLOTS[0]);
    }
    // Nothing stands above the ground on a blank map.
    for (const layer of map.layers.slice(1)) {
      expect(layer.ids.every((id) => id === EMPTY_TILE)).toBe(true);
    }
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
    const painted = next as EditorMap;
    // Water is an empty ground cell, and only that cell emptied.
    expect(groundSlot(painted, 3, 4)).toBe(-1);
    for (const cell of [
      { col: 2, row: 4 },
      { col: 4, row: 4 },
      { col: 3, row: 3 },
      { col: 3, row: 5 },
    ]) {
      expect(groundSlot(painted, cell.col, cell.row)).toBe(GRASS_SLOTS[0]);
    }
    // input untouched
    expect(groundSlot(map, 3, 4)).toBe(GRASS_SLOTS[0]);
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

  it("clears the ground on a cell that holds no element or marker", () => {
    const map = blankMap("m", 20, 15);
    const eraserTool: EditorTool = { kind: "eraser" };
    const next = applyTool(map, eraserTool, 3, 4) as EditorMap;
    expect(next).not.toBe(map);
    expect(groundSlot(next, 3, 4)).toBe(-1);
  });

  it("returns the SAME reference on a cell that is already void", () => {
    const map = applyTool(blankMap("m", 20, 15), { kind: "eraser" }, 3, 4) as EditorMap;
    expect(applyTool(map, { kind: "eraser" }, 3, 4)).toBe(map);
  });

  it("does not carve ground mid-drag, but a click on the same cell still does", () => {
    const map = blankMap("m", 20, 15);
    const eraserTool: EditorTool = { kind: "eraser" };
    // A drag cell (isStrokeStart = false) with nothing on it: refused, ground untouched.
    expect(applyTool(map, eraserTool, 3, 4, false)).toBeNull();
    expect(groundSlot(map, 3, 4)).toBe(GRASS_SLOTS[0]);
    // A click on the same bare cell (default isStrokeStart = true) still falls through to terrain.
    const clicked = applyTool(map, eraserTool, 3, 4) as EditorMap;
    expect(clicked).not.toBe(map);
    expect(groundSlot(clicked, 3, 4)).toBe(-1);
  });

  it("still removes an element mid-drag, without touching the ground beneath it", () => {
    let map = blankMap("m", 20, 15);
    const bushTool: EditorTool = { kind: "element", assetId: BUSH };
    map = applyTool(map, bushTool, 3, 4) as EditorMap;
    const eraserTool: EditorTool = { kind: "eraser" };
    const next = applyTool(map, eraserTool, 3, 4, false) as EditorMap;
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next.elements).toEqual([]);
    expect(groundSlot(next, 3, 4)).toBe(GRASS_SLOTS[0]);
  });
});

describe("applyTool: rect", () => {
  it("anchors on stroke start and commits the whole rectangle once, on release", () => {
    const base = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "rect", content: { kind: "elevation", level: 1 } };

    let map = applyTool(base, tool, 1, 1, true) as EditorMap;
    expect(map).not.toBeNull();
    // Stroke start alone paints nothing — it only drops the anchor.
    expect(map.layers[0]).toEqual(base.layers[0]);

    map = applyTool(map, tool, 6, 6, false) as EditorMap; // drag out to a larger rectangle
    map = applyTool(map, tool, 4, 3, false) as EditorMap; // shrink back and release here

    const expectedGround = paintRectAutotile(
      base.layers[0] as TileLayer,
      TINY_SWORDS_TILESET,
      GRASS_SLOTS[1],
      1,
      1,
      4,
      3,
    );
    expect(map.layers[0]).toEqual(expectedGround);
    // Wall upkeep ran across the whole region: row 4, one below the rectangle's bottom edge (row
    // 3), now casts a wall for every painted column.
    expect(wallSlot(map, 2, 4)).toBe(CLIFF_WALL_SLOT);
    expect(wallSlot(map, 1, 4)).toBe(CLIFF_WALL_SLOT);
    expect(wallSlot(map, 4, 4)).toBe(CLIFF_WALL_SLOT);

    const history = commitEditorHistory(createEditorHistory(base), map);
    expect(history.past).toHaveLength(1);
    expect(undoEditorHistory(history).present).toEqual(base);
  });

  it("erases the ground under a water rectangle and takes the wall away with it", () => {
    const raised = applyTool(
      blankMap("m", 20, 15),
      { kind: "elevation", level: 1 },
      2,
      2,
    ) as EditorMap;
    const tool: EditorTool = { kind: "rect", content: { kind: "block", block: "water" } };
    let map = applyTool(raised, tool, 1, 1, true) as EditorMap;
    map = applyTool(map, tool, 3, 3, false) as EditorMap;
    expect(groundSlot(map, 2, 2)).toBe(-1);
    expect(wallSlot(map, 2, 3)).toBe(-1);
  });

  it("refuses a drag cell with no open stroke", () => {
    const base = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "rect", content: { kind: "block", block: "grass" } };
    expect(applyTool(base, tool, 3, 3, false)).toBeNull();
  });

  it("does not permanently drop an element the drag passed over but the final rectangle excludes", () => {
    const base = blankMap("m", 20, 15);
    const withTree = applyTool(base, { kind: "element", assetId: TREE }, 5, 5) as EditorMap;
    expect(withTree).not.toBeNull();

    const tool: EditorTool = { kind: "rect", content: { kind: "block", block: "water" } };
    let map = applyTool(withTree, tool, 1, 1, true) as EditorMap;
    map = applyTool(map, tool, 5, 5, false) as EditorMap; // drag out over the tree
    // Mid-drag, the rectangle covers the tree's cell with water, which a tree cannot stand on.
    expect(map.elements).toEqual([]);
    map = applyTool(map, tool, 2, 2, false) as EditorMap; // shrink back and release here

    // The final rectangle never touched (5, 5): the tree must survive.
    expect(map.elements).toEqual([{ col: 5, row: 5, assetId: TREE }]);
    const expectedGround = eraseRect(
      withTree.layers[0] as TileLayer,
      TINY_SWORDS_TILESET,
      1,
      1,
      2,
      2,
    );
    expect(map.layers[0]).toEqual(expectedGround);
  });
});

describe("applyTool: fill", () => {
  it("floods the contiguous region on click, as one undo entry", () => {
    let base = blankMap("m", 20, 15);
    // Carve a small pocket of empty ground so the fill has a bounded, non-trivial region to
    // redraw — filling an already-uniform blank map with its own slot would be a no-op.
    for (const [col, row] of [
      [3, 3],
      [4, 3],
      [3, 4],
      [4, 4],
    ] as const) {
      base = applyTool(base, { kind: "block", block: "water" }, col, row) as EditorMap;
    }

    const tool: EditorTool = { kind: "fill", content: { kind: "block", block: "grass" } };
    const filled = applyTool(base, tool, 3, 3) as EditorMap;
    expect(filled).not.toBeNull();
    expect(groundSlot(filled, 3, 3)).toBe(GRASS_SLOTS[0]);
    expect(groundSlot(filled, 4, 4)).toBe(GRASS_SLOTS[0]);
    // The fill did not leak past the pocket it started in.
    expect(groundSlot(filled, 2, 3)).toBe(GRASS_SLOTS[0]);

    const history = commitEditorHistory(createEditorHistory(base), filled);
    expect(history.past).toHaveLength(1);
    expect(undoEditorHistory(history).present).toEqual(base);
  });

  it("is a no-op that returns the same reference when nothing in the region changes", () => {
    const base = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "fill", content: { kind: "block", block: "grass" } };
    expect(applyTool(base, tool, 3, 3)).toBe(base);
  });
});

describe("applyTool: stairs", () => {
  it("stamps the ramp onto layer 1 as one undo entry", () => {
    const base = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "stairs" };
    const next = applyTool(base, tool, 5, 5) as EditorMap;
    expect(next).not.toBeNull();
    const expectedWalls = paintStairs(base.layers, TINY_SWORDS_TILESET, 5, 5)[1];
    expect(next.layers[1]).toEqual(expectedWalls);

    const history = commitEditorHistory(createEditorHistory(base), next);
    expect(history.past).toHaveLength(1);
  });

  it("refuses an out-of-bounds stamp, creating no history entry", () => {
    const base = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "stairs" };
    // The map is 20 cols wide; the stamp's right edge (col + 1) would land at col 20.
    expect(applyTool(base, tool, 19, 5)).toBeNull();

    const history = commitEditorHistory(createEditorHistory(base), base);
    expect(history.past).toHaveLength(0);
  });
});

describe("applyTool: activeLayer targeting", () => {
  it("routes an eraser stroke to layer 2 when active layer is 2, leaving layers 0/1 untouched", () => {
    const base = blankMap("m", 20, 15);
    // Nothing in the editor paints layer 2 yet, so poke a tile onto it directly, the same way other
    // tests build markers by hand.
    const layer2 = base.layers[2] as TileLayer;
    const index = 4 * layer2.cols + 3; // (col 3, row 4)
    const poked: TileLayer = {
      ...layer2,
      ids: layer2.ids.map((id, cell) => (cell === index ? autotileId(GRASS_SLOTS[0], 0) : id)),
    };
    const withLayer2: EditorMap = {
      ...base,
      layers: [base.layers[0] as TileLayer, base.layers[1] as TileLayer, poked],
    };
    expect(slotAt(poked, 3, 4)).toBe(GRASS_SLOTS[0]);

    const next = applyTool(withLayer2, { kind: "eraser" }, 3, 4, true, 2) as EditorMap;
    expect(next).not.toBeNull();
    expect(slotAt(next.layers[2] as TileLayer, 3, 4)).toBe(-1);
    expect(next.layers[0]).toEqual(withLayer2.layers[0]);
    expect(next.layers[1]).toEqual(withLayer2.layers[1]);
  });

  it("leaves an already-void layer-2 cell untouched (same reference) when active layer is 2", () => {
    const base = blankMap("m", 20, 15);
    expect(applyTool(base, { kind: "eraser" }, 3, 4, true, 2)).toBe(base);
  });

  it("still writes ground for a terrain selection when active layer is 2, wall upkeep included", () => {
    const raised = applyTool(
      blankMap("m", 20, 15),
      { kind: "elevation", level: 1 },
      5,
      6,
    ) as EditorMap;
    const flattened = applyTool(
      raised,
      { kind: "block", block: "grass" },
      5,
      6,
      true,
      2,
    ) as EditorMap;
    expect(groundSlot(flattened, 5, 6)).toBe(GRASS_SLOTS[0]);
    expect(wallSlot(flattened, 5, 7)).toBe(-1); // wall upkeep still ran despite activeLayer = 2
  });
});

describe("setActiveLayer", () => {
  it("swaps the field without touching past, present, future or saved", () => {
    const history = createEditorHistory(blankMap("m", 20, 15));
    expect(history.activeLayer).toBe(0);
    const next = setActiveLayer(history, 2);
    expect(next.activeLayer).toBe(2);
    expect(next.present).toBe(history.present);
    expect(next.past).toBe(history.past);
    expect(next.saved).toBe(history.saved);
  });

  it("survives undo/redo unchanged, unlike map content", () => {
    const base = blankMap("m", 20, 15);
    const painted = applyTool(base, { kind: "block", block: "water" }, 1, 1) as EditorMap;
    const history = setActiveLayer(commitEditorHistory(createEditorHistory(base), painted), 1);
    expect(undoEditorHistory(history).activeLayer).toBe(1);
    expect(redoEditorHistory(undoEditorHistory(history)).activeLayer).toBe(1);
  });

  it("does not dirty the map on its own", () => {
    const base = blankMap("m", 20, 15);
    const history = markEditorHistorySaved(createEditorHistory(base));
    expect(isEditorHistoryDirty(history)).toBe(false);
    const layerSwitched = setActiveLayer(history, 1);
    expect(isEditorHistoryDirty(layerSwitched)).toBe(false);
  });
});

describe("applyTool: elevation", () => {
  it("raises the cell and casts a cliff wall on layer 1 in the cell below", () => {
    const map = blankMap("m", 20, 15);
    const next = applyTool(map, { kind: "elevation", level: 1 }, 5, 6) as EditorMap;
    expect(next).not.toBeNull();
    expect(groundSlot(next, 5, 6)).toBe(GRASS_SLOTS[1]);
    expect(wallSlot(next, 5, 7)).toBe(CLIFF_WALL_SLOT);
    // The raised cell itself carries no wall: nothing above it stands higher.
    expect(wallSlot(next, 5, 6)).toBe(-1);
  });

  it("takes the wall away again when the ground drops back to level 0", () => {
    const raised = applyTool(blankMap("m", 20, 15), { kind: "elevation", level: 1 }, 5, 6);
    const flattened = applyTool(raised as EditorMap, { kind: "block", block: "grass" }, 5, 6);
    expect(wallSlot(flattened as EditorMap, 5, 7)).toBe(-1);
  });

  it("takes the wall away when the raised ground is erased entirely", () => {
    const raised = applyTool(blankMap("m", 20, 15), { kind: "elevation", level: 1 }, 5, 6);
    const erased = applyTool(raised as EditorMap, { kind: "block", block: "water" }, 5, 6);
    expect(groundSlot(erased as EditorMap, 5, 6)).toBe(-1);
    expect(wallSlot(erased as EditorMap, 5, 7)).toBe(-1);
  });

  it("refuses a stroke whose cliff wall would land on the spawn", () => {
    const map = blankMap("m", 20, 15);
    // The wall lands one row below the raised cell, so raising the cell above the spawn would
    // wall the spawn in — that is exactly the stroke `keepsSpawnClear` has to refuse.
    expect(
      applyTool(map, { kind: "elevation", level: 1 }, map.spawn.col, map.spawn.row - 1),
    ).toBeNull();
  });
});

/**
 * The regression this whole task exists to prevent.
 *
 * A cliff wall lives on layer 1. The editor used to store a `.`/`#` block grid and project it onto
 * layers at save time, and that projection could not represent layer 1 at all — so the first
 * open-and-save round trip after an elevation stroke would have flattened every cliff back to water,
 * silently, with no error and nothing to fail.
 */
describe("elevation survives a save/load round trip", () => {
  it("keeps the cliff wall on layer 1 after toSaveInput -> parseMapData -> editor layers", () => {
    const painted = applyTool(
      blankMap("m", 20, 15),
      { kind: "elevation", level: 1 },
      5,
      6,
    ) as EditorMap;
    expect(wallSlot(painted, 5, 7)).toBe(CLIFF_WALL_SLOT);

    // Exactly what the Save button sends, and exactly what /api/maps/:id sends back.
    const saved = toSaveInput(painted);
    const reloaded: EditorMap = { ...painted, layers: editorLayersFromPayload(saved) };

    expect(reloaded.layers).toHaveLength(3);
    expect(groundSlot(reloaded, 5, 6)).toBe(GRASS_SLOTS[1]);
    expect(wallSlot(reloaded, 5, 7)).toBe(CLIFF_WALL_SLOT);
    expect(reloaded.layers[0]?.ids).toEqual(painted.layers[0]?.ids);
    expect(reloaded.layers[1]?.ids).toEqual(painted.layers[1]?.ids);
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

describe("markers are quarantined on the editor map", () => {
  it("blankMap starts with empty markers", () => {
    expect(blankMap("m", 20, 15).markers).toEqual(EMPTY_MARKERS);
  });

  it("the editor never authors a functional marker: the save body always sends EMPTY_MARKERS", () => {
    // Even a map seeded (by hand) with legacy markers is saved with none — the functional meaning is
    // events now, and the editor emits `EMPTY_MARKERS` regardless of what the field still holds.
    const base = blankMap("m", 20, 15);
    const seeded: EditorMap = {
      ...base,
      markers: {
        entries: [{ id: "door", col: 2, row: 2 }],
        exits: [{ id: "gate", col: 4, row: 4 }],
        monsterSpawns: [],
      },
    };
    expect(toSaveInput(seeded).markers).toEqual(EMPTY_MARKERS);
    expect(toSaveInput(base).markers).toEqual(EMPTY_MARKERS);
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

describe("applyTool: functional event kinds (entry / exit / monster)", () => {
  const base = blankMap("m", 20, 15);

  it("places an entry event as a functionalEvent-shaped MapEvent with a uuid", () => {
    const next = applyTool(base, { kind: "event", eventKind: "entry" }, 2, 2) as EditorMap;
    expect(next).not.toBeNull();
    expect(next.events).toHaveLength(1);
    const event = next.events[0] as MapEvent;
    expect(isUuid(event.id)).toBe(true);
    expect(event.kind).toBe("entry");
    expect(event).toMatchObject({ col: 2, row: 2, name: "", ordinal: 1, species: null });
    expect(event.patrolRadius).toBeNull();
    // A functional event is single-page, conditions-disabled — the one default page and no more.
    expect(event.pages).toEqual([defaultEventPage()]);
  });

  it("places an exit event, and an exit may not share the spawn cell", () => {
    const next = applyTool(base, { kind: "event", eventKind: "exit" }, 5, 5) as EditorMap;
    expect(next.events[0]?.kind).toBe("exit");
    // The exit-on-spawn rule the server enforces is refused here too.
    expect(
      applyTool(base, { kind: "event", eventKind: "exit" }, base.spawn.col, base.spawn.row),
    ).toBeNull();
  });

  it("allows an entry on the spawn cell (the born default map does exactly this)", () => {
    const onSpawn = applyTool(
      base,
      { kind: "event", eventKind: "entry" },
      base.spawn.col,
      base.spawn.row,
    ) as EditorMap;
    expect(onSpawn).not.toBeNull();
    expect(onSpawn.events[0]?.kind).toBe("entry");
  });

  it("refuses a functional event on solid ground (walkable rule, per kind)", () => {
    const wet = applyTool(base, { kind: "block", block: "water" }, 3, 3) as EditorMap;
    expect(applyTool(wet, { kind: "event", eventKind: "entry" }, 3, 3)).toBeNull();
    expect(applyTool(wet, { kind: "event", eventKind: "exit" }, 3, 3)).toBeNull();
    expect(
      applyTool(
        wet,
        { kind: "event", eventKind: "monster", species: "spear_goblin", patrolRadius: 96 },
        3,
        3,
      ),
    ).toBeNull();
    // A `normal` event floats above collision, so water is fine.
    expect(applyTool(wet, { kind: "event", eventKind: "normal" }, 3, 3)).not.toBeNull();
  });

  it("places a monster event carrying species and radius, and validates the radius", () => {
    const placed = applyTool(
      base,
      { kind: "event", eventKind: "monster", species: "spear_goblin", patrolRadius: 96 },
      6,
      6,
    ) as EditorMap;
    const event = placed.events[0] as MapEvent;
    expect(event.kind).toBe("monster");
    expect(event.species).toBe("spear_goblin");
    expect(event.patrolRadius).toBe(96);
    // Out-of-range radius and a missing species are refused (would be rejected by the wire parser).
    expect(
      applyTool(
        base,
        { kind: "event", eventKind: "monster", species: "spear_goblin", patrolRadius: 8 },
        6,
        6,
      ),
    ).toBeNull();
    expect(
      applyTool(base, { kind: "event", eventKind: "monster", patrolRadius: 96 }, 6, 6),
    ).toBeNull();
  });

  it("still refuses a second event on an occupied cell, whatever the kind", () => {
    const entry = applyTool(base, { kind: "event", eventKind: "entry" }, 4, 4) as EditorMap;
    expect(applyTool(entry, { kind: "event", eventKind: "exit" }, 4, 4)).toBeNull();
    expect(selectionAt(entry, 4, 4)).toEqual({ kind: "event", id: entry.events[0]?.id });
  });

  it("the eraser and moveSelection treat functional events like any event", () => {
    const entry = applyTool(base, { kind: "event", eventKind: "entry" }, 4, 4) as EditorMap;
    const id = entry.events[0]?.id ?? "";
    // Eraser peels the event off its cell.
    expect((applyTool(entry, { kind: "eraser" }, 4, 4) as EditorMap).events).toEqual([]);
    // Move keeps the exit off the spawn cell (the same rule as placement).
    const exit = applyTool(base, { kind: "event", eventKind: "exit" }, 7, 7) as EditorMap;
    const exitId = exit.events[0]?.id ?? "";
    expect(
      moveSelection(exit, { kind: "event", id: exitId }, exit.spawn.col, exit.spawn.row),
    ).toBeNull();
    // But a move onto walkable ground is fine, id preserved.
    const moved = moveSelection(entry, { kind: "event", id }, 8, 8) as EditorMap;
    expect(moved.events[0]).toMatchObject({ id, col: 8, row: 8, kind: "entry" });
  });
});

describe("entry/exit event uuids drive the graph binding (the Cartes-panel start star)", () => {
  it("entryEvents/exitEvents expose only their kind's events, by uuid", () => {
    let map = blankMap("m", 20, 15);
    map = applyTool(map, { kind: "event", eventKind: "entry" }, 2, 2) as EditorMap;
    map = applyTool(map, { kind: "event", eventKind: "exit" }, 5, 5) as EditorMap;
    map = applyTool(map, { kind: "event", eventKind: "normal" }, 9, 9) as EditorMap;

    const entries = entryEvents(map.events);
    const exits = exitEvents(map.events);
    expect(entries).toHaveLength(1);
    expect(exits).toHaveLength(1);
    // These uuids are exactly what the adventure graph binds (start → an entry, an exit → dest).
    expect(isUuid(entries[0]?.id)).toBe(true);
    expect(isUuid(exits[0]?.id)).toBe(true);
    // The scripted event is neither an entry nor an exit anchor.
    expect(entries.some((e) => e.col === 9)).toBe(false);
    expect(exits.some((e) => e.col === 9)).toBe(false);
  });
});

describe("applyTool: event placement", () => {
  it("mints a uuid, the next ordinal, and the wireframe's default page, as one undo entry", () => {
    const base = blankMap("m", 20, 15);
    const next = applyTool(base, { kind: "event", eventKind: "normal" }, 3, 4) as EditorMap;
    expect(next).not.toBeNull();
    expect(next).not.toBe(base);
    expect(next.events).toHaveLength(1);

    const event = next.events[0];
    expect(isUuid(event?.id)).toBe(true);
    expect(event?.col).toBe(3);
    expect(event?.row).toBe(4);
    expect(event?.name).toBe("");
    expect(event?.ordinal).toBe(1);
    // The lone page is the wireframe's `defPage`: speed 4 (not 3), Stop-Anim off (not on).
    expect(event?.pages).toEqual([defaultEventPage()]);
    expect(event?.pages[0]?.moveSpeed).toBe(4);
    expect(event?.pages[0]?.moveFreq).toBe(3);
    expect(event?.pages[0]?.optMoveAnim).toBe(true);
    expect(event?.pages[0]?.optStopAnim).toBe(false);
    expect(event?.pages[0]?.trigger).toBe("action");

    const history = commitEditorHistory(createEditorHistory(base), next);
    expect(history.past).toHaveLength(1);
    expect(undoEditorHistory(history).present).toEqual(base);

    // A second event takes the next ordinal and a fresh, distinct id.
    const two = applyTool(next, { kind: "event", eventKind: "normal" }, 5, 6) as EditorMap;
    expect(two.events[1]?.ordinal).toBe(2);
    expect(two.events[0]?.id).not.toBe(two.events[1]?.id);
  });

  it("stamps the tool's pending graphic onto the new event's page 1", () => {
    const base = blankMap("m", 20, 15);
    const graphic = EDITOR_ASSETS[0]?.id as EditorAssetId;
    const next = applyTool(
      base,
      { kind: "event", eventKind: "normal", graphic },
      3,
      4,
    ) as EditorMap;
    // The pending graphic (the palette's Événements picker) becomes page 1's appearance; every other
    // page field stays the wireframe default.
    expect(next.events[0]?.pages[0]?.graphicAssetId).toBe(graphic);
    expect(next.events[0]?.pages[0]?.moveSpeed).toBe(4);
  });

  it("leaves page 1's graphic null when the tool carries no graphic", () => {
    const base = blankMap("m", 20, 15);
    expect(
      (applyTool(base, { kind: "event", eventKind: "normal", graphic: null }, 3, 4) as EditorMap)
        .events[0]?.pages[0]?.graphicAssetId,
    ).toBeNull();
    expect(
      (applyTool(base, { kind: "event", eventKind: "normal" }, 3, 4) as EditorMap).events[0]
        ?.pages[0]?.graphicAssetId,
    ).toBeNull();
  });

  it("refuses a second event on an occupied cell and selects it instead — no history entry", () => {
    const base = blankMap("m", 20, 15);
    const next = applyTool(base, { kind: "event", eventKind: "normal" }, 3, 4) as EditorMap;
    const id = next.events[0]?.id ?? "";

    // Placement on the occupied cell is a no-op: the pointer path reads null as "select this one".
    expect(applyTool(next, { kind: "event", eventKind: "normal" }, 3, 4)).toBeNull();
    expect(selectionAt(next, 3, 4)).toEqual({ kind: "event", id });

    // A rejected placement commits nothing.
    const history = commitEditorHistory(createEditorHistory(next), next);
    expect(history.past).toHaveLength(0);
  });
});

describe("moveSelection: event", () => {
  it("drags an event to an empty cell as one history entry", () => {
    const base = blankMap("m", 20, 15);
    const placed = applyTool(base, { kind: "event", eventKind: "normal" }, 3, 4) as EditorMap;
    const id = placed.events[0]?.id ?? "";

    const moved = moveSelection(placed, { kind: "event", id }, 7, 8) as EditorMap;
    expect(moved).not.toBeNull();
    expect(moved.events[0]?.col).toBe(7);
    expect(moved.events[0]?.row).toBe(8);
    expect(moved.events[0]?.id).toBe(id); // id survives the move

    const history = commitEditorHistory(createEditorHistory(placed), moved);
    expect(history.past).toHaveLength(1);
  });

  it("is a no-op when the destination cell already holds an event", () => {
    const base = blankMap("m", 20, 15);
    const one = applyTool(base, { kind: "event", eventKind: "normal" }, 3, 4) as EditorMap;
    const two = applyTool(one, { kind: "event", eventKind: "normal" }, 5, 6) as EditorMap;
    const firstId = two.events[0]?.id ?? "";
    expect(moveSelection(two, { kind: "event", id: firstId }, 5, 6)).toBeNull();
  });
});

describe("applyTool: eraser precedence event > element", () => {
  it("peels the event first, then the element, on successive strokes", () => {
    // One cell carrying both planes at once — they are independent, so a cell may hold an event and
    // an element together. Built by hand so the construction is unambiguous. (Markers are dead — an
    // entry/exit/monster is an event now, peeled off by the same first stroke.)
    const base = blankMap("m", 20, 15);
    const event: MapEvent = {
      id: "11111111-1111-4111-8111-111111111111",
      col: 3,
      row: 4,
      name: "",
      ordinal: 1,
      kind: "normal",
      species: null,
      patrolRadius: null,
      pages: [defaultEventPage()],
    };
    const stacked: EditorMap = {
      ...base,
      elements: [{ col: 3, row: 4, assetId: BUSH }],
      events: [event],
    };

    // Stroke 1: the event goes; the element stays.
    const afterEvent = applyTool(stacked, { kind: "eraser" }, 3, 4) as EditorMap;
    expect(afterEvent.events).toEqual([]);
    expect(afterEvent.elements).toEqual([{ col: 3, row: 4, assetId: BUSH }]);

    // Stroke 2: the element goes.
    const afterElement = applyTool(afterEvent, { kind: "eraser" }, 3, 4) as EditorMap;
    expect(afterElement.elements).toEqual([]);
  });
});

describe("event dialog draft", () => {
  it("keeps edits off history until commit, then folds them into ONE entry", () => {
    const map = applyTool(
      blankMap("m", 20, 15),
      { kind: "event", eventKind: "normal" },
      3,
      4,
    ) as EditorMap;
    const id = map.events[0]?.id ?? "";
    const history = markEditorHistorySaved(createEditorHistory(map));

    // Edit two fields on a detached draft.
    let draft = beginEventDraft(map, id) as MapEvent;
    draft = setEventDraftName(draft, "Goblin");
    draft = updateEventDraftPage(draft, 0, { trigger: "auto" });

    // Discard = drop the draft: the live map and history never moved.
    expect(isEditorHistoryDirty(history)).toBe(false);
    expect(history.past).toHaveLength(0);
    expect(map.events[0]?.name).toBe("");
    expect(map.events[0]?.pages[0]?.trigger).toBe("action");

    // Commit = one history entry carrying BOTH edits.
    const committed = commitEventDraft(history, draft);
    expect(committed.past).toHaveLength(1);
    expect(committed.present.events[0]?.name).toBe("Goblin");
    expect(committed.present.events[0]?.pages[0]?.trigger).toBe("auto");
  });

  it("flips the dirty flag when a committed draft changes an event field", () => {
    const map = applyTool(
      blankMap("m", 20, 15),
      { kind: "event", eventKind: "normal" },
      3,
      4,
    ) as EditorMap;
    const id = map.events[0]?.id ?? "";
    const history = markEditorHistorySaved(createEditorHistory(map));
    expect(isEditorHistoryDirty(history)).toBe(false);

    const draft = updateEventDraftPage(beginEventDraft(map, id) as MapEvent, 0, { moveSpeed: 2 });
    expect(isEditorHistoryDirty(commitEventDraft(history, draft))).toBe(true);
  });
});

describe("event serialization", () => {
  it("emits every condition field as an explicit null in the save body", () => {
    const map = applyTool(
      blankMap("m", 20, 15),
      { kind: "event", eventKind: "normal" },
      3,
      4,
    ) as EditorMap;
    const saved = toSaveInput(map);
    const body = JSON.stringify(saved);

    // The wire parser rejects a page with an ABSENT condition key, so the nulls must be present in
    // the literal JSON — not merely reconstructable.
    expect(body).toContain('"condSwitchId":null');
    expect(body).toContain('"condVariableId":null');
    expect(body).toContain('"condVariableMin":null');
    expect(body).toContain('"condSelfSwitch":null');
    expect(body).toContain('"graphicAssetId":null');

    const page = saved.events[0]?.pages[0];
    expect(page?.condSwitchId).toBeNull();
    expect(page?.condVariableId).toBeNull();
    expect(page?.condVariableMin).toBeNull();
    expect(page?.condSelfSwitch).toBeNull();
    expect(page?.graphicAssetId).toBeNull();
  });

  it("has the deleteSelection path drop an event by id", () => {
    const map = applyTool(
      blankMap("m", 20, 15),
      { kind: "event", eventKind: "normal" },
      3,
      4,
    ) as EditorMap;
    const id = map.events[0]?.id ?? "";
    expect(deleteSelection(map, { kind: "event", id }).events).toEqual([]);
  });
});

describe("placementLegalAt (UX wave #9 hover legality)", () => {
  const TREE_TOOL: EditorTool = { kind: "element", assetId: TREE };

  /** Paint one water cell so the "on water" cases have real solid ground to reject. */
  function withWaterAt(map: EditorMap, col: number, row: number): EditorMap {
    return applyTool(map, { kind: "block", block: "water" }, col, row) as EditorMap;
  }

  it("legal: a decoration on grass", () => {
    expect(placementLegalAt(TREE_TOOL, blankMap("m", 20, 15), 3, 4)).toBe(true);
  });

  it("illegal: a decoration on water", () => {
    const map = withWaterAt(blankMap("m", 20, 15), 3, 4);
    expect(placementLegalAt(TREE_TOOL, map, 3, 4)).toBe(false);
  });

  it("legal: an entry event on grass, illegal on water", () => {
    const map = withWaterAt(blankMap("m", 20, 15), 3, 4);
    expect(placementLegalAt({ kind: "event", eventKind: "entry" }, map, 5, 5)).toBe(true);
    expect(placementLegalAt({ kind: "event", eventKind: "entry" }, map, 3, 4)).toBe(false);
  });

  it("legal: the spawn on empty grass, illegal onto a decorated cell", () => {
    let map = blankMap("m", 20, 15);
    expect(placementLegalAt({ kind: "spawn" }, map, 6, 6)).toBe(true);
    map = applyTool(map, TREE_TOOL, 6, 6) as EditorMap;
    expect(placementLegalAt({ kind: "spawn" }, map, 6, 6)).toBe(false);
  });

  it("legal: an event on an empty cell, illegal on a cell that already holds an event", () => {
    let map = blankMap("m", 20, 15);
    expect(placementLegalAt({ kind: "event", eventKind: "normal" }, map, 7, 7)).toBe(true);
    map = applyTool(map, { kind: "event", eventKind: "normal" }, 7, 7) as EditorMap;
    expect(placementLegalAt({ kind: "event", eventKind: "normal" }, map, 7, 7)).toBe(false);
  });

  it("legal: the select tool anywhere, even over water (nothing to refuse)", () => {
    const map = withWaterAt(blankMap("m", 20, 15), 3, 4);
    expect(placementLegalAt({ kind: "select" }, map, 3, 4)).toBe(true);
  });

  it("illegal: any placement out of bounds", () => {
    expect(placementLegalAt(TREE_TOOL, blankMap("m", 20, 15), -1, 4)).toBe(false);
    expect(placementLegalAt(TREE_TOOL, blankMap("m", 20, 15), 20, 4)).toBe(false);
  });
});

describe("placementLegalAt: fill short-circuit (perf)", () => {
  const FILL_GRASS: EditorTool = { kind: "fill", content: { kind: "block", block: "grass" } };
  const FILL_WATER: EditorTool = { kind: "fill", content: { kind: "block", block: "water" } };

  /** Wrap the ground layer's `ids` array in a Proxy that counts index reads. The full `applyTool`
   *  fill path spreads and traverses this array (`floodFill` + `changedBounds` + `commitTerrain`);
   *  the short-circuit must not touch it at all, only the layer's `cols`/`rows`. */
  function countingGroundReads(map: EditorMap): { map: EditorMap; reads: () => number } {
    let reads = 0;
    const ground = map.layers[0];
    if (!ground) throw new Error("map has no ground layer");
    const ids = new Proxy(ground.ids, {
      get(target, prop, receiver) {
        reads += 1;
        return Reflect.get(target, prop, receiver);
      },
    });
    const proxied = { ...map, layers: [{ ...ground, ids }, ...map.layers.slice(1)] };
    return { map: proxied, reads: () => reads };
  }

  it("legal everywhere the content has a fill slot — position-independent", () => {
    const map = blankMap("m", 20, 15);
    // grass cell, water-fill area, both edges: all legal for a grass fill.
    expect(placementLegalAt(FILL_GRASS, map, 3, 4)).toBe(true);
    expect(placementLegalAt(FILL_GRASS, map, 0, 0)).toBe(true);
    expect(placementLegalAt(FILL_GRASS, map, 19, 14)).toBe(true);
  });

  it("illegal when the content has no fill slot (water), and out of bounds", () => {
    const map = blankMap("m", 20, 15);
    expect(placementLegalAt(FILL_WATER, map, 3, 4)).toBe(false);
    expect(placementLegalAt(FILL_GRASS, map, -1, 4)).toBe(false);
    expect(placementLegalAt(FILL_GRASS, map, 20, 4)).toBe(false);
  });

  it("agrees with the full applyTool legality it replaces", () => {
    const map = blankMap("m", 20, 15);
    for (const [tool, c, r] of [
      [FILL_GRASS, 3, 4],
      [FILL_GRASS, 0, 0],
      [FILL_WATER, 5, 5],
      [FILL_GRASS, -1, 0],
    ] as const) {
      expect(placementLegalAt(tool, map, c, r)).toBe(applyTool(map, tool, c, r, true) !== null);
    }
  });

  it("does not flood: the short-circuit never reads the ground tile array", () => {
    const probe = countingGroundReads(blankMap("m", 20, 15));
    expect(placementLegalAt(FILL_GRASS, probe.map, 3, 4)).toBe(true);
    expect(probe.reads()).toBe(0);

    // Proof the probe is live: the full path it replaces does traverse that array.
    const probe2 = countingGroundReads(blankMap("m", 20, 15));
    applyTool(probe2.map, FILL_GRASS, 3, 4, true);
    expect(probe2.reads()).toBeGreaterThan(0);
  });
});
