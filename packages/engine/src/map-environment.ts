/** The authored presentation contract for the space surrounding a map. */
export const MAP_ENVIRONMENTS = ["exterior", "interior"] as const;
export type MapEnvironment = (typeof MAP_ENVIRONMENTS)[number];

export const DEFAULT_MAP_ENVIRONMENT: MapEnvironment = "exterior";

export function parseMapEnvironment(value: unknown): MapEnvironment | null {
  return typeof value === "string" && (MAP_ENVIRONMENTS as readonly string[]).includes(value)
    ? (value as MapEnvironment)
    : null;
}
