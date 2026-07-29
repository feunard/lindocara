import { PARTY_COLORS } from "@lindocara/engine/party.js";
import { type Static, z } from "alepha";
import { users } from "alepha/api/users";
import { $entity, db } from "alepha/orm";
import { parties } from "./parties.ts";

/**
 * Runtime entity for `party_member` (`packages/server/src/db/schema.ts:508`).
 *
 * Legacy identity is the composite primary key `(partyId, accountId)`. Alepha's `db.primaryKey`
 * has no composite-PK support (Task 6's finding, unchanged here) — same fallback: a surrogate `id`
 * uuid PK plus a unique index over `(partyId, userId)`. `color` reuses the real `PARTY_COLORS`
 * literal tuple from `@lindocara/engine/party.ts`, so this stays a genuine DB-enforced enum exactly
 * like legacy's `text("color", {enum: [...]})`.
 */
export const partyMembers = $entity({
  name: "partyMembers",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    partyId: db.ref(z.uuid(), () => parties.cols.id, { onDelete: "cascade" }),
    userId: db.ref(z.uuid(), () => users.cols.id, { onDelete: "cascade" }),
    color: z.enum(PARTY_COLORS),
    joinedAt: db.createdAt(),
  }),
  indexes: [
    { columns: ["partyId", "userId"], unique: true, name: "party_member_identity_unique" },
    { columns: ["partyId", "color"], unique: true, name: "party_member_colour_unique" },
    { columns: ["userId"], name: "party_member_account_idx" },
  ],
});

export type PartyMember = Static<typeof partyMembers.schema>;
