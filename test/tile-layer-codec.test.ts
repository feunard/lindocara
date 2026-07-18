import { describe, expect, it } from "vitest";
import {
  decodeTileLayer,
  emptyLayer,
  encodeTileLayer,
  parseTileLayer,
} from "../src/shared/tile-layer-codec.js";

describe("tile layer codec", () => {
  it("collapses a uniform layer to a single run", () => {
    expect(encodeTileLayer(emptyLayer(4, 2))).toBe("0*8");
  });

  it("writes singles bare and runs with a multiplier", () => {
    const layer = { cols: 4, rows: 1, ids: [0, 17, 17, 18] };
    expect(encodeTileLayer(layer)).toBe("0,17*2,18");
  });

  it("round-trips", () => {
    const layer = { cols: 3, rows: 3, ids: [0, 1, 1, 1, 1025, 0, 0, 0, 42] };
    expect(decodeTileLayer(encodeTileLayer(layer), 3, 3)).toEqual(layer);
  });

  it("throws on a payload whose cell count disagrees with the map size", () => {
    expect(() => decodeTileLayer("0*5", 3, 3)).toThrow();
  });

  it("returns null rather than throwing on anything off the wire", () => {
    expect(parseTileLayer("0*5", 3, 3)).toBeNull();
    expect(parseTileLayer("nope", 3, 3)).toBeNull();
    expect(parseTileLayer("1*-2", 3, 3)).toBeNull();
    expect(parseTileLayer(42, 3, 3)).toBeNull();
    expect(parseTileLayer("0*9", 3, 3)).toEqual(emptyLayer(3, 3));
  });
});
