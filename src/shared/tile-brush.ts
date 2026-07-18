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

interface ClampedRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** Corners accepted in either order, clamped to the layer. Null when nothing survives clamping. */
function clampRect(
  layer: TileLayer,
  colA: number,
  rowA: number,
  colB: number,
  rowB: number,
): ClampedRect | null {
  const c0 = Math.max(0, Math.min(colA, colB));
  const c1 = Math.min(layer.cols - 1, Math.max(colA, colB));
  const r0 = Math.max(0, Math.min(rowA, rowB));
  const r1 = Math.min(layer.rows - 1, Math.max(rowA, rowB));
  if (c0 > c1 || r0 > r1) return null;
  return { c0, r0, c1, r1 };
}

/**
 * Fill `rect` with `id`, then re-resolve every cell whose variant could have changed: the region
 * itself plus its one-cell border (a neighbour just outside the region may now abut a different
 * slot). One pass to write the ids, one to resolve — never per-cell recursion into the
 * single-cell brush, which would re-resolve an interior cell up to five times.
 *
 * Unlike `syncWall`'s ambient wall upkeep, which since Task 2 refuses to touch a fixed tile, a
 * rectangle is explicit authoring intent: a fixed tile inside the region is overwritten exactly
 * like an autotile would be.
 */
function fillRect(layer: TileLayer, tileset: Tileset, rect: ClampedRect, id: number): TileLayer {
  const ids = [...layer.ids];
  for (let row = rect.r0; row <= rect.r1; row += 1) {
    for (let col = rect.c0; col <= rect.c1; col += 1) {
      ids[indexOf(layer, col, row)] = id;
    }
  }
  const draft: TileLayer = { ...layer, ids };
  const top = Math.max(0, rect.r0 - 1);
  const bottom = Math.min(layer.rows - 1, rect.r1 + 1);
  const left = Math.max(0, rect.c0 - 1);
  const right = Math.min(layer.cols - 1, rect.c1 + 1);
  for (let row = top; row <= bottom; row += 1) {
    for (let col = left; col <= right; col += 1) {
      const resolved = resolvedId(draft, tileset, col, row);
      if (resolved !== null) ids[indexOf(draft, col, row)] = resolved;
    }
  }
  return { ...layer, ids };
}

export function paintRectAutotile(
  layer: TileLayer,
  tileset: Tileset,
  slot: number,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
): TileLayer {
  const rect = clampRect(layer, c0, r0, c1, r1);
  if (!rect) return layer;
  return fillRect(layer, tileset, rect, autotileId(slot, 0));
}

export function eraseRect(
  layer: TileLayer,
  tileset: Tileset,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
): TileLayer {
  const rect = clampRect(layer, c0, r0, c1, r1);
  if (!rect) return layer;
  return fillRect(layer, tileset, rect, EMPTY_TILE);
}

/**
 * Whether `col,row` belongs to the same flood-fill region as the start cell, given `startRef` — the
 * decoded id the fill began on. An autotile region is every cell sharing that slot; an empty region
 * is every empty cell; a fixed tile matches nothing at all, because the region rule below never asks
 * this function about a fixed start in the first place — its region is exactly the one cell clicked,
 * even when the next cell over happens to be a fixed tile of the identical index.
 */
function sameRegion(
  layer: TileLayer,
  startRef: { kind: "autotile"; slot: number } | { kind: "empty" },
  col: number,
  row: number,
): boolean {
  if (!inBounds(layer, col, row)) return false;
  const ref = decodeTileId(layer.ids[indexOf(layer, col, row)] ?? EMPTY_TILE);
  if (startRef.kind === "empty") return ref.kind === "empty";
  return ref.kind === "autotile" && ref.slot === startRef.slot;
}

/**
 * Every cell of the start cell's flood-fill region, found with an explicit stack — never recursion,
 * because a 100x100 map is 10,000 cells and workerd's stack is not the budget to spend on that.
 *
 * The cap below is not reachable by a correct visited-set: each cell is marked visited the moment it
 * is pushed, so no cell is ever pushed twice and the walk does at most `cells` pops. It exists so
 * that a *broken* visited-set — the classic bug where two neighbours keep re-queueing each other —
 * fails fast and loud instead of spinning forever; JS is single-threaded, so an actual infinite loop
 * here would hang the whole process, not just this call, and no test timeout can preempt it.
 */
function floodRegion(
  layer: TileLayer,
  startRef: { kind: "autotile"; slot: number } | { kind: "empty" },
  col: number,
  row: number,
): { col: number; row: number }[] {
  const cap = layer.cols * layer.rows * 4;
  const visited = new Set<number>([indexOf(layer, col, row)]);
  const stack: { col: number; row: number }[] = [{ col, row }];
  const region: { col: number; row: number }[] = [];
  let steps = 0;
  while (stack.length > 0) {
    steps += 1;
    if (steps > cap) throw new Error("floodFill exceeded its safety cap — visited set is broken");
    const cell = stack.pop();
    if (!cell) break;
    region.push(cell);
    const neighbours: readonly { col: number; row: number }[] = [
      { col: cell.col, row: cell.row - 1 },
      { col: cell.col + 1, row: cell.row },
      { col: cell.col, row: cell.row + 1 },
      { col: cell.col - 1, row: cell.row },
    ];
    for (const next of neighbours) {
      if (!inBounds(layer, next.col, next.row)) continue;
      const idx = indexOf(layer, next.col, next.row);
      if (visited.has(idx)) continue;
      if (!sameRegion(layer, startRef, next.col, next.row)) continue;
      visited.add(idx);
      stack.push(next);
    }
  }
  return region;
}

/**
 * Fill the contiguous 4-neighbour region sharing the start cell's slot — empty counts as a slot of
 * its own, and a fixed tile is a region of exactly one cell, always replaced. Filling a region with
 * its own slot is a genuine no-op (same reference back); filling empty is never a no-op, because
 * empty is not the slot being painted.
 *
 * Same two-pass shape as `fillRect`: write every region cell first, then re-resolve the region plus
 * its one-cell border, since a mask only ever reads a neighbour's slot and every write below keeps
 * each already-resolved cell's slot fixed — only its variant moves — so reading the same mutating
 * array back for a later cell in this second pass is safe, not a hazard.
 */
export function floodFill(
  layer: TileLayer,
  tileset: Tileset,
  slot: number,
  col: number,
  row: number,
): TileLayer {
  if (!inBounds(layer, col, row)) return layer;
  const startRef = decodeTileId(layer.ids[indexOf(layer, col, row)] ?? EMPTY_TILE);
  if (startRef.kind === "autotile" && startRef.slot === slot) return layer;

  const region: { col: number; row: number }[] =
    startRef.kind === "fixed" ? [{ col, row }] : floodRegion(layer, startRef, col, row);

  const ids = [...layer.ids];
  const fillId = autotileId(slot, 0);
  for (const cell of region) {
    ids[indexOf(layer, cell.col, cell.row)] = fillId;
  }
  const draft: TileLayer = { ...layer, ids };

  const resolveVisited = new Set<number>();
  for (const cell of region) {
    const border: readonly { col: number; row: number }[] = [
      { col: cell.col, row: cell.row },
      { col: cell.col, row: cell.row - 1 },
      { col: cell.col + 1, row: cell.row },
      { col: cell.col, row: cell.row + 1 },
      { col: cell.col - 1, row: cell.row },
    ];
    for (const target of border) {
      if (!inBounds(draft, target.col, target.row)) continue;
      const idx = indexOf(draft, target.col, target.row);
      if (resolveVisited.has(idx)) continue;
      resolveVisited.add(idx);
      const resolved = resolvedId(draft, tileset, target.col, target.row);
      if (resolved !== null) ids[idx] = resolved;
    }
  }
  return { ...layer, ids };
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
