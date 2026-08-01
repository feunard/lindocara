import type { WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import type { EditorAssetArt } from "@lindocara/renderer/editor-asset-art.js";
import {
  preloadWorldEventAssetArts,
  worldEventPreloadAssetIds,
} from "@lindocara/renderer/world-event-art.js";
import { describe, expect, it, vi } from "vitest";

const TREE = "resource.terrain-resources-wood-trees.tree3";
const STUMP = "resource.terrain-resources-wood-trees.stump-1";

function intactTree(): WorldEventSnapshot {
  return {
    id: "tree-a",
    col: 2,
    row: 3,
    graphicAssetId: TREE,
    onTop: true,
    moveSpeed: 0,
    moveFrequency: 0,
    moveAnimation: false,
    directionFixed: true,
    harvest: {
      state: "intact",
      generation: 0,
      hits: 2,
      lastHitAt: 1_000,
      depletedAt: null,
      respawnAt: null,
      exhaustionBehavior: "replace",
      exhaustedAssetId: STUMP,
      fadeDurationMs: 250,
    },
  };
}

function eventWithoutHarvest(id: string, graphicAssetId: string | null = TREE): WorldEventSnapshot {
  return {
    id,
    col: 2,
    row: 3,
    graphicAssetId,
    onTop: true,
    moveSpeed: 0,
    moveFrequency: 0,
    moveAnimation: false,
    directionFixed: true,
  };
}

describe("world event art preloading", () => {
  it("loads an explicit harvest replacement while the node is still intact", async () => {
    const loaded = new Map<EditorAssetId, EditorAssetArt>();
    const loader = vi.fn(async (_assetIds: Iterable<EditorAssetId>) => loaded);

    await expect(preloadWorldEventAssetArts([intactTree()], loader)).resolves.toBe(loaded);
    expect(loader).toHaveBeenCalledWith([TREE, STUMP]);
  });

  it("deduplicates explicit ids and never guesses replacements from asset-like names", () => {
    const tree = intactTree();
    const duplicate = eventWithoutHarvest("tree-b");
    const pathLike = eventWithoutHarvest("tree-c", "resource.somewhere/tree_stump.png");

    expect(worldEventPreloadAssetIds([tree, duplicate, pathLike])).toEqual([TREE, STUMP]);
  });

  it("keeps legacy non-harvest events loadable without replacement metadata", () => {
    const legacy = eventWithoutHarvest("legacy-tree");
    expect(worldEventPreloadAssetIds([legacy])).toEqual([TREE]);
  });
});
