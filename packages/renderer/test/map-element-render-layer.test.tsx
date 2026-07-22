import { mapElementRenderLayer } from "@lindocara/renderer/renderer.js";
import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";

/**
 * `mapElementRenderLayer` is the renderer's ONE routing decision for an authored prop's depth: a
 * flat `ground` decal is pinned below every actor in the decor pass, while an `object`/`canopy` prop
 * joins the sortable actors layer so a hero can pass *behind* a tree instead of always drawing over
 * it. Extracted and Pixi-object-only (no WebGL context, which this suite cannot get) so the fork can
 * be pinned directly, the same way `eventRenderLayer` is.
 */
describe("mapElementRenderLayer", () => {
  const decor = new Container();
  const actors = new Container();

  it("keeps a ground decal below the actors and Y-sorts objects and canopies among them", () => {
    expect(mapElementRenderLayer("ground", decor, actors)).toBe(decor);
    expect(mapElementRenderLayer("object", decor, actors)).toBe(actors);
    expect(mapElementRenderLayer("canopy", decor, actors)).toBe(actors);
  });
});
