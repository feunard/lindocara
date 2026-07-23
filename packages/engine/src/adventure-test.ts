/**
 * Wire-safe options for an editor-owned adventure playtest.
 *
 * The client chooses only a class and an optional authored map. The server still derives every
 * authoritative position: `null` means the adventure's global start, while a map id means that
 * map's authored fallback/test point.
 */
import { isValidClass, type PlayerClass } from "./game.js";
import { isUuid } from "./identifiers.js";

export const ADVENTURE_TEST_SESSION_TTL_MS = 6 * 60 * 60 * 1_000;

export interface CreateAdventureTestSessionInput {
  readonly startMapId: string | null;
  readonly heroClass: PlayerClass;
}

export function parseCreateAdventureTestSessionInput(
  value: unknown,
): CreateAdventureTestSessionInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { startMapId, heroClass } = value as Record<string, unknown>;
  if (startMapId !== null && (typeof startMapId !== "string" || !isUuid(startMapId))) return null;
  if (!isValidClass(heroClass)) return null;
  return { startMapId, heroClass };
}
