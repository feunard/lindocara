import {
  applyTool,
  beginEventDraft,
  blankMap,
  canLinkDoorAt,
  canvasEditorMap,
  commitEditorHistory,
  commitEventDraft,
  convertElementToEvent,
  createEditorHistory,
  croppedForSave,
  defaultEventPage,
  deleteSelection,
  EDITOR_HISTORY_LIMIT,
  type EditorMap,
  type EditorMode,
  type EditorTool,
  editorLayersFromPayload,
  editorMapSize,
  elementForSavedMap,
  isEditorHistoryDirty,
  markEditorHistorySaved,
  moveSelection,
  placementLegalAt,
  redoEditorHistory,
  selectionAt,
  selectionAtMode,
  setActiveMode,
  setEventDraftHarvestProfile,
  setEventDraftName,
  toSaveInput,
  undoEditorHistory,
  updateEventDraftPage,
  updateSelectedBridgeDimensions,
  updateSelectedBuildingSettings,
  updateSelectedElementOrientation,
  updateSelectedElementRotation,
} from "@lindocara/editor/game/editor-state.js";
import { harvestPreset, harvestProfileFromPreset } from "@lindocara/engine/harvest-presets.js";
import { decodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { isUuid } from "@lindocara/engine/identifiers.js";
import { EMPTY_MARKERS, MAX_MAP_ELEMENTS, type MapElement } from "@lindocara/engine/map-data.js";
import {
  entryEvents,
  exitEvents,
  functionalEvent,
  MAX_RUNTIME_EVENTS_PER_MAP,
  type MapEvent,
} from "@lindocara/engine/map-events.js";
import { MAP_MAX_COLS, MAP_MAX_ROWS, MAP_OCEAN_MARGIN } from "@lindocara/engine/map-limits.js";
import {
  eraseRect,
  groundElevationAt,
  paintRectAutotile,
  paintStairs,
  slotAt,
  stairsFixedIndex,
  stairsTilePlacements,
} from "@lindocara/engine/tile-brush.js";
import type { TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { decodeTileId, EMPTY_TILE } from "@lindocara/engine/tileset.js";
import {
  CLIFF_WALL_SLOT,
  GRASS_SLOTS,
  MAX_TERRAIN_LEVEL,
  TERRAIN_MATERIAL_SLOTS,
  TINY_SWORDS_TILESET,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import {
  DEFAULT_GUARD_APPEARANCE_ASSET_ID,
  DEFAULT_NPC_MODEL_ASSET_ID,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

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

/** The mode a tool belongs to: Field owns the terrain brushes and the spawn, Element the prop tool,
 *  Event the event tool. `applyTool` gates a tool it does not own out of a mode, so a test that is
 *  not about the gate lets `place` fill in the owning mode. */
function modeForTool(tool: EditorTool): EditorMode {
  return tool.kind === "element" ? "element" : tool.kind === "event" ? "event" : "field";
}

/** `applyTool` with the mode a tool belongs to filled in, so the placement/terrain tests below need
 *  not restate it. The eraser is shared by all three modes, so eraser tests — and any test that IS
 *  about the mode gate — still pass `mode` explicitly. */
function place(
  map: EditorMap,
  tool: EditorTool,
  col: number,
  row: number,
  isStrokeStart = true,
  mode: EditorMode = modeForTool(tool),
): EditorMap | null {
  return applyTool(map, tool, col, row, isStrokeStart, mode);
}

const TREE = "resource.terrain-resources-wood-trees.tree3" as const;
const BUSH = "decoration.terrain-decorations-bushes.bushe1" as const;
const HOUSE = "building.buildings-blue-buildings.house1" as const;
const BRIDGE = "terrain.bridge.wood.horizontal" as const;
const STONE = "decoration.terrain-decorations-rocks.rock1" as const;
const SMALL_DECOR = "decoration.deco.01" as const;
const SMALL_DECOR_ALT = "decoration.deco.02" as const;

function boundaryCrossingTreeProfile() {
  const profile = harvestProfileFromPreset("tree");
  return {
    ...profile,
    collision: {
      intact: { offsetX: -40, offsetY: -30, width: 64, height: 30 },
      depleted: profile.collision?.depleted ?? null,
    },
  };
}

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
    // Permanent day, not the cycle: a map an author is about to paint must not dim under them.
    expect(map.dayNightCycle).toBe(false);
    expect(map.fixedLighting).toBe("day");
  });

  it("serializes a disabled day/night cycle and its fixed ambience with the map", () => {
    const map = {
      ...blankMap("m", 20, 15),
      dayNightCycle: false,
      fixedLighting: "night-middle" as const,
    };
    expect(toSaveInput(map).dayNightCycle).toBe(false);
    expect(toSaveInput(map).fixedLighting).toBe("night-middle");
  });

  it("preserves an interior environment through the editable save document", () => {
    const map = { ...blankMap("room", 20, 15), environment: "interior" as const };
    const saved = toSaveInput(map);
    expect(saved.environment).toBe("interior");
    expect(decodeMap(saved.heightfield)?.environment).toBe("interior");
  });
});

describe("elementForSavedMap", () => {
  it("projects a fresh canvas element into its persisted cropped slot", () => {
    const authored = place(
      blankMap("m", 20, 15),
      { kind: "element", assetId: "building.lindocara.house" },
      6,
      6,
      false,
      "element",
    ) as EditorMap;
    const canvas = canvasEditorMap(authored);
    const selected = canvas.elements[0];
    expect(selected).toBeDefined();
    if (!selected) return;

    expect(elementForSavedMap(canvas, selected)).toEqual(croppedForSave(canvas).elements[0]);
    expect(elementForSavedMap(canvas, selected)).not.toMatchObject({
      col: selected.col,
      row: selected.row,
    });
  });
});

describe("applyTool: block", () => {
  it("writes the block at the cell and nowhere else, returning a NEW object", () => {
    const map = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "block", block: "water" };
    const next = place(map, tool, 3, 4);
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

  it("painting water under a tree keeps it because scenery is terrain-independent", () => {
    let map = blankMap("m", 20, 15);
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
    const withTree = place(map, treeTool, 3, 4);
    expect(withTree).not.toBeNull();
    map = withTree as EditorMap;
    const beforeElements = map.elements.slice();
    const waterTool: EditorTool = { kind: "block", block: "water" };
    const next = place(map, waterTool, 3, 4);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([{ col: 3, row: 4, offsetX: 0, offsetY: 0, assetId: TREE }]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("painting water under a stone keeps it too", () => {
    let map = blankMap("m", 20, 15);
    const stoneTool: EditorTool = { kind: "element", assetId: STONE };
    const withStone = place(map, stoneTool, 3, 4);
    expect(withStone).not.toBeNull();
    map = withStone as EditorMap;
    const beforeElements = map.elements.slice();
    const waterTool: EditorTool = { kind: "block", block: "water" };
    const next = place(map, waterTool, 3, 4);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([{ col: 3, row: 4, offsetX: 0, offsetY: 0, assetId: STONE }]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("refuses painting water onto the spawn cell", () => {
    const map = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "block", block: "water" };
    const next = place(map, tool, map.spawn.col, map.spawn.row);
    expect(next).toBeNull();
  });
});

describe("applyTool: element", () => {
  it("allows placing a tree on water", () => {
    let map = blankMap("m", 20, 15);
    const waterTool: EditorTool = { kind: "block", block: "water" };
    const withWater = place(map, waterTool, 3, 4);
    expect(withWater).not.toBeNull();
    map = withWater as EditorMap;
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
    const next = place(map, treeTool, 3, 4, true, "element");
    expect(next).not.toBeNull();
    expect(next?.elements).toEqual([{ col: 3, row: 4, offsetX: 0, offsetY: 0, assetId: TREE }]);
  });

  it("allows placing a stone on water", () => {
    let map = blankMap("m", 20, 15);
    const waterTool: EditorTool = { kind: "block", block: "water" };
    const withWater = place(map, waterTool, 3, 4);
    expect(withWater).not.toBeNull();
    map = withWater as EditorMap;
    const beforeElements = map.elements.slice();
    const stoneTool: EditorTool = { kind: "element", assetId: STONE };
    const next = place(map, stoneTool, 3, 4, true, "element");
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([{ col: 3, row: 4, offsetX: 0, offsetY: 0, assetId: STONE }]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("replaces the existing element only on an exact sub-position match", () => {
    // Task 12b changed the identity from `(col, row)` to the full sub-position, so REPLACE now means
    // "same cell AND same offset". Both placements here land at offset (0,0), so the tree replaces
    // the bush (length stays 1); a distinct offset would instead STACK — covered in editor-modes.
    let map = blankMap("m", 20, 15);
    const bushTool: EditorTool = { kind: "element", assetId: BUSH };
    const withBush = place(map, bushTool, 3, 4, true, "element");
    expect(withBush).not.toBeNull();
    map = withBush as EditorMap;
    const beforeElements = map.elements.slice();
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
    const next = place(map, treeTool, 3, 4, true, "element");
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([{ col: 3, row: 4, offsetX: 0, offsetY: 0, assetId: TREE }]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("refuses placing a colliding element on the spawn cell", () => {
    const map = blankMap("m", 20, 15);
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
    const next = place(map, treeTool, map.spawn.col, map.spawn.row, true, "element");
    expect(next).toBeNull();
  });

  it("refuses a new element once the map already holds the cap, but still allows replacing one", () => {
    // A 100x100 blank map so geometry is not the limit — the cap is. Fill from the top with bushes
    // (all grass and clear of the centred spawn).
    const base = blankMap("m", 100, 100);
    const elements: MapElement[] = Array.from({ length: MAX_MAP_ELEMENTS }, (_, i) => ({
      col: i % 100,
      row: Math.floor(i / 100),
      offsetX: 0,
      offsetY: 0,
      assetId: SMALL_DECOR,
    }));
    const full: EditorMap = { ...base, elements };

    // A new empty cell is refused because it would exceed the shared safety budget.
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
    expect(place(full, treeTool, 10, 30, true, "element")).toBeNull();

    // Replacing an element already on a cell is fine — the count does not grow.
    const replaced = place(
      full,
      { kind: "element", assetId: SMALL_DECOR_ALT },
      10,
      2,
      true,
      "element",
    );
    expect(replaced).not.toBeNull();
    expect(replaced?.elements).toHaveLength(MAX_MAP_ELEMENTS);
    expect(replaced?.elements.find((e) => e.col === 10 && e.row === 2)?.assetId).toBe(
      SMALL_DECOR_ALT,
    );
  });
});

describe("Select tool collection targeting and dragging", () => {
  it("only grabs the collection owned by the active mode on a shared cell", () => {
    let map = applyTool(
      blankMap("m", 20, 15),
      { kind: "element", assetId: BUSH },
      3,
      4,
      true,
      "element",
      2,
      1,
    ) as EditorMap;
    map = place(map, { kind: "event", eventKind: "normal" }, 3, 4) as EditorMap;
    const eventId = map.events[0]?.id ?? "";

    expect(selectionAtMode(map, 3, 4, "event", 2, 1)).toEqual({
      kind: "event",
      id: eventId,
    });
    expect(selectionAtMode(map, 3, 4, "element", 2, 1)).toEqual({
      kind: "element",
      col: 3,
      row: 4,
      offsetX: 2,
      offsetY: 1,
    });
    expect(selectionAtMode(map, 3, 4, "field", 2, 1)).toBeNull();
    expect(selectionAtMode(map, map.spawn.col, map.spawn.row, "field")).toEqual({
      kind: "spawn",
    });
  });

  it("prefers the exact quarter-cell prop in a stacked scenery cell", () => {
    let map = applyTool(
      blankMap("m", 20, 15),
      { kind: "element", assetId: BUSH },
      4,
      5,
      true,
      "element",
      0,
      0,
    ) as EditorMap;
    map = applyTool(
      map,
      { kind: "element", assetId: SMALL_DECOR },
      4,
      5,
      true,
      "element",
      3,
      2,
    ) as EditorMap;

    expect(selectionAtMode(map, 4, 5, "element", 0, 0)).toEqual({
      kind: "element",
      col: 4,
      row: 5,
      offsetX: 0,
      offsetY: 0,
    });
    expect(selectionAtMode(map, 4, 5, "element", 3, 2)).toEqual({
      kind: "element",
      col: 4,
      row: 5,
      offsetX: 3,
      offsetY: 2,
    });
  });

  it("moves a captured prop to the pointer's cell and quarter offset as one operation", () => {
    const placed = applyTool(
      blankMap("m", 20, 15),
      { kind: "element", assetId: BUSH },
      3,
      4,
      true,
      "element",
      1,
      2,
    ) as EditorMap;
    const selection = {
      kind: "element",
      col: 3,
      row: 4,
      offsetX: 1,
      offsetY: 2,
    } as const;
    const moved = moveSelection(placed, selection, 7, 8, 3, 0) as EditorMap;

    expect(moved.elements).toEqual([{ col: 7, row: 8, offsetX: 3, offsetY: 0, assetId: BUSH }]);
    const history = commitEditorHistory(createEditorHistory(placed), moved);
    expect(history.past).toHaveLength(1);
    expect(
      deleteSelection(moved, {
        kind: "element",
        col: 7,
        row: 8,
        offsetX: 3,
        offsetY: 0,
      }).elements,
    ).toEqual([]);
  });

  it("refuses to overwrite another prop already anchored at the drag destination", () => {
    let map = applyTool(
      blankMap("m", 20, 15),
      { kind: "element", assetId: BUSH },
      3,
      4,
      true,
      "element",
      1,
      1,
    ) as EditorMap;
    map = applyTool(
      map,
      { kind: "element", assetId: SMALL_DECOR },
      7,
      8,
      true,
      "element",
      2,
      3,
    ) as EditorMap;

    expect(
      moveSelection(map, { kind: "element", col: 3, row: 4, offsetX: 1, offsetY: 1 }, 7, 8, 2, 3),
    ).toBeNull();
    expect(map.elements).toHaveLength(2);
  });
});

describe("convertElementToEvent", () => {
  it("preserves the real asset and makes one-shot loot non-repeatable", () => {
    const placed = applyTool(
      blankMap("m", 20, 15),
      { kind: "element", assetId: BUSH },
      4,
      4,
      true,
      "element",
      2,
      1,
    );
    expect(placed).not.toBeNull();
    const converted = convertElementToEvent(
      placed as EditorMap,
      { kind: "element", col: 4, row: 4, offsetX: 2, offsetY: 1 },
      { name: "Coffre", commands: [{ t: "changeGold", amount: 10 }], once: true },
    );
    expect(converted).not.toBeNull();
    expect(converted?.map.elements).toEqual([]);
    expect(converted?.map.events[0]?.pages[0]?.graphicAssetId).toBe(BUSH);
    expect(converted?.map.events[0]?.pages[0]?.commands).toEqual([
      { t: "changeGold", amount: 10 },
      { t: "setSelfSwitch", selfSwitch: "A", value: true },
    ]);
    expect(converted?.map.events[0]?.pages[1]?.condSelfSwitch).toBe("A");
  });

  it("preserves the guided player-touch trigger for an authored area", () => {
    const placed = applyTool(
      blankMap("m", 20, 15),
      { kind: "element", assetId: BUSH },
      7,
      6,
      true,
      "element",
      0,
      0,
    );
    const converted = convertElementToEvent(
      placed as EditorMap,
      { kind: "element", col: 7, row: 6, offsetX: 0, offsetY: 0 },
      {
        name: "North gate",
        trigger: "player-touch",
        commands: [{ t: "enterArea", areaId: "north_gate" }],
      },
    );
    expect(converted?.map.events[0]?.pages[0]).toMatchObject({
      trigger: "player-touch",
      commands: [{ t: "enterArea", areaId: "north_gate" }],
    });
  });
});

describe("applyTool: eraser (mode-scoped)", () => {
  const eraserTool: EditorTool = { kind: "eraser" };

  it("removes the element at the cell in Element mode, leaving the ground beneath", () => {
    let map = blankMap("m", 20, 15);
    const bushTool: EditorTool = { kind: "element", assetId: BUSH };
    const withBush = place(map, bushTool, 3, 4, true, "element");
    expect(withBush).not.toBeNull();
    map = withBush as EditorMap;
    const beforeElements = map.elements.slice();
    const next = place(map, eraserTool, 3, 4, true, "element");
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.elements).toEqual([]);
    // The mode owns only its own collection: an Element erase never carves the terrain underneath.
    expect(groundSlot(next as EditorMap, 3, 4)).toBe(GRASS_SLOTS[0]);
    expect(map.elements).toEqual(beforeElements);
  });

  it("clears the ground in Field mode on a cell that holds no element", () => {
    const map = blankMap("m", 20, 15);
    const next = place(map, eraserTool, 3, 4, true, "field") as EditorMap;
    expect(next).not.toBe(map);
    expect(groundSlot(next, 3, 4)).toBe(-1);
  });

  it("leaves an element standing when Field mode erases the ground beneath it", () => {
    let map = blankMap("m", 20, 15);
    const bushTool: EditorTool = { kind: "element", assetId: BUSH };
    map = place(map, bushTool, 3, 4, true, "element") as EditorMap;
    // Field mode owns only terrain, so it clears the ground and leaves the bush floating — Element
    // mode's job to remove. (Unlike a paint stroke's `commitTerrain`, it does not drop the decor.)
    const next = place(map, eraserTool, 3, 4, true, "field") as EditorMap;
    expect(groundSlot(next, 3, 4)).toBe(-1);
    expect(next.elements).toEqual(map.elements);
  });

  it("returns the SAME reference on a Field-mode erase of an already-void cell", () => {
    const map = place(blankMap("m", 20, 15), eraserTool, 3, 4, true, "field") as EditorMap;
    expect(place(map, eraserTool, 3, 4, true, "field")).toBe(map);
  });

  it("refuses to drown the spawn cell in Field mode", () => {
    const map = blankMap("m", 20, 15);
    // Erasing the spawn's own ground would leave the spawn on water — the `keepsSpawnClear` guard
    // (carried over from the cascade's terrain-erase) refuses it.
    expect(place(map, eraserTool, map.spawn.col, map.spawn.row, true, "field")).toBeNull();
  });

  it("does not smear across a drag in any mode", () => {
    const map = blankMap("m", 20, 15);
    // A drag cell (isStrokeStart = false) erases nothing, whatever the mode owns — one stroke, one
    // cell. A click on the same cell still erases.
    expect(place(map, eraserTool, 3, 4, false, "field")).toBeNull();
    expect(groundSlot(map, 3, 4)).toBe(GRASS_SLOTS[0]);
    const clicked = place(map, eraserTool, 3, 4, true, "field") as EditorMap;
    expect(clicked).not.toBe(map);
    expect(groundSlot(clicked, 3, 4)).toBe(-1);
  });
});

describe("applyTool: rect", () => {
  it("anchors on stroke start and commits the whole rectangle once, on release", () => {
    const base = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "rect", content: { kind: "elevation", level: 1 } };

    let map = place(base, tool, 1, 1, true) as EditorMap;
    expect(map).not.toBeNull();
    // Stroke start alone paints nothing — it only drops the anchor.
    expect(map.layers[0]).toEqual(base.layers[0]);

    map = place(map, tool, 6, 6, false) as EditorMap; // drag out to a larger rectangle
    map = place(map, tool, 4, 3, false) as EditorMap; // shrink back and release here

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
    const raised = place(blankMap("m", 20, 15), { kind: "elevation", level: 1 }, 2, 2) as EditorMap;
    const tool: EditorTool = { kind: "rect", content: { kind: "block", block: "water" } };
    let map = place(raised, tool, 1, 1, true) as EditorMap;
    map = place(map, tool, 3, 3, false) as EditorMap;
    expect(groundSlot(map, 2, 2)).toBe(-1);
    expect(wallSlot(map, 2, 3)).toBe(-1);
  });

  it("refuses a drag cell with no open stroke", () => {
    const base = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "rect", content: { kind: "block", block: "grass" } };
    expect(place(base, tool, 3, 3, false)).toBeNull();
  });

  it("keeps scenery throughout a water rectangle drag", () => {
    const base = blankMap("m", 20, 15);
    const withTree = place(base, { kind: "element", assetId: TREE }, 5, 5) as EditorMap;
    expect(withTree).not.toBeNull();

    const tool: EditorTool = { kind: "rect", content: { kind: "block", block: "water" } };
    let map = place(withTree, tool, 1, 1, true) as EditorMap;
    map = place(map, tool, 5, 5, false) as EditorMap; // drag out over the tree
    // Mid-drag, the rectangle covers the tree's cell with water and the scenery remains authored.
    expect(map.elements).toEqual([{ col: 5, row: 5, offsetX: 0, offsetY: 0, assetId: TREE }]);
    map = place(map, tool, 2, 2, false) as EditorMap; // shrink back and release here

    // Shrinking the terrain preview also leaves the independent scenery untouched.
    expect(map.elements).toEqual([{ col: 5, row: 5, offsetX: 0, offsetY: 0, assetId: TREE }]);
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
      base = place(base, { kind: "block", block: "water" }, col, row) as EditorMap;
    }

    const tool: EditorTool = { kind: "fill", content: { kind: "block", block: "grass" } };
    const filled = place(base, tool, 3, 3) as EditorMap;
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
    expect(place(base, tool, 3, 3)).toBe(base);
  });
});

describe("applyTool: stairs", () => {
  function eastBoundary(): EditorMap {
    // Click low entrance (5,5); the two native halves land at rows 4/5 and replace the two cliff
    // faces immediately to their right.
    const top = place(blankMap("m", 20, 15), { kind: "elevation", level: 1 }, 6, 4) as EditorMap;
    return place(top, { kind: "elevation", level: 1 }, 6, 5) as EditorMap;
  }

  it("stamps both official ramp halves from the low entrance as one undo entry", () => {
    const base = eastBoundary();
    // No direction, no levels: the stamp reads both off the boundary under the cursor.
    const tool: EditorTool = { kind: "stairs" };
    const next = place(base, tool, 5, 5) as EditorMap;
    expect(next).not.toBeNull();
    const expectedWalls = paintStairs(base.layers, TINY_SWORDS_TILESET, 5, 5)[1];
    expect(next.layers[1]).toEqual(expectedWalls);
    expect(decodeTileId(next.layers[1]?.ids[5 * 20 + 5] ?? EMPTY_TILE)).toEqual({
      kind: "fixed",
      index: stairsFixedIndex("east", 0, "low"),
    });
    expect(decodeTileId(next.layers[1]?.ids[4 * 20 + 5] ?? EMPTY_TILE)).toEqual({
      kind: "fixed",
      index: stairsFixedIndex("east", 0, "high"),
    });

    const history = commitEditorHistory(createEditorHistory(base), next);
    expect(history.past).toHaveLength(1);
  });

  it("refuses flat ground instead of manufacturing its own elevation", () => {
    const base = blankMap("m", 20, 15);
    // No direction, no levels: the stamp reads both off the boundary under the cursor.
    const tool: EditorTool = { kind: "stairs" };
    expect(place(base, tool, 5, 5)).toBeNull();

    const history = commitEditorHistory(createEditorHistory(base), base);
    expect(history.past).toHaveLength(0);
  });

  it("water painted on the ramp cell removes the ramp", () => {
    const ramp = place(eastBoundary(), { kind: "stairs" }, 5, 5) as EditorMap;
    const drowned = place(ramp, { kind: "block", block: "water" }, 5, 5) as EditorMap;
    expect(groundSlot(drowned, 5, 5)).toBe(-1);
    for (const placement of stairsTilePlacements("east", 0)) {
      const wall = decodeTileId(
        drowned.layers[1]?.ids[(5 + placement.row) * 20 + 5 + placement.col] ?? EMPTY_TILE,
      );
      expect(wall).not.toEqual({ kind: "fixed", index: placement.fixedIndex });
    }
  });

  it("a water rectangle removes every ramp cell it covers", () => {
    const ramp = place(eastBoundary(), { kind: "stairs" }, 5, 5) as EditorMap;
    const water: EditorTool = { kind: "rect", content: { kind: "block", block: "water" } };
    let drowned = place(ramp, water, 4, 5, true) as EditorMap;
    drowned = place(drowned, water, 6, 6, false) as EditorMap;
    expect(groundSlot(drowned, 5, 5)).toBe(-1);
    for (const placement of stairsTilePlacements("east", 0)) {
      const wall = decodeTileId(
        drowned.layers[1]?.ids[(5 + placement.row) * 20 + 5 + placement.col] ?? EMPTY_TILE,
      );
      expect(wall).not.toEqual({ kind: "fixed", index: placement.fixedIndex });
    }
  });
});

describe("setActiveMode", () => {
  it("swaps the field without touching past, present, future or saved", () => {
    const history = createEditorHistory(blankMap("m", 20, 15));
    expect(history.activeMode).toBe("field");
    const next = setActiveMode(history, "event");
    expect(next.activeMode).toBe("event");
    expect(next.present).toBe(history.present);
    expect(next.past).toBe(history.past);
    expect(next.saved).toBe(history.saved);
  });

  it("survives undo/redo unchanged, unlike map content", () => {
    const base = blankMap("m", 20, 15);
    const painted = place(base, { kind: "block", block: "water" }, 1, 1) as EditorMap;
    const history = setActiveMode(
      commitEditorHistory(createEditorHistory(base), painted),
      "element",
    );
    expect(undoEditorHistory(history).activeMode).toBe("element");
    expect(redoEditorHistory(undoEditorHistory(history)).activeMode).toBe("element");
  });

  it("does not dirty the map on its own", () => {
    const base = blankMap("m", 20, 15);
    const history = markEditorHistorySaved(createEditorHistory(base));
    expect(isEditorHistoryDirty(history)).toBe(false);
    const modeSwitched = setActiveMode(history, "element");
    expect(isEditorHistoryDirty(modeSwitched)).toBe(false);
  });
});

describe("applyTool: elevation", () => {
  it("raises the cell and casts a cliff wall on layer 1 in the cell below", () => {
    const map = blankMap("m", 20, 15);
    const next = place(map, { kind: "elevation", level: 1 }, 5, 6) as EditorMap;
    expect(next).not.toBeNull();
    expect(groundSlot(next, 5, 6)).toBe(GRASS_SLOTS[1]);
    expect(wallSlot(next, 5, 7)).toBe(CLIFF_WALL_SLOT);
    // The raised cell itself carries no wall: nothing above it stands higher.
    expect(wallSlot(next, 5, 6)).toBe(-1);
  });

  it("takes the wall away again when the ground drops back to level 0", () => {
    const raised = place(blankMap("m", 20, 15), { kind: "elevation", level: 1 }, 5, 6);
    const flattened = place(raised as EditorMap, { kind: "block", block: "grass" }, 5, 6);
    expect(wallSlot(flattened as EditorMap, 5, 7)).toBe(-1);
  });

  it("takes the wall away when the raised ground is erased entirely", () => {
    const raised = place(blankMap("m", 20, 15), { kind: "elevation", level: 1 }, 5, 6);
    const erased = place(raised as EditorMap, { kind: "block", block: "water" }, 5, 6);
    expect(groundSlot(erased as EditorMap, 5, 6)).toBe(-1);
    expect(wallSlot(erased as EditorMap, 5, 7)).toBe(-1);
  });

  it("refuses a stroke whose cliff wall would land on the spawn", () => {
    const map = blankMap("m", 20, 15);
    // The wall lands one row below the raised cell, so raising the cell above the spawn would
    // wall the spawn in — that is exactly the stroke `keepsSpawnClear` has to refuse.
    expect(
      place(map, { kind: "elevation", level: 1 }, map.spawn.col, map.spawn.row - 1),
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
    const painted = place(
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
    const next = place(map, tool, 5, 6);
    expect(next).not.toBeNull();
    expect(next).not.toBe(map);
    expect(next?.spawn).toEqual({ col: 5, row: 6 });
    expect(map.spawn).toEqual(beforeSpawn);
  });

  it("refuses moving the spawn onto water", () => {
    let map = blankMap("m", 20, 15);
    const waterTool: EditorTool = { kind: "block", block: "water" };
    const withWater = place(map, waterTool, 5, 6);
    expect(withWater).not.toBeNull();
    map = withWater as EditorMap;
    const spawnTool: EditorTool = { kind: "spawn" };
    const next = place(map, spawnTool, 5, 6);
    expect(next).toBeNull();
  });

  it("refuses moving the spawn under a colliding element", () => {
    let map = blankMap("m", 20, 15);
    const treeTool: EditorTool = { kind: "element", assetId: TREE };
    const withTree = place(map, treeTool, 5, 6);
    expect(withTree).not.toBeNull();
    map = withTree as EditorMap;
    const spawnTool: EditorTool = { kind: "spawn" };
    const next = place(map, spawnTool, 5, 6);
    expect(next).toBeNull();
  });
});

describe("applyTool: bounds", () => {
  it("refuses any out-of-bounds col/row", () => {
    const map = blankMap("m", 20, 15);
    const tool: EditorTool = { kind: "block", block: "water" };
    expect(place(map, tool, -1, 0)).toBeNull();
    expect(place(map, tool, 0, -1)).toBeNull();
    expect(place(map, tool, 20, 0)).toBeNull();
    expect(place(map, tool, 0, 15)).toBeNull();
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
  it("history keeps at most EDITOR_HISTORY_LIMIT undo steps", () => {
    const base = blankMap("m", 20, 15);
    let history = createEditorHistory(base);
    for (let step = 0; step < EDITOR_HISTORY_LIMIT + 5; step += 1) {
      history = commitEditorHistory(history, { ...history.present, name: `m${step}` });
    }
    expect(history.past.length).toBe(EDITOR_HISTORY_LIMIT);
    // The oldest snapshots fell off the far end; the newest survive.
    expect(history.past[history.past.length - 1]?.name).toBe(`m${EDITOR_HISTORY_LIMIT + 3}`);
  });

  it("undoes and redoes one committed operation", () => {
    const base = blankMap("m", 20, 15);
    const painted = place(base, { kind: "block", block: "water" }, 1, 1) as EditorMap;
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
      stroke = place(stroke, { kind: "block", block: "water" }, col, 1) as EditorMap;
    }

    const history = commitEditorHistory(createEditorHistory(base), stroke);
    expect(history.past).toHaveLength(1);
    expect(undoEditorHistory(history).present).toEqual(base);
  });

  it("resets dirty state only at the saved revision", () => {
    const base = blankMap("m", 20, 15);
    const painted = place(base, { kind: "block", block: "water" }, 1, 1) as EditorMap;
    const committed = commitEditorHistory(createEditorHistory(base), painted);
    const saved = markEditorHistorySaved(committed);
    expect(isEditorHistoryDirty(saved)).toBe(false);
    expect(isEditorHistoryDirty(undoEditorHistory(saved))).toBe(true);
  });
});

describe("applyTool: functional event kinds", () => {
  const base = blankMap("m", 20, 15);

  it("places a harvestable with an explicit profile and an independent appearance", () => {
    const profile = harvestProfileFromPreset("tree");
    const next = place(
      base,
      {
        kind: "event",
        eventKind: "harvestable",
        graphic: "decoration.terrain-decorations-bushes.bushe1",
        harvestProfile: profile,
      },
      2,
      2,
    ) as EditorMap;

    expect(next.events[0]).toMatchObject({
      kind: "harvestable",
      harvestProfile: profile,
      pages: [{ graphicAssetId: "decoration.terrain-decorations-bushes.bushe1" }],
    });
    expect(next.events[0]?.harvestProfile).toMatchObject({ resource: "wood", tool: "axe" });
  });

  it("places the stable sheep preset as explicit meat harvested with a knife", () => {
    const preset = harvestPreset("sheep");
    const next = place(
      base,
      {
        kind: "event",
        eventKind: "harvestable",
        graphic: preset.intactAssetId,
        harvestProfile: harvestProfileFromPreset("sheep"),
      },
      3,
      3,
    ) as EditorMap;
    expect(next.events[0]?.pages[0]?.graphicAssetId).toBe(
      "resource.terrain-resources-meat-sheep.sheep-idle",
    );
    expect(next.events[0]?.harvestProfile).toMatchObject({ resource: "meat", tool: "knife" });
  });

  it("defensively refuses an incomplete harvest tool from an untyped caller", () => {
    const incomplete = {
      kind: "event",
      eventKind: "harvestable",
    } as unknown as EditorTool;
    expect(place(base, incomplete, 2, 2)).toBeNull();
  });

  it("allows placement and movement when a harvest footprint overhangs the map", () => {
    const preset = harvestPreset("tree");
    const tool: EditorTool = {
      kind: "event",
      eventKind: "harvestable",
      graphic: preset.intactAssetId,
      harvestProfile: boundaryCrossingTreeProfile(),
    };

    expect(place(base, tool, 0, 2)).not.toBeNull();
    expect(placementLegalAt(tool, base, 0, 2, "event")).toBe(true);

    const placed = place(base, tool, 1, 2) as EditorMap;
    const id = placed.events[0]?.id ?? "";
    expect(placed.events).toHaveLength(1);
    expect(moveSelection(placed, { kind: "event", id }, 0, 2)).not.toBeNull();
  });

  it("places an entry event as a functionalEvent-shaped MapEvent with a uuid", () => {
    const next = place(base, { kind: "event", eventKind: "entry" }, 2, 2) as EditorMap;
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
    const next = place(base, { kind: "event", eventKind: "exit" }, 5, 5) as EditorMap;
    expect(next.events[0]?.kind).toBe("exit");
    // The exit-on-spawn rule the server enforces is refused here too.
    expect(
      place(base, { kind: "event", eventKind: "exit" }, base.spawn.col, base.spawn.row),
    ).toBeNull();
  });

  it("allows an entry on the spawn cell (the born default map does exactly this)", () => {
    const onSpawn = place(
      base,
      { kind: "event", eventKind: "entry" },
      base.spawn.col,
      base.spawn.row,
    ) as EditorMap;
    expect(onSpawn).not.toBeNull();
    expect(onSpawn.events[0]?.kind).toBe("entry");
  });

  it("allows every functional event kind in water", () => {
    const wet = place(base, { kind: "block", block: "water" }, 3, 3) as EditorMap;
    expect(place(wet, { kind: "event", eventKind: "entry" }, 3, 3)).not.toBeNull();
    expect(place(wet, { kind: "event", eventKind: "exit" }, 3, 3)).not.toBeNull();
    expect(
      place(
        wet,
        { kind: "event", eventKind: "monster", species: "spear_goblin", patrolRadius: 96 },
        3,
        3,
      ),
    ).not.toBeNull();
    expect(
      place(wet, { kind: "event", eventKind: "guard", patrolRadius: 96 }, 3, 3),
    ).not.toBeNull();
    expect(place(wet, { kind: "event", eventKind: "npc", patrolRadius: 96 }, 3, 3)).not.toBeNull();
    expect(place(wet, { kind: "event", eventKind: "normal" }, 3, 3)).not.toBeNull();
    expect(place(wet, { kind: "event", eventKind: "sea-guardian" }, 3, 3)).not.toBeNull();
  });

  it("places multiple sea guardians, only on water, and keeps moves in water", () => {
    expect(place(base, { kind: "event", eventKind: "sea-guardian" }, 3, 3)).toBeNull();

    const firstWet = place(base, { kind: "block", block: "water" }, 3, 3) as EditorMap;
    const secondWet = place(firstWet, { kind: "block", block: "water" }, 4, 3) as EditorMap;
    const wet = place(secondWet, { kind: "block", block: "water" }, 5, 3) as EditorMap;
    expect(placementLegalAt({ kind: "event", eventKind: "sea-guardian" }, wet, 3, 3, "event")).toBe(
      true,
    );
    const placed = place(
      wet,
      {
        kind: "event",
        eventKind: "sea-guardian",
        presetName: "Sea guardian",
      },
      3,
      3,
    ) as EditorMap;
    const guardian = placed.events[0] as MapEvent;
    expect(guardian).toMatchObject({
      kind: "sea-guardian",
      name: "Sea guardian",
      species: null,
      patrolRadius: null,
      pages: [defaultEventPage()],
    });
    const placedTwice = place(
      placed,
      { kind: "event", eventKind: "sea-guardian", presetName: "Sea guardian" },
      4,
      3,
    ) as EditorMap;
    expect(placedTwice.events.filter((event) => event.kind === "sea-guardian")).toHaveLength(2);
    expect(moveSelection(placedTwice, { kind: "event", id: guardian.id }, 6, 3)).toBeNull();
    const moved = moveSelection(placedTwice, { kind: "event", id: guardian.id }, 5, 3);
    expect(moved?.events.find((event) => event.id === guardian.id)).toMatchObject({
      id: guardian.id,
      col: 5,
      row: 3,
      kind: "sea-guardian",
    });
  });

  it("places a monster event carrying species and radius, and validates the radius", () => {
    const placed = place(
      base,
      { kind: "event", eventKind: "monster", species: "spear_goblin", patrolRadius: 96 },
      6,
      6,
    ) as EditorMap;
    const event = placed.events[0] as MapEvent;
    expect(event.kind).toBe("monster");
    expect(event.species).toBe("spear_goblin");
    expect(event.patrolRadius).toBe(96);
    // A one-pixel radius is a stationary leash; a negative radius and a missing species are refused.
    const stationary = place(
      base,
      { kind: "event", eventKind: "monster", species: "spear_goblin", patrolRadius: 1 },
      7,
      6,
    ) as EditorMap;
    expect(stationary.events[0]?.patrolRadius).toBe(1);
    expect(
      place(
        base,
        { kind: "event", eventKind: "monster", species: "spear_goblin", patrolRadius: -1 },
        6,
        6,
      ),
    ).toBeNull();
    expect(place(base, { kind: "event", eventKind: "monster", patrolRadius: 96 }, 6, 6)).toBeNull();
  });

  it("stores a catalogue appearance on a monster without changing its combat species", () => {
    const placed = place(
      base,
      {
        kind: "event",
        eventKind: "monster",
        species: "spear_goblin",
        patrolRadius: 96,
        graphic: DEFAULT_NPC_MODEL_ASSET_ID,
      },
      6,
      6,
    ) as EditorMap;
    expect(placed.events[0]).toMatchObject({
      kind: "monster",
      species: "spear_goblin",
      patrolRadius: 96,
    });
    expect(placed.events[0]?.pages[0]?.graphicAssetId).toBe(DEFAULT_NPC_MODEL_ASSET_ID);
  });

  it("places an allied guard with a validated radius and no monster tuning", () => {
    const placed = place(
      base,
      { kind: "event", eventKind: "guard", patrolRadius: 128 },
      9,
      6,
    ) as EditorMap;
    const event = placed.events[0] as MapEvent;
    expect(event.kind).toBe("guard");
    expect(event.species).toBeNull();
    expect(event.patrolRadius).toBe(128);
    expect(event.monsterRank).toBeNull();
    expect(event.pages).toEqual([defaultEventPage()]);
    expect(place(base, { kind: "event", eventKind: "guard", patrolRadius: -1 }, 9, 6)).toBeNull();
    expect(place(base, { kind: "event", eventKind: "guard" }, 9, 6)).toBeNull();
  });

  it("stores the selected native guard colour sheet on its page", () => {
    const placed = place(
      base,
      {
        kind: "event",
        eventKind: "guard",
        patrolRadius: 128,
        graphic: DEFAULT_GUARD_APPEARANCE_ASSET_ID,
      },
      9,
      6,
    ) as EditorMap;
    expect(placed.events[0]?.pages[0]?.graphicAssetId).toBe(DEFAULT_GUARD_APPEARANCE_ASSET_ID);
  });

  it("places a free NPC with characteristics and a random walking routine", () => {
    const placed = place(
      base,
      { kind: "event", eventKind: "npc", patrolRadius: 128 },
      8,
      6,
    ) as EditorMap;
    const event = placed.events[0] as MapEvent;

    expect(event).toMatchObject({
      kind: "npc",
      species: null,
      patrolRadius: 128,
      monsterMaxHp: expect.any(Number),
      monsterDamage: expect.any(Number),
    });
    expect(event.pages[0]).toMatchObject({
      moveType: "random",
      moveSpeed: 3,
      moveFreq: 2,
    });
    expect(place(base, { kind: "event", eventKind: "npc", patrolRadius: -1 }, 8, 6)).toBeNull();
    expect(place(base, { kind: "event", eventKind: "npc" }, 8, 6)).toBeNull();
  });

  it("stores the selected free-NPC model directly at placement", () => {
    const placed = place(
      base,
      {
        kind: "event",
        eventKind: "npc",
        patrolRadius: 128,
        graphic: DEFAULT_NPC_MODEL_ASSET_ID,
      },
      8,
      6,
    ) as EditorMap;
    expect(placed.events[0]?.pages[0]?.graphicAssetId).toBe(DEFAULT_NPC_MODEL_ASSET_ID);
  });

  it("refuses another active entity after the runtime safety budget is reached", () => {
    const events = Array.from({ length: MAX_RUNTIME_EVENTS_PER_MAP }, (_, index) =>
      functionalEvent({
        id: crypto.randomUUID(),
        col: index % 20,
        row: Math.floor(index / 20),
        ordinal: index + 1,
        kind: "npc",
        patrolRadius: 96,
      }),
    );
    const full: EditorMap = { ...base, events };

    expect(place(full, { kind: "event", eventKind: "npc", patrolRadius: 96 }, 19, 14)).toBeNull();
    expect(place(full, { kind: "event", eventKind: "entry" }, 19, 14)).not.toBeNull();
  });

  it("still refuses a second event on an occupied cell, whatever the kind", () => {
    const entry = place(base, { kind: "event", eventKind: "entry" }, 4, 4) as EditorMap;
    expect(place(entry, { kind: "event", eventKind: "exit" }, 4, 4)).toBeNull();
    expect(selectionAt(entry, 4, 4)).toEqual({ kind: "event", id: entry.events[0]?.id });
  });

  it("the eraser and moveSelection treat functional events like any event", () => {
    const entry = place(base, { kind: "event", eventKind: "entry" }, 4, 4) as EditorMap;
    const id = entry.events[0]?.id ?? "";
    // Eraser peels the event off its cell (Event mode owns the event plane).
    expect((place(entry, { kind: "eraser" }, 4, 4, true, "event") as EditorMap).events).toEqual([]);
    // Move keeps the exit off the spawn cell (the same rule as placement).
    const exit = place(base, { kind: "event", eventKind: "exit" }, 7, 7) as EditorMap;
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
    map = place(map, { kind: "event", eventKind: "entry" }, 2, 2) as EditorMap;
    map = place(map, { kind: "event", eventKind: "exit" }, 5, 5) as EditorMap;
    map = place(map, { kind: "event", eventKind: "normal" }, 9, 9) as EditorMap;

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
    const next = place(base, { kind: "event", eventKind: "normal" }, 3, 4) as EditorMap;
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
    const two = place(next, { kind: "event", eventKind: "normal" }, 5, 6) as EditorMap;
    expect(two.events[1]?.ordinal).toBe(2);
    expect(two.events[0]?.id).not.toBe(two.events[1]?.id);
  });

  it("pre-fills a preset event's page 1 with its command program and trigger (D13)", () => {
    const base = blankMap("m", 20, 15);
    const mapId = crypto.randomUUID();
    // Teleporter: a player-touch trigger + a same-map teleport command the author retargets. Its
    // destination placeholder is the map's OWN spawn, not the (0, 0) corner: the runtime silently
    // refuses a teleport onto unwalkable ground, and a spawn is the one cell kept clear.
    const tp = place(
      base,
      { kind: "event", eventKind: "normal", preset: "teleporter", selfMapId: mapId },
      3,
      4,
    ) as EditorMap;
    expect(tp.events[0]?.kind).toBe("normal");
    expect(tp.events[0]?.pages[0]?.trigger).toBe("player-touch");
    expect(tp.events[0]?.pages[0]?.commands).toEqual([
      {
        t: "teleport",
        mapId,
        col: base.spawn.col,
        row: base.spawn.row,
        category: "geographic",
      },
    ]);

    // Sign: an interact-triggered say. Chest: a changeGold. Raw (default): the blank program.
    const sign = place(
      base,
      { kind: "event", eventKind: "normal", preset: "sign" },
      6,
      6,
    ) as EditorMap;
    expect(sign.events[0]?.pages[0]?.commands).toEqual([{ t: "say", text: "", name: null }]);
    const chest = place(
      base,
      { kind: "event", eventKind: "normal", preset: "chest" },
      7,
      7,
    ) as EditorMap;
    expect(chest.events[0]?.pages[0]?.commands).toEqual([
      { t: "changeGold", amount: 10 },
      { t: "setSelfSwitch", selfSwitch: "A", value: true },
    ]);
    expect(chest.events[0]?.pages).toHaveLength(2);
    const raw = place(base, { kind: "event", eventKind: "normal" }, 8, 8) as EditorMap;
    expect(raw.events[0]?.pages[0]?.commands).toEqual([]);
  });

  it("leaves a raw/normal event's page 1 graphic null (the graphic is chosen in the dialog now)", () => {
    const base = blankMap("m", 20, 15);
    expect(
      (place(base, { kind: "event", eventKind: "normal" }, 3, 4) as EditorMap).events[0]?.pages[0]
        ?.graphicAssetId,
    ).toBeNull();
  });

  it("refuses a second event on an occupied cell and selects it instead — no history entry", () => {
    const base = blankMap("m", 20, 15);
    const next = place(base, { kind: "event", eventKind: "normal" }, 3, 4) as EditorMap;
    const id = next.events[0]?.id ?? "";

    // Placement on the occupied cell is a no-op: the pointer path reads null as "select this one".
    expect(place(next, { kind: "event", eventKind: "normal" }, 3, 4)).toBeNull();
    expect(selectionAt(next, 3, 4)).toEqual({ kind: "event", id });

    // A rejected placement commits nothing.
    const history = commitEditorHistory(createEditorHistory(next), next);
    expect(history.past).toHaveLength(0);
  });
});

describe("moveSelection: event", () => {
  it("drags an event to an empty cell as one history entry", () => {
    const base = blankMap("m", 20, 15);
    const placed = place(base, { kind: "event", eventKind: "normal" }, 3, 4) as EditorMap;
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
    const one = place(base, { kind: "event", eventKind: "normal" }, 3, 4) as EditorMap;
    const two = place(one, { kind: "event", eventKind: "normal" }, 5, 6) as EditorMap;
    const firstId = two.events[0]?.id ?? "";
    expect(moveSelection(two, { kind: "event", id: firstId }, 5, 6)).toBeNull();
  });
});

describe("resizable bridge settings", () => {
  it("resizes a selected bridge, preserves it through a move and refuses an out-of-map span", () => {
    const placed = applyTool(
      blankMap("crossing", 20, 20),
      { kind: "element", assetId: BRIDGE },
      8,
      8,
      true,
      "element",
    ) as EditorMap;
    const selection = { kind: "element", col: 8, row: 8, offsetX: 0, offsetY: 0 } as const;
    const resized = updateSelectedBridgeDimensions(placed, selection, { length: 9, width: 3 });
    expect(resized?.elements[0]?.bridge).toEqual({ length: 9, width: 3 });
    expect(placed.elements[0]?.bridge).toBeUndefined();

    const moved = resized && moveSelection(resized, selection, 12, 12);
    expect(moved?.elements[0]).toMatchObject({
      col: 12,
      row: 12,
      bridge: { length: 9, width: 3 },
    });
    expect(updateSelectedBridgeDimensions(placed, selection, { length: 32, width: 1 })).toBeNull();
  });
});

describe("building element settings", () => {
  it("edits a building's durability and footprint as one pure mutation", () => {
    const placed = applyTool(
      blankMap("village", 30, 30),
      { kind: "element", assetId: HOUSE },
      3,
      4,
      true,
      "element",
    ) as EditorMap;
    expect(placed.elements[0]?.building).toEqual({ destructible: true, maxHp: 900 });

    const selection = { kind: "element", col: 3, row: 4, offsetX: 0, offsetY: 0 } as const;
    const edited = updateSelectedBuildingSettings(placed, selection, {
      destructible: false,
      maxHp: 2_750,
      dimensions: { width: 5, depth: 3.125 },
    });
    expect(edited?.elements[0]?.building).toEqual({
      destructible: false,
      maxHp: 2_750,
      dimensions: { width: 5, depth: 3.125 },
    });
    expect(placed.elements[0]?.building).toEqual({ destructible: true, maxHp: 900 });
    expect(
      updateSelectedBuildingSettings(placed, selection, {
        destructible: true,
        maxHp: 900,
        dimensions: { width: 32, depth: 1 },
      }),
    ).toBeNull();
  });

  it("keeps durability and durable identity when a building moves", () => {
    const placed = applyTool(
      blankMap("village", 30, 30),
      { kind: "element", assetId: HOUSE },
      3,
      4,
      true,
      "element",
    ) as EditorMap;
    const element = placed.elements[0];
    if (!element) throw new Error("building placement failed");
    const configured: EditorMap = {
      ...placed,
      elements: [
        {
          ...element,
          id: crypto.randomUUID(),
          building: {
            destructible: true,
            maxHp: 777,
            dimensions: { width: 5, depth: 3.125 },
          },
        },
      ],
    };
    const moved = moveSelection(
      configured,
      { kind: "element", col: 3, row: 4, offsetX: 0, offsetY: 0 },
      8,
      9,
      2,
      1,
    );
    expect(moved?.elements[0]).toMatchObject({
      id: configured.elements[0]?.id,
      col: 8,
      row: 9,
      offsetX: 2,
      offsetY: 1,
      building: {
        destructible: true,
        maxHp: 777,
        dimensions: { width: 5, depth: 3.125 },
      },
    });
  });

  it("rotates a building as one pure edit and preserves the turn through a move", () => {
    const placed = applyTool(
      blankMap("village", 30, 30),
      { kind: "element", assetId: HOUSE },
      6,
      7,
      true,
      "element",
    ) as EditorMap;
    const selection = { kind: "element", col: 6, row: 7, offsetX: 0, offsetY: 0 } as const;
    const rotated = updateSelectedElementOrientation(placed, selection, 2);
    expect(rotated?.elements[0]?.orientation).toBe(2);
    expect(placed.elements[0]?.orientation).toBeUndefined();

    const moved = rotated && moveSelection(rotated, selection, 10, 11);
    expect(moved?.elements[0]).toMatchObject({ col: 10, row: 11, orientation: 2 });
  });

  it("freely rotates buildings and bridges, clears legacy turns and rejects 2D scenery", () => {
    const placed: EditorMap = {
      ...blankMap("village", 30, 30),
      elements: [
        {
          col: 10,
          row: 10,
          offsetX: 0,
          offsetY: 0,
          assetId: HOUSE,
          building: { destructible: true, maxHp: 900 },
        },
        { col: 24, row: 24, offsetX: 0, offsetY: 0, assetId: BRIDGE },
        {
          col: 5,
          row: 25,
          offsetX: 0,
          offsetY: 0,
          assetId: "terrain.bridge.wood.vertical",
        },
      ],
    };
    const buildingSelection = {
      kind: "element",
      col: 10,
      row: 10,
      offsetX: 0,
      offsetY: 0,
    } as const;
    const bridgeSelection = {
      kind: "element",
      col: 24,
      row: 24,
      offsetX: 0,
      offsetY: 0,
    } as const;
    const turned: EditorMap = {
      ...placed,
      elements: placed.elements.map((element, index) =>
        index === 0 ? { ...element, orientation: 1 as const } : element,
      ),
    };

    const building = updateSelectedElementRotation(turned, buildingSelection, 37);
    expect(building?.elements[0]).toMatchObject({ rotation: 37 });
    expect(building?.elements[0]?.orientation).toBeUndefined();
    const bridge = updateSelectedElementRotation(building ?? turned, bridgeSelection, 123);
    expect(bridge?.elements[1]).toMatchObject({ rotation: 123 });
    const vertical = updateSelectedElementRotation(
      bridge ?? turned,
      { kind: "element", col: 5, row: 25, offsetX: 0, offsetY: 0 },
      0,
    );
    expect(vertical?.elements[2]?.rotation).toBe(0);
    expect(updateSelectedElementRotation(turned, buildingSelection, 360)).toBeNull();
  });
});

describe("event dialog draft", () => {
  it("keeps edits off history until commit, then folds them into ONE entry", () => {
    const map = place(
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
    const map = place(
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

  it("detaches, edits, commits and serializes every harvest override without mutating the source", () => {
    const preset = harvestPreset("tree");
    const map = place(
      blankMap("m", 20, 15),
      {
        kind: "event",
        eventKind: "harvestable",
        graphic: preset.intactAssetId,
        harvestProfile: harvestProfileFromPreset("tree"),
      },
      3,
      4,
    ) as EditorMap;
    const sourceProfile = map.events[0]?.harvestProfile;
    const history = markEditorHistorySaved(createEditorHistory(map));
    let draft = beginEventDraft(map, map.events[0]?.id ?? "") as MapEvent;
    const override = {
      ...harvestProfileFromPreset("iron_outcrop"),
      yieldAmount: 17,
      hitsRequired: 7,
      range: 123,
      harvestDurationMs: 2_345,
      exhaustionBehavior: "replace" as const,
      exhaustedAssetId: "resource.terrain-resources-wood-trees.stump-1" as const,
      respawn: "timed" as const,
      respawnDelayMs: 91_000,
      fadeDurationMs: 777,
    };
    draft = setEventDraftHarvestProfile(draft, override);
    draft = updateEventDraftPage(draft, 0, {
      graphicAssetId: "resource.resources-sheep.happysheep-idle",
    });

    expect(sourceProfile).toEqual(harvestProfileFromPreset("tree"));
    expect(draft.harvestProfile).not.toBe(sourceProfile);
    const committed = commitEventDraft(history, draft);
    expect(committed.past).toHaveLength(1);
    expect(committed.present.events[0]?.harvestProfile).toEqual(override);
    expect(committed.present.events[0]?.pages[0]?.graphicAssetId).toBe(
      "resource.resources-sheep.happysheep-idle",
    );
    expect(toSaveInput(committed.present).events[0]?.harvestProfile).toEqual(override);
  });

  it("accepts a draft whose changed harvest footprint crosses the map boundary", () => {
    const preset = harvestPreset("tree");
    const map = place(
      blankMap("m", 20, 15),
      {
        kind: "event",
        eventKind: "harvestable",
        graphic: preset.intactAssetId,
        harvestProfile: harvestProfileFromPreset("tree"),
      },
      1,
      4,
    ) as EditorMap;
    const history = markEditorHistorySaved(createEditorHistory(map));
    const initialDraft = beginEventDraft(map, map.events[0]?.id ?? "");
    if (!initialDraft) throw new Error("placed harvest event must have a draft");
    const draft = setEventDraftHarvestProfile(initialDraft, {
      ...harvestProfileFromPreset("tree"),
      collision: {
        intact: { offsetX: -100, offsetY: -30, width: 64, height: 30 },
        depleted: null,
      },
    });

    const committed = commitEventDraft(history, draft);
    expect(committed).not.toBe(history);
    expect(committed.past).toHaveLength(1);
    expect(committed.present.events[0]?.harvestProfile).toEqual(draft.harvestProfile);
  });
});

describe("event serialization", () => {
  it("emits every condition field as an explicit null in the save body", () => {
    const map = place(
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
    const map = place(
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

  /** Paint one water cell so terrain-independent scenery and functional-event rules are distinct. */
  function withWaterAt(map: EditorMap, col: number, row: number): EditorMap {
    return place(map, { kind: "block", block: "water" }, col, row) as EditorMap;
  }

  it("legal: a decoration on grass", () => {
    expect(placementLegalAt(TREE_TOOL, blankMap("m", 20, 15), 3, 4, "element")).toBe(true);
  });

  it("legal: a decoration on water", () => {
    const map = withWaterAt(blankMap("m", 20, 15), 3, 4);
    expect(placementLegalAt(TREE_TOOL, map, 3, 4, "element")).toBe(true);
  });

  it("legal: a large decoration may overhang every map border", () => {
    const map = blankMap("m", 20, 15);
    expect(placementLegalAt(TREE_TOOL, map, 0, 0, "element")).toBe(true);
    expect(placementLegalAt(TREE_TOOL, map, 19, 14, "element")).toBe(true);
    expect(place(map, TREE_TOOL, 0, 0)).not.toBeNull();
  });

  it("legal: an entry event on grass and water", () => {
    const map = withWaterAt(blankMap("m", 20, 15), 3, 4);
    expect(placementLegalAt({ kind: "event", eventKind: "entry" }, map, 5, 5, "event")).toBe(true);
    expect(placementLegalAt({ kind: "event", eventKind: "entry" }, map, 3, 4, "event")).toBe(true);
  });

  it("legal: the spawn on empty grass, illegal onto a decorated cell", () => {
    let map = blankMap("m", 20, 15);
    expect(placementLegalAt({ kind: "spawn" }, map, 6, 6)).toBe(true);
    map = place(map, TREE_TOOL, 6, 6) as EditorMap;
    expect(placementLegalAt({ kind: "spawn" }, map, 6, 6)).toBe(false);
  });

  it("legal: an event on an empty cell, illegal on a cell that already holds an event", () => {
    let map = blankMap("m", 20, 15);
    expect(placementLegalAt({ kind: "event", eventKind: "normal" }, map, 7, 7, "event")).toBe(true);
    map = place(map, { kind: "event", eventKind: "normal" }, 7, 7) as EditorMap;
    expect(placementLegalAt({ kind: "event", eventKind: "normal" }, map, 7, 7, "event")).toBe(
      false,
    );
  });

  it("legal: the select tool anywhere, even over water (nothing to refuse)", () => {
    const map = withWaterAt(blankMap("m", 20, 15), 3, 4);
    expect(placementLegalAt({ kind: "select" }, map, 3, 4)).toBe(true);
  });

  it("illegal: any placement out of bounds", () => {
    expect(placementLegalAt(TREE_TOOL, blankMap("m", 20, 15), -1, 4, "element")).toBe(false);
    expect(placementLegalAt(TREE_TOOL, blankMap("m", 20, 15), 20, 4, "element")).toBe(false);
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
      expect(placementLegalAt(tool, map, c, r)).toBe(place(map, tool, c, r, true) !== null);
    }
  });

  it("does not flood: the short-circuit never reads the ground tile array", () => {
    const probe = countingGroundReads(blankMap("m", 20, 15));
    expect(placementLegalAt(FILL_GRASS, probe.map, 3, 4)).toBe(true);
    expect(probe.reads()).toBe(0);

    // Proof the probe is live: the full path it replaces does traverse that array.
    const probe2 = countingGroundReads(blankMap("m", 20, 15));
    place(probe2.map, FILL_GRASS, 3, 4, true);
    expect(probe2.reads()).toBeGreaterThan(0);
  });
});

describe("dynamic map size", () => {
  it("canvasEditorMap pads the document to the full canvas", () => {
    const canvas = canvasEditorMap(blankMap("m", 20, 15));
    expect(editorMapSize(canvas)).toEqual({ cols: MAP_MAX_COLS, rows: MAP_MAX_ROWS });
  });

  it("toSaveInput saves the derived rect, not the canvas", () => {
    const canvas = canvasEditorMap(blankMap("m", 20, 15));
    const saved = toSaveInput(canvas);
    expect(saved.cols).toBe(20 + 2 * MAP_OCEAN_MARGIN);
    expect(saved.rows).toBe(15 + 2 * MAP_OCEAN_MARGIN);
    // Spawn was dead centre of the 20×15 grass; the crop keeps it there, margin included.
    expect(saved.spawn).toEqual({ col: 10 + MAP_OCEAN_MARGIN, row: 7 + MAP_OCEAN_MARGIN });
    // The heightfield is compiled from the CROPPED map, so its square side follows the crop.
    const heightfield = decodeMap(saved.heightfield);
    if (!heightfield) throw new Error("failed to decode saved heightfield");
    expect(heightfield.size).toBe(Math.max(saved.cols, saved.rows));
  });

  it("painting far out on the canvas grows the next save", () => {
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

  it("erasing the outlier shrinks the save back (pure derivation)", () => {
    const canvas = canvasEditorMap(blankMap("m", 20, 15));
    const ground = canvas.layers[0];
    if (!ground) throw new Error("missing ground layer");
    const ids = [...ground.ids];
    // The same lone grass tile 30 cells east of the padded content the growth test above paints.
    const col = 118 + 20 + 30;
    const row = 120 + 7;
    const outlierId = ids[120 * ground.cols + 118] ?? 0;
    ids[row * ground.cols + col] = outlierId;
    const painted = { ...canvas, layers: [{ ...ground, ids }, ...canvas.layers.slice(1)] };
    // Painting the outlier really does grow the save first — otherwise erasing it back "shrinking"
    // the save would be true only because nothing ever grew it.
    expect(toSaveInput(painted).cols).toBeGreaterThan(20 + 2 * MAP_OCEAN_MARGIN);

    const erasedIds = [...ids];
    erasedIds[row * ground.cols + col] = EMPTY_TILE;
    const erased = {
      ...canvas,
      layers: [{ ...ground, ids: erasedIds }, ...canvas.layers.slice(1)],
    };
    expect(toSaveInput(erased).cols).toBe(20 + 2 * MAP_OCEAN_MARGIN);
  });
});

describe("bridge placement reads the crossing", () => {
  function carveWater(map: EditorMap, cells: readonly (readonly [number, number])[]): EditorMap {
    return cells.reduce<EditorMap>((current, [col, row]) => {
      const next = applyTool(current, { kind: "block", block: "water" }, col, row, true, "field");
      return next ?? current;
    }, map);
  }

  function placeBridge(map: EditorMap, col: number, row: number): EditorMap | null {
    return applyTool(map, { kind: "element", assetId: BRIDGE }, col, row, true, "element");
  }

  const everyRow = Array.from({ length: 20 }, (_unused, row) => row);

  it("writes a horizontal deck across a north-south river", () => {
    const river = carveWater(
      blankMap("m", 20, 20),
      everyRow.flatMap((row) => [[3, row] as const, [4, row] as const]),
    );
    expect(placeBridge(river, 3, 5)?.elements[0]?.assetId).toBe("terrain.bridge.wood.horizontal");
  });

  it("writes a vertical deck across an east-west river", () => {
    const river = carveWater(
      blankMap("m", 20, 20),
      everyRow.flatMap((col) => [[col, 3] as const, [col, 4] as const]),
    );
    expect(placeBridge(river, 5, 3)?.elements[0]?.assetId).toBe("terrain.bridge.wood.vertical");
  });

  it("keeps the palette's own orientation on dry ground", () => {
    expect(placeBridge(blankMap("m", 20, 20), 3, 5)?.elements[0]?.assetId).toBe(
      "terrain.bridge.wood.horizontal",
    );
  });

  it("leaves every other asset exactly as the palette selected it", () => {
    const river = carveWater(
      blankMap("m", 20, 20),
      everyRow.flatMap((col) => [[col, 3] as const, [col, 4] as const]),
    );
    const placed = applyTool(river, { kind: "element", assetId: STONE }, 5, 6, true, "element");
    expect(placed?.elements[0]?.assetId).toBe(STONE);
  });
});

describe("door links", () => {
  const MAP_ID = "aaaaaaaa-0000-4000-8000-00000000abcd";

  function linkTool(from?: { col: number; row: number }) {
    return { kind: "link", selfMapId: MAP_ID, name: "Door", ...(from ? { from } : {}) } as const;
  }

  function teleportOf(event: MapEvent | undefined) {
    const command = event?.pages[0]?.commands[0];
    return command?.t === "teleport" ? command : null;
  }

  function water(map: EditorMap, cells: readonly (readonly [number, number])[]): EditorMap {
    return cells.reduce<EditorMap>((current, [col, row]) => {
      const next = applyTool(current, { kind: "block", block: "water" }, col, row, true, "field");
      return next ?? current;
    }, map);
  }

  it("mints a round trip: each door teleports to the cell in FRONT of the other", () => {
    const linked = applyTool(
      blankMap("m", 20, 20),
      linkTool({ col: 3, row: 3 }),
      10,
      12,
      true,
      "event",
    );
    expect(linked?.events).toHaveLength(2);
    const first = linked?.events[0];
    const second = linked?.events[1];
    expect(first).toMatchObject({ col: 3, row: 3, kind: "normal" });
    expect(second).toMatchObject({ col: 10, row: 12, kind: "normal" });
    // Never the door cell itself: landing on a `player-touch` teleporter is how a pair of doors
    // becomes a loop. South first, the side a building's threshold faces.
    expect(teleportOf(first)).toMatchObject({ mapId: MAP_ID, col: 10, row: 13 });
    expect(teleportOf(second)).toMatchObject({ mapId: MAP_ID, col: 3, row: 4 });
    // The trigger comes from the shared `teleporter` preset; only the category is the link's own.
    expect(first?.pages[0]?.trigger).toBe("player-touch");
    expect(second?.pages[0]?.trigger).toBe("player-touch");
    expect(teleportOf(first)?.category).toBe("shortcut");
    expect(teleportOf(second)?.category).toBe("shortcut");
  });

  it("refuses both ends together rather than authoring half a link", () => {
    const map = blankMap("m", 20, 20);
    // No first door yet: the stage owns that click, so a bare tool writes nothing.
    expect(applyTool(map, linkTool(), 4, 4, true, "event")).toBeNull();
    // A door linked to itself is not a link.
    expect(applyTool(map, linkTool({ col: 4, row: 4 }), 4, 4, true, "event")).toBeNull();
    // An unsaved map has no uuid for the destination, and the wire parser demands one.
    expect(
      applyTool(
        map,
        { kind: "link", selfMapId: "", from: { col: 4, row: 4 } },
        9,
        9,
        true,
        "event",
      ),
    ).toBeNull();
    // Event mode owns this tool; Field mode must drop it like every other mismatched pair.
    expect(applyTool(map, linkTool({ col: 4, row: 4 }), 9, 9, true, "field")).toBeNull();
  });

  it("refuses a door with no reachable front, and a cell an event already holds", () => {
    const island = water(blankMap("m", 20, 20), [
      [5, 4],
      [5, 6],
      [4, 5],
      [6, 5],
    ]);
    expect(canLinkDoorAt(island, 5, 5)).toBe(false);
    expect(applyTool(island, linkTool({ col: 9, row: 9 }), 5, 5, true, "event")).toBeNull();

    const occupied = applyTool(
      blankMap("m", 20, 20),
      { kind: "event", eventKind: "normal", preset: "sign" },
      7,
      7,
      true,
      "event",
    ) as EditorMap;
    expect(canLinkDoorAt(occupied, 7, 7)).toBe(false);
    expect(applyTool(occupied, linkTool({ col: 9, row: 9 }), 7, 7, true, "event")).toBeNull();
  });
});

describe("relative elevation brushes", () => {
  function levelAt(map: EditorMap, col: number, row: number): number {
    const ground = map.layers[0];
    return ground ? groundElevationAt(ground, col, row) : -1;
  }

  it("raises and lowers from whatever the cell already stands at", () => {
    const base = blankMap("m", 20, 15);
    const once = place(base, { kind: "elevation", step: "raise" }, 5, 5) as EditorMap;
    expect(levelAt(once, 5, 5)).toBe(1);
    const twice = place(once, { kind: "elevation", step: "raise" }, 5, 5) as EditorMap;
    expect(levelAt(twice, 5, 5)).toBe(2);
    const down = place(twice, { kind: "elevation", step: "lower" }, 5, 5) as EditorMap;
    expect(levelAt(down, 5, 5)).toBe(1);
    const flat = place(down, { kind: "elevation", step: "ground" }, 5, 5) as EditorMap;
    expect(levelAt(flat, 5, 5)).toBe(0);
  });

  it("refuses rather than silently repainting when a step has nowhere to go", () => {
    const base = blankMap("m", 20, 15);
    // Ground is the floor: "-1" there returns null, which the stage turns into its visible hint.
    expect(place(base, { kind: "elevation", step: "lower" }, 5, 5)).toBeNull();
    let top = base;
    for (let step = 0; step < MAX_TERRAIN_LEVEL; step += 1) {
      top = place(top, { kind: "elevation", step: "raise" }, 5, 5) as EditorMap;
    }
    expect(levelAt(top, 5, 5)).toBe(MAX_TERRAIN_LEVEL);
    expect(place(top, { kind: "elevation", step: "raise" }, 5, 5)).toBeNull();
  });

  it("keeps the height when only the material changes", () => {
    const raised = place(
      blankMap("m", 20, 15),
      { kind: "elevation", step: "raise" },
      5,
      5,
    ) as EditorMap;
    const iced = place(
      raised,
      { kind: "elevation", step: "keep", material: "glace" },
      5,
      5,
    ) as EditorMap;
    expect(levelAt(iced, 5, 5)).toBe(1);
    expect(groundSlot(iced, 5, 5)).toBe(TERRAIN_MATERIAL_SLOTS.glace[1]);
  });

  it("raises every cell of a rectangle by one, across a slope", () => {
    // A staircase of levels 0/1/2 side by side, then one "+1" rectangle over all three.
    let map = blankMap("m", 20, 15);
    map = place(map, { kind: "elevation", level: 1 }, 4, 5) as EditorMap;
    map = place(map, { kind: "elevation", level: 2 }, 5, 5) as EditorMap;
    const tool: EditorTool = { kind: "rect", content: { kind: "elevation", step: "raise" } };
    map = place(map, tool, 3, 5, true) as EditorMap;
    map = place(map, tool, 5, 5, false) as EditorMap;
    // Relative means relative per CELL: an absolute rectangle would have flattened all three to
    // whichever level the first cell happened to be.
    expect(levelAt(map, 3, 5)).toBe(1);
    expect(levelAt(map, 4, 5)).toBe(2);
    expect(levelAt(map, 5, 5)).toBe(3);
  });

  it("floods one connected region to the step's target, read at the clicked cell", () => {
    const plateau = place(
      blankMap("m", 20, 15),
      { kind: "elevation", level: 1 },
      5,
      5,
    ) as EditorMap;
    const filled = place(
      plateau,
      { kind: "fill", content: { kind: "elevation", step: "raise" } },
      5,
      5,
    ) as EditorMap;
    expect(levelAt(filled, 5, 5)).toBe(2);
    // The surrounding level-0 grass is a different region and is untouched.
    expect(levelAt(filled, 8, 8)).toBe(0);
  });
});
