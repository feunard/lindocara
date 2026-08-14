import {
  defaultBuildingMaxHp,
  defaultBuildingSettings,
  destroyedBuildingAssetId,
  isDestroyedBuildingAsset,
  isStandingBuildingAsset,
  parseBuildingSettings,
} from "@lindocara/engine/buildings.js";
import { parseMapElements } from "@lindocara/engine/map-data.js";
import { describe, expect, it } from "vitest";

const HOUSE = "building.buildings-blue-buildings.house1" as const;
const TOWER = "building.buildings-blue-buildings.tower" as const;
const CASTLE = "building.buildings-blue-buildings.castle" as const;
const RUIN = "building.factions-knights-buildings-house.house-destroyed" as const;
const TREE = "resource.terrain-resources-wood-trees.tree3" as const;

describe("building authoring rules", () => {
  it("derives default HP from both type and size", () => {
    expect(defaultBuildingMaxHp(HOUSE)).toBe(900);
    expect(defaultBuildingMaxHp(TOWER)).toBe(1_500);
    expect(defaultBuildingMaxHp(CASTLE)).toBe(4_000);
  });

  it("maps every standing family to a shipped destroyed appearance", () => {
    for (const assetId of [HOUSE, TOWER, CASTLE] as const) {
      const destroyed = destroyedBuildingAssetId(assetId);
      expect(destroyed).not.toBeNull();
      expect(isDestroyedBuildingAsset(destroyed ?? "")).toBe(true);
    }
    expect(isStandingBuildingAsset(RUIN)).toBe(false);
  });

  it("defaults legacy standing buildings to destructible and keeps non-buildings clean", () => {
    expect(parseMapElements([{ col: 1, row: 2, assetId: HOUSE }], 10, 10)?.[0]).toEqual({
      col: 1,
      row: 2,
      offsetX: 0,
      offsetY: 0,
      assetId: HOUSE,
      building: defaultBuildingSettings(HOUSE),
    });
    expect(parseMapElements([{ col: 1, row: 2, assetId: TREE }], 10, 10)?.[0]?.building).toBe(
      undefined,
    );
  });

  it("rejects malformed or misplaced building settings", () => {
    expect(parseBuildingSettings({ destructible: true, maxHp: 0 })).toBeNull();
    expect(
      parseMapElements(
        [{ col: 1, row: 2, assetId: TREE, building: { destructible: true, maxHp: 100 } }],
        10,
        10,
      ),
    ).toBeNull();
  });
});
