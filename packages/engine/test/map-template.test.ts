import { MAP_MAX_COLS, MAP_MIN_COLS, MAP_MIN_ROWS } from "@lindocara/engine/map-limits.js";
import { DEFAULT_FIRST_MAP_NAME, defaultMapInput } from "@lindocara/engine/map-template.js";
import { TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

describe("defaultMapInput", () => {
  it("mints a bounded field of flat grass with the spawn dead centre", () => {
    const input = defaultMapInput(DEFAULT_FIRST_MAP_NAME);
    expect(input.name).toBe("Map1");
    expect(input.tilesetId).toBe(TINY_SWORDS_TILESET_ID);
    expect(input.cols).toBe(MAP_MIN_COLS);
    expect(input.rows).toBe(MAP_MIN_ROWS);
    expect(input.spawn).toEqual({
      col: Math.floor(MAP_MIN_COLS / 2),
      row: Math.floor(MAP_MIN_ROWS / 2),
    });
    expect(input.elements).toEqual([]);
    expect(input.events).toEqual([]);
    expect(input.layers.length).toBeGreaterThan(0);
  });

  it("is born on permanent day rather than the day/night cycle", () => {
    const input = defaultMapInput(DEFAULT_FIRST_MAP_NAME);
    expect(input.dayNightCycle).toBe(false);
    expect(input.fixedLighting).toBe("day");
  });

  it("honours explicit dimensions", () => {
    const input = defaultMapInput("Wide", 40, 30);
    expect(input.cols).toBe(40);
    expect(input.rows).toBe(30);
    expect(input.spawn).toEqual({ col: 20, row: 15 });
  });

  it("refuses dimensions outside the authoring bounds", () => {
    expect(() => defaultMapInput("Too small", MAP_MIN_COLS - 1, MAP_MIN_ROWS)).toThrow(/size:/);
    expect(() => defaultMapInput("Too wide", MAP_MAX_COLS + 1, MAP_MIN_ROWS)).toThrow(/size:/);
    expect(() => defaultMapInput("Fractional", MAP_MIN_COLS + 0.5, MAP_MIN_ROWS)).toThrow(/size:/);
  });
});
