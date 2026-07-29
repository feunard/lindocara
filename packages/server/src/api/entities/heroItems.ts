import { type Static, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";
import { heroes } from "./heroes.ts";

/**
 * Runtime entity for `hero_item` (`packages/server/src/db/schema.ts:608`).
 *
 * `itemDefinitionId` stays a **plain unconstrained string**, not a `db.ref`: legacy references a
 * separate `item_definition` catalogue table (`db/schema.ts:139`) which is out of scope for this
 * tranche — Task 7's brief lists only `adventures`/`maps`/Alepha `users` as consumed entities, and
 * no `itemDefinitions` entity has been ported onto the Alepha ORM yet. This is a genuine, documented
 * gap versus legacy's `.references(() => itemDefinition.id, { onDelete: "restrict" })`; a later
 * tranche that ports the catalogue table should upgrade this to a real `db.ref`.
 *
 * `hero_item_owner_id_unique` — unique `(heroId, id)` — is preserved verbatim from legacy even
 * though nothing in this file's own constraints requires it; it exists so `heroEquipment` can
 * reference a specific hero's own row (see that file's docblock for why the composite ownership FK
 * itself could not be ported).
 */
export const heroItems = $entity({
  name: "heroItems",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    heroId: db.ref(z.uuid(), () => heroes.cols.id, { onDelete: "cascade" }),
    itemDefinitionId: z.string(),
    quantity: z.integer(),
  }),
  indexes: [
    { columns: ["heroId", "itemDefinitionId"], unique: true, name: "hero_item_definition_unique" },
    { columns: ["heroId", "id"], unique: true, name: "hero_item_owner_id_unique" },
    { columns: ["heroId"], name: "hero_item_hero_idx" },
  ],
  constraints: [{ columns: ["quantity"], check: sql`quantity >= 0` }],
});

export type HeroItem = Static<typeof heroItems.schema>;
