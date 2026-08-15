/** Quarter-turn orientation authored on a building placement.
 *
 * `front` is the historical/default generated facade. Positive turns are clockwise in the map's
 * X/Z plane: right side, rear, then left side. Keeping this as a tiny dependency-free module avoids
 * coupling the building/runtime contract back to the full map parser.
 */
export const ELEMENT_ORIENTATIONS = [0, 1, 2, 3] as const;
export type ElementOrientation = (typeof ELEMENT_ORIENTATIONS)[number];

export function isElementOrientation(value: unknown): value is ElementOrientation {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 3;
}

/** Payloads written before orientation existed face front. */
export function parseElementOrientation(value: unknown): ElementOrientation | null {
  if (value === undefined || value === null) return 0;
  return isElementOrientation(value) ? value : null;
}
