import { type Static, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";
import { heroes } from "./heroes.ts";

/**
 * Runtime entity for `hero_quest` (`packages/server/src/db/schema.ts:673`).
 *
 * Legacy identity is the composite primary key `(heroId, questId)` — same Task 6 fallback: a
 * surrogate `id` uuid PK plus a unique index over `(heroId, questId)`. `questId` stays plain text,
 * matching legacy — quests are a code-owned catalogue, not their own DB table.
 *
 * `status` has no matching `as const` tuple in `@lindocara/engine` (`protocol.ts`'s `QuestStatus`
 * is a plain type union, not an exported literal array), so the four values are inlined verbatim
 * from legacy rather than degrading to unconstrained text.
 */
export const heroQuests = $entity({
  name: "heroQuests",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    heroId: db.ref(z.uuid(), () => heroes.cols.id, { onDelete: "cascade" }),
    questId: z.string(),
    status: db.default(z.enum(["available", "active", "ready", "completed"]), "available"),
    progress: db.default(z.integer(), 0),
    acceptedAt: z.datetime().optional(),
    completedAt: z.datetime().optional(),
    data: z.record(z.string(), z.any()).optional(),
    rewardClaimId: z.string().optional(),
  }),
  indexes: [
    { columns: ["heroId", "questId"], unique: true, name: "hero_quest_identity_unique" },
    { columns: ["heroId", "status"], name: "hero_quest_hero_status_idx" },
    { column: "rewardClaimId", unique: true, name: "hero_quest_reward_claim_unique" },
  ],
  constraints: [{ columns: ["progress"], check: sql`progress >= 0` }],
});

export type HeroQuest = Static<typeof heroQuests.schema>;
