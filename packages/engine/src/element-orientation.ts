/** Quarter-turn orientation authored on a building placement.
 *
 * `front` is the historical/default generated facade. Positive turns are clockwise in the map's
 * X/Z plane: right side, rear, then left side. Keeping this as a tiny dependency-free module avoids
 * coupling the building/runtime contract back to the full map parser.
 */
export const ELEMENT_ORIENTATIONS = [0, 1, 2, 3] as const;
export type ElementOrientation = (typeof ELEMENT_ORIENTATIONS)[number];

/** Whole-degree free rotation for native 3D scenery. */
export type ElementRotation = number;
export const MAX_ELEMENT_ROTATION = 359;
const ROTATED_TRANSFORM_OFFSET = 1_000_000;
const ROTATION_CODE_BASE = 360;

export function isElementOrientation(value: unknown): value is ElementOrientation {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 3;
}

/** Payloads written before orientation existed face front. */
export function parseElementOrientation(value: unknown): ElementOrientation | null {
  if (value === undefined || value === null) return 0;
  return isElementOrientation(value) ? value : null;
}

export function parseElementRotation(value: unknown): ElementRotation | null {
  if (value === undefined || value === null) return 0;
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 359
    ? (value as number)
    : null;
}

export function elementRotationDegrees(value: {
  orientation?: ElementOrientation;
  rotation?: ElementRotation;
}): number {
  return value.rotation ?? (value.orientation ?? 0) * 90;
}

/** Adds a versioned free-rotation lane around an asset-specific legacy transform integer. */
export function encodeElementTransform(baseCode: number, rotation?: ElementRotation): number {
  if (rotation === undefined) return baseCode;
  return ROTATED_TRANSFORM_OFFSET + baseCode * ROTATION_CODE_BASE + rotation;
}

/** Old values decode unchanged; versioned values expose their nested legacy transform and angle. */
export function decodeElementTransform(
  code: number,
): { baseCode: number; rotation?: ElementRotation } | null {
  if (!Number.isSafeInteger(code) || code < 0) return null;
  if (code < ROTATED_TRANSFORM_OFFSET) return { baseCode: code };
  const packed = code - ROTATED_TRANSFORM_OFFSET;
  const rotation = packed % ROTATION_CODE_BASE;
  const baseCode = Math.floor(packed / ROTATION_CODE_BASE);
  const parsed = parseElementRotation(rotation);
  if (parsed === null) return null;
  return { baseCode, rotation: parsed };
}
