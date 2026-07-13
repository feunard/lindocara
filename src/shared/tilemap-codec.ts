/** Decodes the one-char-per-cell rows that `scripts/build-map.ts` emits. Kept apart from
 *  tilemap.ts so the pure model has no knowledge of how it happens to be stored. */
import type { TileKind, TileMap } from "./tilemap.js";

const KIND: Record<string, TileKind> = {
  ".": "grass",
  "^": "plateau",
  "#": "water",
  "=": "bridge",
};

export function decodeTileMap(rows: readonly string[]): TileMap {
  const first = rows[0];
  if (first === undefined) throw new Error("tile map has no rows");
  const cols = first.length;
  const kinds: TileKind[] = [];
  for (const row of rows) {
    if (row.length !== cols) throw new Error(`ragged tile map: expected ${cols} columns`);
    for (const char of row) {
      const kind = KIND[char];
      if (kind === undefined) throw new Error(`unknown tile character: ${char}`);
      kinds.push(kind);
    }
  }
  return { cols, rows: rows.length, kinds };
}
