/** Deterministic procedural authoring for the map editor.
 *
 * The generator mutates no editor state and reads no clock or global random source. A seed plus the
 * four author choices always produces the same dense map document, which makes regeneration,
 * testing and undo predictable. The editor installs the returned document as one history entry.
 */

import { presetEvent } from "@lindocara/engine/event-presets.js";
import type { MonsterSpecies } from "@lindocara/engine/game.js";
import type { HarvestResourceKind } from "@lindocara/engine/harvest.js";
import { nativeHarvestProfileForAsset } from "@lindocara/engine/harvest-presets.js";
import type { TerrainMaterial } from "@lindocara/engine/hd2d/terrain-query.js";
import {
  ELEMENT_OFFSET_STEPS,
  EMPTY_MARKERS,
  elementFitsMap,
  MAX_MAP_ELEMENTS,
  type MapElement,
} from "@lindocara/engine/map-data.js";
import {
  defaultEventPage,
  functionalEvent,
  MAX_EVENTS_PER_MAP,
  type MapEvent,
  type NpcRoutineStep,
} from "@lindocara/engine/map-events.js";
import { MAP_OCEAN_MARGIN } from "@lindocara/engine/map-limits.js";
import { resolveWholeLayer, syncElevationWalls } from "@lindocara/engine/tile-brush.js";
import { emptyLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { autotileId, EMPTY_TILE } from "@lindocara/engine/tileset.js";
import { TINY_SWORDS_TILESET, terrainSlot } from "@lindocara/engine/tilesets/tiny-swords.js";
import {
  DEFAULT_NPC_MODEL_ASSET_ID,
  type EditorAssetDefinition,
  type EditorAssetId,
  editorAsset,
  PLACEABLE_EDITOR_ASSETS,
} from "@lindocara/engine/tiny-swords-catalog.js";
import { canvasEditorMap, type EditorMap } from "./editor-state.js";

export const PROCEDURAL_MAP_GENRES = ["forest", "archipelago", "highlands", "tundra"] as const;
export type ProceduralMapGenre = (typeof PROCEDURAL_MAP_GENRES)[number];

export const PROCEDURAL_MAP_COMPLEXITIES = ["light", "balanced", "dense"] as const;
export type ProceduralMapComplexity = (typeof PROCEDURAL_MAP_COMPLEXITIES)[number];

export const PROCEDURAL_MAP_SIZES = {
  compact: { cols: 24, rows: 18 },
  standard: { cols: 40, rows: 30 },
  large: { cols: 64, rows: 48 },
  epic: { cols: 96, rows: 72 },
} as const;
export type ProceduralMapSize = keyof typeof PROCEDURAL_MAP_SIZES;

export interface ProceduralMapOptions {
  genre: ProceduralMapGenre;
  complexity: ProceduralMapComplexity;
  size: ProceduralMapSize;
  seed: string;
}

interface PlannedCell {
  land: boolean;
  level: 0 | 1 | 2 | 3;
  material: TerrainMaterial;
  route: boolean;
  river: boolean;
  zone: "wild" | "village" | "danger";
}

interface Point {
  col: number;
  row: number;
}

interface RiverPlan {
  axis: "horizontal" | "vertical";
  /** One centre per row for a vertical river, or per column for a horizontal river. */
  centres: readonly Point[];
}

interface LogicalMapPlan {
  village: Point;
  landmarks: readonly Point[];
  dangerZones: readonly Point[];
  river: RiverPlan;
  bridgeCrossings: readonly Point[];
}

const ORTHOGONAL = [
  { col: 0, row: -1 },
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: -1, row: 0 },
] as const;

const ELEMENT_DENSITY: Record<ProceduralMapComplexity, number> = {
  light: 0.035,
  balanced: 0.065,
  dense: 0.1,
};

const MONSTER_AREA: Record<ProceduralMapComplexity, number> = {
  light: 750,
  balanced: 450,
  dense: 280,
};

const GENRE_CATEGORIES: Record<ProceduralMapGenre, Readonly<Record<string, number>>> = {
  forest: { trees: 8, vegetation: 5, resources: 3, "small-decor": 2, rocks: 1 },
  archipelago: {
    vegetation: 4,
    resources: 3,
    "small-decor": 2,
    "water-decor": 5,
    rocks: 2,
    trees: 2,
  },
  highlands: { rocks: 7, resources: 4, trees: 2, vegetation: 1, "small-decor": 1 },
  tundra: { rocks: 6, resources: 4, trees: 3, "water-decor": 2, "small-decor": 1 },
};

const GENRE_MONSTERS: Record<ProceduralMapGenre, readonly MonsterSpecies[]> = {
  forest: ["spear_goblin", "torch_goblin", "war_pig", "pig_rider"],
  archipelago: ["gnoll_marauder", "mire_troll", "spear_goblin"],
  highlands: ["skull_guard", "skull_crusader", "minotaur_brute", "gate_troll"],
  tundra: ["skull_warden", "hex_shaman", "gate_troll"],
};

// Meat belongs on living sheep and gold belongs in authored rewards, never as loose generated
// scenery. The generator only guarantees the two natural gathering families below.
const RESOURCE_VARIETY: readonly HarvestResourceKind[] = ["wood", "stone"];

const FRIENDLY_BUILDING_COLOR: Record<ProceduralMapGenre, "blue" | "purple" | "yellow"> = {
  forest: "blue",
  archipelago: "yellow",
  highlands: "blue",
  tundra: "purple",
};

const VILLAGER_TINTS = [0xffffff, 0xe6f3ff, 0xfff1c2, 0xe9ddff] as const;

function hashText(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function randomSource(seed: string): () => number {
  let state = hashText(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function noiseCorner(seed: number, col: number, row: number, salt: number): number {
  let value = seed ^ Math.imul(col, 0x1f123bb5) ^ Math.imul(row, 0x5f356495) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_295;
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(seed: number, x: number, y: number, scale: number, salt: number): number {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = smooth(sx - x0);
  const ty = smooth(sy - y0);
  const n00 = noiseCorner(seed, x0, y0, salt);
  const n10 = noiseCorner(seed, x0 + 1, y0, salt);
  const n01 = noiseCorner(seed, x0, y0 + 1, salt);
  const n11 = noiseCorner(seed, x0 + 1, y0 + 1, salt);
  const north = n00 + (n10 - n00) * tx;
  const south = n01 + (n11 - n01) * tx;
  return north + (south - north) * ty;
}

function fractalNoise(seed: number, col: number, row: number, salt: number): number {
  return (
    valueNoise(seed, col, row, 14, salt) * 0.56 +
    valueNoise(seed, col, row, 7, salt + 17) * 0.29 +
    valueNoise(seed, col, row, 3.5, salt + 43) * 0.15
  );
}

function cellIndex(cols: number, point: Point): number {
  return point.row * cols + point.col;
}

function inBounds(cols: number, rows: number, point: Point): boolean {
  return point.col >= 0 && point.row >= 0 && point.col < cols && point.row < rows;
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.col - right.col, left.row - right.row);
}

function plannedTerrain(
  genre: ProceduralMapGenre,
  cols: number,
  rows: number,
  seed: number,
  random: () => number,
): PlannedCell[] {
  const centre = { col: (cols - 1) / 2, row: (rows - 1) / 2 };
  const islands = Array.from({ length: Math.max(5, Math.round((cols * rows) / 850)) }, () => ({
    col: 3 + random() * Math.max(1, cols - 6),
    row: 3 + random() * Math.max(1, rows - 6),
    rx: Math.max(3.5, cols * (0.08 + random() * 0.09)),
    ry: Math.max(3, rows * (0.09 + random() * 0.1)),
  }));
  islands[0] = { col: centre.col, row: centre.row, rx: cols * 0.16, ry: rows * 0.18 };

  const cells: PlannedCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const nx = (col - centre.col) / Math.max(1, cols / 2);
      const ny = (row - centre.row) / Math.max(1, rows / 2);
      const radial = Math.sqrt(nx * nx + ny * ny);
      const shape = fractalNoise(seed, col, row, 101);
      const detail = fractalNoise(seed, col, row, 307);
      const border = Math.min(col, row, cols - 1 - col, rows - 1 - row);
      let land = false;
      let level: 0 | 1 | 2 | 3 = 0;
      let material: TerrainMaterial = "herbe";

      if (genre === "archipelago") {
        const islandField = Math.max(
          ...islands.map((island) => {
            const dx = (col - island.col) / island.rx;
            const dy = (row - island.row) / island.ry;
            return 1 - Math.sqrt(dx * dx + dy * dy);
          }),
        );
        land = border > 0 && islandField + (shape - 0.5) * 0.48 > 0.08;
        material = detail > 0.57 ? "herbe" : "sable";
        if (land && islandField > 0.47 && detail > 0.62) level = 1;
      } else if (genre === "highlands") {
        const lake = fractalNoise(seed, col, row, 887);
        land = border > 1 && radial < 0.96 + (shape - 0.5) * 0.17 && !(lake > 0.77 && radial < 0.7);
        const ridge = detail * 0.72 + (1 - radial) * 0.28;
        level = ridge > 0.76 ? 3 : ridge > 0.64 ? 2 : ridge > 0.52 ? 1 : 0;
        // The shipped atlas has grass at level 3, while snow stops at level 2. Keep peaks legal
        // instead of emitting the reserved-but-unbacked snow slot 21.
        material = level === 2 && shape > 0.53 ? "neige" : "herbe";
      } else if (genre === "tundra") {
        land = border > 0 && radial < 0.88 + (shape - 0.5) * 0.24;
        const frozenBasin = fractalNoise(seed, col, row, 661);
        material = frozenBasin > 0.67 && radial < 0.72 ? "glace" : "neige";
        level = material === "glace" ? 0 : detail > 0.71 ? 2 : detail > 0.57 ? 1 : 0;
      } else {
        land = border > 0 && radial < 0.9 + (shape - 0.5) * 0.25;
        level = detail > 0.76 && radial < 0.7 ? 2 : detail > 0.64 && radial < 0.78 ? 1 : 0;
      }

      cells.push({ land, level, material, route: false, river: false, zone: "wild" });
    }
  }
  return cells;
}

function forceSafeDisc(
  cells: PlannedCell[],
  cols: number,
  rows: number,
  centre: Point,
  radius = 3.4,
  preserveRiver = false,
): void {
  const extent = Math.ceil(radius);
  for (let row = centre.row - extent; row <= centre.row + extent; row += 1) {
    for (let col = centre.col - extent; col <= centre.col + extent; col += 1) {
      const point = { col, row };
      if (!inBounds(cols, rows, point) || distance(point, centre) > radius) continue;
      const cell = cells[cellIndex(cols, point)];
      if (!cell || (preserveRiver && cell.river)) continue;
      cell.land = true;
      cell.level = 0;
      cell.material = "herbe";
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Cut one continuous three-cell river through the landmass. Its centre line meanders, but every
 * cross-section stays exactly as wide as the shipped three-cell bridge deck. */
function carveRiver(
  cells: PlannedCell[],
  cols: number,
  rows: number,
  seed: number,
  random: () => number,
): RiverPlan {
  const axis: RiverPlan["axis"] = rows >= 22 && random() < 0.34 ? "horizontal" : "vertical";
  const centres: Point[] = [];
  const compactFraction = cols < 28 ? 0.35 : 0.27;
  const fraction = random() < 0.5 ? compactFraction : 1 - compactFraction;

  if (axis === "vertical") {
    const base = Math.round((cols - 1) * fraction);
    for (let row = 0; row < rows; row += 1) {
      const wobble = Math.round((fractalNoise(seed, row, 0, 1_337) - 0.5) * 4);
      const col = clamp(base + wobble, 2, cols - 3);
      centres.push({ col, row });
      for (let delta = -1; delta <= 1; delta += 1) {
        const cell = cells[cellIndex(cols, { col: col + delta, row })];
        if (!cell) continue;
        cell.land = false;
        cell.level = 0;
        cell.route = false;
        cell.river = true;
        cell.zone = "wild";
      }
    }
  } else {
    const base = Math.round((rows - 1) * (fraction < 0.5 ? 0.27 : 0.73));
    for (let col = 0; col < cols; col += 1) {
      const wobble = Math.round((fractalNoise(seed, col, 0, 1_919) - 0.5) * 4);
      const row = clamp(base + wobble, 2, rows - 3);
      centres.push({ col, row });
      for (let delta = -1; delta <= 1; delta += 1) {
        const cell = cells[cellIndex(cols, { col, row: row + delta })];
        if (!cell) continue;
        cell.land = false;
        cell.level = 0;
        cell.route = false;
        cell.river = true;
        cell.zone = "wild";
      }
    }
  }
  return { axis, centres };
}

function riverCentreAt(river: RiverPlan, point: Point): Point {
  const index = river.axis === "vertical" ? point.row : point.col;
  return river.centres[clamp(index, 0, river.centres.length - 1)] ?? point;
}

/** A guaranteed objective on the bank opposite the village makes the river useful: at least one
 * authored route must cross it, so a generated river never becomes decorative dead space. */
function oppositeBankObjective(
  river: RiverPlan,
  spawn: Point,
  cols: number,
  rows: number,
  random: () => number,
): Point {
  const centre = riverCentreAt(river, spawn);
  if (river.axis === "vertical") {
    return {
      col: spawn.col > centre.col ? (cols < 28 ? 2 : 3) : cols < 28 ? cols - 3 : cols - 4,
      row: clamp(
        spawn.row + (random() < 0.5 ? -1 : 1) * Math.max(3, Math.floor(rows * 0.24)),
        3,
        rows - 4,
      ),
    };
  }
  return {
    col: clamp(
      spawn.col + (random() < 0.5 ? -1 : 1) * Math.max(4, Math.floor(cols * 0.24)),
      3,
      cols - 4,
    ),
    row: spawn.row > centre.row ? (rows < 22 ? 1 : 3) : rows < 22 ? rows - 2 : rows - 4,
  };
}

function prepareVillage(cells: PlannedCell[], cols: number, rows: number, centre: Point): void {
  const radiusCol = Math.min(9, Math.max(4, Math.floor(cols * 0.22)));
  const radiusRow = Math.min(8, Math.max(5, Math.floor(rows * 0.3)));
  for (let row = centre.row - radiusRow; row <= centre.row + radiusRow; row += 1) {
    for (let col = centre.col - radiusCol; col <= centre.col + radiusCol; col += 1) {
      const point = { col, row };
      if (!inBounds(cols, rows, point)) continue;
      const cell = cells[cellIndex(cols, point)];
      if (!cell || cell.river) continue;
      cell.land = true;
      cell.level = 0;
      cell.material = "herbe";
      cell.zone = "village";
    }
  }
}

/** A hostile camp is a flat yard surrounded on three sides by a raised, collision-producing wall.
 * The road is carved afterwards and cuts a real gate through that wall. */
function prepareDangerZone(
  cells: PlannedCell[],
  cols: number,
  rows: number,
  centre: Point,
  radius: number,
): void {
  for (let row = centre.row - radius; row <= centre.row + radius; row += 1) {
    for (let col = centre.col - radius; col <= centre.col + radius; col += 1) {
      const point = { col, row };
      if (!inBounds(cols, rows, point)) continue;
      const cell = cells[cellIndex(cols, point)];
      if (!cell || cell.river) continue;
      const wall = Math.max(Math.abs(col - centre.col), Math.abs(row - centre.row)) === radius;
      cell.land = true;
      cell.level = wall ? 1 : 0;
      cell.material = wall ? "herbe" : "sable";
      cell.zone = "danger";
    }
  }
}

function pickLandmarks(
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  spawn: Point,
  count: number,
  random: () => number,
): Point[] {
  const candidates: Point[] = [];
  for (let row = 3; row < rows - 3; row += 1) {
    for (let col = 3; col < cols - 3; col += 1) {
      const point = { col, row };
      const cell = cells[cellIndex(cols, point)];
      if (cell?.land && distance(point, spawn) > Math.min(cols, rows) * 0.24)
        candidates.push(point);
    }
  }
  const selected: Point[] = [];
  for (let index = 0; index < count && candidates.length > 0; index += 1) {
    let best = candidates[0];
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < Math.min(600, candidates.length * 2); attempt += 1) {
      const candidate = candidates[Math.floor(random() * candidates.length)];
      if (!candidate) continue;
      const separation = Math.min(
        distance(candidate, spawn),
        ...selected.map((point) => distance(candidate, point)),
      );
      const score = separation + random() * 2;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) break;
    selected.push(best);
    for (let candidateIndex = candidates.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = candidates[candidateIndex];
      if (candidate && distance(candidate, best) < 6) candidates.splice(candidateIndex, 1);
    }
  }
  return selected;
}

function carveRoute(
  cells: PlannedCell[],
  cols: number,
  rows: number,
  from: Point,
  to: Point,
  material: TerrainMaterial,
): Point[] {
  let col = from.col;
  let row = from.row;
  const riverHits: Point[] = [];
  const dx = Math.abs(to.col - from.col);
  const dy = Math.abs(to.row - from.row);
  const sx = from.col < to.col ? 1 : -1;
  const sy = from.row < to.row ? 1 : -1;
  let error = dx - dy;
  for (;;) {
    const pathCell = cells[cellIndex(cols, { col, row })];
    if (pathCell?.river) riverHits.push({ col, row });
    for (const offset of [{ col: 0, row: 0 }, ...ORTHOGONAL]) {
      const point = { col: col + offset.col, row: row + offset.row };
      if (!inBounds(cols, rows, point)) continue;
      const cell = cells[cellIndex(cols, point)];
      if (!cell) continue;
      cell.route = true;
      if (cell.river) continue;
      cell.land = true;
      cell.level = 0;
      cell.material = material;
    }
    if (col === to.col && row === to.row) break;
    const doubled = error * 2;
    if (doubled > -dy) {
      error -= dy;
      col += sx;
    }
    if (doubled < dx) {
      error += dx;
      row += sy;
    }
  }
  return riverHits;
}

function applyShoreMaterials(
  genre: ProceduralMapGenre,
  cells: PlannedCell[],
  cols: number,
  rows: number,
): void {
  if (genre === "tundra") return;
  const copy = cells.map((cell) => cell.land);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const point = { col, row };
      const cell = cells[cellIndex(cols, point)];
      if (!cell?.land || cell.route || cell.level > 0) continue;
      const coast = ORTHOGONAL.some((offset) => {
        const neighbour = { col: col + offset.col, row: row + offset.row };
        return !inBounds(cols, rows, neighbour) || !copy[cellIndex(cols, neighbour)];
      });
      if (coast) cell.material = "sable";
    }
  }
}

function buildLayers(cells: readonly PlannedCell[], cols: number, rows: number): TileLayer[] {
  const ids = cells.map((cell) => {
    if (!cell.land) return EMPTY_TILE;
    const slot = terrainSlot(cell.material, cell.level);
    return slot === null ? EMPTY_TILE : autotileId(slot, 0);
  });
  const ground = resolveWholeLayer({ cols, rows, ids }, TINY_SWORDS_TILESET);
  let layers: TileLayer[] = [ground, emptyLayer(cols, rows), emptyLayer(cols, rows)];
  const boundaries = new Set<number>();
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const point = { col, row };
      const cell = cells[cellIndex(cols, point)];
      if (!cell?.land) continue;
      if (
        ORTHOGONAL.some((offset) => {
          const neighbour = { col: col + offset.col, row: row + offset.row };
          if (!inBounds(cols, rows, neighbour)) return true;
          const target = cells[cellIndex(cols, neighbour)];
          return !target?.land || target.level !== cell.level;
        })
      ) {
        boundaries.add(cellIndex(cols, point));
      }
    }
  }
  for (const index of boundaries) {
    layers = syncElevationWalls(
      layers,
      TINY_SWORDS_TILESET,
      index % cols,
      Math.floor(index / cols),
    );
  }
  return layers;
}

function deterministicUuid(seed: string, label: string): string {
  let hex = "";
  for (let index = 0; index < 4; index += 1) {
    hex += hashText(`${seed}:${label}:${index}`).toString(16).padStart(8, "0");
  }
  const chars = hex.slice(0, 32).split("");
  chars[12] = "4";
  chars[16] = "8";
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function flatLand(
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  point: Point,
): boolean {
  const cell = cells[cellIndex(cols, point)];
  if (!cell?.land) return false;
  return ORTHOGONAL.every((offset) => {
    const neighbour = { col: point.col + offset.col, row: point.row + offset.row };
    const target = inBounds(cols, rows, neighbour) ? cells[cellIndex(cols, neighbour)] : undefined;
    return target?.land && target.level === cell.level;
  });
}

function routineFits(
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  home: Point,
  routine: readonly NpcRoutineStep[],
  occupied: ReadonlySet<string>,
): boolean {
  return routine.every((step) => {
    const point = { col: home.col + step.offsetCol, row: home.row + step.offsetRow };
    const cell = inBounds(cols, rows, point) ? cells[cellIndex(cols, point)] : undefined;
    return (
      cell?.land && cell.level === 0 && cell.zone === "village" && !occupied.has(pointKey(point))
    );
  });
}

function openPointNear(
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  centre: Point,
  occupied: ReadonlySet<string>,
  random: () => number,
  minimumDistance: number,
  maximumDistance: number,
  requiredZone?: PlannedCell["zone"],
): Point | null {
  for (let attempt = 0; attempt < 220; attempt += 1) {
    const angle = random() * Math.PI * 2;
    const radius = minimumDistance + random() * Math.max(0.1, maximumDistance - minimumDistance);
    const point = {
      col: Math.round(centre.col + Math.cos(angle) * radius),
      row: Math.round(centre.row + Math.sin(angle) * radius),
    };
    const cell = inBounds(cols, rows, point) ? cells[cellIndex(cols, point)] : undefined;
    if (
      !cell?.land ||
      !flatLand(cells, cols, rows, point) ||
      occupied.has(pointKey(point)) ||
      (requiredZone && cell.zone !== requiredZone)
    )
      continue;
    return point;
  }
  return null;
}

function eventPlan(
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  plan: LogicalMapPlan,
  structures: readonly MapElement[],
  genre: ProceduralMapGenre,
  complexity: ProceduralMapComplexity,
  seed: string,
  random: () => number,
): MapEvent[] {
  const events: MapEvent[] = [];
  const occupied = occupiedByElements(structures);
  const add = (event: MapEvent): void => {
    if (events.length >= MAX_EVENTS_PER_MAP) return;
    events.push(event);
    occupied.add(pointKey(event));
  };
  let ordinal = 1;
  add(
    functionalEvent({
      id: deterministicUuid(seed, "spawn"),
      col: plan.village.col,
      row: plan.village.row,
      ordinal: ordinal++,
      kind: "spawn",
      name: "Village square",
    }),
  );

  const routines: readonly (readonly NpcRoutineStep[])[] = [
    [
      { offsetCol: 0, offsetRow: 0, waitMs: 1_200 },
      { offsetCol: -2, offsetRow: 0, waitMs: 800 },
      { offsetCol: -2, offsetRow: 2, waitMs: 1_200 },
      { offsetCol: 0, offsetRow: 2, waitMs: 700 },
    ],
    [
      { offsetCol: 0, offsetRow: 0, waitMs: 900 },
      { offsetCol: 2, offsetRow: 0, waitMs: 1_400 },
      { offsetCol: 2, offsetRow: -2, waitMs: 700 },
      { offsetCol: 0, offsetRow: -2, waitMs: 1_100 },
    ],
    [
      { offsetCol: 0, offsetRow: 0, waitMs: 800 },
      { offsetCol: 0, offsetRow: 3, waitMs: 1_300 },
      { offsetCol: 2, offsetRow: 3, waitMs: 900 },
      { offsetCol: 2, offsetRow: 0, waitMs: 1_200 },
    ],
    [
      { offsetCol: 0, offsetRow: 0, waitMs: 1_100 },
      { offsetCol: 0, offsetRow: -3, waitMs: 900 },
      { offsetCol: -2, offsetRow: -3, waitMs: 1_300 },
      { offsetCol: -2, offsetRow: 0, waitMs: 700 },
    ],
  ];
  const npcTarget =
    (complexity === "light" ? 1 : complexity === "balanced" ? 2 : 3) +
    (cols * rows >= 3_000 ? 1 : 0);
  const homes = [
    { col: plan.village.col - 2, row: plan.village.row },
    { col: plan.village.col + 2, row: plan.village.row },
    { col: plan.village.col, row: plan.village.row + 2 },
    { col: plan.village.col, row: plan.village.row - 2 },
  ];
  let npcCreated = 0;
  for (let index = 0; index < homes.length && npcCreated < npcTarget; index += 1) {
    const home = homes[index];
    const routine = routines[index];
    if (!home || !routine || occupied.has(pointKey(home))) continue;
    const cell = cells[cellIndex(cols, home)];
    if (
      !cell?.land ||
      cell.zone !== "village" ||
      !routineFits(cells, cols, rows, home, routine, occupied)
    )
      continue;
    const npc = functionalEvent({
      id: deterministicUuid(seed, `villager-${npcCreated}`),
      col: home.col,
      row: home.row,
      ordinal: ordinal++,
      kind: "npc",
      name: `Villager ${npcCreated + 1}`,
      patrolRadius: 4,
    });
    add({
      ...npc,
      pages: [
        {
          ...(npc.pages[0] ?? defaultEventPage()),
          graphicAssetId: DEFAULT_NPC_MODEL_ASSET_ID,
          graphicTint: VILLAGER_TINTS[npcCreated % VILLAGER_TINTS.length] ?? 0xffffff,
          moveType: "custom",
          moveRoute: routine,
          moveSpeed: npcCreated % 2 === 0 ? 3 : 2,
          moveFreq: 2,
        },
      ],
    });
    npcCreated += 1;
  }

  // Compact layouts can lose one of the authored circuits to the river or a house footprint.
  // Fill the remaining population with short market/workshop shuttles, still as real custom
  // routines rather than random wandering.
  for (let attempt = 0; attempt < 160 && npcCreated < npcTarget; attempt += 1) {
    const home = openPointNear(cells, cols, rows, plan.village, occupied, random, 1, 5, "village");
    if (!home) break;
    const direction = ORTHOGONAL.find((offset) => {
      const point = { col: home.col + offset.col, row: home.row + offset.row };
      const cell = inBounds(cols, rows, point) ? cells[cellIndex(cols, point)] : undefined;
      return (
        cell?.land && cell.level === 0 && cell.zone === "village" && !occupied.has(pointKey(point))
      );
    });
    if (!direction) continue;
    const routine: readonly NpcRoutineStep[] = [
      { offsetCol: 0, offsetRow: 0, waitMs: 1_400 },
      { offsetCol: direction.col, offsetRow: direction.row, waitMs: 900 },
      { offsetCol: 0, offsetRow: 0, waitMs: 1_100 },
      { offsetCol: direction.col, offsetRow: direction.row, waitMs: 700 },
    ];
    if (!routineFits(cells, cols, rows, home, routine, occupied)) continue;
    const npc = functionalEvent({
      id: deterministicUuid(seed, `villager-${npcCreated}`),
      col: home.col,
      row: home.row,
      ordinal: ordinal++,
      kind: "npc",
      name: `Villager ${npcCreated + 1}`,
      patrolRadius: 2,
    });
    add({
      ...npc,
      pages: [
        {
          ...(npc.pages[0] ?? defaultEventPage()),
          graphicAssetId: DEFAULT_NPC_MODEL_ASSET_ID,
          graphicTint: VILLAGER_TINTS[npcCreated % VILLAGER_TINTS.length] ?? 0xffffff,
          moveType: "custom",
          moveRoute: routine,
          moveSpeed: 2,
          moveFreq: 2,
        },
      ],
    });
    npcCreated += 1;
  }

  // Landmarks get actual authored treasure interactions, but villagers take priority over props in
  // the settlement and every chest is moved beside its point of interest rather than through it.
  for (const [index, landmark] of plan.landmarks.entries()) {
    const point = openPointNear(cells, cols, rows, landmark, occupied, random, 1, 4) ?? landmark;
    if (occupied.has(pointKey(point))) continue;
    add(
      presetEvent({
        id: deterministicUuid(seed, `chest-${index}`),
        col: point.col,
        row: point.row,
        ordinal: ordinal++,
        preset: "chest",
        selfMapId: "",
        selfSpawn: plan.village,
      }),
    );
  }

  // Encounters are clustered around explicitly fortified danger zones. No monster is scattered
  // into the village or an arbitrary forest cell just to satisfy a numeric density target.
  const targetMonsters = Math.max(
    plan.dangerZones.length * 2,
    Math.min(32, Math.round((cols * rows) / MONSTER_AREA[complexity])),
  );
  const species = GENRE_MONSTERS[genre];
  let created = 0;
  for (let pass = 0; pass < targetMonsters * 3 && created < targetMonsters; pass += 1) {
    const zoneIndex = pass % plan.dangerZones.length;
    const centre = plan.dangerZones[zoneIndex];
    if (!centre) break;
    const point = openPointNear(cells, cols, rows, centre, occupied, random, 1.5, 5, "danger");
    if (!point) continue;
    const monsterSpecies = species[Math.floor(random() * species.length)] ?? "spear_goblin";
    add(
      functionalEvent({
        id: deterministicUuid(seed, `danger-${zoneIndex}-monster-${created}`),
        col: point.col,
        row: point.row,
        ordinal: ordinal++,
        kind: "monster",
        name: `Danger zone ${zoneIndex + 1}`,
        species: monsterSpecies,
        patrolRadius: complexity === "dense" ? 4 : 3,
      }),
    );
    created += 1;
  }
  return events;
}

function assetWeight(asset: EditorAssetDefinition, genre: ProceduralMapGenre): number {
  const categoryWeight = GENRE_CATEGORIES[genre][asset.editor.category] ?? 0;
  return categoryWeight * (asset.domain === "resource" ? 1.8 : 1);
}

function allowedGeneratedAsset(asset: EditorAssetDefinition): boolean {
  const id = asset.id.toLowerCase();
  if (id.includes("stump") || id.includes("gold")) return false;
  if (id.includes("meat") && !id.includes("sheep")) return false;
  const profile = nativeHarvestProfileForAsset(asset.id as EditorAssetId);
  if (profile?.resource === "gold") return false;
  return profile?.resource !== "meat" || id.includes("sheep");
}

function assetPool(genre: ProceduralMapGenre, terrain: "grass" | "water"): EditorAssetDefinition[] {
  return PLACEABLE_EDITOR_ASSETS.filter(
    (asset) =>
      assetWeight(asset, genre) > 0 &&
      allowedGeneratedAsset(asset) &&
      asset.editor.allowedTerrain.includes(terrain) &&
      asset.editor.renderLayer !== "sky" &&
      asset.editor.category !== "bridges",
  );
}

function weightedAsset(
  assets: readonly EditorAssetDefinition[],
  genre: ProceduralMapGenre,
  random: () => number,
): EditorAssetDefinition | null {
  const total = assets.reduce((sum, asset) => sum + assetWeight(asset, genre), 0);
  if (total <= 0) return null;
  let cursor = random() * total;
  for (const asset of assets) {
    cursor -= assetWeight(asset, genre);
    if (cursor <= 0) return asset;
  }
  return assets[assets.length - 1] ?? null;
}

function elementCells(asset: EditorAssetDefinition, point: Point): Point[] {
  const footprint = asset.editor.visualFootprint.length
    ? asset.editor.visualFootprint
    : [{ col: 0, row: 0 }];
  return footprint.map((cell) => ({ col: point.col + cell.col, row: point.row + cell.row }));
}

function pointKey(point: Point): string {
  return `${point.col},${point.row}`;
}

function occupiedByElements(elements: readonly MapElement[]): Set<string> {
  const occupied = new Set<string>();
  for (const element of elements) {
    const asset = editorAsset(element.assetId);
    if (!asset) continue;
    for (const point of elementCells(asset, element)) occupied.add(pointKey(point));
  }
  return occupied;
}

function tryPlaceElement(
  elements: MapElement[],
  occupied: Set<string>,
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  assetId: string,
  point: Point,
): boolean {
  if (elements.length >= MAX_MAP_ELEMENTS) return false;
  const asset = editorAsset(assetId);
  if (!asset || !allowedGeneratedAsset(asset)) return false;
  const footprint = elementCells(asset, point);
  const base = cells[cellIndex(cols, point)];
  if (!base) return false;
  if (
    footprint.some((target) => {
      if (!inBounds(cols, rows, target) || occupied.has(pointKey(target))) return true;
      const planned = cells[cellIndex(cols, target)];
      if (!planned) return true;
      const terrain = planned.land ? "grass" : "water";
      if (!asset.editor.allowedTerrain.includes(terrain)) return true;
      return asset.editor.category !== "bridges" && planned.level !== base.level;
    })
  )
    return false;
  const element: MapElement = {
    col: point.col,
    row: point.row,
    offsetX: 0,
    offsetY: 0,
    assetId: asset.id as EditorAssetId,
  };
  if (!elementFitsMap(element, cols, rows)) return false;
  elements.push(element);
  for (const target of footprint) occupied.add(pointKey(target));
  return true;
}

function tryPlaceElementNear(
  elements: MapElement[],
  occupied: Set<string>,
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  assetId: string,
  centre: Point,
  radius: number,
): boolean {
  for (let distance = 0; distance <= radius; distance += 1) {
    for (let row = centre.row - distance; row <= centre.row + distance; row += 1) {
      for (let col = centre.col - distance; col <= centre.col + distance; col += 1) {
        if (
          distance > 0 &&
          Math.abs(col - centre.col) !== distance &&
          Math.abs(row - centre.row) !== distance
        )
          continue;
        if (tryPlaceElement(elements, occupied, cells, cols, rows, assetId, { col, row }))
          return true;
      }
    }
  }
  return false;
}

function villageBuildingId(
  genre: ProceduralMapGenre,
  kind: "castle" | "house1" | "house2" | "house3" | "tower",
): string {
  const color = FRIENDLY_BUILDING_COLOR[genre];
  return `building.buildings-${color}-buildings.${kind}`;
}

function hostileBuildingId(genre: ProceduralMapGenre, compact: boolean): string {
  if (genre === "forest") return "building.factions-goblins-buildings-wood-house.goblin-house";
  if (compact) return "building.buildings-red-buildings.house1";
  if (genre === "tundra") return "building.buildings-black-buildings.monastery";
  if (genre === "highlands") return "building.buildings-black-buildings.tower";
  return "building.buildings-red-buildings.barracks";
}

/** Place authored structures before ambient scenery. Their layouts are deliberate: a civil
 * settlement around the spawn, defended hostile compounds, bridges only on routed crossings, and
 * small storytelling props beside the places that give them meaning. */
function structurePlan(
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  plan: LogicalMapPlan,
  genre: ProceduralMapGenre,
): MapElement[] {
  const elements: MapElement[] = [];
  const occupied = new Set<string>();
  const roomy = rows >= 22;
  const village = plan.village;

  // Reserve the only valid crossing cells first. A nearby house may be skipped, but it must never
  // be allowed to erase the map's connectivity by occupying a bridge deck.
  for (const crossing of plan.bridgeCrossings) {
    const centre = riverCentreAt(plan.river, crossing);
    const id =
      plan.river.axis === "vertical"
        ? "terrain.bridge.wood.horizontal"
        : "terrain.bridge.wood.vertical";
    const anchor =
      plan.river.axis === "vertical" ? centre : { col: centre.col, row: centre.row + 1 };
    tryPlaceElement(elements, occupied, cells, cols, rows, id, anchor);
  }

  // A non-hostile landmark becomes a deliberate harvestable grove at the end of its road. This
  // reserves at least one large natural feature even on compact maps where ambient scenery has
  // little room left after the village, river and fortified camp.
  const grove = plan.landmarks[plan.dangerZones.length];
  if (grove) {
    tryPlaceElementNear(
      elements,
      occupied,
      cells,
      cols,
      rows,
      "resource.resources-trees.tree-1",
      grove,
      3,
    );
  }

  if (roomy) {
    const placements = [
      { id: villageBuildingId(genre, "castle"), point: { col: village.col, row: village.row - 4 } },
      {
        id: villageBuildingId(genre, "house1"),
        point: { col: village.col - 6, row: village.row + 2 },
      },
      {
        id: villageBuildingId(genre, "house2"),
        point: { col: village.col + 6, row: village.row + 2 },
      },
      {
        id: villageBuildingId(genre, "house3"),
        point: { col: village.col - 5, row: village.row + 7 },
      },
      {
        id: villageBuildingId(genre, "tower"),
        point: { col: village.col + 5, row: village.row + 7 },
      },
    ];
    for (const placement of placements)
      tryPlaceElement(elements, occupied, cells, cols, rows, placement.id, placement.point);
  } else {
    const placements = [
      {
        id: villageBuildingId(genre, "house1"),
        point: { col: village.col - 4, row: village.row - 2 },
      },
      {
        id: villageBuildingId(genre, "house2"),
        point: { col: village.col + 4, row: village.row - 2 },
      },
      {
        id: villageBuildingId(genre, "tower"),
        point: { col: village.col, row: village.row + 5 },
      },
    ];
    for (const placement of placements)
      tryPlaceElement(elements, occupied, cells, cols, rows, placement.id, placement.point);
  }

  // A sign announces the settlement; tools and sheep live by the houses rather than in the wild.
  tryPlaceElement(elements, occupied, cells, cols, rows, "decoration.deco.17", {
    col: village.col - 2,
    row: village.row + 3,
  });
  for (let index = 0; index < (roomy ? 3 : 1); index += 1) {
    tryPlaceElement(
      elements,
      occupied,
      cells,
      cols,
      rows,
      `resource.terrain-resources-tools.tool-0${index + 1}`,
      { col: village.col + 2 + index, row: village.row + 3 },
    );
  }
  if (roomy) {
    tryPlaceElement(
      elements,
      occupied,
      cells,
      cols,
      rows,
      "resource.resources-sheep.happysheep-idle",
      { col: village.col, row: village.row + 7 },
    );
  }

  for (const [index, centre] of plan.dangerZones.entries()) {
    tryPlaceElement(
      elements,
      occupied,
      cells,
      cols,
      rows,
      hostileBuildingId(genre, !roomy),
      centre,
    );
    tryPlaceElement(elements, occupied, cells, cols, rows, "decoration.lindocara-lab.campfire", {
      col: centre.col,
      row: centre.row + 2,
    });
    if (roomy && index > 0) {
      tryPlaceElement(
        elements,
        occupied,
        cells,
        cols,
        rows,
        genre === "forest"
          ? "building.factions-goblins-buildings-wood-tower.wood-tower-destroyed"
          : "building.buildings-red-buildings.tower",
        { col: centre.col + 4, row: centre.row + 2 },
      );
    }
  }

  return elements;
}

function sceneryPlan(
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  spawn: Point,
  events: readonly MapEvent[],
  original: readonly MapElement[],
  genre: ProceduralMapGenre,
  complexity: ProceduralMapComplexity,
  random: () => number,
): MapElement[] {
  const landAssets = assetPool(genre, "grass");
  const waterAssets = assetPool(genre, "water");
  const occupied = new Set(events.map((event) => `${event.col},${event.row}`));
  for (const key of occupiedByElements(original)) occupied.add(key);
  const routeClearance = new Set<string>();
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const cell = cells[cellIndex(cols, { col, row })];
      if (!cell?.route) continue;
      for (let dz = -1; dz <= 1; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) routeClearance.add(`${col + dx},${row + dz}`);
      }
    }
  }
  for (let row = spawn.row - 3; row <= spawn.row + 3; row += 1) {
    for (let col = spawn.col - 3; col <= spawn.col + 3; col += 1) {
      routeClearance.add(`${col},${row}`);
    }
  }

  const target = Math.max(
    original.length,
    Math.min(MAX_MAP_ELEMENTS - 8, Math.round(cols * rows * ELEMENT_DENSITY[complexity])),
  );
  const elements: MapElement[] = [...original];
  for (let attempt = 0; attempt < target * 28 && elements.length < target; attempt += 1) {
    const point = { col: Math.floor(random() * cols), row: Math.floor(random() * rows) };
    const cell = cells[cellIndex(cols, point)];
    if (!cell) continue;
    const terrain = cell.land ? "grass" : "water";
    if (terrain === "grass" && !flatLand(cells, cols, rows, point)) continue;
    const asset = weightedAsset(terrain === "grass" ? landAssets : waterAssets, genre, random);
    if (!asset) continue;
    const footprint = elementCells(asset, point);
    if (
      footprint.some((targetCell) => {
        if (!inBounds(cols, rows, targetCell)) return true;
        const planned = cells[cellIndex(cols, targetCell)];
        const targetTerrain = planned?.land ? "grass" : "water";
        const key = `${targetCell.col},${targetCell.row}`;
        return targetTerrain !== terrain || occupied.has(key) || routeClearance.has(key);
      })
    )
      continue;
    const element: MapElement = {
      col: point.col,
      row: point.row,
      offsetX: asset.domain === "resource" ? 0 : Math.floor(random() * ELEMENT_OFFSET_STEPS),
      offsetY: asset.domain === "resource" ? 0 : Math.floor(random() * ELEMENT_OFFSET_STEPS),
      assetId: asset.id as EditorAssetId,
    };
    if (!elementFitsMap(element, cols, rows)) continue;
    elements.push(element);
    for (const targetCell of footprint) occupied.add(`${targetCell.col},${targetCell.row}`);
  }
  return elements;
}

function ensureResourceVariety(
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  spawn: Point,
  events: readonly MapEvent[],
  original: readonly MapElement[],
  random: () => number,
): MapElement[] {
  const elements = [...original];
  const occupied = new Set(events.map((event) => `${event.col},${event.row}`));
  for (const element of elements) {
    const asset = editorAsset(element.assetId);
    if (!asset) continue;
    for (const point of elementCells(asset, element)) occupied.add(`${point.col},${point.row}`);
  }

  for (const resource of RESOURCE_VARIETY) {
    if (
      elements.some(
        (element) => nativeHarvestProfileForAsset(element.assetId)?.resource === resource,
      )
    )
      continue;
    const assets = PLACEABLE_EDITOR_ASSETS.filter((asset) => {
      if (!allowedGeneratedAsset(asset)) return false;
      return nativeHarvestProfileForAsset(asset.id as EditorAssetId)?.resource === resource;
    });
    for (let attempt = 0; attempt < 700; attempt += 1) {
      const asset = assets[Math.floor(random() * assets.length)];
      if (!asset) break;
      const point = { col: Math.floor(random() * cols), row: Math.floor(random() * rows) };
      const cell = cells[cellIndex(cols, point)];
      if (!cell?.land || cell.route || distance(point, spawn) < 5) continue;
      if (!flatLand(cells, cols, rows, point)) continue;
      const footprint = elementCells(asset, point);
      if (
        footprint.some((target) => {
          const planned = inBounds(cols, rows, target) ? cells[cellIndex(cols, target)] : undefined;
          return !planned?.land || occupied.has(`${target.col},${target.row}`);
        })
      )
        continue;
      const element: MapElement = {
        col: point.col,
        row: point.row,
        offsetX: 0,
        offsetY: 0,
        assetId: asset.id as EditorAssetId,
      };
      if (!elementFitsMap(element, cols, rows)) continue;
      elements.push(element);
      for (const target of footprint) occupied.add(`${target.col},${target.row}`);
      break;
    }
  }
  return elements;
}

function ensureDecorVariety(
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  events: readonly MapEvent[],
  original: readonly MapElement[],
  random: () => number,
): MapElement[] {
  const elements = [...original];
  const occupied = occupiedByElements(elements);
  for (const event of events) occupied.add(pointKey(event));
  for (const category of ["trees", "small-decor", "rocks"] as const) {
    if (elements.some((element) => editorAsset(element.assetId)?.editor.category === category))
      continue;
    const assets = PLACEABLE_EDITOR_ASSETS.filter(
      (asset) =>
        asset.editor.category === category &&
        asset.editor.allowedTerrain.includes("grass") &&
        allowedGeneratedAsset(asset),
    );
    for (let attempt = 0; attempt < 900; attempt += 1) {
      const asset = assets[Math.floor(random() * assets.length)];
      if (!asset) break;
      const point = { col: Math.floor(random() * cols), row: Math.floor(random() * rows) };
      const cell = cells[cellIndex(cols, point)];
      if (!cell?.land || cell.route || cell.zone !== "wild") continue;
      if (tryPlaceElement(elements, occupied, cells, cols, rows, asset.id, point)) break;
    }
  }
  return elements;
}

/** Generate a complete replacement for the open map while retaining its authored shell settings. */
export function generateProceduralMap(base: EditorMap, options: ProceduralMapOptions): EditorMap {
  const selectedSize = PROCEDURAL_MAP_SIZES[options.size];
  // The editor adds an ocean margin around authored content when it derives the stored rectangle.
  // Generate inside that margin so the size presented in the dialog remains the saved upper bound.
  const cols = selectedSize.cols - MAP_OCEAN_MARGIN * 2;
  const rows = selectedSize.rows - MAP_OCEAN_MARGIN * 2;
  const normalizedSeed = options.seed.trim() || "lindocara";
  const seedKey = `${normalizedSeed}:${options.genre}:${options.complexity}:${selectedSize.cols}x${selectedSize.rows}`;
  const seed = hashText(seedKey);
  const random = randomSource(seedKey);
  const spawn = { col: Math.floor(cols / 2), row: Math.floor(rows / 2) };
  const cells = plannedTerrain(options.genre, cols, rows, seed, random);
  const river = carveRiver(cells, cols, rows, seed, random);
  forceSafeDisc(cells, cols, rows, spawn, 3.4, true);
  prepareVillage(cells, cols, rows, spawn);

  const oppositeBank = oppositeBankObjective(river, spawn, cols, rows, random);
  forceSafeDisc(cells, cols, rows, oppositeBank, 3.4, true);
  const areaDangerCount = cols * rows >= 4_500 ? 3 : cols * rows >= 1_700 ? 2 : 1;
  const plannedDangerCount = Math.min(
    4,
    areaDangerCount + (options.complexity === "dense" ? 1 : 0),
  );
  const landmarkCount = Math.max(
    plannedDangerCount + 1,
    options.complexity === "light" ? 2 : options.complexity === "dense" ? 5 : 3,
  );
  const discovered = pickLandmarks(cells, cols, rows, spawn, landmarkCount * 2, random).filter(
    (point) => distance(point, oppositeBank) >= 6,
  );
  const landmarks = [oppositeBank, ...discovered].slice(0, landmarkCount);
  const dangerZones = landmarks.slice(0, Math.min(plannedDangerCount, landmarks.length));
  for (const landmark of landmarks.slice(dangerZones.length)) {
    forceSafeDisc(cells, cols, rows, landmark, 3.4, true);
  }
  const dangerRadius = rows >= 44 ? 5 : 4;
  for (const centre of dangerZones) prepareDangerZone(cells, cols, rows, centre, dangerRadius);

  const routeMaterial: TerrainMaterial = options.genre === "tundra" ? "glace" : "sable";
  const bridgeCrossings: Point[] = [];
  for (const landmark of landmarks) {
    const riverHits = carveRoute(cells, cols, rows, spawn, landmark, routeMaterial);
    const crossing = riverHits[Math.floor(riverHits.length / 2)];
    if (crossing && bridgeCrossings.every((existing) => distance(existing, crossing) >= 4))
      bridgeCrossings.push(crossing);
  }
  forceSafeDisc(cells, cols, rows, spawn, 3.4, true);
  applyShoreMaterials(options.genre, cells, cols, rows);

  const plan: LogicalMapPlan = {
    village: spawn,
    landmarks,
    dangerZones,
    river,
    bridgeCrossings,
  };
  const structures = structurePlan(cells, cols, rows, plan, options.genre);
  const events = eventPlan(
    cells,
    cols,
    rows,
    plan,
    structures,
    options.genre,
    options.complexity,
    seedKey,
    random,
  );
  const scenery = sceneryPlan(
    cells,
    cols,
    rows,
    spawn,
    events,
    structures,
    options.genre,
    options.complexity,
    random,
  );
  const resources = ensureResourceVariety(cells, cols, rows, spawn, events, scenery, random);
  const elements = ensureDecorVariety(cells, cols, rows, events, resources, random);

  return canvasEditorMap({
    ...base,
    layers: buildLayers(cells, cols, rows),
    elements,
    spawn,
    markers: EMPTY_MARKERS,
    events,
  });
}
