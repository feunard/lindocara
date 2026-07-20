import { describe, expect, it } from "vitest";
import {
  ELEMENT_OFFSET_PX,
  ELEMENT_OFFSET_STEPS,
  parseMapElements,
} from "../../src/shared/map-data.js";

const ASSET = "resource.terrain-resources-wood-trees.tree3";

describe("element offsets", () => {
  it("is a quarter tile", () => {
    expect(ELEMENT_OFFSET_STEPS).toBe(4);
    expect(ELEMENT_OFFSET_PX).toBe(16);
  });

  it("parses offsets", () => {
    const parsed = parseMapElements(
      [{ col: 1, row: 2, offsetX: 3, offsetY: 0, assetId: ASSET }],
      10,
      10,
    );
    expect(parsed).toEqual([{ col: 1, row: 2, offsetX: 3, offsetY: 0, assetId: ASSET }]);
  });

  it("defaults a legacy element without offsets to zero", () => {
    const parsed = parseMapElements([{ col: 1, row: 2, assetId: ASSET }], 10, 10);
    expect(parsed?.[0]).toMatchObject({ offsetX: 0, offsetY: 0 });
  });

  it("rejects an offset outside 0..3", () => {
    expect(
      parseMapElements([{ col: 0, row: 0, offsetX: 4, offsetY: 0, assetId: ASSET }], 10, 10),
    ).toBeNull();
    expect(
      parseMapElements([{ col: 0, row: 0, offsetX: -1, offsetY: 0, assetId: ASSET }], 10, 10),
    ).toBeNull();
    expect(
      parseMapElements([{ col: 0, row: 0, offsetX: 1.5, offsetY: 0, assetId: ASSET }], 10, 10),
    ).toBeNull();
  });

  it("rejects a cell outside the map, now that elements are collision", () => {
    expect(parseMapElements([{ col: 10, row: 0, assetId: ASSET }], 10, 10)).toBeNull();
    expect(parseMapElements([{ col: 0, row: -1, assetId: ASSET }], 10, 10)).toBeNull();
  });
});
