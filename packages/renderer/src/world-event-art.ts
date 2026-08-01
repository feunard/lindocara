import type { WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import { type EditorAssetId, isEditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import { type EditorAssetArt, loadEditorAssetArts } from "./editor-asset-art.js";

export type WorldEventArtLoader = (
  assetIds: Iterable<EditorAssetId>,
) => Promise<Map<EditorAssetId, EditorAssetArt>>;

/**
 * Collects only explicit visual ids carried by the authoritative snapshot. In particular this
 * never inspects an asset name or path to guess that a resource might need a stump, empty rock or
 * other replacement.
 */
export function worldEventPreloadAssetIds(events: readonly WorldEventSnapshot[]): EditorAssetId[] {
  const assetIds = new Set<EditorAssetId>();
  for (const event of events) {
    if (isEditorAssetId(event.graphicAssetId)) assetIds.add(event.graphicAssetId);
    const exhaustedAssetId = event.harvest?.exhaustedAssetId;
    if (isEditorAssetId(exhaustedAssetId)) assetIds.add(exhaustedAssetId);
  }
  return [...assetIds];
}

/** Testable renderer preload boundary; the default loader owns Pixi texture slicing and caching. */
export function preloadWorldEventAssetArts(
  events: readonly WorldEventSnapshot[],
  load: WorldEventArtLoader = loadEditorAssetArts,
): Promise<Map<EditorAssetId, EditorAssetArt>> {
  return load(worldEventPreloadAssetIds(events));
}
