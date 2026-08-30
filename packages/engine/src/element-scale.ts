/** Bounds shared by persisted maps, the creator inspector, visuals, and authoritative collision. */
export const MIN_ELEMENT_SCALE = 0.25;
export const MAX_ELEMENT_SCALE = 4;
export const ELEMENT_SCALE_STEP = 0.05;

export function parseElementScale(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < MIN_ELEMENT_SCALE || value > MAX_ELEMENT_SCALE) return null;
  return Math.round(value / ELEMENT_SCALE_STEP) * ELEMENT_SCALE_STEP;
}
