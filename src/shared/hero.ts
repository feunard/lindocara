/**
 * A hero belongs to a party (not the account roster) and wears the colour of its owner's slot in
 * that party — so colour is never stored here. Pure rules only: D1 lives in server/heroes.ts.
 */
import type { PlayerClass } from "./game.js";

/** `satisfies` rejects a listed class that isn't a `PlayerClass`; it does NOT enforce
 *  exhaustiveness — a new class added to `PlayerClass` stays absent here until added by hand. */
export const HERO_CLASSES = [
  "warrior",
  "ranger",
  "priest",
] as const satisfies readonly PlayerClass[];

export const MAX_HEROES_PER_PARTY = 3;
export const HERO_NAME_MAX = 24;

export function isHeroClass(value: unknown): value is PlayerClass {
  return typeof value === "string" && (HERO_CLASSES as readonly string[]).includes(value);
}

export interface CreateHeroInput {
  name: string;
  class: PlayerClass;
}

export function parseCreateHeroInput(value: unknown): CreateHeroInput | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { name, class: heroClass } = record;
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > HERO_NAME_MAX) return null;
  if (!isHeroClass(heroClass)) return null;
  return { name: trimmed, class: heroClass };
}
