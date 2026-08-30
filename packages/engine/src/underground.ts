import type { ColliderRect } from "./hd2d/collider-index.js";
import {
  isRampDirection,
  rampAlongX,
  type TerrainMaterial,
  type TerrainRamp,
} from "./hd2d/terrain-query.js";
import { isUuid } from "./identifiers.js";
import type {
  UndergroundContentDepth,
  UndergroundCellRun,
  UndergroundLevel,
  UndergroundMap,
  UndergroundShaft,
  UndergroundStair,
  UndergroundTerrainRun,
} from "./map-data.js";
import { INTERIOR_SHELL_STYLES, type InteriorShellStyle } from "./map-environment.js";

export const MAX_UNDERGROUND_DEPTH = 16;
export const UNDERGROUND_STOREY_HEIGHT = 2.4;
export const UNDERGROUND_SLAB_THICKNESS = 0.18;
export const DEFAULT_UNDERGROUND_STAIR_LENGTH = 3;
export const DEFAULT_UNDERGROUND_STAIR_WIDTH = 1;
export const MAX_UNDERGROUND_TERRAIN_ELEVATION = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function undergroundFloorHeight(depth: number): number {
  return depth === 0 ? 0 : -depth * UNDERGROUND_STOREY_HEIGHT;
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
  const terrainValues = value.terrain ?? [];
  if (!Array.isArray(terrainValues) || terrainValues.length > size * size) return null;
  const terrain = terrainValues.map((entry): UndergroundTerrainRun | null => {
    const run = parseRun(entry, size);
    if (!run || !isRecord(entry)) return null;
    const material = entry.material;
    const elevation = entry.elevation;
    if (
      typeof material !== "string" ||
      ![
        "sable",
        "herbe",
        "neige",
        "glace",
        "grotte",
        "montagne",
        "volcan",
        "lave",
        "water",
      ].includes(material)
    )
      return null;
    if (
      elevation !== undefined &&
      (!Number.isSafeInteger(elevation) ||
        (elevation as number) < 0 ||
        (elevation as number) > MAX_UNDERGROUND_TERRAIN_ELEVATION)
    )
      return null;
    return {
      ...run,
      material: material as UndergroundTerrainRun["material"],
      ...((elevation as number | undefined) ? { elevation: 1 as const } : {}),
    };
  });
  if (terrain.some((entry) => entry === null)) return null;
  return {
    depth: value.depth as number,
    style: value.style as InteriorShellStyle,
    cells: cells as UndergroundCellRun[],
    ...(value.terrain === undefined ? {} : { terrain: terrain as UndergroundTerrainRun[] }),
  };
}

function parseContentDepths(value: unknown): UndergroundContentDepth[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 2_000) return null;
  const result: UndergroundContentDepth[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !isUuid(entry.id) ||
      ids.has(entry.id) ||
      !Number.isSafeInteger(entry.depth) ||
      (entry.depth as number) < 1 ||
      (entry.depth as number) > MAX_UNDERGROUND_DEPTH
    )
      return null;
    ids.add(entry.id);
    result.push({ id: entry.id, depth: entry.depth as number });
  }
  return result;
}

export function undergroundStairFootprint(stair: UndergroundStair): { cols: number; rows: number } {
  return rampAlongX(stair.direction)
    ? { cols: stair.length, rows: stair.width }
    : { cols: stair.width, rows: stair.length };
}

function parseStair(value: unknown, size: number): UndergroundStair | null {
  if (!isRecord(value)) return null;
  const { depth, fromDepth, col, row, direction, length, width } = value;
  if (
    !Number.isSafeInteger(depth) ||
    (depth as number) < 1 ||
    (depth as number) > MAX_UNDERGROUND_DEPTH ||
    (fromDepth !== undefined &&
      (!Number.isSafeInteger(fromDepth) ||
        (fromDepth as number) < 0 ||
        (fromDepth as number) >= (depth as number))) ||
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
    ...(fromDepth === undefined ? {} : { fromDepth: fromDepth as number }),
    col: col as number,
    row: row as number,
    direction,
    length: length as number,
    width: width as number,
  };
  const footprint = undergroundStairFootprint(stair);
  return stair.col + footprint.cols <= size && stair.row + footprint.rows <= size ? stair : null;
}

function parseShaft(value: unknown, size: number): UndergroundShaft | null {
  if (!isRecord(value)) return null;
  const { col, row, width, length, depth } = value;
  if (
    !Number.isSafeInteger(col) ||
    !Number.isSafeInteger(row) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(length) ||
    !Number.isSafeInteger(depth) ||
    (col as number) < 0 ||
    (row as number) < 0 ||
    (width as number) < 1 ||
    (length as number) < 1 ||
    (depth as number) < 1 ||
    (depth as number) > MAX_UNDERGROUND_DEPTH ||
    (col as number) + (width as number) > size ||
    (row as number) + (length as number) > size
  ) {
    return null;
  }
  return {
    col: col as number,
    row: row as number,
    width: width as number,
    length: length as number,
    depth: depth as number,
  };
}

/** Strict storage parser shared by authored maps and compiled heightfields. */
export function parseUnderground(value: unknown, size: number): UndergroundMap | null {
  if (!isRecord(value) || !Array.isArray(value.levels) || !Array.isArray(value.stairs)) return null;
  const shaftValues = value.shafts ?? [];
  if (!Array.isArray(shaftValues)) return null;
  if (
    value.levels.length > MAX_UNDERGROUND_DEPTH ||
    value.stairs.length > 512 ||
    shaftValues.length > 512
  )
    return null;
  const levels = value.levels.map((level) => parseLevel(level, size));
  const stairs = value.stairs.map((stair) => parseStair(stair, size));
  const shafts = shaftValues.map((shaft) => parseShaft(shaft, size));
  const elementDepths = parseContentDepths(value.elementDepths);
  const eventDepths = parseContentDepths(value.eventDepths);
  if (
    levels.some((level) => level === null) ||
    stairs.some((stair) => stair === null) ||
    shafts.some((shaft) => shaft === null) ||
    elementDepths === null ||
    eventDepths === null
  )
    return null;
  const decodedLevels = levels as UndergroundLevel[];
  if (new Set(decodedLevels.map((level) => level.depth)).size !== decodedLevels.length) return null;
  if (
    decodedLevels.reduce((total, level) => total + level.cells.length, 0) >
    size * MAX_UNDERGROUND_DEPTH
  )
    return null;
  return {
    levels: decodedLevels,
    stairs: stairs as UndergroundStair[],
    ...(value.shafts === undefined ? {} : { shafts: shafts as UndergroundShaft[] }),
    ...(value.elementDepths === undefined ? {} : { elementDepths }),
    ...(value.eventDepths === undefined ? {} : { eventDepths }),
  };
}

export function undergroundTerrainCells(
  level: UndergroundLevel | undefined,
  size: number,
): Array<UndergroundTerrainRun["material"] | null> {
  const cells = new Array<UndergroundTerrainRun["material"] | null>(size * size).fill(null);
  for (const run of level?.terrain ?? []) {
    for (let col = run.col; col < run.col + run.length; col += 1)
      cells[run.row * size + col] = run.material;
  }
  return cells;
}

export function undergroundTerrainElevationCells(
  level: UndergroundLevel | undefined,
  size: number,
): Uint8Array {
  const cells = new Uint8Array(size * size);
  for (const run of level?.terrain ?? []) {
    if (!run.elevation) continue;
    for (let col = run.col; col < run.col + run.length; col += 1)
      cells[run.row * size + col] = run.elevation;
  }
  return cells;
}

/** Exact authored floor/liquid top at one underground cell. */
export function undergroundTerrainHeightAt(
  underground: UndergroundMap | undefined,
  depth: number,
  col: number,
  row: number,
  levelHeight: number,
): number {
  const level = underground?.levels.find((candidate) => candidate.depth === depth);
  const elevation =
    level?.terrain?.find((run) => run.row === row && col >= run.col && col < run.col + run.length)
      ?.elevation ?? 0;
  return undergroundFloorHeight(depth) + elevation * levelHeight;
}

export function compactUndergroundTerrain(
  cells: readonly (UndergroundTerrainRun["material"] | null)[],
  size: number,
  elevations: ArrayLike<number> = [],
): UndergroundTerrainRun[] {
  const runs: UndergroundTerrainRun[] = [];
  for (let row = 0; row < size; row += 1) {
    let col = 0;
    while (col < size) {
      const material = cells[row * size + col] ?? null;
      if (material === null) {
        col += 1;
        continue;
      }
      const start = col;
      const elevation = elevations[row * size + col] ?? 0;
      while (
        col < size &&
        cells[row * size + col] === material &&
        (elevations[row * size + col] ?? 0) === elevation
      )
        col += 1;
      runs.push({
        col: start,
        row,
        length: col - start,
        material,
        ...(elevation > 0 ? { elevation: 1 } : {}),
      });
    }
  }
  return runs;
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
    highHeight: undergroundFloorHeight(undergroundStairUpperDepth(stair)),
  };
}

/** Legacy stairs always joined the immediately shallower storey. */
export function undergroundStairUpperDepth(stair: UndergroundStair): number {
  return stair.fromDepth ?? stair.depth - 1;
}

/** Whether this flight pierces the slab between `boundaryDepth - 1` and `boundaryDepth`. */
export function undergroundStairCrossesBoundary(
  stair: UndergroundStair,
  boundaryDepth: number,
): boolean {
  return undergroundStairUpperDepth(stair) < boundaryDepth && boundaryDepth <= stair.depth;
}

function stairCell(
  stairs: readonly UndergroundStair[],
  depth: number,
  col: number,
  row: number,
): boolean {
  return stairs.some((stair) => {
    if (!undergroundStairCrossesBoundary(stair, depth)) return false;
    const footprint = undergroundStairFootprint(stair);
    return (
      col >= stair.col &&
      col < stair.col + footprint.cols &&
      row >= stair.row &&
      row < stair.row + footprint.rows
    );
  });
}

export function undergroundStairMouth(
  stairs: readonly UndergroundStair[],
  depth: number,
  col: number,
  row: number,
  dx: number,
  dz: number,
): boolean {
  return stairs.some((stair) => {
    const footprint = undergroundStairFootprint(stair);
    if (
      col < stair.col ||
      col >= stair.col + footprint.cols ||
      row < stair.row ||
      row >= stair.row + footprint.rows
    )
      return false;
    // A wall belongs to the room whose floor it rises from. The high mouth of an underground
    // flight therefore opens on `fromDepth` itself; only the surface has no room/wall of its own,
    // so its opening is represented by level 1. Using `fromDepth + 1` made every -N -> -(N + 1)
    // stair keep the upper room's end wall and behave like an invisible barrier.
    const upperVolumeDepth = Math.max(1, undergroundStairUpperDepth(stair));
    const lowDepth = stair.depth;
    if (rampAlongX(stair.direction)) {
      const west = col === stair.col && dx === -1;
      const east = col === stair.col + footprint.cols - 1 && dx === 1;
      if (!west && !east) return false;
      const high = stair.direction === "east" ? east : west;
      return depth === (high ? upperVolumeDepth : lowDepth);
    }
    const north = row === stair.row && dz === -1;
    const south = row === stair.row + footprint.rows - 1 && dz === 1;
    if (!north && !south) return false;
    const high = stair.direction === "south" ? south : north;
    return depth === (high ? upperVolumeDepth : lowDepth);
  });
}

export function undergroundShaftCell(
  shafts: readonly UndergroundShaft[] | undefined,
  col: number,
  row: number,
  minimumDepth = 1,
): boolean {
  return (shafts ?? []).some(
    (shaft) =>
      shaft.depth >= minimumDepth &&
      col >= shaft.col &&
      col < shaft.col + shaft.width &&
      row >= shaft.row &&
      row < shaft.row + shaft.length,
  );
}

/** Surface cells whose terrain top must be cut away so an access is visible and traversable. */
export function undergroundSurfaceOpenings(
  underground: UndergroundMap | undefined,
  size: number,
): Uint8Array {
  const cells = new Uint8Array(size * size);
  for (const stair of underground?.stairs ?? []) {
    if (undergroundStairUpperDepth(stair) !== 0) continue;
    const footprint = undergroundStairFootprint(stair);
    for (let row = stair.row; row < stair.row + footprint.rows; row += 1) {
      for (let col = stair.col; col < stair.col + footprint.cols; col += 1) {
        cells[row * size + col] = 1;
      }
    }
  }
  for (const shaft of underground?.shafts ?? []) {
    for (let row = shaft.row; row < shaft.row + shaft.length; row += 1) {
      for (let col = shaft.col; col < shaft.col + shaft.width; col += 1) {
        cells[row * size + col] = 1;
      }
    }
  }
  return cells;
}

export function undergroundDepthAtElevation(elevation: number): number | null {
  if (!Number.isFinite(elevation) || elevation >= -0.6) return null;
  return Math.max(
    1,
    Math.min(MAX_UNDERGROUND_DEPTH, Math.round(-elevation / UNDERGROUND_STOREY_HEIGHT)),
  );
}

/** Storeys visible while a body crosses vertically between them. Exact floor elevations select one
 * storey; every in-between elevation selects the shallower and deeper neighbours so camera and
 * actor visibility never switch halfway through a stair or fall. */
export function undergroundVisibleDepthsAtElevation(elevation: number): readonly (number | null)[] {
  if (!Number.isFinite(elevation) || elevation >= -0.02) return [null];
  const storey = Math.max(
    0,
    Math.min(MAX_UNDERGROUND_DEPTH, -elevation / UNDERGROUND_STOREY_HEIGHT),
  );
  const nearest = Math.round(storey);
  if (Math.abs(storey - nearest) <= 0.04) return [Math.max(1, nearest)];
  const shallow = Math.floor(storey);
  const deep = Math.min(MAX_UNDERGROUND_DEPTH, Math.ceil(storey));
  return shallow <= 0 ? [null, deep] : shallow === deep ? [deep] : [shallow, deep];
}

/** The two finite trench flanks every underground flight needs independently of room boundaries. */
export function undergroundStairSideColliders(
  underground: UndergroundMap,
  size: number,
): ColliderRect[] {
  const colliders: ColliderRect[] = [];
  const wallThickness = 0.16;
  for (const stair of underground.stairs) {
    const ramp = undergroundRamp(stair, size);
    const bottom = ramp.lowHeight ?? undergroundFloorHeight(stair.depth);
    const upperDepth = undergroundStairUpperDepth(stair);
    // The visible flank continues above the upper landing to that room's ceiling. Ending it at
    // the landing elevation let a jumping body's feet clear the collider while its torso was still
    // inside the trench, after which it could move sideways into solid rock. A surface departure
    // has no upper room, so y=0 remains its natural cap.
    const top = upperDepth === 0 ? 0 : undergroundFloorHeight(upperDepth - 1);
    if (rampAlongX(stair.direction)) {
      colliders.push(
        {
          x: ramp.x,
          z: ramp.z,
          w: ramp.width,
          h: wallThickness,
          bottom,
          top,
        },
        {
          x: ramp.x,
          z: ramp.z + ramp.depth - wallThickness,
          w: ramp.width,
          h: wallThickness,
          bottom,
          top,
        },
      );
    } else {
      colliders.push(
        {
          x: ramp.x,
          z: ramp.z,
          w: wallThickness,
          h: ramp.depth,
          bottom,
          top,
        },
        {
          x: ramp.x + ramp.width - wallThickness,
          z: ramp.z,
          w: wallThickness,
          h: ramp.depth,
          bottom,
          top,
        },
      );
    }
  }
  return colliders;
}

/** Adds the stair flanks missing from heightfields saved before they became collision geometry. */
export function withUndergroundStairSideColliders(
  colliders: readonly ColliderRect[],
  underground: UndergroundMap | undefined,
  size: number,
): ColliderRect[] {
  if (!underground) return [...colliders];
  const result = [...colliders];
  for (const side of undergroundStairSideColliders(underground, size)) {
    const present = result.some(
      (candidate) =>
        candidate.x === side.x &&
        candidate.z === side.z &&
        candidate.w === side.w &&
        candidate.h === side.h &&
        candidate.bottom === side.bottom &&
        candidate.top === side.top,
    );
    if (!present) result.push(side);
  }
  return result;
}

/** Storeys visible through every stair or shaft that continues below the currently viewed floor. */
export function undergroundAccessVisibleDepths(
  underground: UndergroundMap | undefined,
  depth: number | null,
): readonly number[] {
  if (!underground) return depth === null ? [] : [depth];
  const visible = new Set<number>(depth === null ? [] : [depth]);
  const reached = new Set<number>([depth ?? 0]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const current of [...reached]) {
      for (const shaft of underground.shafts ?? []) {
        if (current < 0 || current >= shaft.depth) continue;
        for (let next = Math.max(1, current + 1); next <= shaft.depth; next += 1) {
          if (!visible.has(next)) changed = true;
          visible.add(next);
          reached.add(next);
        }
      }
      for (const stair of underground.stairs) {
        const upper = undergroundStairUpperDepth(stair);
        if (current < upper || current >= stair.depth) continue;
        for (let next = Math.max(1, current + 1); next <= stair.depth; next += 1) {
          if (!visible.has(next)) changed = true;
          visible.add(next);
          reached.add(next);
        }
      }
    }
  }
  return [...visible].sort((left, right) => left - right);
}

/** Whether a world X/Z point lies inside an authored vertical connection. Height alone cannot tell
 * a stair/shaft transition from an ordinary jump inside a room, yet only the former may reveal two
 * storeys at once. */
export function undergroundTransitionAt(
  underground: UndergroundMap | undefined,
  size: number,
  x: number,
  z: number,
): boolean {
  if (!underground) return false;
  const col = Math.floor(x + size / 2);
  const row = Math.floor(z + size / 2);
  if (undergroundShaftCell(underground.shafts, col, row)) return true;
  return underground.stairs.some((stair) => {
    const footprint = undergroundStairFootprint(stair);
    return (
      col >= stair.col &&
      col < stair.col + footprint.cols &&
      row >= stair.row &&
      row < stair.row + footprint.rows
    );
  });
}

/** Compile excavated volumes into the finite slabs and walls consumed by shared collision. */
export function undergroundColliders(
  underground: UndergroundMap,
  size: number,
  levelHeight = 0.9,
): ColliderRect[] {
  const colliders: ColliderRect[] = [];
  const wallThickness = 0.16;
  for (const level of underground.levels) {
    const cells = undergroundCells(level, size);
    const floorY = undergroundFloorHeight(level.depth);
    const ceilingY = undergroundFloorHeight(level.depth - 1);
    const addSlabs = (run: UndergroundCellRun, y: number, openingDepth: number): void => {
      let start = -1;
      for (let col = run.col; col <= run.col + run.length; col += 1) {
        const open =
          col >= run.col + run.length ||
          stairCell(underground.stairs, openingDepth, col, run.row) ||
          undergroundShaftCell(underground.shafts, col, run.row, openingDepth);
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
      // At the surface, the authored heightfield already supplies the walkable top. Keeping the
      // underground ceiling's collider all the way up to y=0 made a swimmer at the conventional
      // -0.05 waterline overlap that slab even though they were still outside. Its underside is
      // the actual underground boundary; deeper ceilings coincide with the floor above.
      addSlabs(
        run,
        level.depth === 1 ? ceilingY - UNDERGROUND_SLAB_THICKNESS : ceilingY,
        level.depth,
      );
    }
    for (const run of level.terrain ?? []) {
      if (!run.elevation || run.material === "water" || run.material === "lave") continue;
      colliders.push({
        x: run.col - size / 2,
        z: run.row - size / 2,
        w: run.length,
        h: 1,
        bottom: floorY,
        top: floorY + run.elevation * levelHeight,
      });
    }
    const occupied = (col: number, row: number): boolean =>
      col >= 0 && row >= 0 && col < size && row < size && cells[row * size + col] !== 0;
    for (const side of ["north", "south"] as const) {
      const dz = side === "north" ? -1 : 1;
      for (let row = 0; row < size; row += 1) {
        let start = -1;
        for (let col = 0; col <= size; col += 1) {
          const exposed =
            col < size &&
            occupied(col, row) &&
            !occupied(col, row + dz) &&
            !undergroundStairMouth(underground.stairs, level.depth, col, row, 0, dz);
          if (exposed && start < 0) start = col;
          if (!exposed && start >= 0) {
            colliders.push({
              x: start - size / 2,
              z: row - size / 2 + (dz > 0 ? 1 - wallThickness : 0),
              w: col - start,
              h: wallThickness,
              bottom: floorY,
              top: level.depth === 1 ? ceilingY - UNDERGROUND_SLAB_THICKNESS : ceilingY,
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
            !undergroundStairMouth(underground.stairs, level.depth, col, row, dx, 0);
          if (exposed && start < 0) start = row;
          if (!exposed && start >= 0) {
            colliders.push({
              x: col - size / 2 + (dx > 0 ? 1 - wallThickness : 0),
              z: start - size / 2,
              w: wallThickness,
              h: row - start,
              bottom: floorY,
              top: level.depth === 1 ? ceilingY - UNDERGROUND_SLAB_THICKNESS : ceilingY,
            });
            start = -1;
          }
        }
      }
    }
  }
  // Excavation walls protect a room's perimeter, but a stair cut through occupied cells has no
  // exposed room edge along either side. The renderer still draws those trench flanks; matching
  // finite colliders keep a jumping body from slipping sideways through the visible wall and into
  // an unexcavated column. They stop at the upper room's ceiling, so both forward-facing mouths
  // remain walkable and unrelated storeys at the same X/Z stay untouched.
  colliders.push(...undergroundStairSideColliders(underground, size));
  return colliders;
}
