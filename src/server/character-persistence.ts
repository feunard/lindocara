import type { Equipment } from "@lindocara/engine/character.js";
import { normalizeEquipment, starterEquipmentFor } from "@lindocara/engine/character.js";
import { type QuestChapter, questDefinition } from "@lindocara/engine/game.js";
import type { QuestState } from "@lindocara/engine/protocol.js";
import { CLASS_SKILLS, isSkillUnlocked } from "@lindocara/engine/skills.js";
import { and, eq } from "drizzle-orm";
import {
  type character,
  characterEquipment,
  characterItem,
  characterQuest,
  characterSkill,
  type Db,
  type EquipmentSlot,
} from "./db/index.js";
import {
  HEALTH_POTION_ID,
  ITEM_DEFINITIONS,
  isMainHandItem,
  isOffHandItem,
  ownedItemId,
} from "./items.js";

const QUEST_ORDER: readonly QuestChapter[] = [
  "three_offerings",
  "bone_choir",
  "mire_runes",
  "ward_run",
];

export interface NormalizedCharacterState {
  potions: number;
  equipment: Equipment;
  quest: QuestState;
  wardRunExpiresAt: number | null;
}

export interface PersistedQuest {
  questId: string;
  status: QuestState["status"];
  progress: number;
  acceptedAt: Date | null;
  completedAt: Date | null;
  data: Record<string, unknown> | null;
  rewardClaimId: string | null;
}

export async function ensureNormalizedCharacter(db: Db, row: typeof character.$inferSelect) {
  if (row.persistenceVersion >= 1) return;
  const equipment = normalizeEquipment(row.class, row.mainHand, row.offHand);
  const statements: D1PreparedStatement[] = [];
  for (const definition of ITEM_DEFINITIONS) {
    statements.push(
      db.$client
        .prepare(
          `INSERT OR IGNORE INTO item_definition
            (id, type, stackable, max_stack, equipment_slot, allowed_class)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          definition.id,
          definition.type,
          definition.stackable ? 1 : 0,
          definition.maxStack,
          definition.equipmentSlot,
          definition.allowedClass,
        ),
    );
  }
  statements.push(
    db.$client
      .prepare(
        `INSERT OR IGNORE INTO character_item
          (id, character_id, item_definition_id, quantity, created_at)
         SELECT ?, id, ?, ?, created_at FROM character WHERE id = ?`,
      )
      .bind(ownedItemId(row.id, HEALTH_POTION_ID), HEALTH_POTION_ID, row.potions, row.id),
  );
  for (const [slot, definitionId] of [
    ["main_hand", equipment.mainHand],
    ["off_hand", equipment.offHand],
  ] as const) {
    if (definitionId === null) continue;
    const itemId = ownedItemId(row.id, definitionId);
    statements.push(
      db.$client
        .prepare(
          `INSERT OR IGNORE INTO character_item
            (id, character_id, item_definition_id, quantity, created_at)
           SELECT ?, id, ?, 1, created_at FROM character WHERE id = ?`,
        )
        .bind(itemId, definitionId, row.id),
      db.$client
        .prepare(
          `INSERT OR IGNORE INTO character_equipment
            (character_id, slot, character_item_id, equipped_at)
           SELECT id, ?, ?, last_seen_at FROM character WHERE id = ?`,
        )
        .bind(slot, itemId, row.id),
    );
  }
  statements.push(
    db.$client
      .prepare(
        `INSERT OR IGNORE INTO character_quest
          (character_id, quest_id, status, progress, accepted_at, completed_at, data)
         SELECT id, quest_chapter, quest_status, quest_progress,
           CASE WHEN quest_status = 'available' THEN NULL ELSE created_at END,
           CASE WHEN quest_status = 'completed' THEN last_seen_at ELSE NULL END,
           CASE WHEN ward_run_expires_at IS NULL THEN NULL
             ELSE json_object('wardRunExpiresAt', ward_run_expires_at) END
         FROM character WHERE id = ?`,
      )
      .bind(row.id),
  );
  for (const skill of CLASS_SKILLS[row.class]) {
    const unlocked = isSkillUnlocked(row.level, skill.slot);
    statements.push(
      db.$client
        .prepare(
          `INSERT OR IGNORE INTO character_skill
            (character_id, skill_id, unlocked, equipped, slot, unlocked_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          skill.id,
          unlocked ? 1 : 0,
          unlocked ? 1 : 0,
          unlocked ? skill.slot : null,
          unlocked ? row.createdAt.getTime() : null,
        ),
    );
  }
  statements.push(
    db.$client.prepare("UPDATE character SET persistence_version = 1 WHERE id = ?").bind(row.id),
  );
  await db.$client.batch(statements);
}

export async function loadNormalizedCharacterState(
  db: Db,
  row: typeof character.$inferSelect,
): Promise<NormalizedCharacterState> {
  await ensureNormalizedCharacter(db, row);
  const [items, equipped, quests] = await Promise.all([
    db.select().from(characterItem).where(eq(characterItem.characterId, row.id)),
    db
      .select({
        slot: characterEquipment.slot,
        definitionId: characterItem.itemDefinitionId,
      })
      .from(characterEquipment)
      .innerJoin(
        characterItem,
        and(
          eq(characterItem.characterId, characterEquipment.characterId),
          eq(characterItem.id, characterEquipment.characterItemId),
        ),
      )
      .where(eq(characterEquipment.characterId, row.id)),
    listCharacterQuests(db, row.id),
  ]);
  const potions = items.find((item) => item.itemDefinitionId === HEALTH_POTION_ID)?.quantity ?? 0;
  let mainHand: string | undefined;
  let offHand: string | null = null;
  for (const item of equipped) {
    if (item.slot === "main_hand") mainHand = item.definitionId;
    if (item.slot === "off_hand") offHand = item.definitionId;
  }
  const equipment =
    mainHand && isMainHandItem(mainHand) && (offHand === null || isOffHandItem(offHand))
      ? normalizeEquipment(row.class, mainHand, offHand)
      : starterEquipmentFor(row.class);
  const selected = selectPrimaryQuest(quests);
  const chapter = selected?.questId;
  const questChapter = isQuestChapter(chapter) ? chapter : "three_offerings";
  return {
    potions: Math.max(0, potions),
    equipment,
    quest: {
      chapter: questChapter,
      status: selected?.status ?? "available",
      progress: Math.max(0, selected?.progress ?? 0),
      target: questDefinition(questChapter).target,
    },
    wardRunExpiresAt: numberFromData(selected?.data, "wardRunExpiresAt"),
  };
}

export async function listCharacterQuests(db: Db, characterId: string): Promise<PersistedQuest[]> {
  return db.select().from(characterQuest).where(eq(characterQuest.characterId, characterId));
}

export async function loadCharacterSkills(db: Db, characterId: string) {
  return db.select().from(characterSkill).where(eq(characterSkill.characterId, characterId));
}

export async function consumeOwnedItem(
  db: Db,
  characterId: string,
  itemDefinitionId: string,
): Promise<number | null> {
  const result = await db.$client
    .prepare(
      `UPDATE character_item
       SET quantity = quantity - 1
       WHERE character_id = ? AND item_definition_id = ? AND quantity > 0
         AND EXISTS (
           SELECT 1 FROM item_definition
           WHERE id = character_item.item_definition_id AND type = 'consumable'
         )
       RETURNING quantity`,
    )
    .bind(characterId, itemDefinitionId)
    .first<{ quantity: number }>();
  return result?.quantity ?? null;
}

export async function equipOwnedItem(
  db: Db,
  characterId: string,
  characterItemId: string,
  slot: EquipmentSlot,
): Promise<boolean> {
  const result = await db.$client
    .prepare(
      `INSERT INTO character_equipment (character_id, slot, character_item_id, equipped_at)
       SELECT ci.character_id, ?, ci.id, unixepoch() * 1000
       FROM character_item ci
       INNER JOIN item_definition d ON d.id = ci.item_definition_id
       INNER JOIN character c ON c.id = ci.character_id
       WHERE ci.id = ? AND ci.character_id = ? AND ci.quantity > 0
         AND d.equipment_slot = ?
         AND (d.allowed_class IS NULL OR d.allowed_class = c.class)
       ON CONFLICT(character_id, slot) DO UPDATE SET
         character_item_id = excluded.character_item_id,
         equipped_at = excluded.equipped_at
       RETURNING character_item_id`,
    )
    .bind(slot, characterItemId, characterId, slot)
    .first<{ character_item_id: string }>();
  return result !== null;
}

export async function claimQuestReward(
  db: Db,
  input: {
    characterId: string;
    sessionEpoch: number;
    questId: string;
    rewardGold: number;
    rewardPotions: number;
    resultingLevel: number;
    resultingXp: number;
    resultingHp: number;
  },
): Promise<boolean> {
  const claimId = crypto.randomUUID();
  const results = await db.$client.batch([
    db.$client
      .prepare(
        `UPDATE character_quest
         SET status = 'completed', completed_at = unixepoch() * 1000, reward_claim_id = ?
         WHERE character_id = ? AND quest_id = ? AND status = 'ready'
           AND reward_claim_id IS NULL
           AND EXISTS (
             SELECT 1 FROM character
             WHERE id = ? AND session_epoch = ?
           )
         RETURNING quest_id`,
      )
      .bind(claimId, input.characterId, input.questId, input.characterId, input.sessionEpoch),
    db.$client
      .prepare(
        `UPDATE character
         SET gold = gold + ?, level = ?, xp = ?, hp = ?
         WHERE id = ? AND session_epoch = ?
           AND EXISTS (
             SELECT 1 FROM character_quest
             WHERE character_id = ? AND quest_id = ? AND reward_claim_id = ?
           )`,
      )
      .bind(
        input.rewardGold,
        input.resultingLevel,
        input.resultingXp,
        input.resultingHp,
        input.characterId,
        input.sessionEpoch,
        input.characterId,
        input.questId,
        claimId,
      ),
    db.$client
      .prepare(
        `INSERT INTO character_item
          (id, character_id, item_definition_id, quantity, created_at)
         SELECT ?, ?, ?, ?, unixepoch() * 1000
         WHERE EXISTS (
           SELECT 1 FROM character_quest
           WHERE character_id = ? AND quest_id = ? AND reward_claim_id = ?
         )
         ON CONFLICT(character_id, item_definition_id) DO UPDATE SET
           quantity = character_item.quantity + excluded.quantity`,
      )
      .bind(
        ownedItemId(input.characterId, HEALTH_POTION_ID),
        input.characterId,
        HEALTH_POTION_ID,
        input.rewardPotions,
        input.characterId,
        input.questId,
        claimId,
      ),
  ]);
  return (results[0]?.results.length ?? 0) === 1;
}

function selectPrimaryQuest(quests: readonly PersistedQuest[]): PersistedQuest | undefined {
  for (const questId of QUEST_ORDER) {
    const quest = quests.find((candidate) => candidate.questId === questId);
    if (quest && quest.status !== "completed") return quest;
  }
  for (let index = QUEST_ORDER.length - 1; index >= 0; index--) {
    const quest = quests.find((candidate) => candidate.questId === QUEST_ORDER[index]);
    if (quest) return quest;
  }
  return undefined;
}

function isQuestChapter(value: string | undefined): value is QuestChapter {
  return value !== undefined && (QUEST_ORDER as readonly string[]).includes(value);
}

function numberFromData(
  data: Record<string, unknown> | null | undefined,
  key: string,
): number | null {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
