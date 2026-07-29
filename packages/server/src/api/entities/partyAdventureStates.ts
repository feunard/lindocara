import { type Static, z } from "alepha";
import { $entity, db } from "alepha/orm";
import { parties } from "./parties.ts";

/**
 * Runtime entity for `party_adventure_state` (`packages/server/src/db/schema.ts:733`).
 *
 * Legacy's primary key IS `partyId` itself — `text("party_id").primaryKey().references(() =>
 * party.id, {onDelete: "cascade"})` — a natural, non-generated PK, unlike every other entity in
 * this file which uses a server-minted uuid.
 *
 * `db.primaryKey`/`db.ref` DO compose on one field, but **only in this order**:
 * `db.ref(db.primaryKey(z.uuid()), ...)`. `pgAttr` (`.vendor/alepha/src/orm/core/helpers/
 * pgAttr.ts`) just `Object.assign`s a symbol onto the same Zod schema object in place, so `db.ref`
 * (which calls `pgAttr` directly) safely layers `PG_REF` onto whatever schema it's given. But
 * `DatabaseTypeProvider.primaryKey()`'s uuid branch does NOT reuse its `type` argument — it builds
 * a **brand-new** `z.uuid()` and discards whatever was passed in
 * (`.vendor/alepha/src/orm/core/providers/DatabaseTypeProvider.ts:100-102`:
 * `if (z.schema.isString(type) && z.schema.format(type) === "uuid") { return pgAttr(pgAttr(z.uuid(),
 * PG_PRIMARY_KEY), PG_DEFAULT); }` — `type` itself is never touched). So `db.primaryKey(db.ref(...))`
 * silently drops the ref: the reversed order was tried first and failed exactly this way — the
 * insert/read half of the test passed (a row keyed by `partyId` round-tripped), but the FK-cascade
 * half did not (deleting the party left the state row behind, because no real FK constraint had
 * been created at all). Reordering to `db.ref(db.primaryKey(...), ...)` fixed both halves: verified
 * end-to-end by this file's own test (`partyAdventureStates is keyed by partyId` in
 * `entities-runtime.test.ts`). No surrogate `id` fallback was needed here, unlike the composite-PK
 * entities elsewhere in this task.
 */
export const partyAdventureStates = $entity({
  name: "partyAdventureStates",
  schema: z.object({
    partyId: db.ref(db.primaryKey(z.uuid()), () => parties.cols.id, { onDelete: "cascade" }),
    switches: z.string(),
    variables: z.string(),
    selfSwitches: z.string(),
    quests: db.default(z.string(), "{}"),
    defeatedMonsters: db.default(z.string(), "{}"),
    updatedAt: db.updatedAt(),
  }),
});

export type PartyAdventureState = Static<typeof partyAdventureStates.schema>;
