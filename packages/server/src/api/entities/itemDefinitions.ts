import { HERO_CLASSES } from "@lindocara/engine/hero.js";
import { type Infer, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";

/**
 * Runtime entity for `item_definition` (`packages/server/src/db/schema.ts:139`) — the static
 * gameplay catalogue `heroItems.itemDefinitionId` references. Ported now to close the gap Task 7
 * left open (see that entity's own docblock, and the carried-over note in Task 10's brief):
 * `heroItems.itemDefinitionId` was left a plain unconstrained string because this table did not
 * exist yet on the Alepha ORM. `heroItems.ts` now has a real `db.ref` onto this table.
 *
 * `id` is a plain text primary key (a slug like `"health_potion"`), not a uuid — `db.primaryKey`
 * marks a string PK with no `PG_DEFAULT` (see that helper's own docblock), so every insert must
 * supply its id explicitly. `HeroService.ensureItemDefinitionsSeeded` is the one writer, upserting
 * the fixed catalogue from `../../items.js` (`ITEM_DEFINITIONS`) the first time a hero is created.
 *
 * `equipmentSlot`/`allowedClass` stay nullable enums. `EQUIPMENT_SLOTS` is inlined again rather than
 * imported from `heroEquipment.ts` (which does not export it) — the same duplication Task 7 already
 * accepted there, for the same reason: no importable literal tuple exists for it in
 * `@lindocara/engine`. `allowedClass` reuses `HERO_CLASSES`, a real exported tuple.
 */
const EQUIPMENT_SLOTS = [
  "main_hand",
  "off_hand",
  "head",
  "chest",
  "legs",
  "feet",
  "ring",
  "amulet",
] as const;

export const itemDefinitions = $entity({
  name: "itemDefinitions",
  schema: z.object({
    id: db.primaryKey(z.string()),
    type: z.string(),
    stackable: z.boolean(),
    maxStack: z.integer(),
    equipmentSlot: z.enum(EQUIPMENT_SLOTS).optional(),
    allowedClass: z.enum(HERO_CLASSES).optional(),
  }),
  constraints: [
    {
      columns: ["maxStack"],
      name: "item_definition_max_stack_positive",
      check: sql`max_stack > 0`,
    },
    {
      columns: ["stackable", "maxStack"],
      name: "item_definition_stack_shape",
      check: sql`stackable = 1 OR max_stack = 1`,
    },
  ],
});

export type ItemDefinition = Infer<typeof itemDefinitions.schema>;
