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
}

interface Point {
  col: number;
  row: number;
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

const RESOURCE_VARIETY: readonly HarvestResourceKind[] = ["wood", "stone", "iron", "meat", "gold"];

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

      cells.push({ land, level, material, route: false });
    }
  }
  return cells;
}

function forceSafeDisc(cells: PlannedCell[], cols: number, rows: number, centre: Point): void {
  for (let row = centre.row - 3; row <= centre.row + 3; row += 1) {
    for (let col = centre.col - 3; col <= centre.col + 3; col += 1) {
      const point = { col, row };
      if (!inBounds(cols, rows, point) || distance(point, centre) > 3.4) continue;
      const cell = cells[cellIndex(cols, point)];
      if (!cell) continue;
      cell.land = true;
      cell.level = 0;
      cell.material = "herbe";
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
): void {
  let col = from.col;
  let row = from.row;
  const dx = Math.abs(to.col - from.col);
  const dy = Math.abs(to.row - from.row);
  const sx = from.col < to.col ? 1 : -1;
  const sy = from.row < to.row ? 1 : -1;
  let error = dx - dy;
  for (;;) {
    for (const offset of [{ col: 0, row: 0 }, ...ORTHOGONAL]) {
      const point = { col: col + offset.col, row: row + offset.row };
      if (!inBounds(cols, rows, point)) continue;
      const cell = cells[cellIndex(cols, point)];
      if (!cell) continue;
      cell.land = true;
      cell.level = 0;
      cell.material = material;
      cell.route = true;
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

function eventPlan(
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  spawn: Point,
  landmarks: readonly Point[],
  genre: ProceduralMapGenre,
  complexity: ProceduralMapComplexity,
  seed: string,
  random: () => number,
): MapEvent[] {
  const events: MapEvent[] = [];
  const occupied = new Set<string>();
  const add = (event: MapEvent): void => {
    if (events.length >= MAX_EVENTS_PER_MAP) return;
    events.push(event);
    occupied.add(`${event.col},${event.row}`);
  };
  let ordinal = 1;
  add(
    functionalEvent({
      id: deterministicUuid(seed, "spawn"),
      col: spawn.col,
      row: spawn.row,
      ordinal: ordinal++,
      kind: "spawn",
    }),
  );

  for (const [index, landmark] of landmarks.entries()) {
    add(
      presetEvent({
        id: deterministicUuid(seed, `chest-${index}`),
        col: landmark.col,
        row: landmark.row,
        ordinal: ordinal++,
        preset: "chest",
        selfMapId: "",
        selfSpawn: spawn,
      }),
    );
  }

  const npcPoint = ORTHOGONAL.map((offset) => ({
    col: spawn.col + offset.col * 2,
    row: spawn.row + offset.row * 2,
  })).find((point) => inBounds(cols, rows, point) && flatLand(cells, cols, rows, point));
  if (npcPoint) {
    const npc = functionalEvent({
      id: deterministicUuid(seed, "guide"),
      col: npcPoint.col,
      row: npcPoint.row,
      ordinal: ordinal++,
      kind: "npc",
      patrolRadius: 2,
    });
    add({
      ...npc,
      pages: [
        {
          ...(npc.pages[0] ?? defaultEventPage()),
          graphicAssetId: DEFAULT_NPC_MODEL_ASSET_ID,
          moveType: "random",
          moveSpeed: 3,
          moveFreq: 2,
        },
      ],
    });
  }

  const targetMonsters = Math.max(
    2,
    Math.min(28, Math.round((cols * rows) / MONSTER_AREA[complexity])),
  );
  const species = GENRE_MONSTERS[genre];
  for (
    let attempt = 0;
    attempt < targetMonsters * 50 && events.length < targetMonsters + landmarks.length + 2;
    attempt += 1
  ) {
    const point = { col: Math.floor(random() * cols), row: Math.floor(random() * rows) };
    if (
      distance(point, spawn) < 7 ||
      occupied.has(`${point.col},${point.row}`) ||
      !flatLand(cells, cols, rows, point)
    )
      continue;
    const monsterSpecies = species[Math.floor(random() * species.length)] ?? "spear_goblin";
    add(
      functionalEvent({
        id: deterministicUuid(seed, `monster-${events.length}`),
        col: point.col,
        row: point.row,
        ordinal: ordinal++,
        kind: "monster",
        species: monsterSpecies,
        patrolRadius: complexity === "dense" ? 4 : 3,
      }),
    );
  }
  return events;
}

function assetWeight(asset: EditorAssetDefinition, genre: ProceduralMapGenre): number {
  const categoryWeight = GENRE_CATEGORIES[genre][asset.editor.category] ?? 0;
  return categoryWeight * (asset.domain === "resource" ? 1.8 : 1);
}

function assetPool(genre: ProceduralMapGenre, terrain: "grass" | "water"): EditorAssetDefinition[] {
  return PLACEABLE_EDITOR_ASSETS.filter(
    (asset) =>
      assetWeight(asset, genre) > 0 &&
      asset.editor.allowedTerrain.includes(terrain) &&
      asset.editor.renderLayer !== "sky" &&
      !asset.id.toLowerCase().includes("stump"),
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

function sceneryPlan(
  cells: readonly PlannedCell[],
  cols: number,
  rows: number,
  spawn: Point,
  events: readonly MapEvent[],
  genre: ProceduralMapGenre,
  complexity: ProceduralMapComplexity,
  random: () => number,
): MapElement[] {
  const landAssets = assetPool(genre, "grass");
  const waterAssets = assetPool(genre, "water");
  const occupied = new Set(events.map((event) => `${event.col},${event.row}`));
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

  const target = Math.min(
    MAX_MAP_ELEMENTS - 8,
    Math.round(cols * rows * ELEMENT_DENSITY[complexity]),
  );
  const elements: MapElement[] = [];
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
      if (asset.id.toLowerCase().includes("stump")) return false;
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
  forceSafeDisc(cells, cols, rows, spawn);
  const landmarkCount = options.complexity === "light" ? 2 : options.complexity === "dense" ? 5 : 3;
  const landmarks = pickLandmarks(cells, cols, rows, spawn, landmarkCount, random);
  const routeMaterial: TerrainMaterial = options.genre === "tundra" ? "glace" : "sable";
  for (const landmark of landmarks) carveRoute(cells, cols, rows, spawn, landmark, routeMaterial);
  forceSafeDisc(cells, cols, rows, spawn);
  applyShoreMaterials(options.genre, cells, cols, rows);

  const events = eventPlan(
    cells,
    cols,
    rows,
    spawn,
    landmarks,
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
    options.genre,
    options.complexity,
    random,
  );
  const elements = ensureResourceVariety(cells, cols, rows, spawn, events, scenery, random);

  return canvasEditorMap({
    ...base,
    layers: buildLayers(cells, cols, rows),
    elements,
    spawn,
    markers: EMPTY_MARKERS,
    events,
  });
}
