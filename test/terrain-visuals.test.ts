import { describe, expect, it } from "vitest";
import {
  FOAM_CYCLE_MS,
  foamFrameAt,
  pulseTint,
  terrainTintsAt,
  WATER_RENDER_OBJECTS,
  waterSurfaceRect,
} from "../src/client/game/terrain-visuals.js";
import { WORLD_ZONES } from "../src/client/game/world-layout.js";

function brightness(color: number): number {
  return ((color >> 16) & 0xff) + ((color >> 8) & 0xff) + (color & 0xff);
}

describe("regional terrain palettes", () => {
  it("keeps zones without authored visuals neutral", () => {
    // Both channels are modulation tints, so neutral is white on both: it reproduces Tiny Swords'
    // authored flat sea rather than bending it towards a colour this project invented.
    expect(terrainTintsAt(100, 100, [])).toEqual({ land: 0xffffff, water: 0xffffff });
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

  it("walks the foam frames in order and loops", () => {
    expect(foamFrameAt(0, 8)).toBe(0);
    expect(foamFrameAt(FOAM_CYCLE_MS / 8, 8)).toBe(1);
    expect(foamFrameAt(FOAM_CYCLE_MS / 2, 8)).toBe(4);
    // The cycle closes: the frame after the last one is the first again, not a ninth.
    expect(foamFrameAt(FOAM_CYCLE_MS, 8)).toBe(0);
    expect(foamFrameAt(FOAM_CYCLE_MS * 3.5, 8)).toBe(4);
  });

  it("stays inside the sheet however long the world has been running", () => {
    for (const elapsed of [0, 1, 999, 1_000_000, 86_400_000]) {
      const frame = foamFrameAt(elapsed, 8);
      expect(Number.isInteger(frame)).toBe(true);
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(8);
    }
  });

  it("does not index an empty sheet or run time backwards", () => {
    expect(foamFrameAt(1_000, 0)).toBe(0);
    expect(foamFrameAt(-5_000, 8)).toBe(0);
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
