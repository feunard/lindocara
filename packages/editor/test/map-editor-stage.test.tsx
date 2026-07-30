import type { EditorMap, EditorTool } from "@lindocara/editor/game/editor-state.js";
import { applyTool, blankMap, defaultEventPage } from "@lindocara/editor/game/editor-state.js";
import {
  applyModeDim,
  clampCameraAxis,
  defaultDimForMode,
  eventChipLabel,
  eventOverlayToggled,
  fitCameraScale,
  paintCollisionOverlay,
  paintElementSelectionOutline,
  paintEventCell,
  paintGridCoordinates,
  paintHoverCell,
  paintLandCell,
  paintPlacementAssetPreview,
  shouldShowEventOverlay,
  shouldShowHoverPreview,
  stampFootprintCells,
} from "@lindocara/editor/game/map-editor-stage.js";
import type { MapElement } from "@lindocara/engine/map-data.js";
import type { MapEvent } from "@lindocara/engine/map-events.js";
import type { TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import type { TileMap } from "@lindocara/engine/tilemap.js";
import type { Tileset } from "@lindocara/engine/tileset.js";
import { fixedId } from "@lindocara/engine/tileset.js";
import type {
  EditorAssetDefinition,
  EditorAssetId,
} from "@lindocara/engine/tiny-swords-catalog.js";
import type { EditorAssetArt } from "@lindocara/renderer/editor-asset-art.js";
import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";

describe("clampCameraAxis", () => {
  it("keeps both edges of a large map reachable inside an offset centre pane", () => {
    expect(clampCameraAxis(400, 1_200, 240, 700)).toBe(240);
    expect(clampCameraAxis(-900, 1_200, 240, 700)).toBe(-260);
  });

  it("centres a small map inside the centre pane rather than the full canvas", () => {
    expect(clampCameraAxis(0, 400, 240, 700)).toBe(390);
  });
});

describe("fitCameraScale", () => {
  it("fits a maximal legal map below the former 50% zoom floor", () => {
    const maximalMapPixels = 256 * 64;
    const scale = fitCameraScale(maximalMapPixels, maximalMapPixels, 700, 500);

    expect(scale).toBeCloseTo((500 / maximalMapPixels) * 0.92);
    expect(maximalMapPixels * scale).toBeLessThanOrEqual(500);
    expect(scale).toBeLessThan(0.5);
  });
});

describe("paintGridCoordinates", () => {
  it("numbers every cell from one along all four map edges", () => {
    const container = new Container();
    paintGridCoordinates(container, 4, 3);

    const labels = container.children.filter((child): child is Text => child instanceof Text);
    expect(labels).toHaveLength(14);
    expect(labels.slice(0, 8).map((label) => label.text)).toEqual([
      "1",
      "1",
      "2",
      "2",
      "3",
      "3",
      "4",
      "4",
    ]);
    expect(labels.slice(8).map((label) => label.text)).toEqual(["1", "1", "2", "2", "3", "3"]);
  });
});

/**
 * `paintLandCell` is `redraw()`'s per-cell tile routing, exported and kept Pixi-object-only (no
 * Application, no canvas) so it can be pinned without the rest of the stage, which needs a real
 * WebGL context `openMapEditorStage` cannot get in this suite (see map-editor.test.tsx). `Container`
 * and `Sprite` construct and accept children fine without a renderer; only actually drawing to a
 * canvas needs one.
 *
 * No declared Tiny Swords tile is "above" today, so the fixture below is the only way to exercise
 * the fork at all: without it every real map draws exclusively into `land`, and a tileset that later
 * adds one "above" tile would silently start disagreeing with the world renderer's `#tilesAbove`.
 */
describe("paintLandCell", () => {
  const BELOW_INDEX = 0;
  const ABOVE_INDEX = 1;
  const fixture: Tileset = {
    id: "fixture",
    autotiles: [],
    fixed: [
      { atlas: "sheet", col: 0, row: 0, passable: true, priority: "below" },
      {
        atlas: "sheet",
        col: 1,
        row: 0,
        passable: false,
        priority: "above",
        rotationQuarterTurns: 1,
      },
    ],
  };
  // One texture per sheet cell the fixture's two fixed tiles reference: [row][col].
  const sheet: Texture[][] = [[Texture.WHITE, Texture.WHITE]];

  function layerOf(id: number): TileLayer {
    return { cols: 1, rows: 1, ids: [id] };
  }

  it("routes a below-priority tile into land, not above", () => {
    const land = new Container();
    const above = new Container();
    const drew = paintLandCell(fixture, [layerOf(fixedId(BELOW_INDEX))], sheet, 0, 0, land, above);
    expect(drew).toBe(true);
    expect(land.children).toHaveLength(1);
    expect(above.children).toHaveLength(0);
  });

  it("routes an above-priority tile into above, not land", () => {
    const land = new Container();
    const above = new Container();
    const drew = paintLandCell(fixture, [layerOf(fixedId(ABOVE_INDEX))], sheet, 0, 0, land, above);
    expect(drew).toBe(true);
    expect(land.children).toHaveLength(0);
    expect(above.children).toHaveLength(1);
    expect((above.children[0] as Sprite).rotation).toBe(Math.PI / 2);
  });

  it("splits a layer stack across both containers by each layer's own priority", () => {
    const land = new Container();
    const above = new Container();
    const layers = [layerOf(fixedId(BELOW_INDEX)), layerOf(fixedId(ABOVE_INDEX))];
    const drew = paintLandCell(fixture, layers, sheet, 0, 0, land, above);
    expect(drew).toBe(true);
    expect(land.children).toHaveLength(1);
    expect(above.children).toHaveLength(1);
    expect(land.children[0]).toBeInstanceOf(Sprite);
    expect(above.children[0]).toBeInstanceOf(Sprite);
  });

  it("draws nothing and returns false for an empty layer", () => {
    const land = new Container();
    const above = new Container();
    const drew = paintLandCell(fixture, [layerOf(0)], sheet, 0, 0, land, above);
    expect(drew).toBe(false);
    expect(land.children).toHaveLength(0);
    expect(above.children).toHaveLength(0);
  });
});

/**
 * "Dim other modes" fades the two authored planes the active mode does NOT own — the tile layers
 * (Field), the element containers (Element) and the event overlay (Event). It is pure and
 * Pixi-object-only, a `Container`'s `alpha` needs no renderer, so the alpha rule pins directly.
 */
describe("applyModeDim", () => {
  /** The three planes `applyModeDim` fades: some tile-layer containers, some element containers, and
   *  the single event overlay. Content-free — `alpha` is set regardless of what a container holds. */
  function planes(): { tiles: Container[]; elements: Container[]; events: Container } {
    return {
      tiles: [new Container(), new Container(), new Container()],
      elements: [new Container(), new Container(), new Container()],
      events: new Container(),
    };
  }

  function alphas(p: { tiles: Container[]; elements: Container[]; events: Container }): {
    tiles: number;
    elements: number;
    events: number;
  } {
    return {
      tiles: p.tiles[0]?.alpha ?? Number.NaN,
      elements: p.elements[0]?.alpha ?? Number.NaN,
      events: p.events.alpha,
    };
  }

  it("Field mode dims the element and event planes, not the tiles", () => {
    const p = planes();
    applyModeDim(p.tiles, p.elements, p.events, "field", true);
    expect(alphas(p)).toEqual({ tiles: 1, elements: 0.2, events: 0.2 });
    for (const c of p.tiles) expect(c.alpha).toBe(1);
    for (const c of p.elements) expect(c.alpha).toBe(0.2);
  });

  it("Element mode dims the tiles and the event overlay, not the elements", () => {
    const p = planes();
    applyModeDim(p.tiles, p.elements, p.events, "element", true);
    expect(alphas(p)).toEqual({ tiles: 0.2, elements: 1, events: 0.2 });
  });

  it("Event mode dims the tiles and the element containers, not the events", () => {
    const p = planes();
    applyModeDim(p.tiles, p.elements, p.events, "event", true);
    expect(alphas(p)).toEqual({ tiles: 0.2, elements: 0.2, events: 1 });
  });

  it("restores full opacity on every plane when dim is off", () => {
    const p = planes();
    applyModeDim(p.tiles, p.elements, p.events, "element", true);
    applyModeDim(p.tiles, p.elements, p.events, "element", false);
    for (const c of [...p.tiles, ...p.elements, p.events]) expect(c.alpha).toBe(1);
  });

  it("dims strongly enough to pop the active plane, yet keeps context faintly visible", () => {
    const p = planes();
    applyModeDim(p.tiles, p.elements, p.events, "element", true);
    // The tiles are the inactive plane here: strong dim (well below half) but never invisible.
    expect(p.tiles[0]?.alpha).toBeLessThan(0.3);
    expect(p.tiles[0]?.alpha).toBeGreaterThan(0);
  });
});

describe("defaultDimForMode (D12)", () => {
  it("auto-enables the dim in Element and Event modes, disables it in Field", () => {
    expect(defaultDimForMode("field")).toBe(false);
    expect(defaultDimForMode("element")).toBe(true);
    expect(defaultDimForMode("event")).toBe(true);
  });
});

/**
 * The EV overlay's per-event draw is extracted into `paintEventCell` for the same reason
 * `paintLandCell` is: the whole stage needs a WebGL context this suite cannot give it, but the draw
 * decision — graphic vs placeholder, chip text, selection outline — is pure Pixi-object construction
 * that pins fine here. `shouldShowEventOverlay` and `eventChipLabel` are the two decisions the
 * overlay hangs off, pinned directly.
 */
describe("paintEventCell", () => {
  function eventAt(ordinal: number, graphic: EditorAssetId | null): MapEvent {
    return {
      id: `id-${ordinal}`,
      col: 2,
      row: 3,
      name: "",
      ordinal,
      kind: "normal",
      species: null,
      patrolRadius: null,
      pages: [{ ...defaultEventPage(), graphicAssetId: graphic }],
    };
  }

  const loadedArt: EditorAssetArt = {
    definition: {} as EditorAssetDefinition,
    frames: [Texture.WHITE],
  };

  it("draws the page-1 graphic as a sprite when its art is loaded", () => {
    const container = new Container();
    const result = paintEventCell(
      eventAt(1, "decoration.tree" as EditorAssetId),
      loadedArt,
      false,
      container,
    );
    expect(result.hasGraphic).toBe(true);
    expect(container.children.some((child) => child instanceof Sprite)).toBe(true);
  });

  it("draws the blank placeholder, not a sprite, when page 1 has no graphic", () => {
    const container = new Container();
    const result = paintEventCell(eventAt(1, null), undefined, false, container);
    expect(result.hasGraphic).toBe(false);
    expect(container.children.some((child) => child instanceof Sprite)).toBe(false);
  });

  it("falls back to the placeholder when a graphic is set but its art has not loaded yet", () => {
    const container = new Container();
    const result = paintEventCell(
      eventAt(1, "decoration.tree" as EditorAssetId),
      undefined,
      false,
      container,
    );
    expect(result.hasGraphic).toBe(false);
    expect(container.children.some((child) => child instanceof Sprite)).toBe(false);
  });

  it("labels the chip EV{ordinal} zero-padded to three digits", () => {
    const container = new Container();
    const result = paintEventCell(eventAt(1, null), undefined, false, container);
    expect(result.chipText).toBe("EV001");
    const chip = container.children.find((child): child is Text => child instanceof Text);
    expect(chip?.text).toBe("EV001");
  });

  it("adds a selection outline only when the event is selected", () => {
    const unselected = new Container();
    const withoutOutline = paintEventCell(eventAt(1, null), undefined, false, unselected);
    const selected = new Container();
    const withOutline = paintEventCell(eventAt(1, null), undefined, true, selected);
    expect(withoutOutline.selected).toBe(false);
    expect(withOutline.selected).toBe(true);
    // The selection outline is one extra child; nothing else differs between the two draws.
    expect(selected.children.length).toBe(unselected.children.length + 1);
  });

  it("adds a highlight ring only when the event is list-hovered (D14)", () => {
    const plain = new Container();
    paintEventCell(eventAt(1, null), undefined, false, plain);
    const highlighted = new Container();
    paintEventCell(eventAt(1, null), undefined, false, highlighted, undefined, true);
    // The amber highlight ring is one extra child, independent of selection.
    expect(highlighted.children.length).toBe(plain.children.length + 1);
  });
});

/**
 * D2: a selected element previously drew NO highlight at all, so a stack of decorations in one cell
 * was indistinguishable. `paintElementSelectionOutline` mirrors `paintEventCell`'s selection outline
 * — same exported, Pixi-object-only shape, pinned without a live renderer.
 */
describe("paintElementSelectionOutline", () => {
  it("draws exactly one outline for the selected slot", () => {
    const container = new Container();
    paintElementSelectionOutline({ col: 2, row: 1, offsetX: 0, offsetY: 0 }, container);
    expect(container.children).toHaveLength(1);
    expect(container.children[0]).toBeInstanceOf(Graphics);
  });

  it("draws one outline per quarter-cell offset, distinguishing a stack in one cell", () => {
    // Two decorations stacked in the same cell at different offsets each get their own outline call;
    // nothing about the function itself collapses or dedupes them.
    const container = new Container();
    paintElementSelectionOutline({ col: 0, row: 0, offsetX: 0, offsetY: 0 }, container);
    paintElementSelectionOutline({ col: 0, row: 0, offsetX: 3, offsetY: 2 }, container);
    expect(container.children).toHaveLength(2);
  });
});

/**
 * D18: before this overlay existed, an author had no way to see a tile's baked solidity or an
 * element's sub-cell collider. `paintCollisionOverlay` reuses `isSolidKind` (the same authority
 * `isWalkableBox` collides against) and `elementWorldCollider` (shared with `terrainFromMap`), so the
 * overlay can never disagree with what actually blocks movement — pinned here without a live renderer,
 * exactly like `paintLandCell`.
 */
describe("paintCollisionOverlay", () => {
  // Real catalogue ids already established in test/map-data.test.ts: a tree trunk collides, a bush
  // does not (its footprint is decorative only).
  const TREE = "resource.terrain-resources-wood-trees.tree3" as const;
  const BUSH = "decoration.terrain-decorations-bushes.bushe1" as const;

  it("shades every solid tile and skips walkable ones", () => {
    const tiles: TileMap = { cols: 2, rows: 1, kinds: ["grass", "water"] };
    const container = new Container();
    const result = paintCollisionOverlay(tiles, [], container);
    expect(result).toEqual({ solidCells: 1, colliderRects: 0 });
    expect(container.children).toHaveLength(1);
  });

  it("outlines a colliding element but skips one with no collider", () => {
    const tiles: TileMap = { cols: 1, rows: 1, kinds: ["grass"] };
    const elements: MapElement[] = [
      { col: 0, row: 0, offsetX: 0, offsetY: 0, assetId: TREE as EditorAssetId },
      { col: 0, row: 0, offsetX: 0, offsetY: 0, assetId: BUSH as EditorAssetId },
    ];
    const container = new Container();
    const result = paintCollisionOverlay(tiles, elements, container);
    expect(result).toEqual({ solidCells: 0, colliderRects: 1 });
    expect(container.children).toHaveLength(1);
  });
});

describe("eventChipLabel", () => {
  it("zero-pads the ordinal to three digits", () => {
    expect(eventChipLabel(1)).toBe("EV001");
    expect(eventChipLabel(42)).toBe("EV042");
    expect(eventChipLabel(128)).toBe("EV128");
  });
});

describe("shouldShowEventOverlay", () => {
  it("keeps authored RPG objects visible in every tool", () => {
    expect(shouldShowEventOverlay({ kind: "event", eventKind: "normal" })).toBe(true);
    expect(shouldShowEventOverlay({ kind: "event", eventKind: "entry" })).toBe(true);
    const inactive: EditorTool[] = [
      { kind: "block", block: "grass" },
      { kind: "select" },
      { kind: "eraser" },
      { kind: "spawn" },
    ];
    for (const tool of inactive) expect(shouldShowEventOverlay(tool)).toBe(true);
  });

  /**
   * D15 regression: activating the Select tool while in Event mode used to hide the event overlay
   * entirely. Visibility must depend on MODE (and the mode-dim rule), never on which tool is active.
   * Pins both halves of that contract: the overlay's `.visible` gate (`shouldShowEventOverlay`) stays
   * true under Select, AND `applyModeDim` still reports full opacity for the event plane while the
   * active mode is "event" — so the events read as fully, not just technically, visible.
   */
  it("D15: stays visible (and undimmed) in Event mode when the Select tool is active", () => {
    const selectTool: EditorTool = { kind: "select" };
    expect(shouldShowEventOverlay(selectTool)).toBe(true);

    const tiles = [new Container()];
    const elements = [new Container()];
    const events = new Container();
    applyModeDim(tiles, elements, events, "event", true);
    expect(events.alpha).toBe(1);
  });
});

/**
 * `setTool` redraws the whole stage ONLY when this predicate is true — the EV overlay is the sole
 * stage content that reacts to the active tool. This is the gate that stops every P/R/F/E/S keypress
 * from rebuilding the map. Removing the gate (making `setTool` redraw unconditionally) is exactly the
 * mutation the first case below catches: a same-visibility tool swap must report `false`.
 */
describe("eventOverlayToggled", () => {
  it("is false when neither or both tools show the overlay — no redraw needed", () => {
    // Both non-event: the wasteful case the gate eliminates.
    expect(eventOverlayToggled({ kind: "block", block: "grass" }, { kind: "select" })).toBe(false);
    expect(
      eventOverlayToggled(
        { kind: "rect", content: { kind: "block", block: "grass" } },
        { kind: "eraser" },
      ),
    ).toBe(false);
    // Both event: staying in EV mode (e.g. a graphic or kind change) does not flip visibility here.
    expect(
      eventOverlayToggled(
        { kind: "event", eventKind: "normal" },
        { kind: "event", eventKind: "entry" },
      ),
    ).toBe(false);
  });

  it("never flips because RPG objects remain visible", () => {
    expect(eventOverlayToggled({ kind: "select" }, { kind: "event", eventKind: "normal" })).toBe(
      false,
    );
    expect(
      eventOverlayToggled(
        { kind: "event", eventKind: "normal" },
        { kind: "block", block: "grass" },
      ),
    ).toBe(false);
  });
});

/**
 * `paintHoverCell` is the UX wave #9 hover overlay's per-cell render decision, exported and kept
 * Pixi-object-only (Container/Graphics need no renderer) so the red-vs-clear choice pins without the
 * WebGL context `openMapEditorStage` cannot get in this suite — exactly like `paintLandCell`.
 */
describe("shouldShowHoverPreview", () => {
  it("shows for placement tools, hides for select and pan", () => {
    expect(shouldShowHoverPreview({ kind: "block", block: "grass" })).toBe(true);
    expect(
      shouldShowHoverPreview({
        kind: "element",
        assetId: "resource.terrain-resources-wood-trees.tree3",
      }),
    ).toBe(true);
    expect(shouldShowHoverPreview({ kind: "event", eventKind: "entry" })).toBe(true);
    expect(shouldShowHoverPreview({ kind: "spawn" })).toBe(true);
    expect(shouldShowHoverPreview({ kind: "select" })).toBe(false);
    expect(shouldShowHoverPreview({ kind: "pan" })).toBe(false);
  });
});

describe("paintPlacementAssetPreview", () => {
  const TREE = "resource.terrain-resources-wood-trees.tree3" as EditorAssetId;
  const treeArt: EditorAssetArt = {
    definition: {
      anchor: { x: 0.5, y: 1 },
      footOffset: 0,
      editor: { renderLayer: "object" },
    } as EditorAssetDefinition,
    frames: [Texture.WHITE],
  };

  it("draws the real element sprite at its native quarter-cell anchor", () => {
    const container = new Container();
    const drew = paintPlacementAssetPreview(
      { kind: "element", assetId: TREE },
      2,
      3,
      1,
      2,
      false,
      container,
      { editorAssets: new Map([[TREE, treeArt]]) },
    );
    expect(drew).toBe(true);
    expect(container.children).toHaveLength(1);
    const ghost = container.children[0];
    expect(ghost).toBeInstanceOf(Container);
    expect((ghost as Container).children[0]).toBeInstanceOf(Sprite);
    // Same `createCatalogElementView` anchor as a committed element.
    expect((ghost as Container).position.x).toBe(2 * 64 + 32 + 16);
    expect((ghost as Container).position.y).toBe(4 * 64 + 2 * 16);
    expect((ghost as Container).alpha).toBeLessThan(1);
  });

  it("draws the selected monster and its patrol radius before placement", () => {
    const container = new Container();
    const drew = paintPlacementAssetPreview(
      {
        kind: "event",
        eventKind: "monster",
        species: "spear_goblin",
        patrolRadius: 192,
      },
      4,
      5,
      0,
      0,
      false,
      container,
      {
        editorAssets: new Map(),
        monsters: new Map([["spear_goblin", Texture.WHITE]]),
      },
    );
    expect(drew).toBe(true);
    expect(container.children.some((child) => child instanceof Sprite)).toBe(true);
    expect(container.children.some((child) => child instanceof Graphics)).toBe(true);
  });

  it("draws the hero sprite for a start-position tool", () => {
    const container = new Container();
    expect(
      paintPlacementAssetPreview({ kind: "spawn" }, 1, 2, 0, 0, false, container, {
        editorAssets: new Map(),
        spawn: Texture.WHITE,
      }),
    ).toBe(true);
    expect(container.children[0]).toBeInstanceOf(Sprite);
  });

  it("draws both native cells of a side-ramp preview", () => {
    const container = new Container();
    const sheet = Array.from({ length: 6 }, () => Array.from({ length: 9 }, () => Texture.WHITE));
    expect(
      paintPlacementAssetPreview(
        { kind: "stairs", direction: "east", lowLevel: 0 },
        3,
        4,
        0,
        0,
        false,
        container,
        { editorAssets: new Map(), tileset: sheet },
      ),
    ).toBe(true);
    expect(container.children).toHaveLength(2);
    for (const child of container.children) {
      expect(child).toBeInstanceOf(Sprite);
      expect((child as Sprite).width).toBe(64);
      expect((child as Sprite).height).toBe(64);
      expect((child as Sprite).rotation).toBe(0);
    }
  });
});

describe("paintHoverCell", () => {
  const TREE = "resource.terrain-resources-wood-trees.tree3";
  const TREE_TOOL: EditorTool = { kind: "element", assetId: TREE };

  function waterAt(map: EditorMap, col: number, row: number): EditorMap {
    return applyTool(map, { kind: "block", block: "water" }, col, row) as EditorMap;
  }

  it("draws only the preview outline on a legal cell (no red fill)", () => {
    const container = new Container();
    const decision = paintHoverCell(TREE_TOOL, blankMap("m", 20, 15), 3, 4, "element", container);
    expect(decision.illegal).toBe(false);
    expect(container.children).toHaveLength(1);
  });

  it("keeps the decoration hover legal over water", () => {
    const map = waterAt(blankMap("m", 20, 15), 3, 4);
    const container = new Container();
    const decision = paintHoverCell(TREE_TOOL, map, 3, 4, "element", container);
    expect(decision.illegal).toBe(false);
    expect(container.children).toHaveLength(1);
  });

  it("draws a translucent red warning fill UNDER the outline on an illegal cell", () => {
    const map = blankMap("m", 20, 15);
    const container = new Container();
    const decision = paintHoverCell(
      TREE_TOOL,
      map,
      map.spawn.col,
      map.spawn.row,
      "element",
      container,
    );
    expect(decision.illegal).toBe(true);
    // Fill first, outline on top: two children, the red fill drawn beneath the border.
    expect(container.children).toHaveLength(2);
  });
});

describe("directional ramp hover footprint", () => {
  it("keeps both native side ramps on their vertical two-cell footprint", () => {
    const east = stampFootprintCells({ kind: "stairs", direction: "east", lowLevel: 1 }, 3, 4);
    const west = stampFootprintCells({ kind: "stairs", direction: "west", lowLevel: 1 }, 3, 4);
    expect(east).toEqual([
      { col: 3, row: 4 },
      { col: 3, row: 3 },
    ]);
    expect(west).toEqual([
      { col: 3, row: 4 },
      { col: 3, row: 3 },
    ]);
  });
});
