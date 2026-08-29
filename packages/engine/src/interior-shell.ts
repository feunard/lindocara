import type { ColliderRect } from "./hd2d/collider-index.js";
import type { TerrainMaterial } from "./hd2d/terrain-query.js";
import type {
  InteriorShell,
  InteriorShellCellRun,
  InteriorShellOpeningRun,
  InteriorShellStyle,
} from "./map-environment.js";

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

function openingUnits(run: InteriorShellOpeningRun): InteriorShellOpeningRun[] {
  return Array.from({ length: run.length }, (_unused, offset) => ({
    side: run.side,
    col: run.col + (run.side === "north" || run.side === "south" ? offset : 0),
    row: run.row + (run.side === "east" || run.side === "west" ? offset : 0),
    length: 1,
  }));
}

function openingKey(edge: Omit<InteriorShellOpeningRun, "length">): string {
  return `${edge.side}:${edge.col}:${edge.row}`;
}

function compactOpeningRuns(edges: readonly InteriorShellOpeningRun[]): InteriorShellOpeningRun[] {
  const units = new Map<string, InteriorShellOpeningRun>();
  for (const run of edges) {
    for (const edge of openingUnits(run)) units.set(openingKey(edge), edge);
  }
  const ordered = [...units.values()].sort(
    (left, right) =>
      left.side.localeCompare(right.side) || left.row - right.row || left.col - right.col,
  );
  const compact: InteriorShellOpeningRun[] = [];
  for (const edge of ordered) {
    const previous = compact.at(-1);
    const horizontal = edge.side === "north" || edge.side === "south";
    if (
      previous &&
      previous.side === edge.side &&
      (horizontal ? previous.row === edge.row : previous.col === edge.col) &&
      (horizontal
        ? previous.col + previous.length === edge.col
        : previous.row + previous.length === edge.row)
    ) {
      previous.length += 1;
    } else {
      compact.push({ ...edge });
    }
  }
  return compact;
}

function sameOpeningRuns(
  left: readonly InteriorShellOpeningRun[],
  right: readonly InteriorShellOpeningRun[],
): boolean {
  return (
    left.length === right.length &&
    left.every((run, index) => {
      const other = right[index];
      return (
        other?.side === run.side &&
        other.col === run.col &&
        other.row === run.row &&
        other.length === run.length
      );
    })
  );
}

/** Add/merge one traversable wall gap. */
export function addInteriorShellOpening(
  shell: InteriorShell,
  opening: InteriorShellOpeningRun,
): InteriorShell {
  const current = shell.openings ?? [];
  const openings = compactOpeningRuns([...current, opening]);
  return sameOpeningRuns(current, openings) ? shell : { ...shell, openings };
}

/** Close only the requested unit edges, splitting wider saved gaps when necessary. */
export function removeInteriorShellOpening(
  shell: InteriorShell,
  closing: InteriorShellOpeningRun,
): InteriorShell {
  if (!shell.openings?.length) return shell;
  const removed = new Set(openingUnits(closing).map(openingKey));
  const remaining = shell.openings
    .flatMap(openingUnits)
    .filter((edge) => !removed.has(openingKey(edge)));
  if (remaining.length > 0) {
    const openings = compactOpeningRuns(remaining);
    return sameOpeningRuns(shell.openings, openings) ? shell : { ...shell, openings };
  }
  const { openings: _removed, ...withoutOpenings } = shell;
  return withoutOpenings;
}

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
  if (innerWalls.length > 0) return { ...shell, innerWalls };
  const { innerWalls: _removed, ...withoutInnerWalls } = shell;
  return withoutInnerWalls;
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

export interface InteriorShellRunGroups {
  outer: readonly InteriorShellRun[];
  inner: readonly InteriorShellRun[];
}

function openingEdgeForRunUnit(
  size: number,
  run: InteriorShellRun,
  offset: number,
): InteriorShellOpeningRun {
  const half = size / 2;
  const horizontal = run.side === "north" || run.side === "south";
  const fixed = Math.round((horizontal ? run.z : run.x) + half);
  const start = Math.round((horizontal ? run.x : run.z) - run.length / 2 + half) + offset;
  switch (run.side) {
    case "north":
      return { side: run.side, col: start, row: fixed, length: 1 };
    case "south":
      return { side: run.side, col: start, row: fixed - 1, length: 1 };
    case "east":
      return { side: run.side, col: fixed - 1, row: start, length: 1 };
    case "west":
      return { side: run.side, col: fixed, row: start, length: 1 };
  }
}

function withoutOpenings(
  size: number,
  runs: readonly InteriorShellRun[],
  openings: readonly InteriorShellOpeningRun[],
): InteriorShellRun[] {
  if (openings.length === 0) return [...runs];
  const removed = new Set(openings.flatMap(openingUnits).map(openingKey));
  const kept: InteriorShellRun[] = [];
  for (const run of runs) {
    for (let offset = 0; offset < run.length; offset += 1) {
      const edge = openingEdgeForRunUnit(size, run, offset);
      if (removed.has(openingKey(edge))) continue;
      const horizontal = run.side === "north" || run.side === "south";
      const along = offset + 0.5 - run.length / 2;
      kept.push({
        side: run.side,
        x: run.x + (horizontal ? along : 0),
        z: run.z + (horizontal ? 0 : along),
        length: 1,
        level: run.level,
      });
    }
  }
  return mergeBoundaryRuns(size, kept);
}

/** Unmerged visual groups, so outer and author-painted inner walls can cut away independently. */
export function interiorShellRunGroups(
  size: number,
  levels: readonly (number | null)[],
  materials: readonly TerrainMaterial[],
  shell: InteriorShell,
  liquidLevels: readonly (number | null)[] = [],
): InteriorShellRunGroups {
  const openings = shell.openings ?? [];
  return {
    outer: withoutOpenings(
      size,
      interiorShellRuns(
        size,
        interiorShellLevels(size, levels, materials, shell.style, liquidLevels),
      ),
      openings,
    ),
    inner: withoutOpenings(
      size,
      shell.innerWalls
        ? interiorShellRuns(size, innerWallLevels(size, levels, materials, shell))
        : [],
      openings,
    ),
  };
}

/** Raw wall edge nearest a world point, including edges currently removed by a saved opening. */
export function interiorShellOpeningEdgeAt(
  size: number,
  levels: readonly (number | null)[],
  materials: readonly TerrainMaterial[],
  shell: InteriorShell,
  x: number,
  z: number,
  liquidLevels: readonly (number | null)[] = [],
): InteriorShellOpeningRun | null {
  const { openings: _openings, ...raw } = shell;
  const groups = interiorShellRunGroups(size, levels, materials, raw, liquidLevels);
  let closest: { edge: InteriorShellOpeningRun; distance: number } | null = null;
  for (const run of [...groups.outer, ...groups.inner]) {
    for (let offset = 0; offset < run.length; offset += 1) {
      const edge = openingEdgeForRunUnit(size, run, offset);
      const horizontal = run.side === "north" || run.side === "south";
      const along = offset + 0.5 - run.length / 2;
      const cx = run.x + (horizontal ? along : 0);
      const cz = run.z + (horizontal ? 0 : along);
      const distance = Math.hypot(x - cx, z - cz);
      if (!closest || distance < closest.distance) closest = { edge, distance };
    }
  }
  return closest && closest.distance <= 0.72 ? closest.edge : null;
}

/** Span between two clicks on the same straight wall. */
export function interiorShellOpeningBetween(
  first: InteriorShellOpeningRun,
  second: InteriorShellOpeningRun,
): InteriorShellOpeningRun | null {
  if (first.side !== second.side) return null;
  const horizontal = first.side === "north" || first.side === "south";
  if (horizontal && first.row !== second.row) return null;
  if (!horizontal && first.col !== second.col) return null;
  const start = Math.min(horizontal ? first.col : first.row, horizontal ? second.col : second.row);
  const end = Math.max(horizontal ? first.col : first.row, horizontal ? second.col : second.row);
  return {
    side: first.side,
    col: horizontal ? start : first.col,
    row: horizontal ? first.row : start,
    length: end - start + 1,
  };
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
  const { outer, inner } = interiorShellRunGroups(size, levels, materials, shell, liquidLevels);
  if (inner.length === 0) return [...outer];
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
