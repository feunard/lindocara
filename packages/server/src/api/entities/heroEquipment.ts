import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { heroes } from "./heroes.ts";

/**
 * Runtime entity for `hero_equipment` (`packages/server/src/db/schema.ts:629`).
 *
 * Legacy identity is the composite primary key `(heroId, slot)` — same Task 6 fallback as
 * `mapElements`: a surrogate `id` uuid PK plus a unique index over `(heroId, slot)`.
 *
 * `slot` has no matching `as const` tuple in `@lindocara/engine` (`EQUIPMENT_SLOTS` only exists in
 * the legacy `db/schema.ts:126`, which this new entity tree intentionally does not import from —
 * see the package README's "entities stay logic-free" rule and Task 6's precedent of not reaching
 * into legacy Drizzle modules). The eight values are inlined verbatim below so `slot` stays a real
 * DB-enforced enum rather than degrading to unconstrained text.
 *
 * **The composite ownership FK could not be ported.** Legacy enforces "`heroItemId` must be a row
 * this SAME hero owns" with a genuine composite foreign key,
 * `foreignKey({ columns: [heroId, heroItemId], foreignColumns: [heroItem.heroId, heroItem.id] })
 * .onDelete("cascade")`. Alepha's `EntityPrimitiveOptions.foreignKeys` can express the
 * columns/foreignColumns shape, but its type has no `onDelete`/`onUpdate` action — the framework's
 * `ModelBuilder.buildTableConfig` always calls `builders.foreignKey({...})` with no `.onDelete()`
 * chained on top, so a composite FK here would silently fall back to SQLite's default `NO ACTION`.
 * That is unsafe in this shape specifically: a hero delete cascades both `heroItems` and
 * `heroEquipment` independently (each via their own single-column `heroId` ref), and SQLite gives no
 * ordering guarantee between two independent cascade paths — a `NO ACTION` composite FK could
 * transiently see its referenced `heroItems` row already gone while this row still exists,
 * aborting the whole delete. Rather than risk that, this follows the task brief's pre-authorized
 * fallback: no DB-level composite FK. `heroItems.hero_item_owner_id_unique` (unique `(heroId, id)`)
 * remains as the shape a real composite FK would target, and the actual ownership check —
 * "the hero_item row named by `heroItemId` belongs to this same `heroId`" — is deferred to the
 * service layer the controller tasks add (Task 10+, `HeroService`).
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

export const heroEquipment = $entity({
  name: "heroEquipment",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    heroId: db.ref(z.uuid(), () => heroes.cols.id, { onDelete: "cascade" }),
    slot: z.enum(EQUIPMENT_SLOTS),
    /** Must reference a `heroItems` row owned by the same `heroId` — service-layer invariant, see docblock. */
    heroItemId: z.uuid(),
    equippedAt: db.createdAt(),
  }),
  indexes: [
    { columns: ["heroId", "slot"], unique: true, name: "hero_equipment_identity_unique" },
    { columns: ["heroItemId"], unique: true, name: "hero_equipment_item_unique" },
  ],
});

export type HeroEquipment = Static<typeof heroEquipment.schema>;
