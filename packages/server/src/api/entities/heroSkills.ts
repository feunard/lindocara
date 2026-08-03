import { type Infer, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";
import { heroes } from "./heroes.ts";

/**
 * Runtime entity for `hero_skill` (`packages/server/src/db/schema.ts:650`).
 *
 * Legacy identity is the composite primary key `(heroId, skillId)` — same Task 6 fallback: a
 * surrogate `id` uuid PK plus a unique index over `(heroId, skillId)`. `skillId` stays a plain
 * string exactly like legacy's unconstrained `text("skill_id")` — skills are a code-owned catalogue
 * (`@lindocara/engine/skills.ts`), never their own DB table.
 *
 * Both legacy CHECK constraints are ported verbatim: `slot` is null or in `1..5`, and a skill can
 * only be `equipped` while it is also `unlocked` and has a `slot` assigned (and vice versa — no
 * `slot` while not `equipped`).
 */
export const heroSkills = $entity({
  name: "heroSkills",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    heroId: db.ref(z.uuid(), () => heroes.cols.id, { onDelete: "cascade" }),
    skillId: z.string(),
    unlocked: db.default(z.boolean(), false),
    equipped: db.default(z.boolean(), false),
    slot: z.integer().optional(),
    unlockedAt: z.datetime().optional(),
  }),
  indexes: [
    { columns: ["heroId", "skillId"], unique: true, name: "hero_skill_identity_unique" },
    { columns: ["heroId", "slot"], unique: true, name: "hero_skill_slot_unique" },
  ],
  constraints: [
    {
      columns: ["slot"],
      name: "hero_skill_slot_range",
      check: sql`slot IS NULL OR slot BETWEEN 1 AND 5`,
    },
    {
      columns: ["equipped", "slot", "unlocked"],
      name: "hero_skill_equipped_shape",
      check: sql`(equipped = 0 AND slot IS NULL) OR (equipped = 1 AND unlocked = 1 AND slot IS NOT NULL)`,
    },
  ],
});

export type HeroSkill = Infer<typeof heroSkills.schema>;
