import type { ColliderRect } from "./hd2d/collider-index.js";
import type { TerrainMaterial } from "./hd2d/terrain-query.js";
import type { InteriorShellStyle } from "./map-environment.js";

export type InteriorShellSide = "north" | "east" | "south" | "west";

/** One contiguous boundary run. `x`/`z` are its world-space centre on the floor edge. */
export interface InteriorShellRun {
  side: InteriorShellSide;
  x: number;
  z: number;
  length: number;
  level: number;
}

export const INTERIOR_SHELL_THICKNESS = 0.42;
export const INTERIOR_SHELL_WALL_HEIGHT = 2.6;
export const INTERIOR_SHELL_SILL_HEIGHT = 0.34;

/**
 * The authored terrain that grows each envelope.
 *
 * Constructed interiors use the existing sand brush as their neutral structural-floor marker; the
 * renderer replaces only that marker with timber boards or castle stone. Natural interiors use
 * their own material directly. Water and grass therefore remain ordinary decoration, never an
 * accidental instruction to build another wall.
 */
export function interiorShellFloorMaterial(style: InteriorShellStyle): TerrainMaterial {
  switch (style) {
    case "timber":
    case "castle":
      return "sable";
    case "cave":
      return "grotte";
    case "mountain":
      return "montagne";
    case "volcano":
      return "volcan";
    case "ice":
      return "glace";
    case "snow":
      return "neige";
  }
}

/**
 * Build the architectural footprint from the selected coating's structural floor.
 *
 * A flood fill marks non-structural cells reachable from the map edge as outside. Any other terrain
 * or liquid enclosed by structural floor stays inside the room, so a rug, pool, lava basin or grass
 * patch does not sprout walls around itself. The result is consumed by both renderer and compiler;
 * visual walls and authoritative collision therefore use exactly the same footprint.
 */
export function interiorShellLevels(
  size: number,
  levels: readonly (number | null)[],
  materials: readonly TerrainMaterial[],
  style: InteriorShellStyle,
  liquidLevels: readonly (number | null)[] = [],
): Array<number | null> {
  const cells = size * size;
  const floor = interiorShellFloorMaterial(style);
  const structural = new Uint8Array(cells);
  for (let index = 0; index < cells; index += 1) {
    if (levels[index] !== null && levels[index] !== undefined && materials[index] === floor) {
      structural[index] = 1;
    }
  }

  const outside = new Uint8Array(cells);
  const queue = new Int32Array(cells);
  let head = 0;
  let tail = 0;
  const enqueue = (index: number): void => {
    if (structural[index] || outside[index]) return;
    outside[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let coordinate = 0; coordinate < size; coordinate += 1) {
    enqueue(coordinate);
    enqueue((size - 1) * size + coordinate);
    enqueue(coordinate * size);
    enqueue(coordinate * size + size - 1);
  }
  while (head < tail) {
    const index = queue[head];
    head += 1;
    if (index === undefined) break;
    const col = index % size;
    const row = Math.floor(index / size);
    if (col > 0) enqueue(index - 1);
    if (col + 1 < size) enqueue(index + 1);
    if (row > 0) enqueue(index - size);
    if (row + 1 < size) enqueue(index + size);
  }

  return Array.from({ length: cells }, (_unused, index) => {
    if (outside[index]) return null;
    return levels[index] ?? liquidLevels[index] ?? 0;
  });
}

interface Edge {
  side: InteriorShellSide;
  fixed: number;
  start: number;
  level: number;
}

/**
 * Derive the room envelope from the floor itself.
 *
 * Runs, instead of one item per cell, are the performance contract: a rectangular 256-cell room
 * has four colliders, not 1,024. The renderer expands those same runs into GPU instances, so the
 * visible wall and the authoritative boundary cannot disagree about the room's shape.
 */
export function interiorShellRuns(
  size: number,
  levels: readonly (number | null)[],
): InteriorShellRun[] {
  const at = (col: number, row: number): number | null => {
    if (col < 0 || row < 0 || col >= size || row >= size) return null;
    return levels[row * size + col] ?? null;
  };
  const edges: Edge[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const level = at(col, row);
      if (level === null) continue;
      if (at(col, row - 1) === null) edges.push({ side: "north", fixed: row, start: col, level });
      if (at(col + 1, row) === null)
        edges.push({ side: "east", fixed: col + 1, start: row, level });
      if (at(col, row + 1) === null)
        edges.push({ side: "south", fixed: row + 1, start: col, level });
      if (at(col - 1, row) === null) edges.push({ side: "west", fixed: col, start: row, level });
    }
  }

  edges.sort(
    (left, right) =>
      left.side.localeCompare(right.side) ||
      left.fixed - right.fixed ||
      left.level - right.level ||
      left.start - right.start,
  );

  const merged: Array<Edge & { length: number }> = [];
  for (const edge of edges) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.side === edge.side &&
      previous.fixed === edge.fixed &&
      previous.level === edge.level &&
      previous.start + previous.length === edge.start
    ) {
      previous.length += 1;
      continue;
    }
    merged.push({ ...edge, length: 1 });
  }

  const half = size / 2;
  return merged.map((edge) => {
    const horizontal = edge.side === "north" || edge.side === "south";
    return {
      side: edge.side,
      x: horizontal ? edge.start + edge.length / 2 - half : edge.fixed - half,
      z: horizontal ? edge.fixed - half : edge.start + edge.length / 2 - half,
      length: edge.length,
      level: edge.level,
    };
  });
}

/** Finite wall volumes compiled into the heightfield read by both movement authorities. */
export function interiorShellColliders(
  runs: readonly InteriorShellRun[],
  levelHeight: number,
): ColliderRect[] {
  const halfThickness = INTERIOR_SHELL_THICKNESS / 2;
  return runs.map((run) => {
    const horizontal = run.side === "north" || run.side === "south";
    const base = run.level * levelHeight;
    return {
      x: horizontal ? run.x - run.length / 2 : run.x - halfThickness,
      z: horizontal ? run.z - halfThickness : run.z - run.length / 2,
      w: horizontal ? run.length : INTERIOR_SHELL_THICKNESS,
      h: horizontal ? INTERIOR_SHELL_THICKNESS : run.length,
      bottom: base - 0.08,
      top: base + INTERIOR_SHELL_WALL_HEIGHT,
    };
  });
}
