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

export interface InteriorShell {
  style: InteriorShellStyle;
}

export function parseMapEnvironment(value: unknown): MapEnvironment | null {
  return typeof value === "string" && (MAP_ENVIRONMENTS as readonly string[]).includes(value)
    ? (value as MapEnvironment)
    : null;
}

export function parseInteriorShell(value: unknown): InteriorShell | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const style = (value as { style?: unknown }).style;
  if (typeof style !== "string") return null;
  if (!(INTERIOR_SHELL_STYLES as readonly string[]).includes(style)) return null;
  return { style: style as InteriorShellStyle };
}
