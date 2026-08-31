import { buildingArchetype, buildingDoorFacadeRatio } from "./buildings.js";
import type { MapElement } from "./map-data.js";
import type { InteriorShellStyle } from "./map-environment.js";
import { defaultEventPage, type MapEvent } from "./map-events.js";
import { layersFromBlocks } from "./map-migrate.js";
import { defaultMapInput, type MapInput } from "./map-template.js";
import { paintTerrain } from "./tile-brush.js";
import { TINY_SWORDS_TILESET } from "./tilesets/tiny-swords.js";
import { type EditorAssetId, LINDOCARA_INTERIOR_ASSET_IDS } from "./tiny-swords-catalog.js";

export const BUILDING_INTERIOR_COLS = 20;
export const BUILDING_INTERIOR_ROWS = 15;

export interface BuildingInteriorOptions {
  name: string;
  exteriorMapId: string;
  exitEventId: string;
  returnCol: number;
  returnRow: number;
  buildingAssetId: string;
}

function prop(
  assetId: EditorAssetId,
  col: number,
  row: number,
  offsetX = 0,
  offsetY = 0,
): MapElement {
  return { assetId, col, row, offsetX, offsetY };
}

/** A useful editable room per exterior family. Every item is an ordinary map element. */
function themedInteriorElements(buildingAssetId: string): MapElement[] {
  const kind = buildingArchetype(buildingAssetId) ?? "house";
  const { hearth, bed, table, cupboard, rug } = LINDOCARA_INTERIOR_ASSET_IDS;
  const common = [prop(rug, 10, 7), prop(table, 11, 7, 1), prop(cupboard, 16, 3)];
  switch (kind) {
    case "barracks":
    case "training-a":
    case "training-b":
      return [...common, prop(bed, 4, 4), prop(bed, 4, 9), prop(bed, 7, 4), prop(bed, 7, 9)];
    case "archery":
      return [...common, prop(cupboard, 3, 3), prop(table, 5, 7)];
    case "tower":
    case "windmill":
      return [...common, prop(hearth, 3, 4), prop(bed, 4, 9)];
    case "monastery":
    case "community-a":
    case "community-b":
      return [...common, prop(hearth, 3, 4), prop(rug, 10, 4), prop(rug, 10, 10)];
    case "castle":
    case "command-a":
    case "command-b":
      return [...common, prop(hearth, 3, 4), prop(cupboard, 3, 9), prop(rug, 10, 4)];
    case "house":
    case "housing-a":
    case "housing-b":
    case "daily-life-a":
    case "daily-life-b":
      return [...common, prop(hearth, 3, 4), prop(bed, 4, 9)];
  }
}

function interiorShellStyle(buildingAssetId: string): InteriorShellStyle {
  const kind = buildingArchetype(buildingAssetId) ?? "house";
  switch (kind) {
    case "barracks":
    case "castle":
    case "command-a":
    case "command-b":
    case "monastery":
    case "tower":
    case "training-a":
    case "training-b":
      return "castle";
    case "archery":
    case "community-a":
    case "community-b":
    case "daily-life-a":
    case "daily-life-b":
    case "house":
    case "housing-a":
    case "housing-b":
    case "windmill":
      return "timber";
  }
}

function interiorDoorAsset(style: InteriorShellStyle): EditorAssetId {
  return style === "castle"
    ? LINDOCARA_INTERIOR_ASSET_IDS.doorStone
    : LINDOCARA_INTERIOR_ASSET_IDS.doorTimber;
}

/** Mirror the exterior facade's lateral door position across this room's editable front wall. */
function interiorDoorCol(buildingAssetId: string): number {
  const centre = Math.floor(BUILDING_INTERIOR_COLS / 2);
  const usableWidth = BUILDING_INTERIOR_COLS - 2;
  return Math.max(
    1,
    Math.min(
      BUILDING_INTERIOR_COLS - 2,
      Math.round(centre + buildingDoorFacadeRatio(buildingAssetId) * usableWidth),
    ),
  );
}

/**
 * An interior is an ordinary authored map with a useful starter layout. Authors can repaint every
 * tile, move/delete every prop and edit the return event with the existing tools.
 */
export function createBuildingInteriorInput(options: BuildingInteriorOptions): MapInput {
  const base = defaultMapInput(options.name, BUILDING_INTERIOR_COLS, BUILDING_INTERIOR_ROWS);
  const shellStyle = interiorShellStyle(options.buildingAssetId);
  // `#` is an empty ground cell. In an interior heightfield it becomes black void rather than sea;
  // the one-cell frame therefore closes the room without drawing exterior cliffs or water.
  let layers = layersFromBlocks(
    Array.from({ length: BUILDING_INTERIOR_ROWS }, (_, row) =>
      row === 0 || row === BUILDING_INTERIOR_ROWS - 1
        ? "#".repeat(BUILDING_INTERIOR_COLS)
        : `#${".".repeat(BUILDING_INTERIOR_COLS - 2)}#`,
    ),
  ).layers;
  for (let row = 1; row < BUILDING_INTERIOR_ROWS - 1; row += 1) {
    for (let col = 1; col < BUILDING_INTERIOR_COLS - 1; col += 1) {
      layers = paintTerrain(layers, TINY_SWORDS_TILESET, "sable", 0, col, row);
    }
  }

  const doorCol = interiorDoorCol(options.buildingAssetId);
  const doorRow = BUILDING_INTERIOR_ROWS - 2;
  const exit: MapEvent = {
    id: options.exitEventId,
    col: doorCol,
    row: doorRow,
    name: "Sortie",
    ordinal: 1,
    showMarker: false,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [
      {
        ...defaultEventPage(),
        graphicAssetId: interiorDoorAsset(shellStyle),
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
    environment: "interior",
    interiorShell: { style: shellStyle },
    layers,
    spawn: { col: doorCol, row: doorRow - 1 },
    elements: themedInteriorElements(options.buildingAssetId),
    events: [exit],
    dayNightCycle: false,
    fixedLighting: "day",
  };
}
