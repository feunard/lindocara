import {
  harvestEventColliderRects,
  terrainWithHarvestEventColliders,
} from "@lindocara/client/game/net.js";
import { colliderIndexFrom } from "@lindocara/engine/collider.js";
import { isWalkable, type TerrainGeometry } from "@lindocara/engine/game.js";
import type { WorldEventSnapshot } from "@lindocara/engine/protocol.js";
import { decodeTileMap } from "@lindocara/engine/tilemap-codec.js";
import { describe, expect, it } from "vitest";

const STATIC = { x: 160, y: 32, width: 32, height: 32 };
const TILES = decodeTileMap(["....", "....", "....", "...."]);
const BASE: TerrainGeometry = {
  width: 256,
  height: 256,
  obstacles: [],
  spawnPoints: [],
  safeZone: null,
  tiles: TILES,
  colliders: colliderIndexFrom([STATIC], TILES.cols, TILES.rows),
};

function harvestEvent(
  collider: readonly [number, number, number, number] | null,
  graphicAssetId = "resource.terrain-resources-wood-trees.tree1",
): WorldEventSnapshot {
  return {
    id: "tree-a",
    col: 1,
    row: 1,
    graphicAssetId,
    onTop: false,
    moveSpeed: 0,
    moveFrequency: 0,
    moveAnimation: false,
    directionFixed: true,
    presentation: "native",
    harvest: {
      state: collider ? "intact" : "depleted",
      generation: 0,
      hits: collider ? 0 : 3,
      hitsRequired: 3,
      lastHitAt: collider ? null : 1_000,
      depletedAt: collider ? null : 1_000,
      respawnAt: null,
      exhaustionBehavior: "fade",
      exhaustedAssetId: null,
      fadeDurationMs: 300,
      collider,
    },
  };
}

describe("client harvest collision projection", () => {
  it("adds intact authoritative footprints and removes them on a depleted delta", () => {
    const intact = harvestEvent([64, 64, 48, 24]);
    const blocked = terrainWithHarvestEventColliders(BASE, [STATIC], [intact]);
    expect(isWalkable({ x: 72, y: 64 }, 16, blocked)).toBe(false);

    const depleted = terrainWithHarvestEventColliders(BASE, [STATIC], [harvestEvent(null)]);
    expect(isWalkable({ x: 72, y: 64 }, 16, depleted)).toBe(true);
    expect(isWalkable({ x: 164, y: 36 }, 16, depleted)).toBe(false);
  });

  it("does not change collision when only appearance changes", () => {
    const collider = [64, 64, 48, 24] as const;
    expect(harvestEventColliderRects([harvestEvent(collider)])).toEqual(
      harvestEventColliderRects([
        harvestEvent(collider, "resource.terrain-resources-wood-trees.tree4"),
      ]),
    );
  });
});
