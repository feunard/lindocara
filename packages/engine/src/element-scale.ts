/** Bounds shared by persisted maps, the creator inspector, visuals, and authoritative collision. */
export const MIN_ELEMENT_SCALE = 0.25;
export const MAX_ELEMENT_SCALE = 4;
export const ELEMENT_SCALE_STEP = 0.05;

/**
 * Ordinary scenery has no legacy transform beyond zero. Keep its scale in the existing integer
 * `mapElements.variant` column, in a lane above every building/bridge footprint code and below the
 * free-rotation wrapper. This avoids a database migration while keeping old zero-valued rows at
 * their historical 100% size.
 */
const ELEMENT_SCALE_TRANSFORM_OFFSET = 300_000;

export function parseElementScale(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < MIN_ELEMENT_SCALE || value > MAX_ELEMENT_SCALE) return null;
  // Multiplying a decimal step (for example 48 * 0.05) otherwise leaks
  // `2.4000000000000004` into JSON and breaks an otherwise exact save/reload round trip.
  return Number((Math.round(value / ELEMENT_SCALE_STEP) * ELEMENT_SCALE_STEP).toFixed(2));
}

/** Compact persistence code for an ordinary scenery scale. Default size preserves legacy zero. */
export function encodeElementScaleTransform(value: unknown): number | null {
  const scale = parseElementScale(value);
  if (scale === null) return null;
  if (scale === 1) return 0;
  return ELEMENT_SCALE_TRANSFORM_OFFSET + Math.round(scale / ELEMENT_SCALE_STEP);
}

/** Decode an ordinary scenery scale from the historical transform column. */
export function decodeElementScaleTransform(code: unknown): number | null {
  if (code === 0) return 1;
  if (!Number.isSafeInteger(code)) return null;
  const units = (code as number) - ELEMENT_SCALE_TRANSFORM_OFFSET;
  const scale = parseElementScale(units * ELEMENT_SCALE_STEP);
  if (scale === null) return null;
  return encodeElementScaleTransform(scale) === code ? scale : null;
}
