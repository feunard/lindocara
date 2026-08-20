import {
  bridgePlacementLayout,
  decodeBridgeDimensions,
  encodeBridgeDimensions,
  parseBridgeDimensions,
} from "@lindocara/engine/bridges.js";
import { describe, expect, it } from "vitest";

describe("resizable bridge dimensions", () => {
  it("keeps legacy rows at 3x1 and round-trips explicit dimensions in one durable integer", () => {
    expect(decodeBridgeDimensions(0)).toBeUndefined();
    expect(decodeBridgeDimensions(encodeBridgeDimensions({ length: 9, width: 4 }))).toEqual({
      length: 9,
      width: 4,
    });
    expect(parseBridgeDimensions({ length: 0, width: 1 })).toBeNull();
    expect(decodeBridgeDimensions(999_999)).toBeNull();
  });

  it("preserves each historical anchor while expanding length and width", () => {
    expect(
      bridgePlacementLayout({
        assetId: "terrain.bridge.wood.horizontal",
        col: 8,
        row: 7,
        bridge: { length: 6, width: 2 },
      }),
    ).toMatchObject({ startCol: 6, startRow: 6, cols: 6, rows: 2 });
    expect(
      bridgePlacementLayout({
        assetId: "terrain.bridge.wood.vertical",
        col: 8,
        row: 7,
        bridge: { length: 6, width: 2 },
      }),
    ).toMatchObject({ startCol: 8, startRow: 2, cols: 2, rows: 6 });
  });
});
