import { Assets, Rectangle, Texture } from "pixi.js";
import {
  type EditorAssetDefinition,
  type EditorAssetId,
  editorAsset,
} from "../../shared/tiny-swords-catalog.js";
import { tinySwordsSourceUrl } from "./tiny-swords-assets.js";

export interface EditorAssetArt {
  definition: EditorAssetDefinition;
  frames: readonly Texture[];
}

const CACHE = new Map<EditorAssetId, Promise<EditorAssetArt>>();

function sliceFrames(sheet: Texture, definition: EditorAssetDefinition): Texture[] {
  const sourceRect = definition.editor.sourceRect;
  if (sourceRect) {
    return [
      new Texture({
        source: sheet.source,
        frame: new Rectangle(sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height),
        label: definition.id,
      }),
    ];
  }
  const frame = definition.frame;
  if (!frame) return [sheet];
  return Array.from({ length: frame.count }, (_, index) => {
    const x = frame.axis === "x" ? index * frame.width : 0;
    const y = frame.axis === "y" ? index * frame.height : 0;
    return new Texture({
      source: sheet.source,
      frame: new Rectangle(x, y, frame.width, frame.height),
      label: `${definition.id}:${index}`,
    });
  });
}

export function loadEditorAssetArt(assetId: EditorAssetId): Promise<EditorAssetArt> {
  const existing = CACHE.get(assetId);
  if (existing) return existing;
  const definition = editorAsset(assetId);
  if (!definition) return Promise.reject(new Error(`Unknown editor asset: ${assetId}`));
  const loading = Assets.load<Texture>(tinySwordsSourceUrl(definition.sourcePath)).then((sheet) => {
    sheet.source.style.scaleMode = "nearest";
    return { definition, frames: sliceFrames(sheet, definition) };
  });
  CACHE.set(assetId, loading);
  return loading;
}

export async function loadEditorAssetArts(
  assetIds: Iterable<EditorAssetId>,
): Promise<Map<EditorAssetId, EditorAssetArt>> {
  const unique = [...new Set(assetIds)];
  const loaded = await Promise.all(unique.map((assetId) => loadEditorAssetArt(assetId)));
  return new Map(loaded.map((art) => [art.definition.id as EditorAssetId, art]));
}
