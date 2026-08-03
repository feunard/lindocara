import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { adventures } from "./adventures.ts";

/**
 * Runtime entity for `party` (`packages/server/src/db/schema.ts:480`), ported column-for-column.
 *
 * `adventureId` keeps legacy's **restrict** delete action: a party pins its adventure, and deleting
 * a referenced adventure must be refused rather than silently orphaning or cascading away a live
 * playthrough — the opposite policy from `maps`/`adventures`' cascade-on-delete. `hostAccountId`
 * becomes `hostUserId` (ref into Alepha's `users`, following the `userId` rename convention Task 6
 * established for `adventures.userId`/`maps.userId`).
 *
 * `status` has no matching `as const` tuple anywhere in `@lindocara/engine`, so its two values are
 * inlined here directly (same reasoning Task 6 documented for fields with no importable literal
 * tuple) rather than imported.
 */
export const parties = $entity({
  name: "parties",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    /** restrict: deleting an adventure referenced by a live party is refused, not cascaded. */
    adventureId: db.ref(z.uuid(), () => adventures.cols.id, { onDelete: "restrict" }),
    /** Pinned at creation so later adventure edits never move a live party's version. */
    adventureVersion: z.integer(),
    maxPlayers: z.integer(),
    hostUserId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    name: z.string().optional(),
    status: db.default(z.enum(["open", "completed"]), "open"),
  }),
  indexes: [
    { columns: ["adventureId"], name: "party_adventure_idx" },
    { columns: ["hostUserId"], name: "party_host_idx" },
  ],
});

export type Party = Infer<typeof parties.schema>;
