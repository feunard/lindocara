import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { decodeMap, encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import {
  DEFAULT_MAP_WEATHER,
  MAP_WEATHERS,
  parseMapWeather,
  STORM_FLASH_MS,
  STORM_STRIKE_JITTER_MS,
  STORM_STRIKE_PERIOD_MS,
  stormFlashIntensity,
  stormStrikeAt,
  weatherRains,
  weatherStorms,
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
    expect(parseMapWeather("hurricane")).toBeNull();
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

describe("the storm's strike schedule", () => {
  const KEY = "map-under-the-storm";

  it("is the same strike for every client, from the clock and the map alone", () => {
    // The decision, as a test: no message schedules this. Two clients are two calls with the same
    // arguments, so they cannot disagree about which strike is running.
    const at = 1_700_000_000_000;
    expect(stormStrikeAt(at, KEY)).toEqual(stormStrikeAt(at, KEY));
    // And two maps never flash in unison, because the key shifts the whole schedule.
    expect(stormStrikeAt(at, KEY).index).not.toBe(stormStrikeAt(at, "another-map").index);
  });

  it("advances one strike at a time, with a gap that is never twice the same", () => {
    const starts: number[] = [];
    let seen: number | null = null;
    for (let at = 1_700_000_000_000; at < 1_700_000_120_000; at += 50) {
      const strike = stormStrikeAt(at, KEY);
      if (strike.index === seen) continue;
      seen = strike.index;
      starts.push(at - strike.sinceMs);
    }
    expect(starts.length).toBeGreaterThan(5);
    const gaps = starts.slice(1).map((start, index) => start - (starts[index] ?? 0));
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(STORM_STRIKE_PERIOD_MS - STORM_STRIKE_JITTER_MS - 1);
      expect(gap).toBeLessThan(STORM_STRIKE_PERIOD_MS + STORM_STRIKE_JITTER_MS + 1);
    }
    // Jittered, not periodic: a player must not learn the beat.
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });

  it("never reports a strike that has not happened yet", () => {
    // The reason the function looks backwards when its own slot is still in the future: the clap
    // trails the flash by nearly a second, so the strike a consumer needs is the last one FIRED.
    for (let at = 1_700_000_000_000; at < 1_700_000_060_000; at += 137) {
      expect(stormStrikeAt(at, KEY).sinceMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("flashes as a stroke and its return stroke, then goes dark", () => {
    expect(stormFlashIntensity(-1)).toBe(0);
    expect(stormFlashIntensity(0)).toBeGreaterThan(0);
    const peak = stormFlashIntensity(STORM_FLASH_MS * 0.05);
    expect(peak).toBeGreaterThan(0.9);
    // The dip between the two strokes, and the second stroke after it: a single smooth ramp would
    // read as a lamp being turned up.
    const dip = stormFlashIntensity(STORM_FLASH_MS * 0.17);
    const second = stormFlashIntensity(STORM_FLASH_MS * 0.28);
    expect(dip).toBeLessThan(second);
    expect(second).toBeLessThan(peak);
    expect(stormFlashIntensity(STORM_FLASH_MS + 1)).toBe(0);
  });

  it("rains as well as flashing, so the curtain does not have to name it", () => {
    expect(weatherRains("storm")).toBe(true);
    expect(weatherStorms("storm")).toBe(true);
    expect(weatherStorms("rain")).toBe(false);
  });
});
