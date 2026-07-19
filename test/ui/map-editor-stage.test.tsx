import { Container, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { applyLayerDim, paintLandCell } from "../../src/client/game/map-editor-stage.js";
import type { TileLayer } from "../../src/shared/tile-layer-codec.js";
import type { Tileset } from "../../src/shared/tileset.js";
import { fixedId } from "../../src/shared/tileset.js";

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
