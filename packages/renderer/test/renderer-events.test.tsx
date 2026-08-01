import {
  eventRenderLayer,
  isSamePeasantCampLifetime,
  peasantCampLocalLifetime,
  tileRenderLayer,
} from "@lindocara/renderer/renderer.js";
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
  const actors = new Container();
  const above = new Container();

  it("routes onTop pages above actors, NPCs with actors, and markers into decor", () => {
    expect(eventRenderLayer(true, true, decor, actors, above)).toBe(above);
    expect(eventRenderLayer(false, true, decor, actors, above)).toBe(actors);
    expect(eventRenderLayer(false, false, decor, actors, above)).toBe(decor);
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

describe("Peasant camp replay", () => {
  it("keeps admission and heartbeat replays idempotent but accepts a replacement lifetime", () => {
    const current = { id: "camp-1", startedAt: 1_000, expiresAt: 13_000 };
    expect(isSamePeasantCampLifetime(current, { ...current })).toBe(true);
    expect(isSamePeasantCampLifetime(current, { ...current, expiresAt: 14_000 })).toBe(false);
    expect(isSamePeasantCampLifetime(current, { ...current, id: "camp-2" })).toBe(false);
  });

  it("projects server expiry onto performance time and uses bounded relative fallback", () => {
    const camp = { startedAt: 10_000, expiresAt: 22_000 };
    expect(
      peasantCampLocalLifetime(camp, { serverNow: 12_000, localPerformanceNow: 500 }, 700),
    ).toEqual({ startedAt: -1_500, expiresAt: 10_500 });
    expect(peasantCampLocalLifetime(camp, null, 700)).toEqual({
      startedAt: 700,
      expiresAt: 12_700,
    });
    expect(peasantCampLocalLifetime({ startedAt: 0, expiresAt: 999_999 }, null, 700)).toEqual({
      startedAt: 700,
      expiresAt: 120_700,
    });
  });
});
