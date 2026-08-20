import {
  BUILDING_DOOR_INTERACTION_RANGE,
  buildingColor,
  buildingColorVariants,
  buildingDimensionsOrDefault,
  buildingDoorGroundPoint,
  decodeBuildingTransform,
  defaultBuildingMaxHp,
  defaultBuildingSettings,
  destroyedBuildingAssetId,
  distanceToBuildingDoor,
  encodeBuildingTransform,
  isDestroyedBuildingAsset,
  isStandingBuildingAsset,
  parseBuildingDimensions,
  parseBuildingSettings,
} from "@lindocara/engine/buildings.js";
import {
  elementCells,
  elementFitsMap,
  elementWorldCollider,
  parseMapElements,
} from "@lindocara/engine/map-data.js";
import {
  editorAsset,
  LINDOCARA_BUILDING_ASSET_IDS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

const HOUSE = "building.buildings-blue-buildings.house1" as const;
const TOWER = "building.buildings-blue-buildings.tower" as const;
const CASTLE = "building.buildings-blue-buildings.castle" as const;
const RUIN = "building.factions-knights-buildings-house.house-destroyed" as const;
const TREE = "resource.terrain-resources-wood-trees.tree3" as const;

describe("building authoring rules", () => {
  it("rotates each asymmetric facade door with the authored building", () => {
    const anchor = { x: 4, z: -3, assetId: LINDOCARA_BUILDING_ASSET_IDS.house };
    expect(buildingDoorGroundPoint(anchor)).toEqual({ x: 4.55, z: -3 });
    expect(buildingDoorGroundPoint({ ...anchor, orientation: 1 })).toEqual({ x: 4, z: -2.45 });
    expect(buildingDoorGroundPoint({ ...anchor, orientation: 2 })).toEqual({ x: 3.45, z: -3 });
    expect(buildingDoorGroundPoint({ ...anchor, orientation: 3 })).toEqual({ x: 4, z: -3.55 });
    expect(distanceToBuildingDoor({ x: 4.55, z: -2.6 }, anchor)).toBeLessThan(
      BUILDING_DOOR_INTERACTION_RANGE,
    );
    expect(distanceToBuildingDoor({ x: 2.6, z: -3 }, anchor)).toBeGreaterThan(
      BUILDING_DOOR_INTERACTION_RANGE,
    );
  });

  it("uses one generic eighth-cell footprint for resized doors, colliders and persistence", () => {
    const dimensions = { width: 5, depth: 4 };
    expect(buildingDimensionsOrDefault(HOUSE, dimensions)).toEqual(dimensions);
    expect(buildingDoorGroundPoint({ x: 4, z: -3, assetId: HOUSE, dimensions })).toEqual({
      x: 5,
      z: -3,
    });
    expect(decodeBuildingTransform(encodeBuildingTransform(3, dimensions))).toEqual({
      orientation: 3,
      dimensions,
    });
    expect(decodeBuildingTransform(2)).toEqual({ orientation: 2 });
    expect(parseBuildingDimensions({ width: 3.125, depth: 2.5 })).toEqual({
      width: 3.125,
      depth: 2.5,
    });
    expect(parseBuildingDimensions({ width: 3.1, depth: 2.5 })).toBeNull();
  });

  it.each([
    [LINDOCARA_BUILDING_ASSET_IDS.house, { x: -88, y: -136, width: 176, height: 136 }],
    [LINDOCARA_BUILDING_ASSET_IDS.stoneTower, { x: -64, y: -128, width: 128, height: 128 }],
    [LINDOCARA_BUILDING_ASSET_IDS.archeryGuild, { x: -96, y: -144, width: 192, height: 144 }],
    [LINDOCARA_BUILDING_ASSET_IDS.barracks, { x: -96, y: -152, width: 192, height: 152 }],
    [LINDOCARA_BUILDING_ASSET_IDS.monastery, { x: -96, y: -144, width: 192, height: 144 }],
    [LINDOCARA_BUILDING_ASSET_IDS.castle, { x: -96, y: -152, width: 192, height: 152 }],
    [LINDOCARA_BUILDING_ASSET_IDS.windmill, { x: -88, y: -128, width: 176, height: 128 }],
  ] as const)("keeps %s solid across its complete native footprint", (assetId, collider) => {
    expect(editorAsset(assetId)?.editor.collider).toEqual(collider);
  });

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

  it("offers native colour swaps only within the selected 3D model family", () => {
    expect(buildingColor(LINDOCARA_BUILDING_ASSET_IDS.house)).toBe("blue");
    expect(buildingColor("building.buildings-purple-buildings.house1")).toBe("purple");
    expect(buildingColorVariants(LINDOCARA_BUILDING_ASSET_IDS.house)).toEqual([
      { color: "blue", assetId: LINDOCARA_BUILDING_ASSET_IDS.house },
      { color: "red", assetId: "building.buildings-red-buildings.house1" },
      { color: "yellow", assetId: "building.buildings-yellow-buildings.house1" },
      { color: "purple", assetId: "building.buildings-purple-buildings.house1" },
      { color: "black", assetId: "building.buildings-black-buildings.house1" },
    ]);
    expect(buildingColorVariants(LINDOCARA_BUILDING_ASSET_IDS.windmill)).toEqual([]);
    expect(
      buildingColorVariants("building.factions-knights-buildings-house.house-construction"),
    ).toEqual([]);
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

  it("parses building quarter-turns and rotates their complete solid footprint around the foot", () => {
    const oriented = parseMapElements(
      [{ col: 1, row: 2, assetId: LINDOCARA_BUILDING_ASSET_IDS.house, orientation: 1 }],
      10,
      10,
    )?.[0];
    expect(oriented?.orientation).toBe(1);
    expect(oriented && elementWorldCollider(oriented)).toEqual({
      x: 96,
      y: 104,
      width: 136,
      height: 176,
    });
    expect(
      parseMapElements([{ col: 1, row: 2, assetId: TREE, orientation: 1 }], 10, 10),
    ).toBeNull();
    expect(
      parseMapElements(
        [{ col: 1, row: 2, assetId: LINDOCARA_BUILDING_ASSET_IDS.house, orientation: 4 }],
        10,
        10,
      ),
    ).toBeNull();
  });

  it("derives resized building coverage and rotated collision from the same dimensions", () => {
    const building = {
      col: 8,
      row: 8,
      offsetX: 0,
      offsetY: 0,
      assetId: HOUSE,
      building: { destructible: true, maxHp: 900, dimensions: { width: 5, depth: 4 } },
    } as const;
    expect(elementWorldCollider(building)).toEqual({ x: 384, y: 320, width: 320, height: 256 });
    expect(elementCells(building)).toHaveLength(20);
    expect(elementFitsMap(building, 12, 12)).toBe(true);
    expect(elementFitsMap({ ...building, col: 1 }, 12, 12)).toBe(false);
    expect(elementWorldCollider({ ...building, orientation: 1 })).toEqual({
      x: 544,
      y: 416,
      width: 256,
      height: 320,
    });
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
