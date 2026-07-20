import { describe, expect, it } from "vitest";
import { parseWorldColliders } from "../../src/shared/protocol.js";

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

  it("rejects more colliders than a map could hold", () => {
    const many = Array.from({ length: 401 }, () => [0, 0, 1, 1] as const);
    expect(parseWorldColliders(many)).toBeNull();
  });
});
