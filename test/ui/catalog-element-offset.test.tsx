import { describe, expect, it } from "vitest";
import { createCatalogElementView } from "../../src/client/game/catalog-element-render.js";
import { ELEMENT_OFFSET_PX } from "../../src/shared/map-data.js";
import type { EditorAssetId } from "../../src/shared/tiny-swords-catalog.js";
import { stubEditorAssetArt } from "../client/helpers/editor-asset-art-stub.js";

// Pixi objects belong in the jsdom client suite, not the workerd server suite. Keeping this test
// here also avoids workerd trying to resolve Pixi's Node-only XML dependency on Windows paths.
const ASSET_ID: EditorAssetId = "resource.terrain-resources-wood-trees.tree3";

describe("element render offset", () => {
  it("shifts the anchor by a quarter tile per offset step", () => {
    const art = stubEditorAssetArt(ASSET_ID);
    const aligned = createCatalogElementView(
      { col: 2, row: 2, offsetX: 0, offsetY: 0, assetId: ASSET_ID },
      art,
    );
    const shifted = createCatalogElementView(
      { col: 2, row: 2, offsetX: 2, offsetY: 3, assetId: ASSET_ID },
      art,
    );
    expect(aligned).not.toBeNull();
    expect(shifted).not.toBeNull();
    if (!aligned || !shifted) return;
    expect(shifted.x - aligned.x).toBe(2 * ELEMENT_OFFSET_PX);
    expect(shifted.y - aligned.y).toBe(3 * ELEMENT_OFFSET_PX);
  });
});
