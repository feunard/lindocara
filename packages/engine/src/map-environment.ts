/** The authored presentation contract for the space surrounding a map. */
export const MAP_ENVIRONMENTS = ["exterior", "interior"] as const;
export type MapEnvironment = (typeof MAP_ENVIRONMENTS)[number];

export const DEFAULT_MAP_ENVIRONMENT: MapEnvironment = "exterior";

/**
 * World-space architectural languages available for an interior cutaway.
 *
 * Sand, water and ordinary grass deliberately do not appear here: they are floor/outdoor
 * materials, not structures capable of enclosing a room. Each entry resolves to art already
 * shipped by the game.
 */
export const INTERIOR_SHELL_STYLES = [
  "timber",
  "castle",
  "cave",
  "mountain",
  "volcano",
  "ice",
  "snow",
] as const;
export type InteriorShellStyle = (typeof INTERIOR_SHELL_STYLES)[number];

/** One horizontal run of cells whose perimeter authors an inner room or partition. */
export interface InteriorShellCellRun {
  col: number;
  row: number;
  length: number;
}

export interface InteriorShell {
  style: InteriorShellStyle;
  /** Camera-facing perimeter walls become a low cutaway. Missing preserves the historical `true`. */
  openOuterWalls?: boolean;
  /** Camera-facing walls painted inside the room become a low cutaway. Missing means `true`. */
  openInnerWalls?: boolean;
  /**
   * Sparse architectural mask, independent from the visible terrain.
   *
   * Runs keep a filled room proportional to its rows instead of serializing one object per cell.
   * Missing means the historical outer envelope only.
   */
  innerWalls?: readonly InteriorShellCellRun[];
}

export function parseMapEnvironment(value: unknown): MapEnvironment | null {
  return typeof value === "string" && (MAP_ENVIRONMENTS as readonly string[]).includes(value)
    ? (value as MapEnvironment)
    : null;
}

export function parseInteriorShell(value: unknown): InteriorShell | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as {
    style?: unknown;
    openOuterWalls?: unknown;
    openInnerWalls?: unknown;
    innerWalls?: unknown;
  };
  const style = record.style;
  if (typeof style !== "string") return null;
  if (!(INTERIOR_SHELL_STYLES as readonly string[]).includes(style)) return null;
  if (record.openOuterWalls !== undefined && typeof record.openOuterWalls !== "boolean")
    return null;
  if (record.openInnerWalls !== undefined && typeof record.openInnerWalls !== "boolean")
    return null;
  const options = {
    ...(record.openOuterWalls === undefined ? {} : { openOuterWalls: record.openOuterWalls }),
    ...(record.openInnerWalls === undefined ? {} : { openInnerWalls: record.openInnerWalls }),
  };
  if (record.innerWalls === undefined) return { style: style as InteriorShellStyle, ...options };
  if (!Array.isArray(record.innerWalls) || record.innerWalls.length > 65_536) return null;
  const innerWalls: InteriorShellCellRun[] = [];
  let innerWallCells = 0;
  for (const candidate of record.innerWalls) {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate))
      return null;
    const run = candidate as { col?: unknown; row?: unknown; length?: unknown };
    if (
      !Number.isSafeInteger(run.col) ||
      !Number.isSafeInteger(run.row) ||
      !Number.isSafeInteger(run.length) ||
      (run.col as number) < 0 ||
      (run.row as number) < 0 ||
      (run.length as number) <= 0 ||
      (run.col as number) + (run.length as number) > 256 ||
      (run.row as number) >= 256
    )
      return null;
    innerWallCells += run.length as number;
    if (innerWallCells > 65_536) return null;
    innerWalls.push({
      col: run.col as number,
      row: run.row as number,
      length: run.length as number,
    });
  }
  return { style: style as InteriorShellStyle, ...options, innerWalls };
}
