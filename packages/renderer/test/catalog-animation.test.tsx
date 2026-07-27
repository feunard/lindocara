import { advanceCatalogAnimation } from "@lindocara/renderer/catalog-element-render.js";
import { Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";

/**
 * The frozen-game regression.
 *
 * `Renderer.render` advances every animated prop and event graphic BEFORE the reconcile passes that
 * would rebuild them, so between a decor teardown (map load, element refresh) and the next reconcile
 * those animation lists still hold destroyed sprites. Assigning `texture` on a destroyed PixiJS
 * Sprite reads its nulled `scale` and throws — inside the shared Ticker, which kills the ticker and
 * freezes the entire game on one bad frame, not merely one sprite.
 *
 * Latent until an adventure used an ANIMATED event graphic (an event view only gets an `animation`
 * when its asset has more than one frame), which is why it surfaced with the first authored boat.
 */
describe("advanceCatalogAnimation", () => {
  it("advances a live sprite to the frame for the current time", () => {
    const frames = [Texture.EMPTY, Texture.WHITE];
    const sprite = new Sprite(frames[0]);

    expect(advanceCatalogAnimation(sprite, 0, frames, 1000)).toBe(true);
    expect(sprite.texture).toBe(frames[0]);
    expect(advanceCatalogAnimation(sprite, 600, frames, 1000)).toBe(true);
    expect(sprite.texture).toBe(frames[1]);
  });

  it("skips a destroyed sprite instead of throwing inside the ticker", () => {
    const frames = [Texture.EMPTY, Texture.WHITE];
    const sprite = new Sprite(frames[0]);
    sprite.destroy();

    expect(() => advanceCatalogAnimation(sprite, 600, frames, 1000)).not.toThrow();
    expect(advanceCatalogAnimation(sprite, 600, frames, 1000)).toBe(false);
  });

  it("reports a live sprite even when the frame list is empty", () => {
    const sprite = new Sprite(Texture.EMPTY);
    expect(advanceCatalogAnimation(sprite, 600, [], 1000)).toBe(true);
  });
});
