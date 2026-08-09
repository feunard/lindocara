export const DAY_CYCLE_MS = 24 * 60 * 1_000;

export type DayCycleOverride = "day" | "night" | null;

export interface DayCycleState {
  hour: number;
  solarElevation: number;
  nightWeight: number;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Wall-clock synchronized cycle: one real minute is one game hour. Dawn and dusk span several
 * game hours so zenith, twilight and full night are connected by one continuous curve. */
export function dayCycleAt(epochMs: number): DayCycleState {
  const elapsed = ((epochMs % DAY_CYCLE_MS) + DAY_CYCLE_MS) % DAY_CYCLE_MS;
  const hour = (elapsed / DAY_CYCLE_MS) * 24;
  const solarElevation = Math.sin(((hour - 6) / 24) * Math.PI * 2);
  const daylight = smoothstep(-0.28, 0.2, solarElevation);
  return { hour, solarElevation, nightWeight: 1 - daylight };
}

/**
 * Stable phase assigned to one authored map. It keeps every client in that map on the same clock
 * while preventing unrelated maps from sharing one global sunrise and sunset.
 */
export function mapDayCycleOffset(mapId: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < mapId.length; index += 1) {
    hash ^= mapId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % DAY_CYCLE_MS;
}

export function mapDayCycleAt(
  epochMs: number,
  mapId: string,
  override: DayCycleOverride = null,
): DayCycleState {
  if (override === "day") return dayCycleAt(12 * 60_000);
  if (override === "night") return dayCycleAt(0);
  return dayCycleAt(epochMs + mapDayCycleOffset(mapId));
}
