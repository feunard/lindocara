import { eq } from "drizzle-orm";
import {
  type CharacterAppearance,
  type Equipment,
  normalizeAppearance,
  normalizeEquipment,
} from "../shared/character.js";
import { isLifeState, type LifeState } from "../shared/death.js";
import {
  clampRestoredPosition,
  isWalkable,
  maxHpForLevel,
  type PlayerClass,
  questDefinition,
} from "../shared/game.js";
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
  life: LifeState;
  /** Null exactly when `life` is "alive". */
  corpse: Vec2 | null;
}

/**
 * A dead row must carry a body. If the two ever disagree — a hand-edited row, a half-applied
 * migration — repair to alive rather than stranding a ghost with nothing to walk back to.
 */
function lifeFromRow(row: Character): { life: LifeState; corpse: Vec2 | null } {
  const life = isLifeState(row.life) ? row.life : "alive";
  if (life === "alive") return { life: "alive", corpse: null };
  if (row.corpseX === null || row.corpseY === null) return { life: "alive", corpse: null };
  const corpse = { x: row.corpseX, y: row.corpseY };
  if (!isWalkable(corpse)) return { life: "alive", corpse: null };
  return { life, corpse };
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
      {
        body: row.appearanceBody,
        primaryColor: row.appearancePrimaryColor,
      },
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
      chapter: row.questChapter,
      status: row.questStatus,
      progress: Math.max(0, row.questProgress),
      target: questDefinition(row.questChapter).target,
    },
    ...lifeFromRow(row),
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
      questChapter: profile.quest.chapter ?? "three_offerings",
      questProgress: profile.quest.progress,
      life: profile.life,
      corpseX: profile.corpse?.x ?? null,
      corpseY: profile.corpse?.y ?? null,
      lastSeenAt: new Date(),
    })
    .where(eq(character.id, profile.id));
}
