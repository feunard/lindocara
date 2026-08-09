export const DAY_CYCLE_MS = 24 * 60 * 1_000;

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
