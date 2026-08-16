/** Deterministic DEV witness for physically climbing each native building roof. */

import { EMPTY_MARKERS, MAP_LAYERS, type MapData } from "@lindocara/engine/map-data.js";
import { paintElevation, paintRectAutotile } from "@lindocara/engine/tile-brush.js";
import { emptyLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import {
  GRASS_SLOTS,
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import {
  type EditorAssetId,
  LINDOCARA_BUILDING_ASSET_IDS,
} from "@lindocara/engine/tiny-swords-catalog.js";

export const ROOF_WITNESS_BUILDINGS = {
  house: { assetId: LINDOCARA_BUILDING_ASSET_IDS.house, tier: 2 },
  tower: { assetId: LINDOCARA_BUILDING_ASSET_IDS.stoneTower, tier: 3 },
  archery: { assetId: LINDOCARA_BUILDING_ASSET_IDS.archeryGuild, tier: 2 },
  barracks: { assetId: LINDOCARA_BUILDING_ASSET_IDS.barracks, tier: 2 },
  windmill: { assetId: LINDOCARA_BUILDING_ASSET_IDS.windmill, tier: 3 },
} as const;

export type RoofWitnessBuilding = keyof typeof ROOF_WITNESS_BUILDINGS;

export function parseRoofWitnessBuilding(value: string | null): RoofWitnessBuilding {
  return value !== null && value in ROOF_WITNESS_BUILDINGS
    ? (value as RoofWitnessBuilding)
    : "house";
}

export function buildBuildingRoofMap(building: RoofWitnessBuilding): MapData {
  const size = 16;
  const grass = GRASS_SLOTS[0];
  if (grass === undefined) throw new Error("tileset has no ground slot");
  let ground = paintRectAutotile(
    emptyLayer(size, size),
    TINY_SWORDS_TILESET,
    grass,
    0,
    0,
    size - 1,
    size - 1,
  );
  let layers: TileLayer[] = [ground, emptyLayer(size, size), emptyLayer(size, size)];
  const witness = ROOF_WITNESS_BUILDINGS[building];

  // The building stands on level 0 immediately north of a broad level-2/3 floor. The hero starts
  // on that floor and jumps north over the threshold: exactly the comparison requested against a
  // normal elevated terrain surface, with no debug teleport onto the roof.
  for (let row = size / 2; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      layers = paintElevation(layers, TINY_SWORDS_TILESET, witness.tier, col, row);
    }
  }
  ground = layers[0] ?? ground;

  return {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: size,
    rows: size,
    layers: [ground, ...layers.slice(1)].slice(0, MAP_LAYERS),
    elements: [
      {
        col: 7,
        row: 7,
        offsetX: 0,
        offsetY: 0,
        assetId: witness.assetId as EditorAssetId,
      },
    ],
    spawn: { col: 7, row: 8 },
    markers: EMPTY_MARKERS,
  };
}
