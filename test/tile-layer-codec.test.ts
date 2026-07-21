import {
  decodeTileLayer,
  emptyLayer,
  encodeTileLayer,
  parseTileLayer,
} from "@lindocara/engine/tile-layer-codec.js";
import { describe, expect, it } from "vitest";

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

  it("rejects a payload over the length ceiling even though it decodes to exactly the expected cells", () => {
    // For a 3x3 layer expected = 9, and the ceiling is expected * 17 - 1 = 152 (17 =
    // String(Number.MAX_SAFE_INTEGER).length + 1). Leading zeros are legal under `/^\d+$/`, and
    // Number("00000000000000001") === 1 is still a safe integer, so a 17-character bare run can
    // encode a single cell. Nine such runs joined by eight commas is 161 characters — over the
    // ceiling — yet decode to exactly nine ids, one per run, so the per-run `ids.length + count
    // > expected` guard never fires. Only the length ceiling can reject this payload.
    const run = "00000000000000001";
    const oversized = Array(9).fill(run).join(",");
    expect(parseTileLayer(oversized, 3, 3)).toBeNull();
  });

  it("rejects an id past Number.MAX_SAFE_INTEGER", () => {
    expect(parseTileLayer("99999999999999999999999999*9", 3, 3)).toBeNull();
  });
});
