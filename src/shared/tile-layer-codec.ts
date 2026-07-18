/**
 * One layer of tile ids, run-length encoded.
 *
 * Ids run past 255, so the one-character-per-cell encoding `blocks` used cannot carry them. Runs
 * were chosen over base64 because a map is mostly long uniform stretches — and because a run string
 * stays readable in a D1 row and in a failing test's output, which base64 does not.
 */
import { EMPTY_TILE } from "./tileset.js";

export interface TileLayer {
  cols: number;
  rows: number;
  /** Row-major, `cols * rows` entries. */
  ids: readonly number[];
}

/** The largest cell count any layer may claim, matching the map size cap in `server/maps.ts`. */
const MAX_CELLS = 100 * 100;

export function emptyLayer(cols: number, rows: number): TileLayer {
  return { cols, rows, ids: new Array<number>(cols * rows).fill(EMPTY_TILE) };
}

export function encodeTileLayer(layer: TileLayer): string {
  const runs: string[] = [];
  let index = 0;
  while (index < layer.ids.length) {
    const id = layer.ids[index] ?? EMPTY_TILE;
    let length = 1;
    while (index + length < layer.ids.length && layer.ids[index + length] === id) length += 1;
    runs.push(length === 1 ? String(id) : `${id}*${length}`);
    index += length;
  }
  return runs.join(",");
}

/** Throws. For content read at build time, where a malformed layer is a build bug. */
export function decodeTileLayer(text: string, cols: number, rows: number): TileLayer {
  const layer = parseTileLayer(text, cols, rows);
  if (!layer) throw new Error(`malformed tile layer for ${cols}x${rows}`);
  return layer;
}

/**
 * Never throws. A layer arriving over the wire or out of a database row is untrusted like any
 * other payload: a bad one is dropped, not a crash on the first paint.
 */
export function parseTileLayer(value: unknown, cols: number, rows: number): TileLayer | null {
  if (typeof value !== "string") return null;
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows)) return null;
  if (cols <= 0 || rows <= 0 || cols * rows > MAX_CELLS) return null;
  const expected = cols * rows;
  const ids: number[] = [];
  for (const run of value.split(",")) {
    const star = run.indexOf("*");
    const idText = star === -1 ? run : run.slice(0, star);
    const countText = star === -1 ? "1" : run.slice(star + 1);
    if (!/^\d+$/.test(idText) || !/^\d+$/.test(countText)) return null;
    const id = Number(idText);
    const count = Number(countText);
    if (count < 1 || ids.length + count > expected) return null;
    for (let step = 0; step < count; step += 1) ids.push(id);
  }
  if (ids.length !== expected) return null;
  return { cols, rows, ids };
}
