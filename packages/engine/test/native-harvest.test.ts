import { describe, expect, it } from "vitest";

import { nativeHarvestEvents } from "../src/native-harvest.js";

describe("native harvest scenery", () => {
  it("projects tree, both rock variants, gold and sheep assets into the harvest runtime", () => {
    const assets = [
      "resource.terrain-resources-wood-trees.tree1",
      "decoration.terrain-decorations-rocks.rock1",
      "decoration.terrain-decorations-rocks.rock3",
      "resource.terrain-resources-gold-gold-resource.gold-resource",
      "resource.terrain-resources-meat-sheep.sheep-idle",
    ] as const;
    const events = nativeHarvestEvents(
      assets.map((assetId, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        col: index,
        row: 2,
        offsetX: 0,
        offsetY: 0,
        assetId,
      })),
    );

    expect(events.map((event) => event.harvestProfile?.resource)).toEqual([
      "wood",
      "stone",
      "stone",
      "gold",
      "meat",
    ]);
    expect(events.map((event) => event.harvestProfile?.tool)).toEqual([
      "axe",
      "pickaxe",
      "pickaxe",
      "pickaxe",
      "knife",
    ]);
    expect(events[4]).toMatchObject({
      kind: "harvestable",
      pages: [{ graphicAssetId: assets[4] }],
      harvestProfile: { actorBehavior: "wander" },
    });
  });

  it("preserves a resized rock's visual scale in its runtime event", () => {
    const [event] = nativeHarvestEvents([
      {
        col: 2,
        row: 3,
        offsetX: 0,
        offsetY: 0,
        assetId: "decoration.terrain-decorations-rocks.rock1",
        scale: 2.25,
      },
    ]);

    expect(event).toMatchObject({ kind: "harvestable", graphicScale: 2.25 });
  });

  it("ignores ordinary scenery", () => {
    expect(
      nativeHarvestEvents([
        {
          col: 1,
          row: 1,
          offsetX: 0,
          offsetY: 0,
          assetId: "decoration.terrain-decorations-bushes.bushe1",
        },
      ]),
    ).toEqual([]);
  });

  it("ignores standalone tree stumps", () => {
    const stumpAssets = [
      "resource.terrain-resources-wood-trees.stump-1",
      "resource.terrain-resources-wood-trees.stump-2",
      "resource.terrain-resources-wood-trees.stump-3",
      "resource.terrain-resources-wood-trees.stump-4",
      "resource.resources-trees.stump",
    ] as const;
    expect(
      nativeHarvestEvents(
        stumpAssets.map((assetId, index) => ({
          col: index,
          row: 1,
          offsetX: 0,
          offsetY: 0,
          assetId,
        })),
      ),
    ).toEqual([]);
  });
});
