/**
 * One-way authoring compiler: the dense tile-editor document becomes the heightfield document the
 * game stores, validates, collides against and renders.
 *
 * This is deliberately not a runtime fallback. Creator tools and bundle importers call it before
 * writing a map; a world room still refuses a row whose `heightfield` column is absent. Keeping the
 * crossing here gives the editor its mature brush/event model without teaching the shipped client
 * about the retired Pixi/tile render path.
 */

import { isNativeHarvestAsset } from "../harvest-presets.js";
import {
  type MapData as AuthoredMapData,
  ELEMENT_OFFSET_PX,
  elementCells,
  elementWorldCollider,
  type MapElement,
} from "../map-data.js";
import type { MapEvent } from "../map-events.js";
import {
  type StairsDirection,
  type StairsLowLevel,
  stairsDescriptor,
  stairsTilePlacements,
} from "../tile-brush.js";
import { TILE_SIZE } from "../tilemap.js";
import { decodeTileId, fixedId } from "../tileset.js";
import { elevationOfSlot, materialOfSlot } from "../tilesets/tiny-swords.js";
import { editorAsset, editorAssetCollisionElevation } from "../tiny-swords-catalog.js";
import type { ColliderRect } from "./collider-index.js";
import type { MapData } from "./map-data.js";
import type { TerrainMaterial, TerrainRamp } from "./terrain-query.js";

export const AUTHORED_LEVEL_HEIGHT = 0.9;
export const AUTHORED_WATER_LEVEL = -0.05;
const BRIDGE_RAIL_THICKNESS = 0.11;

function groundCoordinate(pixels: number, size: number): number {
  return pixels / TILE_SIZE - size / 2;
}

/** Project an authored decor anchor onto the HD-2D ground.
 *
 * The element's stored cell is its visual footprint cell: its foot is centred on X and planted on
 * the cell's lower Z edge before quarter-cell offsets are applied. The compiler and the editor's
 * hover/selection overlays must share this projection or the prop jumps when it is committed. */
export function authoredElementGroundPoint(
  element: Pick<MapElement, "col" | "row" | "offsetX" | "offsetY">,
  size: number,
): { x: number; z: number } {
  return {
    x: element.col + 0.5 + (element.offsetX * ELEMENT_OFFSET_PX) / TILE_SIZE - size / 2,
    z: element.row + 1 + (element.offsetY * ELEMENT_OFFSET_PX) / TILE_SIZE - size / 2,
  };
}

function authoredLevel(id: number): number | null {
  const tile = decodeTileId(id);
  if (tile.kind === "empty") return null;
  if (tile.kind === "autotile") {
    const elevation = elevationOfSlot(tile.slot);
    return elevation < 0 ? 0 : elevation;
  }
  // Fixed ground art is uncommon (ramps live on the wall layer), but a valid fixed tile is land,
  // never an invisible hole. Its supporting elevation remains the ground layer's base level.
  return 0;
}

function authoredMaterial(id: number): TerrainMaterial {
  const tile = decodeTileId(id);
  return tile.kind === "autotile" ? materialOfSlot(tile.slot) : "herbe";
}

/** Whether an authored editor cell compiles to open water in the shipped heightfield. */
export function isAuthoredWaterCell(
  authored: Pick<AuthoredMapData, "cols" | "rows" | "layers">,
  col: number,
  row: number,
): boolean {
  if (col < 0 || row < 0 || col >= authored.cols || row >= authored.rows) return false;
  const ground = authored.layers[0];
  return authoredLevel(ground?.ids[row * authored.cols + col] ?? 0) === null;
}

/** The world-space ramp both committed stairs and the editor's pointer ghost use. */
export function authoredStairsRamp(
  col: number,
  row: number,
  size: number,
  direction: StairsDirection,
  lowLevel: StairsLowLevel,
): TerrainRamp {
  const parts = stairsTilePlacements(direction, lowLevel);
  const minCol = Math.min(...parts.map((part) => col + part.col));
  const maxCol = Math.max(...parts.map((part) => col + part.col));
  const minRow = Math.min(...parts.map((part) => row + part.row));
  const maxRow = Math.max(...parts.map((part) => row + part.row));
  return {
    x: minCol - size / 2,
    z: minRow - size / 2,
    width: maxCol - minCol + 1,
    depth: maxRow - minRow + 1,
    direction,
    lowLevel,
  };
}

function authoredRamps(authored: AuthoredMapData, size: number): TerrainRamp[] {
  const walls = authored.layers[1];
  if (!walls) return [];
  const ramps: TerrainRamp[] = [];
  for (let row = 0; row < authored.rows; row += 1) {
    for (let col = 0; col < authored.cols; col += 1) {
      const ref = decodeTileId(walls.ids[row * authored.cols + col] ?? 0);
      if (ref.kind !== "fixed") continue;
      const descriptor = stairsDescriptor(ref.index);
      if (descriptor?.part !== "low") continue;
      const complete = stairsTilePlacements(descriptor.direction, descriptor.lowLevel).every(
        (part) =>
          walls.ids[(row + part.row) * authored.cols + col + part.col] === fixedId(part.fixedIndex),
      );
      if (!complete) continue;
      ramps.push(authoredStairsRamp(col, row, size, descriptor.direction, descriptor.lowLevel));
    }
  }
  return ramps;
}

function bridgeTop(
  authored: Pick<AuthoredMapData, "cols" | "rows">,
  element: MapElement,
  levels: readonly (number | null)[],
  size: number,
): number {
  const footprint = elementCells(element);
  const occupied = new Set(footprint.map((cell) => `${cell.col}:${cell.row}`));
  const counts = new Map<number, number>();
  for (const cell of footprint) {
    for (const [dc, dr] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const col = cell.col + dc;
      const row = cell.row + dr;
      if (col < 0 || row < 0 || col >= authored.cols || row >= authored.rows) continue;
      if (occupied.has(`${col}:${row}`)) continue;
      const level = levels[row * size + col] ?? null;
      if (level !== null) counts.set(level, (counts.get(level) ?? 0) + 1);
    }
  }
  const level = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  return level * AUTHORED_LEVEL_HEIGHT;
}

function bridgeRails(
  collider: { x: number; z: number; w: number; h: number },
  deckTop: number,
): ColliderRect[] {
  const top = deckTop + AUTHORED_LEVEL_HEIGHT;
  if (collider.w > collider.h) {
    return [
      { x: collider.x, z: collider.z, w: collider.w, h: BRIDGE_RAIL_THICKNESS, top },
      {
        x: collider.x,
        z: collider.z + collider.h - BRIDGE_RAIL_THICKNESS,
        w: collider.w,
        h: BRIDGE_RAIL_THICKNESS,
        top,
      },
    ];
  }
  return [
    { x: collider.x, z: collider.z, w: BRIDGE_RAIL_THICKNESS, h: collider.h, top },
    {
      x: collider.x + collider.w - BRIDGE_RAIL_THICKNESS,
      z: collider.z,
      w: BRIDGE_RAIL_THICKNESS,
      h: collider.h,
      top,
    },
  ];
}

function elementBaseTop(
  element: Pick<MapElement, "col" | "row">,
  levels: readonly (number | null)[],
  size: number,
): number {
  const level = levels[element.row * size + element.col] ?? null;
  return level === null ? AUTHORED_WATER_LEVEL : level * AUTHORED_LEVEL_HEIGHT;
}

/**
 * Compile one authored scenery footprint into finite world volumes. Every finite volume exposes a
 * walkable upper surface, including pitched-roof buildings: visual slope never changes the
 * discrete elevation rule used by movement.
 */
export function authoredElementColliders(
  authored: Pick<AuthoredMapData, "cols" | "rows">,
  element: MapElement,
  levels: readonly (number | null)[],
  size: number,
): ColliderRect[] {
  const rect = elementWorldCollider(element);
  const asset = editorAsset(element.assetId);
  if (!rect) return [];
  const collider = {
    x: groundCoordinate(rect.x, size),
    z: groundCoordinate(rect.y, size),
    w: rect.width / TILE_SIZE,
    h: rect.height / TILE_SIZE,
  };
  if (asset?.editor.terrainOverride === "walkable") {
    const top = bridgeTop(authored, element, levels, size);
    return [{ ...collider, top }, ...bridgeRails(collider, top)];
  }
  const elevation = asset ? editorAssetCollisionElevation(asset) : null;
  return elevation === null
    ? [collider]
    : [
        {
          ...collider,
          top: elementBaseTop(element, levels, size) + elevation * AUTHORED_LEVEL_HEIGHT,
        },
      ];
}

/** Compile one validated editor map and its full authored event documents into heightfield bytes. */
export function compileAuthoredMap(
  authored: AuthoredMapData,
  events: readonly MapEvent[] = [],
): MapData {
  const size = Math.max(authored.cols, authored.rows);
  const cells = size * size;
  const levels: Array<number | null> = new Array<number | null>(cells).fill(null);
  const materials = new Array<TerrainMaterial>(cells).fill("herbe");
  const ground = authored.layers[0];

  for (let row = 0; row < authored.rows; row += 1) {
    for (let col = 0; col < authored.cols; col += 1) {
      const index = row * size + col;
      const id = ground?.ids[row * authored.cols + col] ?? 0;
      levels[index] = authoredLevel(id);
      materials[index] = authoredMaterial(id);
    }
  }

  // Native resources are live world events: keeping a static copy here would draw the intact asset
  // over its depleted state and leave an immortal collider behind after harvesting.
  const staticElements = authored.elements.filter(
    (element) => !isNativeHarvestAsset(element.assetId),
  );
  const elements = staticElements.map((element) => ({
    assetId: element.assetId,
    ...authoredElementGroundPoint(element, size),
    ...(element.orientation ? { orientation: element.orientation } : {}),
  }));

  const colliders = staticElements.flatMap((element) =>
    authoredElementColliders(authored, element, levels, size),
  );

  return {
    version: 1,
    environment: authored.environment ?? "exterior",
    size,
    levelHeight: AUTHORED_LEVEL_HEIGHT,
    waterLevel: AUTHORED_WATER_LEVEL,
    levels,
    materials,
    ramps: authoredRamps(authored, size),
    colliders,
    spawns: [
      {
        name: "default",
        x: authored.spawn.col + 0.5 - size / 2,
        z: authored.spawn.row + 0.5 - size / 2,
      },
    ],
    elements,
    events: events.map((event) => ({
      id: event.id,
      x: event.col + 0.5 - size / 2,
      z: event.row + 0.5 - size / 2,
      graphicAssetId: event.pages[0]?.graphicAssetId ?? null,
    })),
  };
}
