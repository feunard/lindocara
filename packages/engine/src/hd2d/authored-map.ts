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
import { TILE_SIZE } from "../tilemap.js";
import { decodeTileId } from "../tileset.js";
import { elevationOfSlot } from "../tilesets/tiny-swords.js";
import type { MapData } from "./map-data.js";

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

/** Compile one validated editor map and its full authored event documents into heightfield bytes. */
export function compileAuthoredMap(
  authored: AuthoredMapData,
  events: readonly MapEvent[] = [],
): MapData {
  const size = Math.max(authored.cols, authored.rows);
  const cells = size * size;
  const levels: Array<number | null> = new Array<number | null>(cells).fill(null);
  const materials = new Array<"herbe">(cells).fill("herbe");
  const ground = authored.layers[0];

  for (let row = 0; row < authored.rows; row += 1) {
    for (let col = 0; col < authored.cols; col += 1) {
      levels[row * size + col] = authoredLevel(ground?.ids[row * authored.cols + col] ?? 0);
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
    return rect
      ? [
          {
            x: groundCoordinate(rect.x, size),
            z: groundCoordinate(rect.y, size),
            w: rect.width / TILE_SIZE,
            h: rect.height / TILE_SIZE,
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
