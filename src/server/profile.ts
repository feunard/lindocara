import { and, eq, sql } from "drizzle-orm";
import {
  type CharacterAppearance,
  type Equipment,
  isEquipmentForClass,
  normalizeAppearance,
  starterEquipmentFor,
} from "../shared/character.js";
import { isLifeState, type LifeState } from "../shared/death.js";
import {
  clampRestoredPosition,
  isWalkable,
  maxHpForLevel,
  type PlayerClass,
  type TerrainGeometry,
} from "../shared/game.js";
import type { Inventory, QuestState } from "../shared/protocol.js";
import type { Vec2 } from "../shared/simulation.js";
import { CLASS_SKILLS, isSkillUnlocked } from "../shared/skills.js";
import { resolveZoneLocation } from "../shared/zones.js";
import { loadNormalizedCharacterState } from "./character-persistence.js";
import { type Character, character, type Db } from "./db/index.js";
import { HEALTH_POTION_ID, ownedItemId } from "./items.js";

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
  zoneId: string;
  instanceId: string;
  sessionEpoch: number;
  wardRunExpiresAt: number | null;
  life: LifeState;
  /** Null exactly when `life` is "alive". */
  corpse: Vec2 | null;
}

/**
 * A dead row must carry a body. If the two ever disagree — a hand-edited row, a half-applied
 * migration — repair to alive rather than stranding a ghost with nothing to walk back to.
 */
function lifeFromRow(
  row: Character,
  terrain?: TerrainGeometry,
): { life: LifeState; corpse: Vec2 | null } {
  const life = isLifeState(row.life) ? row.life : "alive";
  if (life === "alive") return { life: "alive", corpse: null };
  if (row.corpseX === null || row.corpseY === null) return { life: "alive", corpse: null };
  const corpse = { x: row.corpseX, y: row.corpseY };
  if (!isWalkable(corpse, undefined, terrain)) return { life: "alive", corpse: null };
  return { life, corpse };
}

async function fromRow(db: Db, row: Character): Promise<PlayerProfile> {
  const terrain = resolveZoneLocation(row.zoneId, row.instanceId)?.definition.terrain;
  const position = clampRestoredPosition({ x: row.x, y: row.y }, row.id, terrain);
  const maxHp = maxHpForLevel(row.level);
  const normalized = await loadNormalizedCharacterState(db, row);
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
    equipment: normalized.equipment,
    inventory: {
      potions: normalized.potions,
      gold: Math.max(0, row.gold),
      crystals: Math.max(0, row.crystals),
    },
    quest: normalized.quest,
    zoneId: row.zoneId,
    instanceId: row.instanceId,
    sessionEpoch: Math.max(0, row.sessionEpoch),
    wardRunExpiresAt: normalized.wardRunExpiresAt,
    ...lifeFromRow(row, terrain),
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
  return fromRow(db, row);
}

export type SaveableProfile = PlayerProfile;

export async function acquireSessionEpoch(db: Db, characterId: string): Promise<number | null> {
  const updated = await db
    .update(character)
    .set({ sessionEpoch: sql`${character.sessionEpoch} + 1` })
    .where(eq(character.id, characterId))
    .returning({ sessionEpoch: character.sessionEpoch })
    .get();
  return updated?.sessionEpoch ?? null;
}

/**
 * Atomically move a character and advance its fencing epoch.  This is deliberately separate
 * from the normal profile save: a source room can never write over this location once it wins.
 */
export async function handoffProfileLocation(
  db: Db,
  profile: Pick<SaveableProfile, "id" | "sessionEpoch">,
  destination: { zoneId: string; instanceId: string; x: number; y: number },
): Promise<number | null> {
  const updated = await db
    .update(character)
    .set({
      zoneId: destination.zoneId,
      instanceId: destination.instanceId,
      x: destination.x,
      y: destination.y,
      sessionEpoch: sql`${character.sessionEpoch} + 1`,
      lastSeenAt: new Date(),
    })
    .where(and(eq(character.id, profile.id), eq(character.sessionEpoch, profile.sessionEpoch)))
    .returning({ sessionEpoch: character.sessionEpoch })
    .get();
  return updated?.sessionEpoch ?? null;
}

/** Persist only while this runtime still owns the character's current session epoch. */
export async function saveProfile(db: Db, profile: SaveableProfile): Promise<boolean> {
  const equipment = isEquipmentForClass(profile.equipment, profile.class)
    ? profile.equipment
    : starterEquipmentFor(profile.class);
  const chapter = profile.quest.chapter ?? "three_offerings";
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db.$client
      .prepare(
        `UPDATE character SET
          name = ?, x = ?, y = ?, level = ?, xp = ?, hp = ?,
          appearance = ?, appearance_body = ?, appearance_primary_color = ?, class = ?,
          gold = ?, crystals = ?, zone_id = ?, instance_id = ?, life = ?,
          corpse_x = ?, corpse_y = ?, last_seen_at = ?, persistence_version = 1
         WHERE id = ? AND session_epoch = ?
         RETURNING id`,
      )
      .bind(
        profile.nick,
        profile.x,
        profile.y,
        profile.level,
        profile.xp,
        profile.hp,
        profile.appearance.primaryColor,
        profile.appearance.body,
        profile.appearance.primaryColor,
        profile.class,
        profile.inventory.gold,
        profile.inventory.crystals,
        profile.zoneId,
        profile.instanceId,
        profile.life,
        profile.corpse?.x ?? null,
        profile.corpse?.y ?? null,
        now,
        profile.id,
        profile.sessionEpoch,
      ),
    db.$client
      .prepare(
        `INSERT INTO character_item
          (id, character_id, item_definition_id, quantity, created_at)
         SELECT ?, id, ?, ?, ? FROM character WHERE id = ? AND session_epoch = ?
         ON CONFLICT(character_id, item_definition_id) DO UPDATE SET quantity = excluded.quantity`,
      )
      .bind(
        ownedItemId(profile.id, HEALTH_POTION_ID),
        HEALTH_POTION_ID,
        profile.inventory.potions,
        now,
        profile.id,
        profile.sessionEpoch,
      ),
  ];
  for (const [slot, definitionId] of [
    ["main_hand", equipment.mainHand],
    ["off_hand", equipment.offHand],
  ] as const) {
    if (definitionId === null) {
      statements.push(
        db.$client
          .prepare(
            `DELETE FROM character_equipment
             WHERE character_id = ? AND slot = ?
               AND EXISTS (SELECT 1 FROM character WHERE id = ? AND session_epoch = ?)`,
          )
          .bind(profile.id, slot, profile.id, profile.sessionEpoch),
      );
      continue;
    }
    const itemId = ownedItemId(profile.id, definitionId);
    statements.push(
      db.$client
        .prepare(
          `INSERT INTO character_item
            (id, character_id, item_definition_id, quantity, created_at)
           SELECT ?, id, ?, 1, ? FROM character WHERE id = ? AND session_epoch = ?
           ON CONFLICT(character_id, item_definition_id) DO NOTHING`,
        )
        .bind(itemId, definitionId, now, profile.id, profile.sessionEpoch),
      db.$client
        .prepare(
          `INSERT INTO character_equipment
            (character_id, slot, character_item_id, equipped_at)
           SELECT id, ?, ?, ? FROM character WHERE id = ? AND session_epoch = ?
           ON CONFLICT(character_id, slot) DO UPDATE SET
             character_item_id = excluded.character_item_id,
             equipped_at = excluded.equipped_at`,
        )
        .bind(slot, itemId, now, profile.id, profile.sessionEpoch),
    );
  }
  statements.push(
    db.$client
      .prepare(
        `INSERT INTO character_quest
          (character_id, quest_id, status, progress, accepted_at, completed_at, data)
         SELECT id, ?, ?, ?,
           CASE WHEN ? = 'available' THEN NULL ELSE ? END,
           CASE WHEN ? = 'completed' THEN ? ELSE NULL END,
           ?
         FROM character WHERE id = ? AND session_epoch = ?
         ON CONFLICT(character_id, quest_id) DO UPDATE SET
           status = excluded.status,
           progress = excluded.progress,
           accepted_at = COALESCE(character_quest.accepted_at, excluded.accepted_at),
           completed_at = excluded.completed_at,
           data = excluded.data
         WHERE character_quest.reward_claim_id IS NULL OR excluded.status = 'completed'`,
      )
      .bind(
        chapter,
        profile.quest.status,
        profile.quest.progress,
        profile.quest.status,
        now,
        profile.quest.status,
        now,
        profile.wardRunExpiresAt === null
          ? null
          : JSON.stringify({ wardRunExpiresAt: profile.wardRunExpiresAt }),
        profile.id,
        profile.sessionEpoch,
      ),
  );
  for (const skill of CLASS_SKILLS[profile.class]) {
    const unlocked = isSkillUnlocked(profile.level, skill.slot);
    statements.push(
      db.$client
        .prepare(
          `INSERT INTO character_skill
            (character_id, skill_id, unlocked, equipped, slot, unlocked_at)
           SELECT id, ?, ?, ?, ?, ? FROM character WHERE id = ? AND session_epoch = ?
           ON CONFLICT(character_id, skill_id) DO UPDATE SET
             unlocked = excluded.unlocked,
             equipped = excluded.equipped,
             slot = excluded.slot,
             unlocked_at = COALESCE(character_skill.unlocked_at, excluded.unlocked_at)`,
        )
        .bind(
          skill.id,
          unlocked ? 1 : 0,
          unlocked ? 1 : 0,
          unlocked ? skill.slot : null,
          unlocked ? now : null,
          profile.id,
          profile.sessionEpoch,
        ),
    );
  }
  const results = await db.$client.batch(statements);
  return (results[0]?.results.length ?? 0) === 1;
}
