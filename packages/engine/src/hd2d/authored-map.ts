/**
 * One-way authoring compiler: the dense tile-editor document becomes the heightfield document the
 * game stores, validates, collides against and renders.
 *
 * This is deliberately not a runtime fallback. Creator tools and bundle importers call it before
 * writing a map; a world room still refuses a row whose `heightfield` column is absent. Keeping the
 * crossing here gives the editor its mature brush/event model without teaching the shipped client
 * about the retired Pixi/tile render path.
 */

import {
  type MapData as AuthoredMapData,
  ELEMENT_OFFSET_PX,
  elementWorldCollider,
} from "../map-data.js";
import type { MapEvent } from "../map-events.js";
import { editorAsset } from "../tiny-swords-catalog.js";
import {
  type StairsDirection,
  type StairsLowLevel,
  stairsDescriptor,
  stairsTilePlacements,
} from "../tile-brush.js";
import { TILE_SIZE } from "../tilemap.js";
import { decodeTileId, fixedId } from "../tileset.js";
import { elevationOfSlot, materialOfSlot } from "../tilesets/tiny-swords.js";
import type { MapData } from "./map-data.js";
import type { TerrainMaterial, TerrainRamp } from "./terrain-query.js";

export const AUTHORED_LEVEL_HEIGHT = 0.9;
export const AUTHORED_WATER_LEVEL = -0.05;

function groundCoordinate(pixels: number, size: number): number {
  return pixels / TILE_SIZE - size / 2;
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

  const elements = authored.elements.map((element) => ({
    assetId: element.assetId,
    // The old renderer planted art at its visible foot: cell centre on x, cell bottom on z, plus
    // quarter-cell offsets. Static HD-2D billboards use the same foot convention.
    x: element.col + 0.5 + (element.offsetX * ELEMENT_OFFSET_PX) / TILE_SIZE - size / 2,
    z: element.row + 1 + (element.offsetY * ELEMENT_OFFSET_PX) / TILE_SIZE - size / 2,
  }));

  const colliders = authored.elements.flatMap((element) => {
    const rect = elementWorldCollider(element);
    const asset = editorAsset(element.assetId);
    const level = levels[element.row * size + element.col] ?? null;
    const base = level === null ? AUTHORED_WATER_LEVEL : level * AUTHORED_LEVEL_HEIGHT;
    return rect
      ? [
          {
            x: groundCoordinate(rect.x, size),
            z: groundCoordinate(rect.y, size),
            w: rect.width / TILE_SIZE,
            h: rect.height / TILE_SIZE,
            ...(asset?.editor.category === "buildings"
              ? { top: base + AUTHORED_LEVEL_HEIGHT }
              : {}),
          },
        ]
      : [];
  });

  return {
    version: 1,
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
