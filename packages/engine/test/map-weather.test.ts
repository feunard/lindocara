import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { decodeMap, encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import {
  DEFAULT_MAP_WEATHER,
  MAP_WEATHERS,
  parseMapWeather,
  weatherRains,
} from "@lindocara/engine/map-weather.js";
import { emptyLayer } from "@lindocara/engine/tile-layer-codec.js";
import { autotileId } from "@lindocara/engine/tileset.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET_ID } from "@lindocara/engine/tilesets/tiny-swords.js";
import { describe, expect, it } from "vitest";

const COLS = 4;
const ROWS = 4;

function authored(weather?: "none" | "rain") {
  const ground = emptyLayer(COLS, ROWS);
  return {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: COLS,
    rows: ROWS,
    layers: [
      { ...ground, ids: ground.ids.map(() => autotileId(GRASS_SLOTS[0], 0)) },
      emptyLayer(COLS, ROWS),
      emptyLayer(COLS, ROWS),
    ],
    elements: [],
    spawn: { col: 1, row: 1 },
    ...(weather === undefined ? {} : { weather }),
  };
}

describe("authored map weather", () => {
  it("parses only what it declares, and defaults to a clear sky", () => {
    expect(DEFAULT_MAP_WEATHER).toBe("none");
    for (const weather of MAP_WEATHERS) expect(parseMapWeather(weather)).toBe(weather);
    // Untrusted input: a row or a frame carrying anything else is not weather.
    expect(parseMapWeather("storm")).toBeNull();
    expect(parseMapWeather(1)).toBeNull();
    expect(parseMapWeather(undefined)).toBeNull();
  });

  it("answers the one question every consumer of the downpour asks", () => {
    expect(weatherRains("rain")).toBe(true);
    expect(weatherRains("none")).toBe(false);
  });

  it("compiles into the heightfield and survives the round trip", () => {
    const compiled = compileAuthoredMap(authored("rain"));
    expect(compiled.weather).toBe("rain");
    const decoded = decodeMap(encodeMap(compiled));
    expect(decoded?.weather).toBe("rain");
  });

  it("leaves a map written before weather existed exactly as it was", () => {
    // Not merely "reads as none": the decoded object must not GAIN the key, or every stored
    // heightfield changes shape on the next read and every round-trip fixture in the suite moves.
    const compiled = compileAuthoredMap(authored());
    const { weather: _weather, ...withoutWeather } = compiled;
    const decoded = decodeMap(encodeMap(withoutWeather as typeof compiled));
    expect(decoded).not.toBeNull();
    expect(decoded && "weather" in decoded).toBe(false);
    expect(decoded?.weather ?? "none").toBe("none");
  });

  it("refuses a heightfield whose weather is not weather at all", () => {
    const compiled = compileAuthoredMap(authored());
    const text = JSON.stringify({ ...compiled, weather: "hurricane" });
    expect(decodeMap(text)).toBeNull();
  });
});
