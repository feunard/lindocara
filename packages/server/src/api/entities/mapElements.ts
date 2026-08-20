import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { maps } from "./maps.ts";

/**
 * Authoring entity for `map_element` (`packages/server/src/db/schema.ts:329`).
 *
 * Legacy identity is the composite primary key `(mapId, col, row, offsetX, offsetY)`. Alepha's
 * `$entity`/`db.primaryKey` only support a single-column primary key (`.vendor/alepha/src/orm/core/
 * primitives/$entity.ts` has no composite-PK option), so this uses the task brief's pre-authorized
 * fallback: a surrogate `id` uuid primary key plus a unique index over the five identity columns.
 * Same data contract — "you can't place two elements at the same cell AND offset" is still enforced
 * by the database, just via a unique index rather than the PK itself.
 */
export const mapElements = $entity({
  name: "mapElements",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    mapId: db.ref(z.uuid(), () => maps.cols.id, { onDelete: "cascade" }),
    col: z.integer(),
    row: z.integer(),
    /** Integer in `0..ELEMENT_OFFSET_STEPS - 1` (shared/map-data.ts), quarter tiles right of origin. */
    offsetX: db.default(z.integer(), 0),
    /** Integer in `0..ELEMENT_OFFSET_STEPS - 1` (shared/map-data.ts), quarter tiles below origin. */
    offsetY: db.default(z.integer(), 0),
    /** Stable Tiny Swords editor asset id; legacy tree/bush/stone rows are normalized on read. */
    kind: z.string(),
    /** Legacy variant, building quarter-turn, or compact resizable-bridge dimensions. */
    variant: db.default(z.integer(), 0),
    /** Null only on non-buildings and legacy rows; reads derive catalogue defaults when absent. */
    buildingDestructible: z.boolean().optional(),
    buildingMaxHp: z.integer().optional(),
    /** Linked ordinary map. Kept scalar so deleting an interior can degrade to an unlinked door. */
    buildingInteriorMapId: z.uuid().optional(),
  }),
  indexes: [
    { columns: ["mapId"], name: "map_element_map_idx" },
    {
      columns: ["mapId", "col", "row", "offsetX", "offsetY"],
      unique: true,
      name: "map_element_identity_unique",
    },
  ],
});

export type MapElement = Infer<typeof mapElements.schema>;
