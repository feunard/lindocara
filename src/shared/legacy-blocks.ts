/**
 * TEMPORARY BRIDGE — delete when Task 9 (`server/maps.ts` storage) and Task 11 (renderer/editor)
 * land.
 *
 * `MapData` is layers now, but the D1 `map.blocks` column, `MapInput` and the editor's `EditorMap`
 * still speak the two-character block grid. Rather than let two of them grow their own private
 * projection — the exact duplication that makes collision unfixable — there is one, here, and it is
 * marked for removal.
 *
 * The projection is deliberately collision-preserving and nothing more: `.` is the flat grass
 * autotile (passable), `#` is the empty cell (which `bakeCollision` reads as the void, i.e. water).
 * Going back the other way keeps only the ground layer's emptiness, so anything authored on layers
 * 1 and 2 is lost — which is precisely the loss Task 9 exists to remove.
 */
import type { MapData, MapElement, MapMarkers } from "./map-data.js";
import { emptyLayer, type TileLayer } from "./tile-layer-codec.js";
import { autotileId, EMPTY_TILE } from "./tileset.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET_ID } from "./tilesets/tiny-swords.js";

const GRASS_ID = autotileId(GRASS_SLOTS[0], 0);

export function groundLayerFromBlocks(blocks: readonly string[]): TileLayer {
  const rows = blocks.length;
  const cols = blocks[0]?.length ?? 0;
  const ids = new Array<number>(cols * rows).fill(EMPTY_TILE);
  for (let row = 0; row < rows; row += 1) {
    const line = blocks[row] ?? "";
    for (let col = 0; col < cols; col += 1) {
      if (line[col] === ".") ids[row * cols + col] = GRASS_ID;
    }
  }
  return { cols, rows, ids };
}

export function mapDataFromBlocks(input: {
  blocks: readonly string[];
  elements: readonly MapElement[];
  spawn: { col: number; row: number };
  markers?: MapMarkers | undefined;
}): MapData {
  const ground = groundLayerFromBlocks(input.blocks);
  const base = {
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: ground.cols,
    rows: ground.rows,
    layers: [ground, emptyLayer(ground.cols, ground.rows), emptyLayer(ground.cols, ground.rows)],
    elements: input.elements,
    spawn: input.spawn,
  };
  return input.markers ? { ...base, markers: input.markers } : base;
}

/** Lossy inverse: only the ground layer's occupancy survives. */
export function blocksFromMapData(data: MapData): string[] {
  const ground = data.layers[0];
  const blocks: string[] = [];
  for (let row = 0; row < data.rows; row += 1) {
    let line = "";
    for (let col = 0; col < data.cols; col += 1) {
      const id = ground?.ids[row * data.cols + col] ?? EMPTY_TILE;
      line += id === EMPTY_TILE ? "#" : ".";
    }
    blocks.push(line);
  }
  return blocks;
}
