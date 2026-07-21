/**
 * Old maps, once.
 *
 * `blocks` only ever held `.` and `#`: the parser rejected everything else, and `forest` and
 * `building` were baked from elements rather than authored. So water becomes an empty ground cell
 * and everything else becomes flat grass, and the mapping needs no special cases.
 *
 * The variant is resolved by the same brush the editor paints with, so a migrated map is
 * indistinguishable from one drawn by hand.
 */
import { resolveWholeLayer } from "./tile-brush.js";
import { emptyLayer, type TileLayer } from "./tile-layer-codec.js";
import { autotileId } from "./tileset.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET } from "./tilesets/tiny-swords.js";

const WATER = "#";

export function layersFromBlocks(blocks: readonly string[]): {
  cols: number;
  rows: number;
  layers: TileLayer[];
} {
  const cols = blocks[0]?.length ?? 0;
  const rows = blocks.length;
  const ground = emptyLayer(cols, rows);
  const ids = [...ground.ids];
  const grass = GRASS_SLOTS[0];
  for (let row = 0; row < rows; row += 1) {
    const line = blocks[row] ?? "";
    for (let col = 0; col < cols; col += 1) {
      if (line[col] === WATER) continue;
      // Variant 0 for now; the whole-layer pass below resolves every edge in one sweep, which is
      // cheaper and simpler than re-resolving neighbours cell by cell.
      ids[row * cols + col] = autotileId(grass, 0);
    }
  }
  const resolved = resolveWholeLayer({ cols, rows, ids }, TINY_SWORDS_TILESET);
  return { cols, rows, layers: [resolved, emptyLayer(cols, rows), emptyLayer(cols, rows)] };
}
