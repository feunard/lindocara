import { MAX_MAP_ELEMENTS } from "@lindocara/engine/map-data.js";
import { parseWorldColliders } from "@lindocara/engine/protocol.js";
import { describe, expect, it } from "vitest";

describe("wire colliders", () => {
  it("parses well-formed tuples", () => {
    expect(parseWorldColliders([[1, 2, 3, 4]])).toEqual([{ x: 1, y: 2, width: 3, height: 4 }]);
  });

  it("accepts an empty list", () => {
    expect(parseWorldColliders([])).toEqual([]);
  });

  it("rejects a malformed payload rather than throwing", () => {
    expect(parseWorldColliders("nope")).toBeNull();
    expect(parseWorldColliders([[1, 2, 3]])).toBeNull();
    expect(parseWorldColliders([[1, 2, 3, "4"]])).toBeNull();
    expect(parseWorldColliders([[1, 2, 3, Number.NaN]])).toBeNull();
  });

  it("accepts exactly the maximum number of colliders a map could hold", () => {
    const max = Array.from({ length: MAX_MAP_ELEMENTS }, () => [0, 0, 1, 1] as const);
    const parsed = parseWorldColliders(max);
    expect(parsed).not.toBeNull();
    expect(parsed).toHaveLength(MAX_MAP_ELEMENTS);
  });

  it("rejects more colliders than a map could hold", () => {
    const many = Array.from({ length: MAX_MAP_ELEMENTS + 1 }, () => [0, 0, 1, 1] as const);
    expect(parseWorldColliders(many)).toBeNull();
  });
});
