import type { MapData } from "@lindocara/engine/hd2d/map-data.js";
import {
  authoredCloudWind,
  authoredSkyAltitude,
  staticAnimationFrame,
} from "@lindocara/renderer/hd2d/static-content.js";
import { describe, expect, it } from "vitest";

describe("HD-2D authored scenery animation", () => {
  it("loops every frame over the catalogue duration", () => {
    expect(staticAnimationFrame(0, 800, 4)).toBe(0);
    expect(staticAnimationFrame(199, 800, 4)).toBe(0);
    expect(staticAnimationFrame(200, 800, 4)).toBe(1);
    expect(staticAnimationFrame(799, 800, 4)).toBe(3);
    expect(staticAnimationFrame(800, 800, 4)).toBe(0);
  });

  it("uses stable placement phases without changing the loop cadence", () => {
    expect(staticAnimationFrame(0, 800, 4, 200)).toBe(1);
    expect(staticAnimationFrame(600, 800, 4, 200)).toBe(0);
    expect(staticAnimationFrame(-200, 800, 4, 200)).toBe(0);
  });

  it("pins static and technical sheets when no animation duration is declared", () => {
    expect(staticAnimationFrame(4_000, 0, 12, 300)).toBe(0);
    expect(staticAnimationFrame(4_000, 800, 1, 300)).toBe(0);
  });
});

describe("HD-2D authored sky", () => {
  it("stays above the highest authored elevation", () => {
    const map = {
      size: 2,
      levelHeight: 0.9,
      waterLevel: 0.12,
      levels: [0, 1, 2, 3],
    } as unknown as MapData;
    expect(authoredSkyAltitude(map)).toBeGreaterThan(3 * map.levelHeight);
  });

  it("drifts gently and deterministically around its authored anchor", () => {
    expect(authoredCloudWind(500, 80)).toEqual(authoredCloudWind(500, 80));
    expect(authoredCloudWind(2_500, 80)).not.toEqual(authoredCloudWind(500, 80));
    expect(Math.abs(authoredCloudWind(2_500, 80).x)).toBeLessThanOrEqual(0.42);
  });
});
