import type { Equipment } from "@lindocara/engine/character.js";
import { normalizeEquipment, starterEquipmentFor } from "@lindocara/engine/character.js";
import {
  CONSUMABLE_IDS,
  type ConsumableCounts,
  emptyConsumables,
} from "@lindocara/engine/consumables.js";
import { type QuestChapter, questDefinition } from "@lindocara/engine/game.js";
import type { QuestState } from "@lindocara/engine/protocol.js";
import { and, eq } from "drizzle-orm";
import { type Db, type hero, heroEquipment, heroItem, heroQuest, heroSkill } from "./db/index.js";
import { HEALTH_POTION_ID, isMainHandItem, isOffHandItem, ownedItemId } from "./items.js";

const QUEST_ORDER: readonly QuestChapter[] = [
  "three_offerings",
  "bone_choir",
  "mire_runes",
  "ward_run",
];

interface PersistedHeroQuest {
  questId: string;
  status: QuestState["status"];
  progress: number;
  acceptedAt: Date | null;
  completedAt: Date | null;
  data: Record<string, unknown> | null;
  rewardClaimId: string | null;
}

export interface NormalizedHeroState {
  consumables: ConsumableCounts;
  equipment: Equipment;
  quest: QuestState;
  wardRunExpiresAt: number | null;
}

export async function loadNormalizedHeroState(
  db: Db,
  row: typeof hero.$inferSelect,
): Promise<NormalizedHeroState> {
  const [items, equipped, quests] = await Promise.all([
    db.select().from(heroItem).where(eq(heroItem.heroId, row.id)),
    db
      .select({ slot: heroEquipment.slot, definitionId: heroItem.itemDefinitionId })
      .from(heroEquipment)
      .innerJoin(
        heroItem,
        and(eq(heroItem.heroId, heroEquipment.heroId), eq(heroItem.id, heroEquipment.heroItemId)),
      )
      .where(eq(heroEquipment.heroId, row.id)),
    listHeroQuests(db, row.id),
  ]);
  const consumables = emptyConsumables();
  for (const item of items) {
    if ((CONSUMABLE_IDS as readonly string[]).includes(item.itemDefinitionId)) {
      consumables[item.itemDefinitionId as keyof ConsumableCounts] = Math.max(0, item.quantity);
    }
  }
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
  const chapter = isQuestChapter(selected?.questId) ? selected.questId : "three_offerings";
  return {
    consumables,
    equipment,
    quest: {
      chapter,
      status: selected?.status ?? "available",
      progress: Math.max(0, selected?.progress ?? 0),
      target: questDefinition(chapter).target,
    },
    wardRunExpiresAt: numberFromData(selected?.data, "wardRunExpiresAt"),
  };
}

export async function listHeroQuests(db: Db, heroId: string): Promise<PersistedHeroQuest[]> {
  return db.select().from(heroQuest).where(eq(heroQuest.heroId, heroId));
}

export async function loadHeroSkills(db: Db, heroId: string) {
  return db.select().from(heroSkill).where(eq(heroSkill.heroId, heroId));
}

export async function consumeHeroOwnedItem(
  db: Db,
  heroId: string,
  sessionEpoch: number,
  itemDefinitionId: string,
): Promise<number | null> {
  const result = await db.$client
    .prepare(
      `UPDATE hero_item
       SET quantity = quantity - 1
       WHERE hero_id = ? AND item_definition_id = ? AND quantity > 0
         AND EXISTS (
           SELECT 1 FROM hero WHERE id = ? AND session_epoch = ?
         )
         AND EXISTS (
           SELECT 1 FROM item_definition
           WHERE id = hero_item.item_definition_id AND type = 'consumable'
         )
       RETURNING quantity`,
    )
    .bind(heroId, itemDefinitionId, heroId, sessionEpoch)
    .first<{ quantity: number }>();
  return result?.quantity ?? null;
}

export async function claimHeroQuestReward(
  db: Db,
  input: {
    heroId: string;
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
        `UPDATE hero_quest
         SET status = 'completed', completed_at = unixepoch() * 1000, reward_claim_id = ?
         WHERE hero_id = ? AND quest_id = ? AND status = 'ready'
           AND reward_claim_id IS NULL
           AND EXISTS (SELECT 1 FROM hero WHERE id = ? AND session_epoch = ?)
         RETURNING quest_id`,
      )
      .bind(claimId, input.heroId, input.questId, input.heroId, input.sessionEpoch),
    db.$client
      .prepare(
        `UPDATE hero
         SET gold = gold + ?, level = ?, xp = ?, hp = ?, updated_at = unixepoch() * 1000
         WHERE id = ? AND session_epoch = ?
           AND EXISTS (
             SELECT 1 FROM hero_quest
             WHERE hero_id = ? AND quest_id = ? AND reward_claim_id = ?
           )`,
      )
      .bind(
        input.rewardGold,
        input.resultingLevel,
        input.resultingXp,
        input.resultingHp,
        input.heroId,
        input.sessionEpoch,
        input.heroId,
        input.questId,
        claimId,
      ),
    db.$client
      .prepare(
        `INSERT INTO hero_item (id, hero_id, item_definition_id, quantity, created_at)
         SELECT ?, ?, ?, ?, unixepoch() * 1000
         WHERE EXISTS (
           SELECT 1 FROM hero_quest
           WHERE hero_id = ? AND quest_id = ? AND reward_claim_id = ?
         )
           AND EXISTS (SELECT 1 FROM hero WHERE id = ? AND session_epoch = ?)
         ON CONFLICT(hero_id, item_definition_id) DO UPDATE SET
           quantity = hero_item.quantity + excluded.quantity`,
      )
      .bind(
        ownedItemId(input.heroId, HEALTH_POTION_ID),
        input.heroId,
        HEALTH_POTION_ID,
        input.rewardPotions,
        input.heroId,
        input.questId,
        claimId,
        input.heroId,
        input.sessionEpoch,
      ),
  ]);
  return (results[0]?.results.length ?? 0) === 1;
}

function selectPrimaryQuest(quests: readonly PersistedHeroQuest[]): PersistedHeroQuest | undefined {
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
