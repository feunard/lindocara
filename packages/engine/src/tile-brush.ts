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
import type { TerrainMaterial } from "./hd2d/terrain-query.js";
import type { TileLayer } from "./tile-layer-codec.js";
import { autotileId, decodeTileId, EMPTY_TILE, fixedId, type Tileset } from "./tileset.js";
import {
  CLIFF_FACE_FIXED_BASE,
  CLIFF_FACE_FIXED_LEVEL_STRIDE,
  CLIFF_WALL_HIGH_2_SLOT,
  CLIFF_WALL_SLOT,
  CLIFF_WALL_SLOTS,
  CLIFF_WATER_HIGH_2_SLOT,
  CLIFF_WATER_SLOT,
  elevationOfSlot,
  isGroundElevation,
  MAX_TERRAIN_LEVEL,
  MIN_TERRAIN_LEVEL,
  oneCellRampDescriptor,
  oneCellRampFixedIndex,
  RAMP_FIXED_TILE_COUNT,
  RAMP_LEVEL_3_FIXED_BASE,
  RAMP_ONE_CELL_DIRECTIONS,
  RAMP_ONE_CELL_LEVELS,
  RAMP_SUNKEN_ONE_CELL_LEVELS,
  terrainDescriptorOfTileId,
  terrainFixedIndex,
  terrainSlot,
  waterFixedIndex,
  waterLevelOfTileId,
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
 * because a 256x256 map is 65,536 cells and workerd's stack is not the budget to spend on that.
 *
 * The cap below is not reachable by a correct visited-set: each cell is marked visited the moment it
 * is pushed, so no cell is ever pushed twice and the walk does at most `cells` pops. It exists so
 * that a *broken* visited-set — the classic bug where two neighbours keep re-queueing each other —
 * fails fast and loud instead of spinning forever; JS is single-threaded, so an actual infinite loop
 * here would hang the whole process, not just this call, and no test timeout can preempt it.
 */
function floodRegion(
  layer: TileLayer,
  col: number,
  row: number,
  matches: (col: number, row: number) => boolean,
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
      if (!matches(next.col, next.row)) continue;
      visited.add(idx);
      stack.push(next);
    }
  }
  return region;
}

/** The contiguous semantic terrain region under a cell. Unlike the legacy slot-only flood helper,
 * generated fixed terrain joins neighbouring cells with the same material and elevation. */
export function terrainFloodRegion(
  layer: TileLayer,
  col: number,
  row: number,
): { col: number; row: number }[] {
  if (!inBounds(layer, col, row)) return [];
  const startId = layer.ids[indexOf(layer, col, row)] ?? EMPTY_TILE;
  const startRef = decodeTileId(startId);
  const startTerrain = terrainDescriptorOfTileId(startId);
  if (startRef.kind === "fixed" && !startTerrain) return [{ col, row }];
  return floodRegion(layer, col, row, (candidateCol, candidateRow) => {
    const candidateId = layer.ids[indexOf(layer, candidateCol, candidateRow)] ?? EMPTY_TILE;
    if (startRef.kind === "empty") return decodeTileId(candidateId).kind === "empty";
    const candidate = terrainDescriptorOfTileId(candidateId);
    return (
      candidate !== null &&
      candidate.material === startTerrain?.material &&
      candidate.level === startTerrain.level
    );
  });
}

/** Contiguous authored-water region. Empty cells are the level-zero sea; raised/sunken water ids
 * join only water at the identical tier, so a fill or held-wheel gesture never crosses a fall. */
export function waterFloodRegion(
  layer: TileLayer,
  col: number,
  row: number,
): { col: number; row: number }[] {
  if (!inBounds(layer, col, row)) return [];
  const startId = layer.ids[indexOf(layer, col, row)] ?? EMPTY_TILE;
  const startRef = decodeTileId(startId);
  const startLevel = waterLevelOfTileId(startId);
  if (startRef.kind !== "empty" && startLevel === null) return [{ col, row }];
  return floodRegion(layer, col, row, (candidateCol, candidateRow) => {
    const candidateId = layer.ids[indexOf(layer, candidateCol, candidateRow)] ?? EMPTY_TILE;
    if (startRef.kind === "empty") return decodeTileId(candidateId).kind === "empty";
    return waterLevelOfTileId(candidateId) === startLevel;
  });
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
    startRef.kind === "fixed"
      ? [{ col, row }]
      : floodRegion(layer, col, row, (candidateCol, candidateRow) =>
          sameRegion(layer, startRef, candidateCol, candidateRow),
        );

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

/** Paint one semantic terrain cell, whether its storage is a legacy autotile or an append-only
 * generated-material fixed id. Neighbouring legacy masks are still refreshed around a fixed write. */
export function paintTerrainLayer(
  layer: TileLayer,
  tileset: Tileset,
  material: TerrainMaterial,
  level: number,
  col: number,
  row: number,
): TileLayer {
  const slot = terrainSlot(material, level);
  if (slot !== null) return paintAutotile(layer, tileset, slot, col, row);
  const fixedIndex = terrainFixedIndex(material, level);
  if (fixedIndex < 0 || !inBounds(layer, col, row)) return layer;
  const ids = [...layer.ids];
  ids[indexOf(layer, col, row)] = fixedId(fixedIndex);
  return withNeighboursResolved({ ...layer, ids }, tileset, col, row);
}

/** Paint water while preserving its authored surface tier. Level zero remains the historical empty
 * tile; every other tier uses the append-only fixed-water band. */
export function paintWaterLayer(
  layer: TileLayer,
  tileset: Tileset,
  level: number,
  col: number,
  row: number,
): TileLayer {
  if (level === 0) return eraseTile(layer, tileset, col, row);
  const fixedIndex = waterFixedIndex(level);
  if (fixedIndex < 0 || !inBounds(layer, col, row)) return layer;
  const ids = [...layer.ids];
  ids[indexOf(layer, col, row)] = fixedId(fixedIndex);
  return withNeighboursResolved({ ...layer, ids }, tileset, col, row);
}

/** Flood one semantic region with water at `level`, including fill-to-empty at sea level. */
export function floodFillWater(
  layer: TileLayer,
  tileset: Tileset,
  level: number,
  col: number,
  row: number,
): TileLayer {
  if (!inBounds(layer, col, row)) return layer;
  const fixedIndex = waterFixedIndex(level);
  if (level !== 0 && fixedIndex < 0) return layer;
  const fillId = level === 0 ? EMPTY_TILE : fixedId(fixedIndex);
  const startId = layer.ids[indexOf(layer, col, row)] ?? EMPTY_TILE;
  if (startId === fillId) return layer;
  const region = terrainFloodRegion(layer, col, row);
  const ids = [...layer.ids];
  for (const cell of region) ids[indexOf(layer, cell.col, cell.row)] = fillId;
  const draft = { ...layer, ids };
  const resolveVisited = new Set<number>();
  for (const cell of region) {
    for (const target of [
      cell,
      { col: cell.col, row: cell.row - 1 },
      { col: cell.col + 1, row: cell.row },
      { col: cell.col, row: cell.row + 1 },
      { col: cell.col - 1, row: cell.row },
    ]) {
      if (!inBounds(draft, target.col, target.row)) continue;
      const targetIndex = indexOf(draft, target.col, target.row);
      if (resolveVisited.has(targetIndex)) continue;
      resolveVisited.add(targetIndex);
      const resolved = resolvedId(draft, tileset, target.col, target.row);
      if (resolved !== null) ids[targetIndex] = resolved;
    }
  }
  return { ...layer, ids };
}

/** Flood one contiguous semantic material/elevation region. Generated fixed ground joins its
 * neighbours like an autotile region instead of behaving as unrelated hand-placed fixtures. */
export function floodFillTerrain(
  layer: TileLayer,
  tileset: Tileset,
  material: TerrainMaterial,
  level: number,
  col: number,
  row: number,
): TileLayer {
  if (!inBounds(layer, col, row)) return layer;
  const slot = terrainSlot(material, level);
  const fixedIndex = terrainFixedIndex(material, level);
  if (slot === null && fixedIndex < 0) return layer;
  const fillId = slot === null ? fixedId(fixedIndex) : autotileId(slot, 0);
  const startId = layer.ids[indexOf(layer, col, row)] ?? EMPTY_TILE;
  const startTerrain = terrainDescriptorOfTileId(startId);
  if (startTerrain?.material === material && startTerrain.level === level) return layer;

  const region = terrainFloodRegion(layer, col, row);

  const ids = [...layer.ids];
  for (const cell of region) ids[indexOf(layer, cell.col, cell.row)] = fillId;
  const draft: TileLayer = { ...layer, ids };
  const resolveVisited = new Set<number>();
  for (const cell of region) {
    for (const target of [
      cell,
      { col: cell.col, row: cell.row - 1 },
      { col: cell.col + 1, row: cell.row },
      { col: cell.col, row: cell.row + 1 },
      { col: cell.col - 1, row: cell.row },
    ]) {
      if (!inBounds(draft, target.col, target.row)) continue;
      const targetIndex = indexOf(draft, target.col, target.row);
      if (resolveVisited.has(targetIndex)) continue;
      resolveVisited.add(targetIndex);
      const resolved = resolvedId(draft, tileset, target.col, target.row);
      if (resolved !== null) ids[targetIndex] = resolved;
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

/** Which elevation level a ground cell stands at. Empty and off-map read as `NO_GROUND_ELEVATION`:
 *  lower than any authored level, so a cliff at the map's edge still gets its face. */
function elevationAt(ground: TileLayer, col: number, row: number): number {
  if (!inBounds(ground, col, row)) return elevationOfSlot(-1);
  const id = ground.ids[indexOf(ground, col, row)] ?? EMPTY_TILE;
  return terrainDescriptorOfTileId(id)?.level ?? waterLevelOfTileId(id) ?? elevationOfSlot(-1);
}

/**
 * What an elevation brush does to the cell it lands on, RELATIVE to what is already there.
 *
 * The editor's palette used to offer one button per absolute level ("Ground", "Plateau +1",
 * "Plateau +2", "High plateau +3"), which meant an author who wanted a fourth plateau had nowhere
 * to click, and one who wanted to raise an existing slope had to read its current level off the
 * screen first. These four steps say what the author actually means, and they do not enumerate the
 * range, so they keep working the day the range grows.
 */
export type ElevationStep = "keep" | "ground" | "raise" | "lower";

/**
 * The absolute level an `ElevationStep` reaches from `current`, or `null` when it has nowhere to
 * go. `null` is a REFUSAL the caller is expected to show (the editor flashes its "not here" hint),
 * never a silent no-op: a button that does nothing is indistinguishable from a broken one.
 *
 * Water and off-map read as `NO_GROUND_ELEVATION` (`elevationOfSlot`), below every authored level.
 * The first stroke on the sea therefore always lands on the ground, whichever step carries it, and
 * only `lower` refuses there: the sea is not a pit, and lowering the absence of ground has no
 * meaning. From ground, `lower` now digs, down to `MIN_TERRAIN_LEVEL`.
 */
export function elevationStepTarget(step: ElevationStep, current: number): number | null {
  if (!isGroundElevation(current)) return step === "lower" ? null : 0;
  switch (step) {
    case "keep":
      return current;
    case "ground":
      return 0;
    case "raise":
      return current < MAX_TERRAIN_LEVEL ? current + 1 : null;
    case "lower":
      return current > MIN_TERRAIN_LEVEL ? current - 1 : null;
  }
}

/** Which elevation the ground layer already holds at a cell: `NO_GROUND_ELEVATION` for water, void
 *  and off-map, and a NEGATIVE level for a pit floor, which is ground like any other. */
export function groundElevationAt(ground: TileLayer, col: number, row: number): number {
  return elevationAt(ground, col, row);
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
  return paintTerrain(layers, tileset, "herbe", level, col, row);
}

/** Paint one material at one elevation while keeping the existing cliff-wall maintenance rule. */
export function paintTerrain(
  layers: readonly TileLayer[],
  tileset: Tileset,
  material: TerrainMaterial,
  level: number,
  col: number,
  row: number,
): TileLayer[] {
  const ground = layers[0];
  const walls = layers[1];
  if (!ground || !walls) return [...layers];

  const paintedGround = paintTerrainLayer(ground, tileset, material, level, col, row);
  if (paintedGround === ground) return [...layers];
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

const CLIFF_ROTATION: Readonly<Record<CliffDirection, 0 | 1 | 2 | 3>> = {
  north: 0,
  east: 1,
  south: 2,
  west: 3,
};

function ambientCliffFixed(index: number): boolean {
  return (
    index >= CLIFF_FACE_FIXED_BASE &&
    index < CLIFF_FACE_FIXED_BASE + CLIFF_FACE_FIXED_LEVEL_STRIDE * 2
  );
}

function ambientCliffAutotile(slot: number): boolean {
  return (CLIFF_WALL_SLOTS as readonly number[]).includes(slot);
}

export const STAIRS_DIRECTIONS = ["east", "west"] as const;
export type StairsDirection = (typeof STAIRS_DIRECTIONS)[number];
export type StairsLowLevel = 0 | 1 | 2;

export type StairsPart = "high" | "low";

/** Both native side ramps occupy a vertical pair beside their cliff. */
const STAIRS_HIGH_PART_OFFSET: Readonly<Record<StairsDirection, { col: number; row: number }>> = {
  east: { col: 0, row: -1 },
  west: { col: 0, row: -1 },
};

const STAIRS_HIGH_SIDE_OFFSET: Readonly<Record<StairsDirection, { col: number; row: number }>> = {
  east: { col: 1, row: 0 },
  west: { col: -1, row: 0 },
};

/** Four stable ids per direction: high 0/1, then low 0/1. */
export function stairsFixedIndex(
  direction: StairsDirection,
  lowLevel: StairsLowLevel,
  part: StairsPart,
): number {
  if (lowLevel === 2) {
    return (
      RAMP_LEVEL_3_FIXED_BASE + STAIRS_DIRECTIONS.indexOf(direction) * 2 + (part === "low" ? 1 : 0)
    );
  }
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

export interface StairsDescriptor {
  direction: StairsDirection;
  lowLevel: StairsLowLevel;
  part: StairsPart;
}

/** Decode one stair half from the stable eight-id side-ramp band. */
export function stairsDescriptor(index: number): StairsDescriptor | null {
  if (!Number.isInteger(index) || index < 0) return null;
  if (index >= RAMP_LEVEL_3_FIXED_BASE && index < RAMP_LEVEL_3_FIXED_BASE + 4) {
    const offset = index - RAMP_LEVEL_3_FIXED_BASE;
    const direction = STAIRS_DIRECTIONS[Math.floor(offset / 2)];
    if (!direction) return null;
    return { direction, lowLevel: 2, part: offset % 2 === 0 ? "high" : "low" };
  }
  if (index >= RAMP_FIXED_TILE_COUNT) return null;
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
  return {
    col: col - high.col,
    row: row - high.row,
  };
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
 * Both ramp halves stay on the lower elevation and run alongside one straight cliff edge. Each half
 * must touch the immediately higher terrain on the chosen side, matching Pixel Frog's native
 * composition: the bank replaces two joined cliff faces. Other neighbours do not participate in
 * validity: rejecting them made a visually straight edge fail near harmless corners and short
 * plateaus even though both actual endpoints matched.
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

  const highSide = STAIRS_HIGH_SIDE_OFFSET[direction];
  return placements.every((placement) => {
    const targetCol = col + placement.col;
    const targetRow = row + placement.row;
    return elevationAt(ground, targetCol + highSide.col, targetRow + highSide.row) === lowLevel + 1;
  });
}

/** The first higher neighbour around a lower cell. North keeps the atlas's joined horizontal run;
 * the other sides use the same face art rotated as a fixed tile. The priority only affects the
 * picture at a concave corner: every choice is equally impassable. */
interface WantedCliff {
  direction: CliffDirection;
  highLevel: 1 | 2;
}

function wantedCliffDirection(ground: TileLayer, col: number, row: number): WantedCliff | null {
  const here = elevationAt(ground, col, row);
  const neighbours: readonly [CliffDirection, number][] = [
    ["north", elevationAt(ground, col, row - 1)],
    ["east", elevationAt(ground, col + 1, row)],
    ["south", elevationAt(ground, col, row + 1)],
    ["west", elevationAt(ground, col - 1, row)],
  ];
  // A face belongs to the LOW cell. Two readings meet here and only one of them is new:
  // - the cell is ground (a plateau's foot, or a pit floor): any neighbour standing higher is a
  //   wall, which is what lets a pit have sides at all;
  // - the cell is water: the historical rule stands, a neighbour must be RAISED (level 1 or more),
  //   because a shore beside level-0 ground is a beach and gets foam, not a cliff.
  const wanted = neighbours.find(
    ([, elevation]) =>
      isGroundElevation(elevation) &&
      elevation > here &&
      (isGroundElevation(here) || elevation > 0),
  );
  if (!wanted) return null;
  return { direction: wanted[0], highLevel: wanted[1] >= 2 ? 2 : 1 };
}

function northCliffSlot(waterFacing: boolean, highLevel: 1 | 2): number {
  if (highLevel === 2) {
    return waterFacing ? CLIFF_WATER_HIGH_2_SLOT : CLIFF_WALL_HIGH_2_SLOT;
  }
  return waterFacing ? CLIFF_WATER_SLOT : CLIFF_WALL_SLOT;
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

      // Water or repainting either joined level invalidates the complete two-cell
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
      (current.kind === "autotile" && ambientCliffAutotile(current.slot)) ||
      (current.kind === "fixed" && ambientCliffFixed(current.index));
    return ambient ? eraseTile(walls, tileset, col, row) : walls;
  }

  if (wanted.direction === "north") {
    // WATER-footed, not merely low-lying: a pit floor is ground, and its wall wears the land foot.
    const wantedSlot = northCliffSlot(
      !isGroundElevation(elevationAt(ground, col, row)),
      wanted.highLevel,
    );
    if (current.kind === "autotile" && current.slot === wantedSlot) return walls;
    return paintAutotile(walls, tileset, wantedSlot, col, row);
  }

  const wantedIndex =
    CLIFF_FACE_FIXED_BASE +
    (wanted.highLevel - 1) * CLIFF_FACE_FIXED_LEVEL_STRIDE +
    CLIFF_ROTATION[wanted.direction];
  if (current.kind === "fixed" && current.index === wantedIndex) return walls;
  const ids = [...walls.ids];
  ids[indexOf(walls, col, row)] = fixedId(wantedIndex);
  return withNeighboursResolved({ ...walls, ids }, tileset, col, row);
}

/** Every direction a ramp may climb toward. The stored two-cell bands only ever knew east and west,
 *  because that is what the official side asset draws; a meshed ramp has no such limit. */
export const RAMP_DIRECTIONS = RAMP_ONE_CELL_DIRECTIONS;
export type RampDirection = (typeof RAMP_DIRECTIONS)[number];

/** The neighbour a ramp climbs INTO: one level up, on the side the ramp faces. */
const RAMP_HIGH_SIDE: Readonly<Record<RampDirection, { col: number; row: number }>> = {
  east: { col: 1, row: 0 },
  west: { col: -1, row: 0 },
  south: { col: 0, row: 1 },
  north: { col: 0, row: -1 },
};

const OPPOSITE_RAMP_DIRECTION: Readonly<Record<RampDirection, RampDirection>> = {
  east: "west",
  west: "east",
  south: "north",
  north: "south",
};

const MAX_AUTOMATIC_STAIRS_WIDTH = 3;

export interface StairsPlacement {
  direction: RampDirection;
  lowLevel: number;
}

export interface StairsRunCell extends StairsPlacement {
  col: number;
  row: number;
  material: TerrainMaterial;
}

export interface StairsRunPlan {
  direction: RampDirection;
  highLevel: number;
  cells: readonly StairsRunCell[];
}

/**
 * Whether ONE cell can be a ramp climbing `direction` from `lowLevel`.
 *
 * Two conditions, and they are the whole rule: the cell itself stands on the low bank, and the
 * neighbour it faces stands exactly one level higher. The two-cell predicate (`stairsFits`, still
 * used to decode stored maps) asked the same question of a pair of cells because the ART was two
 * cells tall; the slope is geometry now, so one cell is enough to describe it.
 */
export function oneCellRampFits(
  ground: TileLayer,
  col: number,
  row: number,
  direction: RampDirection,
  lowLevel: number,
): boolean {
  if (!inBounds(ground, col, row)) return false;
  if (elevationAt(ground, col, row) !== lowLevel) return false;
  const side = RAMP_HIGH_SIDE[direction];
  return elevationAt(ground, col + side.col, row + side.row) === lowLevel + 1;
}

/**
 * Stamp a one-cell ramp on the wall layer, or return the layers unchanged when it does not fit.
 *
 * Same refusal discipline as `paintStairs`: identity means "nothing was written", and the caller
 * turns that into a visible refusal rather than a silent no-op.
 */
export function paintOneCellRamp(
  layers: readonly TileLayer[],
  tileset: Tileset,
  col: number,
  row: number,
  direction: RampDirection,
  lowLevel: number,
): TileLayer[] {
  const ground = layers[0];
  const walls = layers[1];
  if (!ground || !walls) return layers as TileLayer[];
  if (!oneCellRampFits(ground, col, row, direction, lowLevel)) return layers as TileLayer[];
  const index = oneCellRampFixedIndex(direction, lowLevel);
  if (index < 0) return layers as TileLayer[];
  const ids = [...walls.ids];
  ids[indexOf(walls, col, row)] = fixedId(index);
  const painted = withNeighboursResolved({ ...walls, ids }, tileset, col, row);
  return [ground, painted, ...layers.slice(2)];
}

/**
 * Efface l'escalier touché sans creuser son terrain porteur.
 *
 * Les rampes automatiques sont des cellules indépendantes dans le format de carte, mais une volée
 * peut couvrir plusieurs niveaux et plusieurs cases de large. La gomme les traite comme un seul
 * objet : elle suit les marches compatibles dans le sens de la pente et sur sa largeur, puis remet
 * les parois de falaise que l'escalier remplaçait. Les anciens escaliers officiels à deux cellules
 * conservent le même contrat atomique.
 */
export function eraseStairsAt(
  layers: readonly TileLayer[],
  tileset: Tileset,
  col: number,
  row: number,
): TileLayer[] {
  const ground = layers[0];
  const walls = layers[1];
  if (!ground || !walls || !inBounds(walls, col, row)) return layers as TileLayer[];
  const current = decodeTileId(walls.ids[indexOf(walls, col, row)] ?? EMPTY_TILE);
  if (current.kind !== "fixed") return layers as TileLayer[];

  const oneCell = oneCellRampDescriptor(current.index);
  const removed: { col: number; row: number }[] = [];
  if (oneCell) {
    const highSide = RAMP_HIGH_SIDE[oneCell.direction];
    const across = highSide.col === 0 ? { col: 1, row: 0 } : { col: 0, row: 1 };
    const pending = [{ col, row, lowLevel: oneCell.lowLevel }];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const cell = pending.pop();
      if (!cell || !inBounds(walls, cell.col, cell.row)) continue;
      const key = `${cell.col}:${cell.row}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const ref = decodeTileId(walls.ids[indexOf(walls, cell.col, cell.row)] ?? EMPTY_TILE);
      const descriptor = ref.kind === "fixed" ? oneCellRampDescriptor(ref.index) : null;
      if (
        !descriptor ||
        descriptor.direction !== oneCell.direction ||
        descriptor.lowLevel !== cell.lowLevel
      ) {
        continue;
      }
      removed.push({ col: cell.col, row: cell.row });
      pending.push(
        {
          col: cell.col + highSide.col,
          row: cell.row + highSide.row,
          lowLevel: cell.lowLevel + 1,
        },
        {
          col: cell.col - highSide.col,
          row: cell.row - highSide.row,
          lowLevel: cell.lowLevel - 1,
        },
        {
          col: cell.col + across.col,
          row: cell.row + across.row,
          lowLevel: cell.lowLevel,
        },
        {
          col: cell.col - across.col,
          row: cell.row - across.row,
          lowLevel: cell.lowLevel,
        },
      );
    }
  } else {
    const legacy = stairsDescriptor(current.index);
    if (!legacy) return layers as TileLayer[];
    const anchor = stairsAnchorAt(col, row, legacy);
    for (const placement of stairsTilePlacements(legacy.direction, legacy.lowLevel)) {
      const targetCol = anchor.col + placement.col;
      const targetRow = anchor.row + placement.row;
      if (
        inBounds(walls, targetCol, targetRow) &&
        walls.ids[indexOf(walls, targetCol, targetRow)] === fixedId(placement.fixedIndex)
      ) {
        removed.push({ col: targetCol, row: targetRow });
      }
    }
  }

  if (removed.length === 0) return layers as TileLayer[];
  const ids = [...walls.ids];
  for (const cell of removed) ids[indexOf(walls, cell.col, cell.row)] = EMPTY_TILE;
  let restored: TileLayer = { ...walls, ids };
  for (const cell of removed) restored = syncWall(ground, restored, tileset, cell.col, cell.row);
  return [ground, restored, ...layers.slice(2)];
}

/**
 * The staircase this cell can actually take, read off the terrain instead of asked for.
 *
 * There are only six candidates (two ramp directions, three transitions) and `stairsFits` already
 * answers each of them exactly: both ramp halves must stand on `lowLevel` and both must touch
 * `lowLevel + 1` on the chosen side. So the editor never needed the author to declare a direction
 * and a pair of levels before clicking; it needed to ask this question at the hovered cell.
 *
 * In practice at most one candidate fits, because east and west want cliffs on opposite sides. When
 * two genuinely do (a cell in a trench, higher ground both ways), `prefer` breaks the tie: the
 * editor passes whichever direction currently reads as "to the right of the screen" at the camera's
 * yaw, so the ramp climbs the way the author is looking.
 *
 * `null` is a real answer and the common one: flat ground, or a bank running north to south, which
 * has NO ramp art at all (`STAIRS_DIRECTIONS` is east/west, and Pixel Frog ships those two sides).
 * A caller that swallows the null turns a missing asset into a click that mysteriously does nothing.
 */
export function inferStairsPlacement(
  ground: TileLayer,
  col: number,
  row: number,
  prefer?: RampDirection,
): StairsPlacement | null {
  const fits: StairsPlacement[] = [];
  for (const direction of RAMP_DIRECTIONS) {
    for (const lowLevel of [...RAMP_ONE_CELL_LEVELS, ...RAMP_SUNKEN_ONE_CELL_LEVELS]) {
      if (oneCellRampFits(ground, col, row, direction, lowLevel))
        fits.push({ direction, lowLevel });
    }
  }
  return fits.find((placement) => placement.direction === prefer) ?? fits[0] ?? null;
}

interface StairsRunCandidate {
  direction: RampDirection;
  highCol: number;
  highRow: number;
  highLevel: number;
  carve: boolean;
}

function terrainAt(ground: TileLayer, col: number, row: number) {
  if (!inBounds(ground, col, row)) return null;
  return terrainDescriptorOfTileId(ground.ids[indexOf(ground, col, row)] ?? EMPTY_TILE);
}

function stairsRunLane(
  ground: TileLayer,
  candidate: StairsRunCandidate,
  acrossCol: number,
  acrossRow: number,
): StairsRunCell[] | null {
  const highCol = candidate.highCol + acrossCol;
  const highRow = candidate.highRow + acrossRow;
  const high = terrainAt(ground, highCol, highRow);
  if (!high || high.level !== candidate.highLevel) return null;
  const highSide = RAMP_HIGH_SIDE[candidate.direction];
  const outwardCol = -highSide.col;
  const outwardRow = -highSide.row;
  const cells: StairsRunCell[] = [];
  const terminalLevel = candidate.carve ? MIN_TERRAIN_LEVEL : 0;
  for (let lowLevel = candidate.highLevel - 1; lowLevel >= terminalLevel; lowLevel--) {
    const distance = candidate.highLevel - lowLevel;
    const col = highCol + outwardCol * distance;
    const row = highRow + outwardRow * distance;
    if (!inBounds(ground, col, row)) break;
    const existing = terrainAt(ground, col, row);
    // Never tunnel through a second plateau. Lower terrain and water are the missing support the
    // staircase is explicitly allowed to build; a cell as high as the preceding step is a wall.
    if (
      existing &&
      (candidate.carve ? existing.level > candidate.highLevel : existing.level >= lowLevel + 1)
    )
      break;
    cells.push({ col, row, direction: candidate.direction, lowLevel, material: high.material });
  }
  return cells.length > 0 ? cells : null;
}

/**
 * Planifie un escalier complet depuis un rebord jusqu'au niveau minimum accessible.
 *
 * Le clic peut viser la case haute, la première case basse ou directement l'eau. Chaque case
 * manquante devient un palier un niveau plus bas que la précédente. Depuis le niveau zéro (ou un
 * palier déjà négatif), l'outil creuse jusqu'à `MIN_TERRAIN_LEVEL`. Une bande compatible de part et
 * d'autre élargit automatiquement le passage jusqu'à trois cases.
 */
export function inferStairsRun(
  ground: TileLayer,
  col: number,
  row: number,
  prefer?: RampDirection,
): StairsRunPlan | null {
  if (!inBounds(ground, col, row)) return null;
  const here = terrainAt(ground, col, row);
  const candidates: StairsRunCandidate[] = [];

  // Le curseur désigne la première marche basse (y compris une case d'eau) et regarde la berge.
  for (const direction of RAMP_DIRECTIONS) {
    const side = RAMP_HIGH_SIDE[direction];
    const high = terrainAt(ground, col + side.col, row + side.row);
    if (!high || high.level <= MIN_TERRAIN_LEVEL || (here && here.level >= high.level)) continue;
    candidates.push({
      direction,
      highCol: col + side.col,
      highRow: row + side.row,
      highLevel: high.level,
      carve: high.level <= 0,
    });
  }

  // Le curseur désigne le rebord haut : l'escalier part vers le voisin plus bas ou vers le vide.
  if (here && here.level > MIN_TERRAIN_LEVEL) {
    for (const outward of RAMP_DIRECTIONS) {
      const delta = RAMP_HIGH_SIDE[outward];
      const neighbour = terrainAt(ground, col + delta.col, row + delta.row);
      // Raised flights still need an existing lower approach. At and below zero the explicit
      // staircase tool may excavate flat ground in the camera-preferred direction.
      if (here.level > 0 && neighbour && neighbour.level >= here.level) continue;
      candidates.push({
        direction: OPPOSITE_RAMP_DIRECTION[outward],
        highCol: col,
        highRow: row,
        highLevel: here.level,
        carve: here.level <= 0,
      });
    }
  }

  const candidate = candidates.find((item) => item.direction === prefer) ?? candidates[0] ?? null;
  if (!candidate) return null;
  const alongX = candidate.direction === "east" || candidate.direction === "west";
  const across = alongX ? { col: 0, row: 1 } : { col: 1, row: 0 };
  const lanes: StairsRunCell[][] = [];
  const centre = stairsRunLane(ground, candidate, 0, 0);
  if (!centre) return null;
  lanes.push(centre);
  for (const offset of [-1, 1]) {
    if (lanes.length >= MAX_AUTOMATIC_STAIRS_WIDTH) break;
    const lane = stairsRunLane(ground, candidate, across.col * offset, across.row * offset);
    if (lane) lanes.push(lane);
  }
  return {
    direction: candidate.direction,
    highLevel: candidate.highLevel,
    cells: lanes.flat(),
  };
}

/** Peint le terrain porteur puis toutes les rampes d'un plan automatique en une seule opération. */
export function paintStairsRun(
  layers: readonly TileLayer[],
  tileset: Tileset,
  plan: StairsRunPlan,
): TileLayer[] {
  let painted = [...layers];
  for (const cell of plan.cells) {
    painted = paintTerrain(painted, tileset, cell.material, cell.lowLevel, cell.col, cell.row);
  }
  for (const cell of plan.cells) {
    painted = paintOneCellRamp(painted, tileset, cell.col, cell.row, cell.direction, cell.lowLevel);
  }
  return painted;
}

/**
 * Directional, bidirectional official Tiny Swords staircase.
 *
 * `direction` names the high side; walking back down is always supported. `lowLevel` chooses the
 * 0-to-1 or 1-to-2 transition. The author first paints both elevations, then clicks the low entrance
 * cell. The stamp refuses flat ground and mismatched levels; it never invents a plateau.
 * East/west use Pixel Frog's two native side sources.
 */
export function paintStairs(
  layers: readonly TileLayer[],
  tileset: Tileset,
  col: number,
  row: number,
  direction: StairsDirection = "east",
  lowLevel: StairsLowLevel = 0,
): TileLayer[] {
  const ground = layers[0];
  const walls = layers[1];
  if (!ground || !walls || (lowLevel !== 0 && lowLevel !== 1 && lowLevel !== 2)) {
    return layers as TileLayer[];
  }
  if (STAIRS_HIGH_SIDE_OFFSET[direction] === undefined || !inBounds(walls, col, row)) {
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
