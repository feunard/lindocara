/**
 * The island builder behind Sombregué's maps.
 *
 * Tiny Swords' own promo art is the target: irregular grass islands floating on a teal sea, plateaus
 * with cliff faces, trees crowding the shoreline, bushes and rocks scattered inland, and rocks
 * breaking the water offshore. The previous adventure painted one grass rectangle inset by a single
 * water cell, which is why every map read as a football pitch with a border.
 *
 * Nothing here invents art. It composes the pack's own assets and the engine's own pure brushes —
 * the same `paintAutotile`/`paintElevation` the editor calls — so a map built by this script is a map
 * an author could have drawn by hand, and the autotiler picks the shoreline variants for free.
 *
 * Everything is DETERMINISTIC: `mulberry32` seeded from a string, never `Math.random`. Re-running the
 * seed must produce byte-identical maps, or "reset and reseed" becomes a diff nobody can review.
 */

import type { MapElement } from "@lindocara/engine/map-data.js";
import {
  paintAutotile,
  paintElevation,
  resolveWholeLayer,
  syncElevationWalls,
} from "@lindocara/engine/tile-brush.js";
import { emptyLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { GRASS_SLOTS, TINY_SWORDS_TILESET } from "@lindocara/engine/tilesets/tiny-swords.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";

/** `true` where the shape covers a cell. Indexed `[row][col]`, like every layer in this codebase. */
export type Mask = boolean[][];

export interface Rng {
  (): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
}

/** Deterministic, tiny, and good enough for scatter — the seed is the map's name. */
export function rngFor(seed: string): Rng {
  let state = 0x9e3779b9;
  for (const character of seed) state = (state ^ character.charCodeAt(0)) * 0x01000193;
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = next as Rng;
  rng.int = (maxExclusive: number) => Math.floor(next() * maxExclusive);
  rng.pick = <T>(items: readonly T[]): T => {
    const chosen = items[Math.floor(next() * items.length)];
    if (chosen === undefined) throw new Error("pick from an empty list");
    return chosen;
  };
  rng.chance = (probability: number) => next() < probability;
  return rng;
}

export function emptyMask(cols: number, rows: number): Mask {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => false));
}

export function maskAt(mask: Mask, col: number, row: number): boolean {
  return mask[row]?.[col] ?? false;
}

function setMask(mask: Mask, col: number, row: number, value: boolean): void {
  const line = mask[row];
  if (line && col >= 0 && col < line.length) line[col] = value;
}

export function forEachCell(mask: Mask, visit: (col: number, row: number) => void): void {
  for (const [row, line] of mask.entries()) {
    for (const [col, filled] of line.entries()) if (filled) visit(col, row);
  }
}

export function countCells(mask: Mask): number {
  let total = 0;
  forEachCell(mask, () => {
    total += 1;
  });
  return total;
}

/**
 * An irregular blob: an ellipse whose radius wobbles with the angle.
 *
 * The wobble is what separates an island from a stadium. Four harmonics with seeded phases keep the
 * outline curved rather than noisy — per-cell noise would produce a fringe of single-tile spits the
 * autotiler has no variant for, and a shoreline the player cannot read.
 */
export function blob(
  mask: Mask,
  rng: Rng,
  params: {
    col: number;
    row: number;
    radiusX: number;
    radiusY: number;
    /** 0 = a clean ellipse, 0.35 = a properly ragged coast. */
    wobble?: number;
  },
): Mask {
  const wobble = params.wobble ?? 0.22;
  const phases = [rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2];
  for (const [row, line] of mask.entries()) {
    for (const col of line.keys()) {
      const dx = (col - params.col) / params.radiusX;
      const dy = (row - params.row) / params.radiusY;
      const distance = Math.hypot(dx, dy);
      if (distance === 0) {
        setMask(mask, col, row, true);
        continue;
      }
      const angle = Math.atan2(dy, dx);
      const ripple =
        Math.sin(angle * 2 + (phases[0] ?? 0)) * 0.5 +
        Math.sin(angle * 3 + (phases[1] ?? 0)) * 0.32 +
        Math.sin(angle * 5 + (phases[2] ?? 0)) * 0.18;
      if (distance <= 1 + ripple * wobble) setMask(mask, col, row, true);
    }
  }
  return mask;
}

export function rectMask(
  mask: Mask,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  value = true,
): Mask {
  for (let row = Math.min(r0, r1); row <= Math.max(r0, r1); row++) {
    for (let col = Math.min(c0, c1); col <= Math.max(c0, c1); col++) setMask(mask, col, row, value);
  }
  return mask;
}

/** A walkable ribbon between two cells — the isthmus that keeps an archipelago traversable. */
export function causeway(
  mask: Mask,
  from: { col: number; row: number },
  to: { col: number; row: number },
  halfWidth = 1,
): Mask {
  const steps = Math.max(Math.abs(to.col - from.col), Math.abs(to.row - from.row));
  for (let step = 0; step <= steps; step++) {
    const t = steps === 0 ? 0 : step / steps;
    const col = Math.round(from.col + (to.col - from.col) * t);
    const row = Math.round(from.row + (to.row - from.row) * t);
    rectMask(mask, col - halfWidth, row - halfWidth, col + halfWidth, row + halfWidth);
  }
  return mask;
}

/**
 * Drop lone cells and fill lone holes.
 *
 * A one-cell spit or a one-cell pond is where a hand-drawn map and a generated one part company: the
 * autotiler resolves both, but they read as noise and a `PLAYER_SIZE` body cannot stand on the spit
 * anyway. Two passes settle the coast without rounding away the shape.
 */
export function smooth(mask: Mask, passes = 2): Mask {
  for (let pass = 0; pass < passes; pass++) {
    const before = mask.map((line) => [...line]);
    const neighbourCount = (col: number, row: number) => {
      let total = 0;
      for (const [dc, dr] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ] as const) {
        if (before[row + dr]?.[col + dc]) total += 1;
      }
      return total;
    };
    for (const [row, line] of mask.entries()) {
      for (const col of line.keys()) {
        const filled = before[row]?.[col] ?? false;
        const neighbours = neighbourCount(col, row);
        if (filled && neighbours <= 1) setMask(mask, col, row, false);
        if (!filled && neighbours >= 3) setMask(mask, col, row, true);
      }
    }
  }
  return mask;
}

/** Cells of `mask` that touch water (or the map edge) on one of their four sides. */
export function shoreCells(mask: Mask): { col: number; row: number }[] {
  const cells: { col: number; row: number }[] = [];
  forEachCell(mask, (col, row) => {
    const open =
      !maskAt(mask, col, row - 1) ||
      !maskAt(mask, col + 1, row) ||
      !maskAt(mask, col, row + 1) ||
      !maskAt(mask, col - 1, row);
    if (open) cells.push({ col, row });
  });
  return cells;
}

/** `mask` minus every cell within `depth` of the water — the safe interior to build and walk on. */
export function inland(mask: Mask, depth = 1): Mask {
  let current = mask.map((line) => [...line]);
  for (let step = 0; step < depth; step++) {
    const previous = current.map((line) => [...line]);
    const next = emptyMask(mask[0]?.length ?? 0, mask.length);
    for (const [row, line] of previous.entries()) {
      for (const [col, filled] of line.entries()) {
        if (!filled) continue;
        const enclosed =
          (previous[row - 1]?.[col] ?? false) &&
          (previous[row]?.[col + 1] ?? false) &&
          (previous[row + 1]?.[col] ?? false) &&
          (previous[row]?.[col - 1] ?? false);
        if (enclosed) setMask(next, col, row, true);
      }
    }
    current = next;
  }
  return current;
}

/**
 * Paint the ground: grass wherever the mask is set, water (an empty tile) everywhere else, then one
 * whole-layer resolve so every shoreline variant is picked once against the finished shape.
 */
export function paintGround(cols: number, rows: number, land: Mask): TileLayer[] {
  let ground = emptyLayer(cols, rows);
  const grass = GRASS_SLOTS[0];
  if (grass === undefined) throw new Error("the tileset has no grass slot");
  forEachCell(land, (col, row) => {
    ground = paintAutotile(ground, TINY_SWORDS_TILESET, grass, col, row);
  });
  return [
    resolveWholeLayer(ground, TINY_SWORDS_TILESET),
    emptyLayer(cols, rows),
    emptyLayer(cols, rows),
  ];
}

/**
 * Raise `plateau` to `level`, letting the brush maintain the cliff faces.
 *
 * `paintElevation` writes the ground cell AND the face on every lower neighbour, so a plateau is a
 * real barrier on all four sides — which is exactly the silhouette the pack's promo art gets from its
 * stacked rock walls. The caller is responsible for leaving a stair or a walk-around.
 */
export function raise(layers: TileLayer[], plateau: Mask, level: 1 | 2): TileLayer[] {
  let current = layers;
  forEachCell(plateau, (col, row) => {
    current = paintElevation(current, TINY_SWORDS_TILESET, level, col, row);
  });
  // One more sync pass over the plateau's rim: a face written early can be buried by a cell painted
  // later in the same sweep, and a stale face is an invisible collider.
  forEachCell(plateau, (col, row) => {
    current = syncElevationWalls(current, TINY_SWORDS_TILESET, col, row);
  });
  return current;
}

export const TREES: readonly EditorAssetId[] = [
  "resource.terrain-resources-wood-trees.tree1",
  "resource.terrain-resources-wood-trees.tree2",
  "resource.terrain-resources-wood-trees.tree3",
  "resource.terrain-resources-wood-trees.tree4",
] as EditorAssetId[];

export const BUSHES: readonly EditorAssetId[] = [
  "decoration.terrain-decorations-bushes.bushe1",
  "decoration.terrain-decorations-bushes.bushe2",
  "decoration.terrain-decorations-bushes.bushe3",
  "decoration.terrain-decorations-bushes.bushe4",
] as EditorAssetId[];

export const ROCKS: readonly EditorAssetId[] = [
  "decoration.terrain-decorations-rocks.rock1",
  "decoration.terrain-decorations-rocks.rock2",
  "decoration.terrain-decorations-rocks.rock3",
  "decoration.terrain-decorations-rocks.rock4",
] as EditorAssetId[];

export const WATER_ROCKS: readonly EditorAssetId[] = [
  "decoration.terrain-decorations-rocks-in-the-water.water-rocks-01",
  "decoration.terrain-decorations-rocks-in-the-water.water-rocks-02",
  "decoration.terrain-decorations-rocks-in-the-water.water-rocks-03",
  "decoration.terrain-decorations-rocks-in-the-water.water-rocks-04",
] as EditorAssetId[];

export const STUMPS: readonly EditorAssetId[] = [
  "resource.terrain-resources-wood-trees.stump-1",
  "resource.terrain-resources-wood-trees.stump-2",
  "resource.terrain-resources-wood-trees.stump-3",
  "resource.terrain-resources-wood-trees.stump-4",
] as EditorAssetId[];

export function element(
  assetId: EditorAssetId,
  col: number,
  row: number,
  offsetX = 0,
  offsetY = 0,
): MapElement {
  return { col, row, offsetX, offsetY, assetId };
}

/** Cells the composition passes must leave clear — spawns, doorways, event tiles, paths. */
export interface Reserved {
  has(col: number, row: number): boolean;
}

export function reserve(cells: readonly { col: number; row: number }[], radius = 1): Reserved {
  const keys = new Set<string>();
  for (const cell of cells) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) keys.add(`${cell.col + dc}:${cell.row + dr}`);
    }
  }
  return { has: (col, row) => keys.has(`${col}:${row}`) };
}

/**
 * Crowd the shoreline with trees, the way the pack's art does.
 *
 * Trees go on the SHORE ring rather than uniformly inland: it frames the island, it keeps the middle
 * open for gameplay, and it is what makes a generated coast read as drawn. Each tree carries a trunk
 * collider, so a solid ring would wall the island off — hence the density cap and the reserved set.
 */
export function shoreTreeLine(
  land: Mask,
  rng: Rng,
  reserved: Reserved,
  density = 0.42,
): MapElement[] {
  const elements: MapElement[] = [];
  for (const cell of shoreCells(land)) {
    if (reserved.has(cell.col, cell.row)) continue;
    if (!rng.chance(density)) continue;
    elements.push(element(rng.pick(TREES), cell.col, cell.row, rng.int(3), rng.int(3)));
  }
  return elements;
}

/** Scatter props across the interior at quarter-cell offsets, skipping anything reserved. */
export function scatter(
  area: Mask,
  rng: Rng,
  reserved: Reserved,
  assets: readonly EditorAssetId[],
  density: number,
): MapElement[] {
  const elements: MapElement[] = [];
  forEachCell(area, (col, row) => {
    if (reserved.has(col, row)) return;
    if (!rng.chance(density)) return;
    elements.push(element(rng.pick(assets), col, row, rng.int(4), rng.int(4)));
  });
  return elements;
}

/** Rocks breaking the water offshore — the pack's own way of filling an empty sea. */
export function offshoreRocks(
  cols: number,
  rows: number,
  land: Mask,
  rng: Rng,
  density = 0.05,
): MapElement[] {
  const elements: MapElement[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (maskAt(land, col, row)) continue;
      // Hug the coast: a rock alone in open water reads as a mistake rather than as a reef.
      const nearLand =
        maskAt(land, col + 1, row) ||
        maskAt(land, col - 1, row) ||
        maskAt(land, col, row + 1) ||
        maskAt(land, col, row - 1) ||
        maskAt(land, col + 2, row) ||
        maskAt(land, col - 2, row);
      if (!nearLand && !rng.chance(density / 4)) continue;
      if (!rng.chance(density)) continue;
      elements.push(element(rng.pick(WATER_ROCKS), col, row, rng.int(4), rng.int(4)));
    }
  }
  return elements;
}

/**
 * Snap hand-written coordinates onto generated ground.
 *
 * An author picks "the captain stands near the gate"; the coastline is generated, so the exact cell
 * may have turned out to be sea, a cliff face, or already taken by another event. Guessing harder is
 * not the answer — every reshape would break every coordinate again. This walks outward from the
 * requested cell to the nearest cell that is genuinely placeable and not yet used, and reserves it.
 *
 * `placeable` must already exclude water, cliff cells and the map border, so the caller states the
 * rule once and every placement inherits it.
 */
export function snapper(placeable: Mask): {
  at(col: number, row: number): { col: number; row: number };
  used(): { col: number; row: number }[];
} {
  const taken = new Set<string>();
  const claimed: { col: number; row: number }[] = [];
  return {
    at(col, row) {
      const rows = placeable.length;
      const cols = placeable[0]?.length ?? 0;
      // Breadth-first over growing rings: the first hit is the closest legal cell, deterministically.
      for (let radius = 0; radius < Math.max(cols, rows); radius++) {
        for (let dr = -radius; dr <= radius; dr++) {
          for (let dc = -radius; dc <= radius; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
            const c = col + dc;
            const r = row + dr;
            if (!maskAt(placeable, c, r)) continue;
            const key = `${c}:${r}`;
            if (taken.has(key)) continue;
            taken.add(key);
            claimed.push({ col: c, row: r });
            return { col: c, row: r };
          }
        }
      }
      throw new Error(`no placeable cell anywhere near (${col},${row})`);
    },
    used: () => claimed,
  };
}

/** Land minus the plateau (whose rim carries cliff faces) minus a one-cell margin from the sea. */
export function placeableMask(land: Mask, plateau: Mask | null): Mask {
  const safe = inland(land, 1);
  if (!plateau) return safe;
  for (const [row, line] of safe.entries()) {
    for (const [col, filled] of line.entries()) {
      if (!filled) continue;
      // A cell ON the plateau is fine to stand on; a cell ADJACENT to it may hold a cliff face.
      const touchesRim =
        maskAt(plateau, col, row) !== maskAt(plateau, col, row - 1) ||
        maskAt(plateau, col, row) !== maskAt(plateau, col + 1, row) ||
        maskAt(plateau, col, row) !== maskAt(plateau, col, row + 1) ||
        maskAt(plateau, col, row) !== maskAt(plateau, col - 1, row);
      if (touchesRim) line[col] = false;
    }
  }
  return safe;
}
