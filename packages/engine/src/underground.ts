import type { ColliderRect } from "./hd2d/collider-index.js";
import {
  isRampDirection,
  rampAlongX,
  type TerrainMaterial,
  type TerrainRamp,
} from "./hd2d/terrain-query.js";
import type {
  UndergroundCellRun,
  UndergroundLevel,
  UndergroundMap,
  UndergroundStair,
} from "./map-data.js";
import { INTERIOR_SHELL_STYLES, type InteriorShellStyle } from "./map-environment.js";

export const MAX_UNDERGROUND_DEPTH = 16;
export const UNDERGROUND_STOREY_HEIGHT = 2.4;
export const UNDERGROUND_SLAB_THICKNESS = 0.18;
export const DEFAULT_UNDERGROUND_STAIR_LENGTH = 3;
export const DEFAULT_UNDERGROUND_STAIR_WIDTH = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function undergroundFloorHeight(depth: number): number {
  return -depth * UNDERGROUND_STOREY_HEIGHT;
}

export function undergroundStyleMaterial(style: InteriorShellStyle): TerrainMaterial {
  switch (style) {
    case "cave":
    case "timber":
      return "grotte";
    case "volcano":
      return "volcan";
    case "ice":
      return "glace";
    case "snow":
      return "neige";
    case "castle":
    case "mountain":
      return "montagne";
  }
}

function parseRun(value: unknown, size: number): UndergroundCellRun | null {
  if (!isRecord(value)) return null;
  const { col, row, length } = value;
  if (
    !Number.isSafeInteger(col) ||
    !Number.isSafeInteger(row) ||
    !Number.isSafeInteger(length) ||
    (col as number) < 0 ||
    (row as number) < 0 ||
    (length as number) <= 0 ||
    (row as number) >= size ||
    (col as number) + (length as number) > size
  ) {
    return null;
  }
  return { col: col as number, row: row as number, length: length as number };
}

function parseLevel(value: unknown, size: number): UndergroundLevel | null {
  if (!isRecord(value) || !Array.isArray(value.cells)) return null;
  if (
    !Number.isSafeInteger(value.depth) ||
    (value.depth as number) < 1 ||
    (value.depth as number) > MAX_UNDERGROUND_DEPTH ||
    typeof value.style !== "string" ||
    !(INTERIOR_SHELL_STYLES as readonly string[]).includes(value.style)
  ) {
    return null;
  }
  const cells = value.cells.map((run) => parseRun(run, size));
  if (cells.some((run) => run === null)) return null;
  return {
    depth: value.depth as number,
    style: value.style as InteriorShellStyle,
    cells: cells as UndergroundCellRun[],
  };
}

function stairFootprint(stair: UndergroundStair): { cols: number; rows: number } {
  return rampAlongX(stair.direction)
    ? { cols: stair.length, rows: stair.width }
    : { cols: stair.width, rows: stair.length };
}

function parseStair(value: unknown, size: number): UndergroundStair | null {
  if (!isRecord(value)) return null;
  const { depth, col, row, direction, length, width } = value;
  if (
    !Number.isSafeInteger(depth) ||
    (depth as number) < 1 ||
    (depth as number) > MAX_UNDERGROUND_DEPTH ||
    !Number.isSafeInteger(col) ||
    !Number.isSafeInteger(row) ||
    (col as number) < 0 ||
    (row as number) < 0 ||
    !isRampDirection(direction) ||
    !Number.isSafeInteger(length) ||
    (length as number) < 2 ||
    !Number.isSafeInteger(width) ||
    (width as number) < 1
  ) {
    return null;
  }
  const stair: UndergroundStair = {
    depth: depth as number,
    col: col as number,
    row: row as number,
    direction,
    length: length as number,
    width: width as number,
  };
  const footprint = stairFootprint(stair);
  return stair.col + footprint.cols <= size && stair.row + footprint.rows <= size ? stair : null;
}

/** Strict storage parser shared by authored maps and compiled heightfields. */
export function parseUnderground(value: unknown, size: number): UndergroundMap | null {
  if (!isRecord(value) || !Array.isArray(value.levels) || !Array.isArray(value.stairs)) return null;
  if (value.levels.length > MAX_UNDERGROUND_DEPTH || value.stairs.length > 512) return null;
  const levels = value.levels.map((level) => parseLevel(level, size));
  const stairs = value.stairs.map((stair) => parseStair(stair, size));
  if (levels.some((level) => level === null) || stairs.some((stair) => stair === null)) return null;
  const decodedLevels = levels as UndergroundLevel[];
  if (new Set(decodedLevels.map((level) => level.depth)).size !== decodedLevels.length) return null;
  if (
    decodedLevels.reduce((total, level) => total + level.cells.length, 0) >
    size * MAX_UNDERGROUND_DEPTH
  )
    return null;
  return { levels: decodedLevels, stairs: stairs as UndergroundStair[] };
}

export function undergroundCells(level: UndergroundLevel | undefined, size: number): Uint8Array {
  const cells = new Uint8Array(size * size);
  for (const run of level?.cells ?? []) {
    for (let col = run.col; col < run.col + run.length; col += 1) cells[run.row * size + col] = 1;
  }
  return cells;
}

export function compactUndergroundCells(cells: Uint8Array, size: number): UndergroundCellRun[] {
  const runs: UndergroundCellRun[] = [];
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      while (col < size && cells[row * size + col] === 0) col += 1;
      const start = col;
      while (col < size && cells[row * size + col] !== 0) col += 1;
      if (col > start) runs.push({ col: start, row, length: col - start });
    }
  }
  return runs;
}

export function undergroundRamp(stair: UndergroundStair, size: number): TerrainRamp {
  const alongX = rampAlongX(stair.direction);
  return {
    x: stair.col - size / 2,
    z: stair.row - size / 2,
    width: alongX ? stair.length : stair.width,
    depth: alongX ? stair.width : stair.length,
    direction: stair.direction,
    lowLevel: -stair.depth,
    lowHeight: undergroundFloorHeight(stair.depth),
    highHeight: undergroundFloorHeight(stair.depth - 1),
  };
}

function stairCell(
  stairs: readonly UndergroundStair[],
  depth: number,
  col: number,
  row: number,
): boolean {
  return stairs.some((stair) => {
    if (stair.depth !== depth) return false;
    const footprint = stairFootprint(stair);
    return (
      col >= stair.col &&
      col < stair.col + footprint.cols &&
      row >= stair.row &&
      row < stair.row + footprint.rows
    );
  });
}

function stairMouth(
  stairs: readonly UndergroundStair[],
  depth: number,
  col: number,
  row: number,
  dx: number,
  dz: number,
): boolean {
  return stairs.some((stair) => {
    if (stair.depth !== depth && stair.depth !== depth + 1) return false;
    const footprint = stairFootprint(stair);
    if (
      col < stair.col ||
      col >= stair.col + footprint.cols ||
      row < stair.row ||
      row >= stair.row + footprint.rows
    )
      return false;
    if (rampAlongX(stair.direction)) {
      return (
        (col === stair.col && dx === -1) || (col === stair.col + footprint.cols - 1 && dx === 1)
      );
    }
    return (row === stair.row && dz === -1) || (row === stair.row + footprint.rows - 1 && dz === 1);
  });
}

/** Compile excavated volumes into the finite slabs and walls consumed by shared collision. */
export function undergroundColliders(underground: UndergroundMap, size: number): ColliderRect[] {
  const colliders: ColliderRect[] = [];
  for (const level of underground.levels) {
    const cells = undergroundCells(level, size);
    const floorY = undergroundFloorHeight(level.depth);
    const ceilingY = undergroundFloorHeight(level.depth - 1);
    const addSlabs = (run: UndergroundCellRun, y: number, openingDepth: number): void => {
      let start = -1;
      for (let col = run.col; col <= run.col + run.length; col += 1) {
        const open =
          col >= run.col + run.length || stairCell(underground.stairs, openingDepth, col, run.row);
        if (!open && start < 0) start = col;
        if (open && start >= 0) {
          colliders.push({
            x: start - size / 2,
            z: run.row - size / 2,
            w: col - start,
            h: 1,
            bottom: y - UNDERGROUND_SLAB_THICKNESS,
            top: y,
          });
          start = -1;
        }
      }
    };
    for (const run of level.cells) {
      addSlabs(run, floorY, level.depth + 1);
      addSlabs(run, ceilingY, level.depth);
    }
    const occupied = (col: number, row: number): boolean =>
      col >= 0 && row >= 0 && col < size && row < size && cells[row * size + col] !== 0;
    const thickness = 0.16;
    for (const side of ["north", "south"] as const) {
      const dz = side === "north" ? -1 : 1;
      for (let row = 0; row < size; row += 1) {
        let start = -1;
        for (let col = 0; col <= size; col += 1) {
          const exposed =
            col < size &&
            occupied(col, row) &&
            !occupied(col, row + dz) &&
            !stairMouth(underground.stairs, level.depth, col, row, 0, dz);
          if (exposed && start < 0) start = col;
          if (!exposed && start >= 0) {
            colliders.push({
              x: start - size / 2,
              z: row - size / 2 + (dz > 0 ? 1 - thickness : 0),
              w: col - start,
              h: thickness,
              bottom: floorY,
              top: ceilingY,
            });
            start = -1;
          }
        }
      }
    }
    for (const side of ["west", "east"] as const) {
      const dx = side === "west" ? -1 : 1;
      for (let col = 0; col < size; col += 1) {
        let start = -1;
        for (let row = 0; row <= size; row += 1) {
          const exposed =
            row < size &&
            occupied(col, row) &&
            !occupied(col + dx, row) &&
            !stairMouth(underground.stairs, level.depth, col, row, dx, 0);
          if (exposed && start < 0) start = row;
          if (!exposed && start >= 0) {
            colliders.push({
              x: col - size / 2 + (dx > 0 ? 1 - thickness : 0),
              z: start - size / 2,
              w: thickness,
              h: row - start,
              bottom: floorY,
              top: ceilingY,
            });
            start = -1;
          }
        }
      }
    }
  }
  return colliders;
}
