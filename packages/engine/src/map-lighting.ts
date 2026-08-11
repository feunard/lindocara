/** Fixed ambience used when an authored map disables its day/night clock. */
export const MAP_FIXED_LIGHTINGS = ["day", "night-start", "night-middle", "night-full"] as const;

export type MapFixedLighting = (typeof MAP_FIXED_LIGHTINGS)[number];

export const DEFAULT_MAP_FIXED_LIGHTING: MapFixedLighting = "day";

export function parseMapFixedLighting(value: unknown): MapFixedLighting | null {
  return typeof value === "string" && MAP_FIXED_LIGHTINGS.includes(value as MapFixedLighting)
    ? (value as MapFixedLighting)
    : null;
}
