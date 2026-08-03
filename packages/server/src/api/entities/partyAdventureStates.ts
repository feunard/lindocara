import { type Infer, z } from "alepha";
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
/**
 * `version` (realtime tranche, Task 3). Legacy never stored a version in D1 at all — the monotone
 * counter `GameSession` used to drop out-of-order pushes lived only in the Durable Object's
 * `ctx.storage` ("stateVersion"), never in `party_adventure_state`
 * (`packages/server/src/game-session.ts:849-877`; `adventure-state-store.ts`'s D1 row shape is
 * exactly the five JSON columns above). `PartyRoom` (the headless successor) has no such storage:
 * a headless `$room` keeps state only in process memory, so the write-through design this tranche
 * requires — "the version lands in D1 immediately, read back with no clock advance" — needs
 * somewhere durable to put it. Folding it into one of the five JSON text columns was considered and
 * rejected: every one of them is parsed by `@lindocara/engine/adventure-state.js`'s strict parsers
 * (`parseSwitches`/`parseVariables`/`parseQuestProgress`/`parseDefeatedMonsters`), which reject any
 * key that doesn't match their own id pattern, and `packages/engine` is a hard "untouched" global
 * constraint for this tranche — those parsers cannot be taught a reserved version key. A real
 * column is therefore the only option that keeps every JSON column exactly parser-compatible.
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
    materials: db.default(z.string(), "{}"),
    harvestNodes: db.default(z.string(), "{}"),
    /** Private support-spend saga journal. Never copied into the public adventure-state shape. */
    supportSpends: db.default(z.string(), "{}"),
    version: db.default(z.integer(), 0),
    updatedAt: db.updatedAt(),
  }),
});

export type PartyAdventureState = Infer<typeof partyAdventureStates.schema>;
