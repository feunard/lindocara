/**
 * The D1 schema. Nothing reads or writes this yet — it exists so that persistence has
 * somewhere to land when the game needs it.
 *
 * Sessions are currently anonymous: a nickname buys you a freshly-minted UUID, and nothing
 * survives a logout. So a row here is not yet an identity, and `nick` is deliberately NOT
 * unique — two people may both call themselves "nico" today, and a unique constraint would
 * encode a promise the auth layer does not make. Add it the day nicknames are claimed.
 */

import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Milliseconds since the epoch, as SQLite integers. `unixepoch()` is seconds. */
const nowMs = sql`(unixepoch() * 1000)`;

export const player = sqliteTable(
  "player",
  {
    /** Matches the session id shape: a UUID minted by the Worker. */
    id: text("id").primaryKey(),
    nick: text("nick").notNull(),
    x: real("x").notNull().default(784),
    y: real("y").notNull().default(450),
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),
    hp: integer("hp").notNull().default(100),
    appearance: text("appearance", {
      enum: ["azure", "ember", "moss", "violet"],
    })
      .notNull()
      .default("azure"),
    potions: integer("potions").notNull().default(2),
    gold: integer("gold").notNull().default(0),
    crystals: integer("crystals").notNull().default(0),
    weapon: text("weapon", { enum: ["rusty_sword"] })
      .notNull()
      .default("rusty_sword"),
    questStatus: text("quest_status", {
      enum: ["available", "active", "ready", "completed"],
    })
      .notNull()
      .default("available"),
    questProgress: integer("quest_progress").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [index("player_nick_idx").on(table.nick)],
);

export type Player = typeof player.$inferSelect;
export type NewPlayer = typeof player.$inferInsert;
