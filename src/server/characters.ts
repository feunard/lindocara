/**
 * Account-facing character CRUD. The world never creates characters; it only loads them
 * by id through profile.ts after the Worker has proven ownership here.
 */

import { and, eq } from "drizzle-orm";
import {
  type CharacterAppearance,
  type Equipment,
  isValidAppearance,
  normalizeAppearance,
  normalizeEquipment,
  starterEquipmentFor,
} from "../shared/character.js";
import { maxHpForLevel, type PlayerClass, spawnPosition } from "../shared/game.js";
import { character, type Db } from "./db/index.js";

export const MAX_CHARACTERS_PER_ACCOUNT = 3;

const NAME_PATTERN = /^[A-Za-z0-9_-]{2,16}$/;
export function isValidCharacterName(value: unknown): value is string {
  return typeof value === "string" && NAME_PATTERN.test(value);
}

export { isValidAppearance };

export interface CharacterSummary {
  id: string;
  name: string;
  appearance: CharacterAppearance;
  level: number;
  class: PlayerClass;
  equipment: Equipment;
}

function summary(row: {
  id: string;
  name: string;
  appearance: unknown;
  appearanceBody: unknown;
  appearancePrimaryColor: unknown;
  level: number;
  class: PlayerClass;
  mainHand: unknown;
  offHand: unknown;
}): CharacterSummary {
  return {
    id: row.id,
    name: row.name,
    appearance: normalizeAppearance(
      { body: row.appearanceBody, primaryColor: row.appearancePrimaryColor },
      row.appearance,
    ),
    level: row.level,
    class: row.class,
    equipment: normalizeEquipment(row.class, row.mainHand, row.offHand),
  };
}

export async function listCharacters(db: Db, accountId: string): Promise<CharacterSummary[]> {
  const rows = await db.select().from(character).where(eq(character.accountId, accountId));
  return rows.map(summary);
}

export async function createCharacter(
  db: Db,
  accountId: string,
  name: string,
  appearance: CharacterAppearance,
  playerClass: PlayerClass,
): Promise<CharacterSummary | "limit_reached"> {
  const existing = await listCharacters(db, accountId);
  if (existing.length >= MAX_CHARACTERS_PER_ACCOUNT) return "limit_reached";

  const id = crypto.randomUUID();
  const position = spawnPosition(id);
  const equipment = starterEquipmentFor(playerClass);
  const now = new Date();
  await db.insert(character).values({
    id,
    accountId,
    name,
    ...position,
    appearance: appearance.primaryColor,
    appearanceBody: appearance.body,
    appearancePrimaryColor: appearance.primaryColor,
    class: playerClass,
    mainHand: equipment.mainHand,
    offHand: equipment.offHand,
    hp: maxHpForLevel(1),
    createdAt: now,
    lastSeenAt: now,
  });
  return { id, name, appearance, level: 1, class: playerClass, equipment };
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
