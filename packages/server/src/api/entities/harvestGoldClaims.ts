import { type Static, z } from "alepha";
import { $entity, db, sql } from "alepha/orm";
import { heroes } from "./heroes.ts";
import { parties } from "./parties.ts";

/** Idempotency fence for one gold-bearing harvest-node generation. */
export const harvestGoldClaims = $entity({
  name: "harvestGoldClaims",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    partyId: db.ref(z.uuid(), () => parties.cols.id, { onDelete: "cascade" }),
    /** UUID authored event or the bounded `carcass:<zone>:<spawn>` runtime namespace. */
    nodeId: z.string(),
    generation: z.integer(),
    recipientHeroId: db.ref(z.uuid(), () => heroes.cols.id, { onDelete: "cascade" }),
    /** Epoch that authorized preparation; settlement remains valid after that lease is replaced. */
    earnedSessionEpoch: db.default(z.integer(), 0),
    amount: z.integer(),
    /** Additive existing-economy ledger component; zero until the durable node hit commits. */
    ledgerAmount: db.default(z.integer(), 0),
    /** Defaults to legacy so an older Worker writing during a rolling deploy cannot be re-credited. */
    ledgerStatus: db.default(z.enum(["legacy", "prepared", "settled"]), "legacy"),
    settledAt: z.datetime().optional(),
  }),
  indexes: [
    {
      columns: ["partyId", "nodeId", "generation"],
      unique: true,
      name: "harvest_gold_party_node_generation_unique",
    },
    { columns: ["recipientHeroId"], name: "harvest_gold_recipient_idx" },
  ],
  constraints: [
    {
      columns: ["generation"],
      name: "harvest_gold_generation_nonnegative",
      check: sql`generation >= 0`,
    },
    { columns: ["amount"], name: "harvest_gold_amount_positive", check: sql`amount > 0` },
  ],
});

export type HarvestGoldClaim = Static<typeof harvestGoldClaims.schema>;
