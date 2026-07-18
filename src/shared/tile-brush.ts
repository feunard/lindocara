/**
 * Painting, as pure functions over a layer.
 *
 * The variant is frozen at paint time — that is what lets an author override a single tile, and it
 * is also the design's one hazard: a cell whose neighbour changed but which was never re-resolved
 * keeps a stale edge forever. Every write here therefore re-resolves the four orthogonal
 * neighbours, and `resolveWholeLayer` exists so a test can assert that incremental painting and a
 * full recomputation never disagree.
 *
 * A fixed tile is never re-resolved: it is a hand placement, and the whole point of the fallback is
 * that the brush does not get to overrule it.
 */
import { edge16Mask, run4Mask, type SameNeighbour } from "./autotile.js";
import type { TileLayer } from "./tile-layer-codec.js";
import { autotileId, decodeTileId, EMPTY_TILE, type Tileset } from "./tileset.js";

function indexOf(layer: TileLayer, col: number, row: number): number {
  return row * layer.cols + col;
}

function inBounds(layer: TileLayer, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < layer.cols && row < layer.rows;
}

/** Which autotile slot occupies a cell, or -1 for empty, out of bounds, or a fixed tile. */
export function slotAt(layer: TileLayer, col: number, row: number): number {
  if (!inBounds(layer, col, row)) return -1;
  const ref = decodeTileId(layer.ids[indexOf(layer, col, row)] ?? EMPTY_TILE);
  return ref.kind === "autotile" ? ref.slot : -1;
}

/** The id a cell should hold given its neighbourhood, or null when it is not ours to decide. */
function resolvedId(layer: TileLayer, tileset: Tileset, col: number, row: number): number | null {
  const slot = slotAt(layer, col, row);
  if (slot < 0) return null;
  const autotile = tileset.autotiles[slot];
  if (!autotile) return null;
  const same: SameNeighbour = (dCol, dRow) => slotAt(layer, col + dCol, row + dRow) === slot;
  // The variant IS the mask. `autotileOffset` is the only place a mask becomes a sheet cell, and it
  // lives in the renderer's half of the world — so a stored id stays independent of how the sheet
  // happens to be laid out, and re-cutting the art never invalidates a saved map.
  const mask = autotile.kind === "run4" ? run4Mask(same) : edge16Mask(same);
  return autotileId(slot, mask);
}

function withNeighboursResolved(
  layer: TileLayer,
  tileset: Tileset,
  col: number,
  row: number,
): TileLayer {
  const ids = [...layer.ids];
  const draft: TileLayer = { ...layer, ids };
  const cells: readonly { col: number; row: number }[] = [
    { col, row },
    { col, row: row - 1 },
    { col: col + 1, row },
    { col, row: row + 1 },
    { col: col - 1, row },
  ];
  for (const cell of cells) {
    if (!inBounds(draft, cell.col, cell.row)) continue;
    const id = resolvedId(draft, tileset, cell.col, cell.row);
    if (id !== null) ids[indexOf(draft, cell.col, cell.row)] = id;
  }
  return { ...layer, ids };
}

export function paintAutotile(
  layer: TileLayer,
  tileset: Tileset,
  slot: number,
  col: number,
  row: number,
): TileLayer {
  if (!inBounds(layer, col, row)) return layer;
  const ids = [...layer.ids];
  ids[indexOf(layer, col, row)] = autotileId(slot, 0);
  return withNeighboursResolved({ ...layer, ids }, tileset, col, row);
}

export function eraseTile(layer: TileLayer, tileset: Tileset, col: number, row: number): TileLayer {
  if (!inBounds(layer, col, row)) return layer;
  const ids = [...layer.ids];
  ids[indexOf(layer, col, row)] = EMPTY_TILE;
  return withNeighboursResolved({ ...layer, ids }, tileset, col, row);
}

/** Every autotile cell re-resolved from scratch. The oracle the brush is tested against. */
export function resolveWholeLayer(layer: TileLayer, tileset: Tileset): TileLayer {
  const ids = [...layer.ids];
  for (let row = 0; row < layer.rows; row += 1) {
    for (let col = 0; col < layer.cols; col += 1) {
      const id = resolvedId(layer, tileset, col, row);
      if (id !== null) ids[indexOf(layer, col, row)] = id;
    }
  }
  return { ...layer, ids };
}
