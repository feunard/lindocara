import { DEFAULT_ADVENTURE_AUDIO } from "@lindocara/engine/audio-catalog.js";
import type { ZoneBuildingDefinition } from "@lindocara/engine/buildings.js";
import { frontalArc } from "@lindocara/engine/directional-combat.js";
import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import { decodeMap, encodeMap } from "@lindocara/engine/hd2d/map-data.js";
import { defaultMapInput } from "@lindocara/engine/map-template.js";
import { encodeTileLayer } from "@lindocara/engine/tile-layer-codec.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import {
  buildingAtImpact,
  buildingIntersectsArc,
  buildingSnapshot,
  buildingWithinRadius,
  createBuildings,
  damageBuilding,
} from "@lindocara/server/world/building-system.js";
import { describe, expect, it } from "vitest";
import { zoneFromMapPayload } from "../src/api/realtime/worldState.ts";
import type { MapPayload } from "../src/api/services/MapService.ts";

const standing = "building.factions-knights-buildings-house.house-blue" as EditorAssetId;
const ruined = "building.factions-knights-buildings-house.house-destroyed" as EditorAssetId;

function definition(overrides: Partial<ZoneBuildingDefinition> = {}): ZoneBuildingDefinition {
  return {
    id: "building-1",
    x: 2,
    z: 3,
    standingAssetId: standing,
    destroyedAssetId: ruined,
    destructible: true,
    maxHp: 100,
    collider: { x: 1, z: 2, w: 2, h: 2 },
    ...overrides,
  };
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("test fixture is missing a required value");
  return value;
}

describe("building system", () => {
  it("owns HP and replaces a destroyed building with its ruin snapshot", () => {
    const building = required(createBuildings([definition()])[0]);
    expect(buildingSnapshot(building).graphicAssetId).toBe(standing);

    expect(damageBuilding(building, 40)).toEqual({ actualDamage: 40, destroyed: false });
    expect(damageBuilding(building, 80)).toEqual({ actualDamage: 60, destroyed: true });
    expect(buildingSnapshot(building)).toMatchObject({
      hp: 0,
      destroyed: true,
      graphicAssetId: ruined,
      destroyedAssetId: ruined,
    });
    expect(damageBuilding(building, 1)).toBeNull();
  });

  it("never damages an authored indestructible building", () => {
    const building = required(createBuildings([definition({ destructible: false })])[0]);
    expect(damageBuilding(building, 500)).toBeNull();
    expect(buildingSnapshot(building)).toMatchObject({ hp: 100, destroyed: false });
  });

  it("selects solid buildings for melee, area and projectile contacts", () => {
    const building = required(createBuildings([definition()])[0]);
    expect(
      buildingIntersectsArc(building, frontalArc({ x: 0, z: 3 }, { x: 1, z: 0 }, 4, Math.PI / 3)),
    ).toBe(true);
    expect(buildingWithinRadius(building, { x: 0, z: 3 }, 1)).toBe(true);
    expect(buildingAtImpact([building], { x: 1, z: 3 }, 0.1)).toBe(building);
    expect(buildingAtImpact([building], { x: -2, z: 3 }, 0.1)).toBeNull();
  });

  it("projects authored buildings into room state and removes only their static visual", () => {
    const input = defaultMapInput("Building map");
    const element = {
      id: "f2c15465-6f9d-4ef5-80dd-e508c3642111",
      col: 8,
      row: 8,
      offsetX: 0,
      offsetY: 0,
      assetId: standing,
      building: { destructible: true, maxHp: 900 },
    } as const;
    const authored = { ...input, elements: [element] };
    const payload: MapPayload = {
      id: "map-1",
      accountId: "account-1",
      adventureId: "adventure-1",
      name: input.name,
      revision: 1,
      tilesetId: input.tilesetId,
      cols: input.cols,
      rows: input.rows,
      layers: input.layers.map(encodeTileLayer),
      elements: [element],
      spawn: input.spawn,
      markers: required(input.markers),
      events: [],
      audio: required(input.audio),
      heroSettings: required(input.heroSettings),
      dayNightCycle: required(input.dayNightCycle),
      fixedLighting: required(input.fixedLighting),
      heightfield: encodeMap(compileAuthoredMap(authored)),
    };

    const zone = zoneFromMapPayload(payload, DEFAULT_ADVENTURE_AUDIO);
    const liveMap = decodeMap(zone.heightfield ?? "");
    expect(zone.buildings).toEqual([
      expect.objectContaining({
        id: element.id,
        standingAssetId: standing,
        destroyedAssetId: ruined,
        maxHp: 900,
      }),
    ]);
    expect(liveMap?.elements).toEqual([]);
    expect(liveMap?.colliders).toHaveLength(1);
  });
});
