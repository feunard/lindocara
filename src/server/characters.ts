/**
 * Account-facing character CRUD. The world never creates characters; it only loads them
 * by id through profile.ts after the Worker has proven ownership here.
 */

import { and, eq } from "drizzle-orm";
import { maxHpForLevel, spawnPosition } from "../shared/game.js";
import type { Appearance } from "../shared/protocol.js";
import { character, type Db } from "./db/index.js";

export const MAX_CHARACTERS_PER_ACCOUNT = 3;

const NAME_PATTERN = /^[A-Za-z0-9_-]{2,16}$/;
const APPEARANCES: readonly Appearance[] = ["azure", "ember", "moss", "violet"];

export function isValidCharacterName(value: unknown): value is string {
  return typeof value === "string" && NAME_PATTERN.test(value);
}

export function isValidAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCES as readonly string[]).includes(value);
}

export interface CharacterSummary {
  id: string;
  name: string;
  appearance: Appearance;
  level: number;
}

function summary(row: {
  id: string;
  name: string;
  appearance: Appearance;
  level: number;
}): CharacterSummary {
  return { id: row.id, name: row.name, appearance: row.appearance, level: row.level };
}

export async function listCharacters(db: Db, accountId: string): Promise<CharacterSummary[]> {
  const rows = await db.select().from(character).where(eq(character.accountId, accountId));
  return rows.map(summary);
}

export async function createCharacter(
  db: Db,
  accountId: string,
  name: string,
  appearance: Appearance,
): Promise<CharacterSummary | "limit_reached"> {
  const existing = await listCharacters(db, accountId);
  if (existing.length >= MAX_CHARACTERS_PER_ACCOUNT) return "limit_reached";

  const id = crypto.randomUUID();
  const position = spawnPosition(id);
  await db.insert(character).values({
    id,
    accountId,
    name,
    ...position,
    appearance,
    hp: maxHpForLevel(1),
  });
  return { id, name, appearance, level: 1 };
}

export async function characterOwnedBy(
  db: Db,
  accountId: string,
  characterId: string,
): Promise<CharacterSummary | null> {
  const row = await db
    .select()
    .from(character)
    .where(and(eq(character.id, characterId), eq(character.accountId, accountId)))
    .get();
  return row ? summary(row) : null;
}

export async function deleteCharacter(
  db: Db,
  accountId: string,
  characterId: string,
): Promise<boolean> {
  const owned = await characterOwnedBy(db, accountId, characterId);
  if (!owned) return false;
  await db.delete(character).where(eq(character.id, characterId));
  return true;
}
