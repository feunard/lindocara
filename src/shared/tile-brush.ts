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
import { CLIFF_WALL_SLOT, elevationOfSlot, GRASS_SLOTS } from "./tilesets/tiny-swords.js";

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

/** Which elevation level a ground cell stands at. Empty and off-map read as -1: lower than any
 *  authored level, so a cliff at the map's edge still gets its face. */
function elevationAt(ground: TileLayer, col: number, row: number): number {
  return elevationOfSlot(slotAt(ground, col, row));
}

/**
 * Paint one cell of ground at `level`, and maintain the cliff face beneath it.
 *
 * The wall is an ordinary tile whose tileset entry says `passable: false`, which is the entire
 * reason three-level elevation costs nothing in the movement code: a cliff face is a cell you
 * cannot walk into, not a direction you cannot cross.
 *
 * One wall row per drop regardless of the level difference, matching the wireframe. The sheet's
 * second wall row stays available for a later proportional cliff.
 */
export function paintElevation(
  layers: readonly TileLayer[],
  tileset: Tileset,
  level: number,
  col: number,
  row: number,
): TileLayer[] {
  const slot = GRASS_SLOTS[level];
  if (slot === undefined) return [...layers];
  const ground = layers[0];
  const walls = layers[1];
  if (!ground || !walls) return [...layers];

  const paintedGround = paintAutotile(ground, tileset, slot, col, row);
  return syncElevationWalls([paintedGround, walls, ...layers.slice(2)], tileset, col, row);
}

/**
 * Bring layer 1's cliff faces back into agreement with layer 0 around one ground cell.
 *
 * Every write to the ground has to run this, not only `paintElevation`: erasing a raised cell also
 * orphans the face it was casting, and a stale wall is an invisible collider.
 */
export function syncElevationWalls(
  layers: readonly TileLayer[],
  tileset: Tileset,
  col: number,
  row: number,
): TileLayer[] {
  const ground = layers[0];
  const walls = layers[1];
  if (!ground || !walls) return [...layers];
  // Every cell whose wall may have changed: the one below what was just written, and the written
  // cell itself (its own face may now be buried by higher ground above it).
  let painted = walls;
  for (const target of [
    { col, row: row + 1 },
    { col, row },
  ]) {
    painted = syncWall(ground, painted, tileset, target.col, target.row);
  }
  return [ground, painted, ...layers.slice(2)];
}

/** A cell carries a wall exactly when the ground directly above it stands higher than it does. */
function syncWall(
  ground: TileLayer,
  walls: TileLayer,
  tileset: Tileset,
  col: number,
  row: number,
): TileLayer {
  if (col < 0 || row < 0 || col >= walls.cols || row >= walls.rows) return walls;
  // A fixed tile (a ramp) is a hand placement, not ambient wall upkeep's to touch — neither
  // painting a wall over it nor erasing it counts as agreement with what the elevation demands.
  // An author who wants the wall back erases the ramp first.
  if (decodeTileId(walls.ids[indexOf(walls, col, row)] ?? EMPTY_TILE).kind === "fixed")
    return walls;
  const above = elevationAt(ground, col, row - 1);
  const here = elevationAt(ground, col, row);
  const wanted = above > 0 && above > here;
  const has = slotAt(walls, col, row) === CLIFF_WALL_SLOT;
  if (wanted === has) return walls;
  return wanted
    ? paintAutotile(walls, tileset, CLIFF_WALL_SLOT, col, row)
    : eraseTile(walls, tileset, col, row);
}
