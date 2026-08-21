import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db, sql } from "alepha/orm";

/**
 * Authoring entity for `adventure` (`packages/server/src/db/schema.ts:443`), ported column-for-
 * column onto the Alepha ORM. `accountId` becomes `userId`, a required ref into Alepha's own
 * `users` entity — the legacy nullable-for-quarantine story does not apply here: this is a fresh
 * table with no historical ownerless rows to carry forward, so every adventure has a real owner
 * from the first insert.
 *
 * `registry` and `audio` keep the legacy empty-string sentinel default (not `"{}"`): the shared
 * decoders (`AdventureRegistry`/`AdventureAudioConfig`) read an empty string back as their default
 * value, so a freshly created adventure never needs a write to have a valid registry or audio
 * config. `title` gains a 1-48 char bound matching the actual authoring validation in the legacy
 * `adventures.ts` (`title: 1-48 characters`) — the legacy DB column itself has no such CHECK, but
 * every write path already enforces it, so encoding it here just moves an existing rule closer to
 * the data.
 */
export const adventures = $entity({
  name: "adventures",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    title: z.string().min(1).max(48),
    maxPlayers: db.default(z.integer().min(1).max(4), 4),
    /** Fixed HD-2D side view by default; `orbit` enables full yaw and pitch controls. */
    cameraMode: db.default(z.enum(["hd2d", "orbit"]), "hd2d"),
    /** Reserved seam for immutable published versions; always 1 until then. */
    version: db.default(z.integer(), 1),
    /** JSON AdventureGraph: start anchor plus one binding per placed exit. */
    graph: z.string(),
    /** JSON AdventureRegistry. Empty string is the default/legacy sentinel. */
    registry: db.default(z.string(), ""),
    /** JSON AdventureAudioConfig. Empty string is the default/legacy sentinel. */
    audio: db.default(z.string(), ""),
    /** The one map a new hero starts on. Null means derive — today that is the adventure's
     *  earliest-created map. Deliberately NOT `maps.isFirst`, which is account-scoped behind a
     *  `(userId) WHERE is_first = 1` unique index and so cannot express a second adventure. */
    startMapId: z.string().optional(),
  }),
  indexes: [{ columns: ["userId"] }],
  constraints: [{ columns: ["maxPlayers"], check: sql`max_players BETWEEN 1 AND 4` }],
});

export type Adventure = Infer<typeof adventures.schema>;
