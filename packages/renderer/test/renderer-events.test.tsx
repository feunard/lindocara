import { eventRenderLayer, tileRenderLayer } from "@lindocara/renderer/renderer.js";
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";

/**
 * `eventRenderLayer` is the renderer's ONE routing decision for an authored event's appearance: an
 * `onTop` page draws above the actors (`#tilesAbove`, so the hero passes behind a treetop),
 * everything else in the ground decor pass. Extracted and Pixi-object-only (no WebGL context, which
 * this suite cannot get) so the fork can be pinned directly, the same reason `paintLandCell` is.
 */
describe("eventRenderLayer", () => {
  const decor = new Container();
  const above = new Container();

  it("routes an onTop page above the actors and everything else into the decor pass", () => {
    expect(eventRenderLayer(true, decor, above)).toBe(above);
    expect(eventRenderLayer(false, decor, above)).toBe(decor);
  });
});

describe("tileRenderLayer", () => {
  const below = new Container();
  const above = new Container();

  it("routes each tileset priority to the same world layer the editor uses", () => {
    expect(tileRenderLayer("below", below, above)).toBe(below);
    expect(tileRenderLayer("above", below, above)).toBe(above);
  });
});
