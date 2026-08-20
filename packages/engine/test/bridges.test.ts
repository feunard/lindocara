import {
  BRIDGE_ASSET_IDS,
  bridgeAssetIdForCrossing,
  bridgePlacementLayout,
  DEFAULT_BRIDGE_ASSET_ID,
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

describe("bridgeAssetIdForCrossing", () => {
  /** `#` is land, `~` is open water. Row 0 is the first string. */
  const mapOf =
    (rows: readonly string[]) =>
    (col: number, row: number): boolean =>
      rows[row]?.[col] === "~";

  it("spans a north-south river with a horizontal deck", () => {
    const river = mapOf(["##~~##", "##~~##", "##~~##", "##~~##", "##~~##"]);
    expect(bridgeAssetIdForCrossing(river, 2, 2)).toBe(BRIDGE_ASSET_IDS.horizontal);
  });

  it("spans an east-west river with a vertical deck", () => {
    const river = mapOf(["######", "~~~~~~", "~~~~~~", "######", "######"]);
    expect(bridgeAssetIdForCrossing(river, 2, 1)).toBe(BRIDGE_ASSET_IDS.vertical);
  });

  it("keeps the palette's own orientation on dry land, on a square pond and on open sea", () => {
    expect(bridgeAssetIdForCrossing(mapOf(["###", "###", "###"]), 1, 1)).toBe(
      DEFAULT_BRIDGE_ASSET_ID,
    );
    expect(bridgeAssetIdForCrossing(mapOf(["###", "#~#", "###"]), 1, 1)).toBe(
      DEFAULT_BRIDGE_ASSET_ID,
    );
    expect(bridgeAssetIdForCrossing(() => true, 40, 40)).toBe(DEFAULT_BRIDGE_ASSET_ID);
  });

  it("stops the crossing measurement at the map border, not past it", () => {
    // Water leaving the map to the east: the run east of the anchor is bounded by `openAt`
    // answering false off-map, so this reads as the narrow axis and takes the horizontal deck.
    const shore = mapOf(["#~", "#~", "#~", "#~", "#~"]);
    expect(bridgeAssetIdForCrossing(shore, 1, 2)).toBe(BRIDGE_ASSET_IDS.horizontal);
  });
});
