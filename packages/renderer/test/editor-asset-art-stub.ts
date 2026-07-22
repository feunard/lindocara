import { type EditorAssetId, editorAsset } from "@lindocara/engine/tiny-swords-catalog.js";
import type { EditorAssetArt } from "@lindocara/renderer/editor-asset-art.js";
import { Texture } from "pixi.js";

/** A loaded-art stand-in for tests that need `createCatalogElementView`'s real catalogue
 *  geometry (anchor, footOffset) without going through `loadEditorAssetArt`'s network/Assets
 *  fetch. One frame, `Texture.EMPTY`, is enough — the tests exercising this never render it. */
export function stubEditorAssetArt(assetId: EditorAssetId): EditorAssetArt {
  const definition = editorAsset(assetId);
  if (!definition) throw new Error(`fixture: unknown editor asset ${assetId}`);
  return { definition, frames: [Texture.EMPTY] };
}
