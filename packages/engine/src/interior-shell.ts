import type { ColliderRect } from "./hd2d/collider-index.js";
import type { TerrainMaterial } from "./hd2d/terrain-query.js";
import type { InteriorShell, InteriorShellCellRun, InteriorShellStyle } from "./map-environment.js";

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

function normalizedCellRuns(runs: readonly InteriorShellCellRun[]): InteriorShellCellRun[] {
  const byRow = new Map<number, Array<{ start: number; end: number }>>();
  for (const run of runs) {
    const row = byRow.get(run.row) ?? [];
    row.push({ start: run.col, end: run.col + run.length });
    byRow.set(run.row, row);
  }
  const normalized: InteriorShellCellRun[] = [];
  for (const row of [...byRow.keys()].sort((left, right) => left - right)) {
    const intervals = byRow.get(row);
    if (!intervals) continue;
    intervals.sort((left, right) => left.start - right.start || left.end - right.end);
    let current: { start: number; end: number } | null = null;
    for (const interval of intervals) {
      if (current && interval.start <= current.end) {
        current.end = Math.max(current.end, interval.end);
        continue;
      }
      if (current)
        normalized.push({ col: current.start, row, length: current.end - current.start });
      current = { ...interval };
    }
    if (current) normalized.push({ col: current.start, row, length: current.end - current.start });
  }
  return normalized;
}

function sameCellRuns(
  left: readonly InteriorShellCellRun[],
  right: readonly InteriorShellCellRun[],
): boolean {
  return (
    left.length === right.length &&
    left.every((run, index) => {
      const other = right[index];
      return other?.col === run.col && other.row === run.row && other.length === run.length;
    })
  );
}

/** Add cells to the persisted inner-room mask, merging adjacent cells into compact row runs. */
export function addInteriorShellInnerWalls(
  shell: InteriorShell,
  cells: readonly { col: number; row: number }[],
): InteriorShell {
  if (cells.length === 0) return shell;
  const current = shell.innerWalls ?? [];
  const innerWalls = normalizedCellRuns([
    ...current,
    ...cells.map((cell) => ({ ...cell, length: 1 })),
  ]);
  return sameCellRuns(current, innerWalls) ? shell : { ...shell, innerWalls };
}

/** Drop mask cells whose visible terrain no longer belongs to the selected structural coating. */
export function filterInteriorShellInnerWalls(
  shell: InteriorShell,
  keep: (col: number, row: number) => boolean,
): InteriorShell {
  const current = shell.innerWalls ?? [];
  if (current.length === 0) return shell;
  const cells: Array<{ col: number; row: number; length: number }> = [];
  for (const run of current) {
    for (let col = run.col; col < run.col + run.length; col += 1) {
      if (keep(col, run.row)) cells.push({ col, row: run.row, length: 1 });
    }
  }
  const innerWalls = normalizedCellRuns(cells);
  if (sameCellRuns(current, innerWalls)) return shell;
  return innerWalls.length === 0 ? { style: shell.style } : { ...shell, innerWalls };
}

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

function innerWallLevels(
  size: number,
  levels: readonly (number | null)[],
  materials: readonly TerrainMaterial[],
  shell: InteriorShell,
): Array<number | null> {
  const inner = new Array<number | null>(size * size).fill(null);
  const floor = interiorShellFloorMaterial(shell.style);
  for (const run of shell.innerWalls ?? []) {
    if (run.row < 0 || run.row >= size) continue;
    for (let col = run.col; col < run.col + run.length && col < size; col += 1) {
      if (col < 0) continue;
      const index = run.row * size + col;
      const level = levels[index];
      if (level !== null && level !== undefined && materials[index] === floor) inner[index] = level;
    }
  }
  return inner;
}

/** Merge overlapping/adjacent world runs, including an inner wall that reaches the outer shell. */
function mergeBoundaryRuns(size: number, runs: readonly InteriorShellRun[]): InteriorShellRun[] {
  const edges: Edge[] = [];
  const half = size / 2;
  for (const run of runs) {
    const horizontal = run.side === "north" || run.side === "south";
    const fixed = (horizontal ? run.z : run.x) + half;
    const start = (horizontal ? run.x : run.z) - run.length / 2 + half;
    for (let cell = 0; cell < run.length; cell += 1) {
      edges.push({ side: run.side, fixed, start: start + cell, level: run.level });
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
      edge.start <= previous.start + previous.length
    ) {
      previous.length = Math.max(previous.length, edge.start + 1 - previous.start);
      continue;
    }
    merged.push({ ...edge, length: 1 });
  }
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

/** Outer envelope plus every explicitly repainted inner room, from one shared geometry rule. */
export function interiorShellBoundaryRuns(
  size: number,
  levels: readonly (number | null)[],
  materials: readonly TerrainMaterial[],
  shell: InteriorShell,
  liquidLevels: readonly (number | null)[] = [],
): InteriorShellRun[] {
  const outer = interiorShellRuns(
    size,
    interiorShellLevels(size, levels, materials, shell.style, liquidLevels),
  );
  if (!shell.innerWalls || shell.innerWalls.length === 0) return outer;
  const inner = interiorShellRuns(size, innerWallLevels(size, levels, materials, shell));
  return mergeBoundaryRuns(size, [...outer, ...inner]);
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
