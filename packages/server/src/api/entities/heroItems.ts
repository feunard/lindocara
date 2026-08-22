import { type Infer, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";

import { heroes } from "./heroes.ts";
import { itemDefinitions } from "./itemDefinitions.ts";

/**
 * Runtime entity for `hero_item` (`packages/server/src/db/schema.ts:608`).
 *
 * `itemDefinitionId` is a real `db.ref` onto `itemDefinitions` (Task 10), matching legacy's
 * `.references(() => itemDefinition.id, { onDelete: "restrict" })`. Task 7 originally left this a
 * plain unconstrained string because the catalogue table did not exist yet on the Alepha ORM — see
 * `itemDefinitions.ts`'s own docblock for how the rows are seeded (an idempotent upsert the first
 * time a hero is created, not a migration).
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
    itemDefinitionId: db.ref(z.string(), () => itemDefinitions.cols.id, { onDelete: "restrict" }),
    quantity: z.integer(),
  }),
  indexes: [
    { columns: ["heroId", "itemDefinitionId"], unique: true, name: "hero_item_definition_unique" },
    { columns: ["heroId", "id"], unique: true, name: "hero_item_owner_id_unique" },
    { columns: ["heroId"], name: "hero_item_hero_idx" },
  ],
  constraints: [{ columns: ["quantity"], check: sql`quantity >= 0` }],
});

export type HeroItem = Infer<typeof heroItems.schema>;
