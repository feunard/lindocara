import { Container, Sprite, Text, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { EditorAssetArt } from "../../src/client/game/editor-asset-art.js";
import type { EditorMap, EditorTool } from "../../src/client/game/editor-state.js";
import { applyTool, blankMap, defaultEventPage } from "../../src/client/game/editor-state.js";
import {
  applyLayerDim,
  eventChipLabel,
  eventOverlayToggled,
  paintEventCell,
  paintHoverCell,
  paintLandCell,
  shouldShowEventOverlay,
  shouldShowHoverPreview,
} from "../../src/client/game/map-editor-stage.js";
import type { MapEvent } from "../../src/shared/map-events.js";
import type { TileLayer } from "../../src/shared/tile-layer-codec.js";
import type { Tileset } from "../../src/shared/tileset.js";
import { fixedId } from "../../src/shared/tileset.js";
import type { EditorAssetDefinition, EditorAssetId } from "../../src/shared/tiny-swords-catalog.js";

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
      { atlas: "sheet", col: 1, row: 0, passable: false, priority: "above" },
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
 * "Dim other layers" is applied to one container per logical tile layer, so it too is pure and
 * Pixi-object-only — a `Container`'s `alpha` needs no renderer. The stage builds the same containers
 * from the same fixture-tile compositing; here we pin the alpha rule directly.
 */
describe("applyLayerDim", () => {
  function tileLayers(): Container[] {
    // One below-priority land container per logical tile layer, painted from the fixture so each
    // holds a real tile — exactly the shape the stage dims.
    const below = { atlas: "sheet", col: 0, row: 0, passable: true, priority: "below" } as const;
    const dimFixture: Tileset = { id: "dim", autotiles: [], fixed: [below] };
    const dimSheet: Texture[][] = [[Texture.WHITE]];
    return Array.from({ length: 3 }, () => {
      const container = new Container();
      paintLandCell(
        dimFixture,
        [{ cols: 1, rows: 1, ids: [fixedId(0)] }],
        dimSheet,
        0,
        0,
        container,
        new Container(),
      );
      return container;
    });
  }

  it("fades every layer but the active one when dim is on", () => {
    const layers = tileLayers();
    applyLayerDim(layers, 1, true);
    expect(layers[0]?.alpha).toBe(0.35);
    expect(layers[1]?.alpha).toBe(1);
    expect(layers[2]?.alpha).toBe(0.35);
  });

  it("moves which container is dimmed when the active layer changes", () => {
    const layers = tileLayers();
    applyLayerDim(layers, 0, true);
    expect(layers[0]?.alpha).toBe(1);
    expect(layers[1]?.alpha).toBe(0.35);
    expect(layers[2]?.alpha).toBe(0.35);

    applyLayerDim(layers, 2, true);
    expect(layers[0]?.alpha).toBe(0.35);
    expect(layers[1]?.alpha).toBe(0.35);
    expect(layers[2]?.alpha).toBe(1);
  });

  it("restores full opacity on every layer when dim is off", () => {
    const layers = tileLayers();
    applyLayerDim(layers, 0, true);
    applyLayerDim(layers, 0, false);
    for (const layer of layers) expect(layer.alpha).toBe(1);
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
});

describe("eventChipLabel", () => {
  it("zero-pads the ordinal to three digits", () => {
    expect(eventChipLabel(1)).toBe("EV001");
    expect(eventChipLabel(42)).toBe("EV042");
    expect(eventChipLabel(128)).toBe("EV128");
  });
});

describe("shouldShowEventOverlay", () => {
  it("is true only while the event tool is active", () => {
    expect(shouldShowEventOverlay({ kind: "event", eventKind: "normal" })).toBe(true);
    expect(shouldShowEventOverlay({ kind: "event", eventKind: "entry" })).toBe(true);
    const inactive: EditorTool[] = [
      { kind: "block", block: "grass" },
      { kind: "select" },
      { kind: "eraser" },
      { kind: "spawn" },
    ];
    for (const tool of inactive) expect(shouldShowEventOverlay(tool)).toBe(false);
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

  it("is true exactly when the overlay's visibility flips", () => {
    expect(eventOverlayToggled({ kind: "select" }, { kind: "event", eventKind: "normal" })).toBe(
      true,
    );
    expect(
      eventOverlayToggled(
        { kind: "event", eventKind: "normal" },
        { kind: "block", block: "grass" },
      ),
    ).toBe(true);
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

describe("paintHoverCell", () => {
  const TREE = "resource.terrain-resources-wood-trees.tree3";
  const TREE_TOOL: EditorTool = { kind: "element", assetId: TREE };

  function waterAt(map: EditorMap, col: number, row: number): EditorMap {
    return applyTool(map, { kind: "block", block: "water" }, col, row) as EditorMap;
  }

  it("draws only the preview outline on a legal cell (no red fill)", () => {
    const container = new Container();
    const decision = paintHoverCell(TREE_TOOL, blankMap("m", 20, 15), 3, 4, 0, container);
    expect(decision.illegal).toBe(false);
    expect(container.children).toHaveLength(1);
  });

  it("draws an opaque red fill UNDER the outline on an illegal cell", () => {
    const map = waterAt(blankMap("m", 20, 15), 3, 4);
    const container = new Container();
    const decision = paintHoverCell(TREE_TOOL, map, 3, 4, 0, container);
    expect(decision.illegal).toBe(true);
    // Fill first, outline on top: two children, the red fill drawn beneath the border.
    expect(container.children).toHaveLength(2);
  });
});
