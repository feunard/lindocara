import { defaultEventPage, type MapEvent } from "./map-events.js";
import { defaultMapInput, type MapInput } from "./map-template.js";
import { paintTerrain } from "./tile-brush.js";
import { TINY_SWORDS_TILESET } from "./tilesets/tiny-swords.js";
import type { EditorAssetId } from "./tiny-swords-catalog.js";

export const BUILDING_INTERIOR_COLS = 20;
export const BUILDING_INTERIOR_ROWS = 15;

const CAMPFIRE = "decoration.lindocara-lab.campfire" as EditorAssetId;
const SMALL_DECOR = [
  "decoration.deco.01",
  "decoration.deco.04",
  "decoration.deco.08",
  "decoration.deco.12",
] as const satisfies readonly EditorAssetId[];
const EXIT_SIGN = "decoration.deco.17" as EditorAssetId;

export interface BuildingInteriorOptions {
  name: string;
  exteriorMapId: string;
  exitEventId: string;
  returnCol: number;
  returnRow: number;
}

/**
 * An interior is an ordinary authored map with a useful starter layout. Authors can repaint every
 * tile, move/delete every prop and edit the return event with the existing tools.
 */
export function createBuildingInteriorInput(options: BuildingInteriorOptions): MapInput {
  const base = defaultMapInput(options.name, BUILDING_INTERIOR_COLS, BUILDING_INTERIOR_ROWS);
  let layers = [...base.layers];
  for (let row = 0; row < BUILDING_INTERIOR_ROWS; row += 1) {
    for (let col = 0; col < BUILDING_INTERIOR_COLS; col += 1) {
      layers = paintTerrain(layers, TINY_SWORDS_TILESET, "sable", 0, col, row);
    }
  }
  // A raised perimeter reads as an enclosed room and compiles through the same cliff collision as
  // every exterior map. The southern interaction sign remains one cell inside that perimeter.
  for (let col = 0; col < BUILDING_INTERIOR_COLS; col += 1) {
    layers = paintTerrain(layers, TINY_SWORDS_TILESET, "sable", 1, col, 0);
    layers = paintTerrain(layers, TINY_SWORDS_TILESET, "sable", 1, col, BUILDING_INTERIOR_ROWS - 1);
  }
  for (let row = 1; row < BUILDING_INTERIOR_ROWS - 1; row += 1) {
    layers = paintTerrain(layers, TINY_SWORDS_TILESET, "sable", 1, 0, row);
    layers = paintTerrain(layers, TINY_SWORDS_TILESET, "sable", 1, BUILDING_INTERIOR_COLS - 1, row);
  }

  const centre = Math.floor(BUILDING_INTERIOR_COLS / 2);
  const exit: MapEvent = {
    id: options.exitEventId,
    col: centre,
    row: BUILDING_INTERIOR_ROWS - 3,
    name: "Sortie",
    ordinal: 1,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [
      {
        ...defaultEventPage(),
        graphicAssetId: EXIT_SIGN,
        trigger: "action",
        commands: [
          {
            t: "teleport",
            mapId: options.exteriorMapId,
            col: options.returnCol,
            row: options.returnRow,
            category: "interior",
          },
        ],
      },
    ],
  };

  return {
    ...base,
    layers,
    spawn: { col: centre, row: BUILDING_INTERIOR_ROWS - 4 },
    elements: [
      { col: centre, row: 6, offsetX: 0, offsetY: 0, assetId: CAMPFIRE },
      ...SMALL_DECOR.map((assetId, index) => ({
        col: index % 2 === 0 ? 4 : BUILDING_INTERIOR_COLS - 5,
        row: index < 2 ? 4 : 9,
        offsetX: 0,
        offsetY: 0,
        assetId,
      })),
    ],
    events: [exit],
    dayNightCycle: false,
    fixedLighting: "day",
  };
}
