import { describe, expect, it } from "vitest";
import { pulseTint, terrainTintsAt, waterFrameIndex } from "../src/client/game/terrain-visuals.js";
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

  it("maps adjacent tiles to adjacent surface samples and wraps at the source edge", () => {
    expect(waterFrameIndex(0, 0, 16)).toBe(0);
    expect(waterFrameIndex(1, 0, 16)).toBe(1);
    expect(waterFrameIndex(0, 1, 16)).toBe(16);
    expect(waterFrameIndex(16, 16, 16)).toBe(0);
    expect(waterFrameIndex(-1, -1, 16)).toBe(255);
  });

  it("only makes the ambient water pulse subtly", () => {
    const base = 0x5d899d;
    expect(brightness(pulseTint(base, 1.035)) - brightness(base)).toBeLessThan(20);
  });
});
