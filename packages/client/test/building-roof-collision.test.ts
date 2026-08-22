import { compileAuthoredMap } from "@lindocara/engine/hd2d/authored-map.js";
import type { MapData as HeightfieldMap } from "@lindocara/engine/hd2d/map-data.js";
import { EMPTY_MARKERS, type MapData } from "@lindocara/engine/map-data.js";
import { BODY_RADIUS, zoneTerrainFromHeightfield } from "@lindocara/engine/terrain-access.js";
import { emptyLayer } from "@lindocara/engine/tile-layer-codec.js";
import { autotileId } from "@lindocara/engine/tileset.js";
import {
  TERRAIN_MATERIAL_SLOTS,
  TINY_SWORDS_TILESET_ID,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import {
  type EditorAssetId,
  LINDOCARA_BUILDING_ASSET_IDS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { describe, expect, it } from "vitest";

import { createHeroController } from "@/game/hero-controller.js";

const SIZE = 16;
const FRAME = 1 / 60;

function roofApproach(assetId: EditorAssetId, tier: 2 | 3): HeightfieldMap {
  const ground = {
    ...emptyLayer(SIZE, SIZE),
    ids: new Array(SIZE * SIZE).fill(autotileId(TERRAIN_MATERIAL_SLOTS.herbe[0], 0)),
  };
  const authored: MapData = {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: SIZE,
    rows: SIZE,
    layers: [ground, emptyLayer(SIZE, SIZE), emptyLayer(SIZE, SIZE)],
    elements: [{ col: 7, row: 7, offsetX: 0, offsetY: 0, assetId }],
    spawn: { col: 7, row: 8 },
    markers: EMPTY_MARKERS,
  };
  const compiled = compileAuthoredMap(authored);
  return {
    ...compiled,
    // The southern half is the same elevated floor a player already walks on successfully. Its
    // north edge meets the building's front threshold, providing a legitimate jump onto the roof.
    levels: compiled.levels.map((level, index) =>
      Math.floor(index / SIZE) >= SIZE / 2 ? tier : level,
    ),
  };
}

describe("native building roof collision", () => {
  it.each([
    ["house", LINDOCARA_BUILDING_ASSET_IDS.house, 2],
    ["stone tower", LINDOCARA_BUILDING_ASSET_IDS.stoneTower, 3],
    ["archery guild", LINDOCARA_BUILDING_ASSET_IDS.archeryGuild, 2],
    ["barracks", LINDOCARA_BUILDING_ASSET_IDS.barracks, 2],
    ["windmill", LINDOCARA_BUILDING_ASSET_IDS.windmill, 3],
  ] as const)(
    "lands on and walks across the %s roof from elevated ground",
    (_name, assetId, tier) => {
      const map = roofApproach(assetId, tier);
      const terrain = zoneTerrainFromHeightfield(map);
      const collider = map.colliders[0];
      if (!collider) throw new Error("building collider missing");
      const x = collider.x + collider.w / 2;
      const front = collider.z + collider.h;
      const hero = createHeroController({
        terrain,
        spawn: { x, y: tier * map.levelHeight, z: front + 0.5 },
        speed: 4,
      });

      for (let frame = 0; frame < 22; frame += 1) {
        hero.step({ x: 0, z: -1, jump: frame === 0 }, FRAME);
      }
      for (let frame = 0; frame < 90; frame += 1) {
        hero.step({ x: 0, z: 0, jump: false }, FRAME);
      }

      const footprintZ = hero.state.z - 0.15;
      const roof = terrain.query.surfaceAt?.(hero.state.x, footprintZ, Number.POSITIVE_INFINITY);
      expect(hero.state.airborne, JSON.stringify(hero.state)).toBe(false);
      expect(hero.state.x).toBeGreaterThan(collider.x);
      expect(hero.state.x).toBeLessThan(collider.x + collider.w);
      expect(footprintZ).toBeGreaterThan(collider.z);
      expect(footprintZ).toBeLessThan(collider.z + collider.h);
      expect(hero.state.y).toBeCloseTo(roof ?? -99, 3);

      const beforeX = hero.state.x;
      for (let frame = 0; frame < 8; frame += 1) {
        hero.step({ x: 1, z: 0, jump: false }, FRAME);
      }
      expect(hero.state.x).toBeGreaterThan(beforeX + 0.1);
      expect(hero.state.airborne, JSON.stringify(hero.state)).toBe(false);
      expect(hero.state.y).toBeGreaterThan(1.79);
    },
  );

  it("falls past a wall graze instead of landing outside the roof", () => {
    const map = roofApproach(LINDOCARA_BUILDING_ASSET_IDS.house, 2);
    const terrain = zoneTerrainFromHeightfield(map);
    const collider = map.colliders[0];
    if (!collider) throw new Error("building collider missing");
    const hero = createHeroController({
      terrain,
      spawn: {
        x: collider.x - 0.05,
        y: 3.2,
        z: collider.z + collider.h / 2 + 0.15,
      },
      speed: 4,
    });
    hero.step({ x: 0, z: 0, jump: true }, FRAME);
    for (let frame = 0; frame < 120; frame += 1) {
      hero.step({ x: 0, z: 0, jump: false }, FRAME);
    }
    expect(hero.state.y).toBeCloseTo(0);
    expect(hero.state.airborne).toBe(false);
  });

  it("cannot walk back onto a roof after falling beside its wall", () => {
    const map = roofApproach(LINDOCARA_BUILDING_ASSET_IDS.house, 2);
    const terrain = zoneTerrainFromHeightfield(map);
    const collider = map.colliders[0];
    if (!collider) throw new Error("building collider missing");
    const x = collider.x + collider.w / 2;
    const roofFootprintZ = collider.z + collider.h / 2;
    const roof = terrain.query.surfaceAt?.(x, roofFootprintZ, Number.POSITIVE_INFINITY);
    if (roof === null || roof === undefined) throw new Error("building roof missing");
    const hero = createHeroController({
      terrain,
      spawn: { x, y: roof, z: roofFootprintZ + 0.15 },
      speed: 4,
    });

    // Walk off the north edge, then release immediately: the body falls beside the wall while its
    // collision disc is still touching it, which is the exact state that used to arm the generic
    // overlap escape hatch in the wrong direction.
    for (let frame = 0; frame < 60 && hero.state.z - 0.15 >= collider.z; frame += 1) {
      hero.step({ x: 0, z: -1, jump: false }, FRAME);
    }
    for (let frame = 0; frame < 120 && hero.state.airborne; frame += 1) {
      hero.step({ x: 0, z: 0, jump: false }, FRAME);
    }
    const fallenFootprintZ = hero.state.z - 0.15;
    expect(hero.state.airborne, JSON.stringify(hero.state)).toBe(false);
    expect(hero.state.y).toBeCloseTo(0);
    expect(collider.z - fallenFootprintZ).toBeLessThan(BODY_RADIUS);

    for (let frame = 0; frame < 90; frame += 1) {
      hero.step({ x: 0, z: 1, jump: false }, FRAME);
    }
    expect(hero.state.y).toBeCloseTo(0);
    expect(hero.state.z - 0.15).toBeLessThanOrEqual(collider.z);
  });
});
