import { describe, expect, it } from "vitest";
import {
  pulseTint,
  terrainTintsAt,
  WATER_RENDER_OBJECTS,
  waterScrollOffsets,
  waterSurfaceRect,
} from "../src/client/game/terrain-visuals.js";
import { WORLD_ZONES } from "../src/client/game/world-layout.js";

function brightness(color: number): number {
  return ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
}

describe("regional terrain palettes", () => {
  it("keeps zones without authored visuals neutral", () => {
    expect(terrainTintsAt(100, 100, [])).toEqual({ land: 0xffffff, water: 0x5d899d });
  });

  it("darkens the marsh naturally relative to the sunlit meadow", () => {
    const sunwake = WORLD_ZONES.find((zone) => zone.id === "sunwake");
    const marsh = WORLD_ZONES.find((zone) => zone.id === "duskmire");
    expect(sunwake).toBeDefined();
    expect(marsh).toBeDefined();
    if (!sunwake || !marsh) return;

    const light = terrainTintsAt(sunwake.x, sunwake.y, [sunwake]);
    const dark = terrainTintsAt(marsh.x, marsh.y, [marsh]);
    expect(brightness(dark.land)).toBeLessThan(brightness(light.land));
    expect(brightness(dark.water)).toBeLessThan(brightness(light.water));
  });

  it("animates the two authored water layers in different directions", () => {
    const start = waterScrollOffsets(0, 1_024);
    const afterOneSecond = waterScrollOffsets(1_000, 1_024);

    expect(start).toEqual({ primary: { x: 0, y: 0 }, secondary: { x: 0, y: 0 } });
    expect(afterOneSecond.primary.x).toBeCloseTo(15.36);
    expect(afterOneSecond.primary.y).toBeCloseTo(1.024);
    expect(afterOneSecond.secondary.x).toBeCloseTo(1_008.64);
    expect(afterOneSecond.secondary.y).toBeCloseTo(1_003.52);
    expect(afterOneSecond.primary.x).not.toBe(afterOneSecond.secondary.x);
  });

  it("wraps water motion on the texture period without accumulating unbounded offsets", () => {
    expect(waterScrollOffsets(1_000_000, 0)).toEqual({
      primary: { x: 0, y: 0 },
      secondary: { x: 0, y: 0 },
    });
    const wrapped = waterScrollOffsets(1_000_000, 1_024);
    for (const value of [
      wrapped.primary.x,
      wrapped.primary.y,
      wrapped.secondary.x,
      wrapped.secondary.y,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1_024);
    }
  });

  it("only makes the ambient water pulse subtly", () => {
    const base = 0x5d899d;
    expect(brightness(pulseTint(base, 1.035)) - brightness(base)).toBeLessThan(20);
  });

  it("keeps water at two render objects even for a very large camera window", () => {
    const surface = waterSurfaceRect(0, 0, 200, 120, 64, 12_800, 7_680);
    expect(WATER_RENDER_OBJECTS).toBe(2);
    expect(surface).toEqual({ x: 0, y: 0, width: 12_800, height: 7_680 });
  });

  it("moves and clips the same viewport surface instead of growing a tile pool", () => {
    const first = waterSurfaceRect(128, 64, 20, 12, 64, 4_800, 2_752);
    const moved = waterSurfaceRect(1_280, 640, 20, 12, 64, 4_800, 2_752);
    const transitioned = waterSurfaceRect(576, 416, 20, 12, 64, 640, 480);
    expect(first).toEqual({ x: 128, y: 64, width: 1_280, height: 768 });
    expect(moved).toEqual({ x: 1_280, y: 640, width: 1_280, height: 768 });
    expect(transitioned).toEqual({ x: 576, y: 416, width: 64, height: 64 });
    expect(WATER_RENDER_OBJECTS).toBe(2);
  });
});
