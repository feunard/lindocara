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
import { autotileId, decodeTileId, EMPTY_TILE, fixedId, type Tileset } from "./tileset.js";
import {
  CLIFF_FACE_FIXED_BASE,
  CLIFF_WALL_SLOT,
  elevationOfSlot,
  GRASS_SLOTS,
  RAMP_FIXED_TILE_COUNT,
} from "./tilesets/tiny-swords.js";

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
 * Paint one cell of ground at `level`, and maintain the cliff faces around it.
 *
 * The wall is an ordinary tile whose tileset entry says `passable: false`, which is the entire
 * reason three-level elevation costs nothing in the movement code: a cliff face is a cell you
 * cannot walk into, not a direction you cannot cross.
 *
 * One wall cell per drop regardless of the level difference. A face is written into the lower cell
 * on every side, so a plateau is a real barrier whether its edge faces north, east, south or west.
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
  // Every cell whose face may have changed: the written cell and its four neighbours. A face lives
  // in the lower cell, so changing one elevation can create/remove a barrier on any side.
  let painted = walls;
  for (const target of [
    { col, row },
    { col, row: row - 1 },
    { col: col + 1, row },
    { col, row: row + 1 },
    { col: col - 1, row },
  ]) {
    painted = syncWall(ground, painted, tileset, target.col, target.row);
  }
  return [ground, painted, ...layers.slice(2)];
}

type CliffDirection = "north" | "east" | "south" | "west";

function ambientCliffFixed(index: number): boolean {
  return index >= CLIFF_FACE_FIXED_BASE && index < CLIFF_FACE_FIXED_BASE + 4;
}

export const STAIRS_DIRECTIONS = ["north", "east", "south", "west"] as const;
export type StairsDirection = (typeof STAIRS_DIRECTIONS)[number];
export type StairsLowLevel = 0 | 1;

type QuarterTurns = 0 | 1 | 2 | 3;

const STAIRS_ROTATION: Readonly<Record<StairsDirection, QuarterTurns>> = {
  // The official 64×128 source climbs toward its right-hand side.
  north: 3,
  east: 0,
  south: 1,
  west: 2,
};

export type StairsPart = "high" | "low";

/**
 * Relative position of the asset's high half from the clicked low half. Rotating the native
 * vertical pair turns it into a horizontal pair for north/south.
 */
const STAIRS_HIGH_PART_OFFSET: Readonly<Record<StairsDirection, { col: number; row: number }>> = {
  north: { col: -1, row: 0 },
  east: { col: 0, row: -1 },
  south: { col: 1, row: 0 },
  west: { col: 0, row: 1 },
};

const STAIRS_HIGH_SIDE_OFFSET: Readonly<Record<StairsDirection, { col: number; row: number }>> = {
  north: { col: 0, row: -1 },
  east: { col: 1, row: 0 },
  south: { col: 0, row: 1 },
  west: { col: -1, row: 0 },
};

/** Four stable ids per direction: high 0/1, then low 0/1. */
export function stairsFixedIndex(
  direction: StairsDirection,
  lowLevel: StairsLowLevel,
  part: StairsPart,
): number {
  // Keep the historical direction group encoded in saved maps: north/east/south/west. The atlas
  // rotation is deliberately NOT the id group now that we know the source art itself faces east.
  return STAIRS_DIRECTIONS.indexOf(direction) * 4 + (part === "low" ? 2 : 0) + lowLevel;
}

export interface StairsTilePlacement {
  /** Relative to the clicked low entrance cell. */
  col: number;
  /** Relative to the clicked low entrance cell. */
  row: number;
  part: StairsPart;
  fixedIndex: number;
}

/** The exact two atlas cells the committed stamp and pointer preview share. */
export function stairsTilePlacements(
  direction: StairsDirection,
  lowLevel: StairsLowLevel,
): StairsTilePlacement[] {
  const high = STAIRS_HIGH_PART_OFFSET[direction];
  return [
    { col: 0, row: 0, part: "low", fixedIndex: stairsFixedIndex(direction, lowLevel, "low") },
    {
      col: high.col,
      row: high.row,
      part: "high",
      fixedIndex: stairsFixedIndex(direction, lowLevel, "high"),
    },
  ];
}

interface StairsDescriptor {
  direction: StairsDirection;
  lowLevel: StairsLowLevel;
  part: StairsPart;
}

/** Decode one of the official stair's two halves from the stable sixteen-id ramp band. */
function stairsDescriptor(index: number): StairsDescriptor | null {
  if (!Number.isInteger(index) || index < 0 || index >= RAMP_FIXED_TILE_COUNT) return null;
  const direction = STAIRS_DIRECTIONS[Math.floor(index / 4)];
  if (!direction) return null;
  return {
    direction,
    lowLevel: (index % 2) as StairsLowLevel,
    part: index % 4 >= 2 ? "low" : "high",
  };
}

function stairsAnchorAt(
  col: number,
  row: number,
  descriptor: StairsDescriptor,
): { col: number; row: number } {
  if (descriptor.part === "low") return { col, row };
  const high = STAIRS_HIGH_PART_OFFSET[descriptor.direction];
  return { col: col - high.col, row: row - high.row };
}

function stairsPartsPresent(
  walls: TileLayer,
  col: number,
  row: number,
  direction: StairsDirection,
  lowLevel: StairsLowLevel,
): boolean {
  return stairsTilePlacements(direction, lowLevel).every((placement) => {
    const targetCol = col + placement.col;
    const targetRow = row + placement.row;
    if (!inBounds(walls, targetCol, targetRow)) return false;
    return walls.ids[indexOf(walls, targetCol, targetRow)] === fixedId(placement.fixedIndex);
  });
}

/**
 * The clicked cell and the rotated companion both stay on the lower elevation. The high end touches
 * the immediately higher terrain one cell farther in the chosen direction, giving a three-cell
 * low-half → high-half → plateau route. No other higher neighbour may touch either passable stair
 * cell, because collision is whole-cell and that would open an unintended cliff face.
 */
function stairsFits(
  ground: TileLayer,
  col: number,
  row: number,
  direction: StairsDirection,
  lowLevel: StairsLowLevel,
): boolean {
  const placements = stairsTilePlacements(direction, lowLevel);
  for (const placement of placements) {
    const targetCol = col + placement.col;
    const targetRow = row + placement.row;
    if (
      !inBounds(ground, targetCol, targetRow) ||
      elevationAt(ground, targetCol, targetRow) !== lowLevel
    ) {
      return false;
    }
  }

  const highPart = STAIRS_HIGH_PART_OFFSET[direction];
  const highSide = STAIRS_HIGH_SIDE_OFFSET[direction];
  const highCell = {
    col: col + highPart.col + highSide.col,
    row: row + highPart.row + highSide.row,
  };
  if (elevationAt(ground, highCell.col, highCell.row) !== lowLevel + 1) return false;

  const neighbours: readonly { col: number; row: number }[] = [
    { col: 0, row: -1 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: -1, row: 0 },
  ];
  return placements.every((placement) =>
    neighbours.every((offset) => {
      const neighbourCol = col + placement.col + offset.col;
      const neighbourRow = row + placement.row + offset.row;
      const elevation = elevationAt(ground, neighbourCol, neighbourRow);
      const isHighCell = neighbourCol === highCell.col && neighbourRow === highCell.row;
      return isHighCell ? elevation === lowLevel + 1 : elevation <= lowLevel;
    }),
  );
}

/** The first higher neighbour around a lower cell. North keeps the atlas's joined horizontal run;
 * the other sides use the same face art rotated as a fixed tile. The priority only affects the
 * picture at a concave corner: every choice is equally impassable. */
function wantedCliffDirection(ground: TileLayer, col: number, row: number): CliffDirection | null {
  const here = elevationAt(ground, col, row);
  const neighbours: readonly [CliffDirection, number][] = [
    ["north", elevationAt(ground, col, row - 1)],
    ["east", elevationAt(ground, col + 1, row)],
    ["south", elevationAt(ground, col, row + 1)],
    ["west", elevationAt(ground, col - 1, row)],
  ];
  return neighbours.find(([, elevation]) => elevation > 0 && elevation > here)?.[0] ?? null;
}

/** A lower cell carries one impassable face when any orthogonal neighbour stands higher. */
function syncWall(
  ground: TileLayer,
  walls: TileLayer,
  tileset: Tileset,
  col: number,
  row: number,
): TileLayer {
  if (col < 0 || row < 0 || col >= walls.cols || row >= walls.rows) return walls;
  const current = decodeTileId(walls.ids[indexOf(walls, col, row)] ?? EMPTY_TILE);
  if (current.kind === "fixed") {
    const ramp = stairsDescriptor(current.index);
    if (ramp) {
      const anchor = stairsAnchorAt(col, row, ramp);
      if (
        stairsFits(ground, anchor.col, anchor.row, ramp.direction, ramp.lowLevel) &&
        stairsPartsPresent(walls, anchor.col, anchor.row, ramp.direction, ramp.lowLevel)
      ) {
        return walls;
      }

      // Water, repainting either level or changing the corner invalidates the complete two-cell
      // stair. Clear both matching halves before normal cliff upkeep so no visual fragment or stale
      // passable cell survives the terrain edit.
      const ids = [...walls.ids];
      const removed: { col: number; row: number }[] = [];
      for (const placement of stairsTilePlacements(ramp.direction, ramp.lowLevel)) {
        const targetCol = anchor.col + placement.col;
        const targetRow = anchor.row + placement.row;
        if (
          inBounds(walls, targetCol, targetRow) &&
          ids[indexOf(walls, targetCol, targetRow)] === fixedId(placement.fixedIndex)
        ) {
          ids[indexOf(walls, targetCol, targetRow)] = EMPTY_TILE;
          removed.push({ col: targetCol, row: targetRow });
        }
      }
      let restored: TileLayer = { ...walls, ids };
      for (const cell of removed) {
        restored = syncWall(ground, restored, tileset, cell.col, cell.row);
      }
      return restored;
    } else if (!ambientCliffFixed(current.index)) {
      // Other hand-authored fixed fixtures remain explicit authoring intent.
      return walls;
    }
  }

  const wanted = wantedCliffDirection(ground, col, row);
  if (wanted === null) {
    const ambient =
      (current.kind === "autotile" && current.slot === CLIFF_WALL_SLOT) ||
      (current.kind === "fixed" && ambientCliffFixed(current.index));
    return ambient ? eraseTile(walls, tileset, col, row) : walls;
  }

  // UPRIGHT on every side, never rotated.
  //
  // The pack ships exactly one wall band — four variants of a horizontal run (two caps, two
  // middles) — and no side or corner face. Rotating it a quarter turn for an east/west/south
  // boundary turns the rock's scalloped bottom lip sideways, which is what made three of every
  // plateau's four edges read as broken. Tiny Swords' own art stacks this same upright band down a
  // vertical edge, so drawing it unrotated is both what the artist did and the only honest use of
  // the tiles that exist. `run4` then resolves horizontal continuity for free: a south drop gets its
  // end caps, and a vertical edge gets the isolated variant, which reads as stacked rock.
  if (current.kind === "autotile" && current.slot === CLIFF_WALL_SLOT) return walls;
  return paintAutotile(walls, tileset, CLIFF_WALL_SLOT, col, row);
}

/**
 * Directional, bidirectional official Tiny Swords staircase.
 *
 * `direction` names the high side: north means climb north / descend south, and so on. `lowLevel`
 * chooses the 0-to-1 or 1-to-2 transition. The author first paints both elevations, then clicks the
 * low entrance cell. The stamp refuses flat ground, corners and mismatched levels; it never invents
 * a plateau. On a valid boundary it writes both 64px halves of the atlas's native 64×128 asset,
 * rotating their art and relative positions toward the selected high side.
 */
export function paintStairs(
  layers: readonly TileLayer[],
  tileset: Tileset,
  col: number,
  row: number,
  direction: StairsDirection = "north",
  lowLevel: StairsLowLevel = 0,
): TileLayer[] {
  const ground = layers[0];
  const walls = layers[1];
  if (!ground || !walls || (lowLevel !== 0 && lowLevel !== 1)) return layers as TileLayer[];
  if (STAIRS_ROTATION[direction] === undefined || !inBounds(walls, col, row)) {
    return layers as TileLayer[];
  }
  if (!stairsFits(ground, col, row, direction, lowLevel)) return layers as TileLayer[];

  const placements = stairsTilePlacements(direction, lowLevel);
  if (
    placements.every(
      (placement) =>
        walls.ids[indexOf(walls, col + placement.col, row + placement.row)] ===
        fixedId(placement.fixedIndex),
    )
  ) {
    return [...layers];
  }
  const ids = [...walls.ids];
  for (const placement of placements) {
    ids[indexOf(walls, col + placement.col, row + placement.row)] = fixedId(placement.fixedIndex);
  }
  let newWalls: TileLayer = { ...walls, ids };
  for (const placement of placements) {
    newWalls = withNeighboursResolved(newWalls, tileset, col + placement.col, row + placement.row);
  }
  return layers.map((layer, index) => (index === 1 ? newWalls : layer));
}
