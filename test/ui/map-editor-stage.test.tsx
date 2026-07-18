import { Container, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { paintLandCell } from "../../src/client/game/map-editor-stage.js";
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
