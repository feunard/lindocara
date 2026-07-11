import { eq } from "drizzle-orm";
import {
  type CharacterAppearance,
  type Equipment,
  normalizeAppearance,
  normalizeEquipment,
} from "../shared/character.js";
import { clampRestoredPosition, maxHpForLevel, type PlayerClass } from "../shared/game.js";
import type { Inventory, QuestState } from "../shared/protocol.js";
import type { Vec2 } from "../shared/simulation.js";
import { type Character, character, type Db } from "./db/index.js";

export interface PlayerProfile extends Vec2 {
  id: string;
  nick: string;
  level: number;
  xp: number;
  hp: number;
  appearance: CharacterAppearance;
  class: PlayerClass;
  equipment: Equipment;
  inventory: Inventory;
  quest: QuestState;
}

function fromRow(row: Character): PlayerProfile {
  const position = clampRestoredPosition({ x: row.x, y: row.y }, row.id);
  const maxHp = maxHpForLevel(row.level);
  return {
    id: row.id,
    nick: row.name,
    ...position,
    level: Math.max(1, row.level),
    xp: Math.max(0, row.xp),
    hp: Math.min(maxHp, Math.max(1, row.hp)),
    appearance: normalizeAppearance(
      { body: row.appearanceBody, primaryColor: row.appearancePrimaryColor },
      row.appearance,
    ),
    class: row.class,
    equipment: normalizeEquipment(row.class, row.mainHand, row.offHand),
    inventory: {
      potions: Math.max(0, row.potions),
      gold: Math.max(0, row.gold),
      crystals: Math.max(0, row.crystals),
    },
    quest: {
      status: row.questStatus,
      progress: Math.max(0, row.questProgress),
      target: 3,
    },
  };
}

/**
 * Load by character id, never create. Characters exist only through POST /api/characters,
 * so a missing row here means the socket must be refused.
 */
export async function loadProfile(db: Db, characterId: string): Promise<PlayerProfile | null> {
  const row = await db.select().from(character).where(eq(character.id, characterId)).get();
  if (!row) return null;
  await db.update(character).set({ lastSeenAt: new Date() }).where(eq(character.id, characterId));
  return fromRow(row);
}

export type SaveableProfile = PlayerProfile;

export async function saveProfile(db: Db, profile: SaveableProfile): Promise<void> {
  await db
    .update(character)
    .set({
      name: profile.nick,
      x: profile.x,
      y: profile.y,
      level: profile.level,
      xp: profile.xp,
      hp: profile.hp,
      appearance: profile.appearance.primaryColor,
      appearanceBody: profile.appearance.body,
      appearancePrimaryColor: profile.appearance.primaryColor,
      class: profile.class,
      mainHand: profile.equipment.mainHand,
      offHand: profile.equipment.offHand,
      potions: profile.inventory.potions,
      gold: profile.inventory.gold,
      crystals: profile.inventory.crystals,
      questStatus: profile.quest.status,
      questProgress: profile.quest.progress,
      lastSeenAt: new Date(),
    })
    .where(eq(character.id, profile.id));
}
