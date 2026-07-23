import type {
  AuthoredQuestProgress,
  PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import type { QuestItemReward } from "@lindocara/engine/quests.js";
import { ownedItemId } from "./items.js";

export interface AtomicAuthoredQuestRewardInput {
  readonly ownerKind: "party" | "personal";
  readonly ownerId: string;
  readonly partyId: string;
  readonly heroId: string;
  readonly sessionEpoch: number;
  readonly questId: string;
  readonly attempt: number;
  readonly resultingLevel: number;
  readonly resultingXp: number;
  readonly resultingHp: number;
  readonly gold: number;
  readonly items: readonly QuestItemReward[];
  readonly consumeItems: readonly QuestItemReward[];
  readonly completedPersonal?: { questId: string; progress: AuthoredQuestProgress };
  readonly nextPersonal?: { questId: string; progress: AuthoredQuestProgress };
  readonly partyState?: PartyAdventureState;
}

function aggregateProgress(progress: AuthoredQuestProgress): number {
  return Object.values(progress.objectives).reduce((total, value) => total + value, 0);
}

function progressStatement(
  db: D1Database,
  claimId: string,
  heroId: string,
  questId: string,
  progress: AuthoredQuestProgress,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO hero_quest
        (hero_id, quest_id, status, progress, accepted_at, completed_at, data)
       SELECT ?, ?, ?, ?, unixepoch() * 1000,
              CASE WHEN ? = 'completed' THEN unixepoch() * 1000 ELSE NULL END, ?
       WHERE EXISTS (SELECT 1 FROM authored_quest_reward_claim WHERE id = ?)
       ON CONFLICT(hero_id, quest_id) DO UPDATE SET
         status = excluded.status,
         progress = excluded.progress,
         accepted_at = COALESCE(hero_quest.accepted_at, excluded.accepted_at),
         completed_at = excluded.completed_at,
         data = excluded.data`,
    )
    .bind(
      heroId,
      questId,
      progress.status,
      aggregateProgress(progress),
      progress.status,
      JSON.stringify({ authoredProgress: progress }),
      claimId,
    );
}

/** One D1 transaction: claim fence, delivery consumption, completion and every core reward. */
export async function claimAuthoredQuestReward(
  db: D1Database,
  input: AtomicAuthoredQuestRewardInput,
): Promise<boolean> {
  const claimId = crypto.randomUUID();
  const requirementSql = input.consumeItems
    .map(
      () =>
        `AND COALESCE((SELECT quantity FROM hero_item
                       WHERE hero_id = ? AND item_definition_id = ?), 0) >= ?`,
    )
    .join("\n");
  const requirementBindings = input.consumeItems.flatMap((item) => [
    input.heroId,
    item.itemId,
    item.quantity,
  ]);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO authored_quest_reward_claim
          (id, owner_kind, owner_id, recipient_hero_id, quest_id, attempt)
         SELECT ?, ?, ?, id, ?, ?
         FROM hero
         WHERE id = ? AND session_epoch = ?
         ${requirementSql}
         ON CONFLICT(owner_kind, owner_id, quest_id, attempt) DO NOTHING
         RETURNING id`,
      )
      .bind(
        claimId,
        input.ownerKind,
        input.ownerId,
        input.questId,
        input.attempt,
        input.heroId,
        input.sessionEpoch,
        ...requirementBindings,
      ),
    db
      .prepare(
        `UPDATE hero
         SET gold = gold + ?, level = ?, xp = ?, hp = ?, updated_at = unixepoch() * 1000
         WHERE id = ? AND session_epoch = ?
           AND EXISTS (SELECT 1 FROM authored_quest_reward_claim WHERE id = ?)`,
      )
      .bind(
        input.gold,
        input.resultingLevel,
        input.resultingXp,
        input.resultingHp,
        input.heroId,
        input.sessionEpoch,
        claimId,
      ),
  ];
  for (const item of input.consumeItems) {
    statements.push(
      db
        .prepare(
          `UPDATE hero_item
           SET quantity = quantity - ?
           WHERE hero_id = ? AND item_definition_id = ? AND quantity >= ?
             AND EXISTS (SELECT 1 FROM authored_quest_reward_claim WHERE id = ?)`,
        )
        .bind(item.quantity, input.heroId, item.itemId, item.quantity, claimId),
    );
  }
  for (const item of input.items) {
    statements.push(
      db
        .prepare(
          `INSERT INTO hero_item (id, hero_id, item_definition_id, quantity, created_at)
           SELECT ?, ?, ?, ?, unixepoch() * 1000
           WHERE EXISTS (SELECT 1 FROM authored_quest_reward_claim WHERE id = ?)
             AND EXISTS (SELECT 1 FROM item_definition WHERE id = ?)
           ON CONFLICT(hero_id, item_definition_id) DO UPDATE SET
             quantity = hero_item.quantity + excluded.quantity`,
        )
        .bind(
          ownedItemId(input.heroId, item.itemId),
          input.heroId,
          item.itemId,
          item.quantity,
          claimId,
          item.itemId,
        ),
    );
  }
  if (input.completedPersonal) {
    statements.push(
      progressStatement(
        db,
        claimId,
        input.heroId,
        input.completedPersonal.questId,
        input.completedPersonal.progress,
      ),
    );
  }
  if (input.nextPersonal) {
    statements.push(
      progressStatement(
        db,
        claimId,
        input.heroId,
        input.nextPersonal.questId,
        input.nextPersonal.progress,
      ),
    );
  }
  if (input.partyState) {
    statements.push(
      db
        .prepare(
          `INSERT INTO party_adventure_state
            (party_id, switches, variables, self_switches, quests, updated_at)
           SELECT ?, ?, ?, ?, ?, unixepoch() * 1000
           WHERE EXISTS (SELECT 1 FROM authored_quest_reward_claim WHERE id = ?)
           ON CONFLICT(party_id) DO UPDATE SET
             switches = excluded.switches,
             variables = excluded.variables,
             self_switches = excluded.self_switches,
             quests = excluded.quests,
             updated_at = excluded.updated_at`,
        )
        .bind(
          input.partyId,
          JSON.stringify(input.partyState.switches),
          JSON.stringify(input.partyState.variables),
          JSON.stringify(input.partyState.selfSwitches),
          JSON.stringify(input.partyState.quests ?? {}),
          claimId,
        ),
    );
  }
  const results = await db.batch(statements);
  return (results[0]?.results.length ?? 0) === 1;
}
