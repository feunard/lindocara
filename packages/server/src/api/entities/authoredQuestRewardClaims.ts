import { type Static, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";
import { heroes } from "./heroes.ts";

/**
 * Runtime entity for `authored_quest_reward_claim` (`packages/server/src/db/schema.ts:697`).
 *
 * Idempotency fence for authored rewards, including repeatable quest attempts. `ownerId` stays a
 * plain string with no `db.ref` — legacy documents it as polymorphic ("party id for shared quests,
 * hero id for personal quests"), so it can never point at one single foreign table.
 */
export const authoredQuestRewardClaims = $entity({
  name: "authoredQuestRewardClaims",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    ownerKind: z.enum(["party", "personal"]),
    /** Party id for shared quests, hero id for personal quests. Deliberately not a `db.ref`. */
    ownerId: z.string(),
    recipientHeroId: db.ref(z.uuid(), () => heroes.cols.id, { onDelete: "cascade" }),
    questId: z.string(),
    attempt: z.integer(),
  }),
  indexes: [
    {
      columns: ["ownerKind", "ownerId", "questId", "attempt"],
      unique: true,
      name: "authored_quest_reward_owner_attempt_unique",
    },
    { columns: ["recipientHeroId"], name: "authored_quest_reward_recipient_idx" },
  ],
  constraints: [
    {
      columns: ["attempt"],
      name: "authored_quest_reward_attempt_positive",
      check: sql`attempt >= 1`,
    },
  ],
});

export type AuthoredQuestRewardClaim = Static<typeof authoredQuestRewardClaims.schema>;
