/**
 * Account-facing character CRUD. The world never creates characters; it only loads them
 * by id through profile.ts after the Worker has proven ownership here.
 */

import {
  type CharacterAppearance,
  type Equipment,
  isValidAppearance,
  normalizeAppearance,
  starterEquipmentFor,
} from "@lindocara/engine/character.js";
import { maxHpForLevel, type PlayerClass } from "@lindocara/engine/game.js";
import { mapSpawnPoint } from "@lindocara/engine/map-data.js";
import { CLASS_SKILLS, isSkillUnlocked } from "@lindocara/engine/skills.js";
import { and, eq } from "drizzle-orm";
import { loadNormalizedCharacterState } from "./character-persistence.js";
import {
  character,
  characterEquipment,
  characterItem,
  characterQuest,
  characterSkill,
  type Db,
} from "./db/index.js";
import { HEALTH_POTION_ID, ownedItemId } from "./items.js";
import { resolveMapFor } from "./maps.js";

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
  zoneId: string;
  instanceId: string;
}

function summary(
  row: {
    id: string;
    name: string;
    appearance: unknown;
    appearanceBody: unknown;
    appearancePrimaryColor: unknown;
    level: number;
    class: PlayerClass;
    zoneId: string;
    instanceId: string;
  },
  equipment: Equipment,
): CharacterSummary {
  return {
    id: row.id,
    name: row.name,
    appearance: normalizeAppearance(
      {
        body: row.appearanceBody,
        primaryColor: row.appearancePrimaryColor,
      },
      row.appearance,
    ),
    level: row.level,
    class: row.class,
    equipment,
    zoneId: row.zoneId,
    instanceId: row.instanceId,
  };
}

export async function listCharacters(db: Db, accountId: string): Promise<CharacterSummary[]> {
  const rows = await db.select().from(character).where(eq(character.accountId, accountId));
  return Promise.all(
    rows.map(async (row) => summary(row, (await loadNormalizedCharacterState(db, row)).equipment)),
  );
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
  // "" is never a map id, so this is exactly "own map (never, it's new) → first map → builtin" —
  // a fresh hero starts wherever the front door currently points.
  const stored = await resolveMapFor(db, accountId, "");
  const spawn = mapSpawnPoint(stored);
  const equipment = starterEquipmentFor(playerClass);
  const now = new Date();
  const equipmentIds = equipment.offHand
    ? [equipment.mainHand, equipment.offHand]
    : [equipment.mainHand];
  await db.batch([
    db.insert(character).values({
      id,
      accountId,
      name,
      zoneId: stored.id,
      instanceId: "main",
      x: spawn.x,
      y: spawn.y,
      appearance: appearance.primaryColor,
      appearanceBody: appearance.body,
      appearancePrimaryColor: appearance.primaryColor,
      class: playerClass,
      hp: maxHpForLevel(1),
      persistenceVersion: 1,
      createdAt: now,
      lastSeenAt: now,
    }),
    db.insert(characterItem).values([
      {
        id: ownedItemId(id, HEALTH_POTION_ID),
        characterId: id,
        itemDefinitionId: HEALTH_POTION_ID,
        quantity: 2,
        createdAt: now,
      },
      ...equipmentIds.map((definitionId) => ({
        id: ownedItemId(id, definitionId),
        characterId: id,
        itemDefinitionId: definitionId,
        quantity: 1,
        createdAt: now,
      })),
    ]),
    db.insert(characterEquipment).values([
      {
        characterId: id,
        slot: "main_hand",
        characterItemId: ownedItemId(id, equipment.mainHand),
        equippedAt: now,
      },
      ...(equipment.offHand === null
        ? []
        : [
            {
              characterId: id,
              slot: "off_hand" as const,
              characterItemId: ownedItemId(id, equipment.offHand),
              equippedAt: now,
            },
          ]),
    ]),
    db.insert(characterQuest).values({
      characterId: id,
      questId: "three_offerings",
      status: "available",
      progress: 0,
    }),
    db.insert(characterSkill).values(
      CLASS_SKILLS[playerClass].map((skill) => {
        const unlocked = isSkillUnlocked(1, skill.slot);
        return {
          characterId: id,
          skillId: skill.id,
          unlocked,
          equipped: unlocked,
          slot: unlocked ? skill.slot : null,
          unlockedAt: unlocked ? now : null,
        };
      }),
    ),
  ]);
  return {
    id,
    name,
    appearance,
    level: 1,
    class: playerClass,
    equipment,
    zoneId: stored.id,
    instanceId: "main",
  };
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
  return row ? summary(row, (await loadNormalizedCharacterState(db, row)).equipment) : null;
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
