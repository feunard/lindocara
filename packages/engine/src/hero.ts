/**
 * A hero belongs to a party (not the account roster) and wears the colour of its owner's slot in
 * that party — so colour is never stored here. Pure rules only: D1 lives in server/heroes.ts.
 */
import { isBodyVariant, type BodyVariant } from "./character.js";
import type { PlayerClass } from "./game.js";

/** `satisfies` rejects a listed class that isn't a `PlayerClass`; it does NOT enforce
 *  exhaustiveness — a new class added to `PlayerClass` stays absent here until added by hand. */
export const HERO_CLASSES = [
  "warrior",
  "ranger",
  "priest",
  "rogue",
  "peasant",
] as const satisfies readonly PlayerClass[];

export const MAX_HEROES_PER_PARTY = 3;
export const HERO_NAME_MAX = 24;

export function isHeroClass(value: unknown): value is PlayerClass {
  return typeof value === "string" && (HERO_CLASSES as readonly string[]).includes(value);
}

export interface CreateHeroInput {
  name: string;
  class: PlayerClass;
  /** Optional for old clients; omitted means the ordinary Tiny Swords roster. */
  body?: BodyVariant;
}

/**
 * Special character bodies that reuse an existing authoritative class. Shared by every hero
 * picker so the editor playtest cannot drift from normal hero creation.
 */
export const PROTOTYPE_HEROES = [
  { body: "runic_guardian", heroClass: "warrior" },
  { body: "assassin", heroClass: "rogue" },
  { body: "peasant", heroClass: "peasant" },
  { body: "ranger", heroClass: "ranger" },
  { body: "priest", heroClass: "priest" },
] as const satisfies readonly {
  body: Exclude<BodyVariant, "wayfarer">;
  heroClass: PlayerClass;
}[];

export function isHeroBodyForClass(body: unknown, heroClass: PlayerClass): body is BodyVariant {
  if (body === "wayfarer") return true;
  return PROTOTYPE_HEROES.some(
    (candidate) => candidate.body === body && candidate.heroClass === heroClass,
  );
}

export function parseCreateHeroInput(value: unknown): CreateHeroInput | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { name, class: heroClass, body } = record;
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > HERO_NAME_MAX) return null;
  if (!isHeroClass(heroClass)) return null;
  if (body === undefined) return { name: trimmed, class: heroClass };
  if (!isBodyVariant(body)) return null;
  // Prototype bodies reuse an existing authoritative class; they never create a sixth one.
  if (!isHeroBodyForClass(body, heroClass)) return null;
  return { name: trimmed, class: heroClass, body };
}
