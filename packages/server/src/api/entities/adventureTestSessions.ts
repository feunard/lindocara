import { type Infer, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { adventures } from "./adventures.ts";
import { parties } from "./parties.ts";

/**
 * Runtime entity for `adventure_test_session` (`packages/server/src/db/schema.ts:581`).
 *
 * A disposable, editor-owned playtest envelope around a normal party/hero runtime. The party is
 * intentionally real so the authoritative World/GameSession path is exercised, but this row keeps
 * it out of save/join lists and gives it a bounded lifetime. Deleting the party cascades this row
 * (and, transitively through the party, its hero and every progression/reward child), leaving no
 * player save behind. `accountId` becomes `userId` (same rename convention as elsewhere in this
 * file); the account-level and party-level unique indexes are what the brief calls "unique per user
 * and per party" — at most one live test session per author, and at most one per party.
 */
export const adventureTestSessions = $entity({
  name: "adventureTestSessions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    adventureId: db.ref(z.uuid(), () => adventures.cols.id, { onDelete: "cascade" }),
    partyId: db.ref(z.uuid(), () => parties.cols.id, { onDelete: "cascade" }),
    /** Null means the authored global adventure start; otherwise the map's fallback/test point. */
    startMapId: z.string().optional(),
    expiresAt: z.datetime(),
  }),
  indexes: [
    { column: "userId", unique: true, name: "adventure_test_session_account_unique" },
    { column: "partyId", unique: true, name: "adventure_test_session_party_unique" },
    { columns: ["expiresAt"], name: "adventure_test_session_expiry_idx" },
  ],
});

export type AdventureTestSession = Infer<typeof adventureTestSessions.schema>;
