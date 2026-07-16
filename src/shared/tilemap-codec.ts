/** One character per cell, in both directions. Kept apart from tilemap.ts so the pure model has no
 *  knowledge of how it happens to be stored — on disk, in D1, or on the wire. */
import { TILE_KINDS, type TileKind, type TileMap } from "./tilemap.js";

const KIND: Record<string, TileKind> = {
  ".": "grass",
  "^": "plateau",
  T: "forest",
  B: "building",
  "#": "water",
  "=": "bridge",
};

const CHAR: Record<TileKind, string> = {
  grass: ".",
  plateau: "^",
  forest: "T",
  building: "B",
  water: "#",
  bridge: "=",
};

/** Every kind must round-trip, or a map re-read is quietly a different map. `TILE_KINDS` is the
 *  list; a new kind with no character fails here rather than at whatever reads the map next. */
for (const kind of TILE_KINDS) {
  if (CHAR[kind] === undefined) throw new Error(`tile kind "${kind}" has no character`);
}

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

/** The inverse. A 75x43 map is 3,225 characters — small enough to put in a welcome. */
export function encodeTileMap(tiles: TileMap): string[] {
  const rows: string[] = [];
  for (let row = 0; row < tiles.rows; row++) {
    let line = "";
    for (let col = 0; col < tiles.cols; col++) {
      const kind = tiles.kinds[row * tiles.cols + col];
      // A hole in the array is not a cell we can guess at; water is the one kind that is safe to be
      // wrong about, because it is solid and nobody can stand in the mistake.
      line += kind === undefined ? "#" : CHAR[kind];
    }
    rows.push(line);
  }
  return rows;
}

/**
 * Decodes without throwing.
 *
 * `decodeTileMap` throws — correctly, on a map read from disk, where a ragged row is a build bug.
 * A map arriving over the wire is different: a truncated or hostile frame must be dropped like any
 * other malformed message, not crash the first paint.
 */
export function parseTileMap(value: unknown): TileMap | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first: unknown = value[0];
  if (typeof first !== "string" || first.length === 0) return null;
  const cols = first.length;
  for (const row of value) {
    if (typeof row !== "string" || row.length !== cols) return null;
    for (const char of row) if (KIND[char] === undefined) return null;
  }
  return decodeTileMap(value as string[]);
}
