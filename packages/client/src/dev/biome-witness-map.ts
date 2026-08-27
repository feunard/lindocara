/** Deterministic side-by-side witness for generated terrain and authored interior shells. */
import { EMPTY_MARKERS, MAP_LAYERS, type MapData } from "@lindocara/engine/map-data.js";
import { paintTerrain } from "@lindocara/engine/tile-brush.js";
import { emptyLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import {
  TINY_SWORDS_TILESET,
  TINY_SWORDS_TILESET_ID,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import { LINDOCARA_STRUCTURE_ASSET_IDS } from "@lindocara/engine/tiny-swords-catalog.js";

export function buildBiomeWitnessMap(): MapData {
  const cols = 28;
  const rows = 20;
  let layers: TileLayer[] = Array.from({ length: MAP_LAYERS }, () => emptyLayer(cols, rows));
  const materials = ["grotte", "montagne", "volcan", "lave"] as const;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const material = materials[Math.min(materials.length - 1, Math.floor(col / 7))] ?? "grotte";
      const localCol = col % 7;
      const level =
        row <= 3 && localCol >= 1 && localCol <= 5
          ? 2
          : row <= 7 && localCol >= 1 && localCol <= 5
            ? 1
            : row >= 16 && localCol >= 2 && localCol <= 4
              ? -1
              : 0;
      layers = paintTerrain(layers, TINY_SWORDS_TILESET, material, level, col, row);
    }
  }
  return {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols,
    rows,
    layers,
    elements: [
      {
        col: 4,
        row: 14,
        offsetX: 0,
        offsetY: 0,
        assetId: LINDOCARA_STRUCTURE_ASSET_IDS.caveWall,
        rotation: 12,
        dimensions: { width: 3, depth: 0.8 },
      },
      {
        col: 10,
        row: 14,
        offsetX: 0,
        offsetY: 0,
        assetId: LINDOCARA_STRUCTURE_ASSET_IDS.castleWall,
        rotation: 348,
        dimensions: { width: 3, depth: 0.75 },
      },
      {
        col: 16,
        row: 14,
        offsetX: 0,
        offsetY: 0,
        assetId: LINDOCARA_STRUCTURE_ASSET_IDS.timberWall,
        rotation: 6,
        dimensions: { width: 3, depth: 0.7 },
      },
      {
        col: 4,
        row: 10,
        offsetX: 0,
        offsetY: 0,
        assetId: LINDOCARA_STRUCTURE_ASSET_IDS.caveCeiling,
        dimensions: { width: 3, depth: 3 },
      },
      {
        col: 10,
        row: 10,
        offsetX: 0,
        offsetY: 0,
        assetId: LINDOCARA_STRUCTURE_ASSET_IDS.castleCeiling,
        dimensions: { width: 3, depth: 3 },
      },
      {
        col: 16,
        row: 10,
        offsetX: 0,
        offsetY: 0,
        assetId: LINDOCARA_STRUCTURE_ASSET_IDS.timberCeiling,
        dimensions: { width: 3, depth: 3 },
      },
    ],
    spawn: { col: 2, row: 12 },
    markers: EMPTY_MARKERS,
  };
}
