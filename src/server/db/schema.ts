/**
 * The D1 schema: accounts own up to three characters.
 *
 * `username` is stored lowercase, so its UNIQUE constraint is case-insensitive by
 * construction — "Nico" and "nico" are the same account. Character `name` is deliberately
 * NOT unique: accounts claim usernames; characters do not claim names.
 */

import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Milliseconds since the epoch, as SQLite integers. `unixepoch()` is seconds. */
const nowMs = sql`(unixepoch() * 1000)`;

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  /** Always lowercase — normalized before every read and write. */
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  /** Stored per-row so PBKDF2_ITERATIONS can be raised without breaking old accounts. */
  passwordIterations: integer("password_iterations").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export const character = sqliteTable(
  "character",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
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
    appearanceBody: text("appearance_body", { enum: ["wayfarer"] })
      .notNull()
      .default("wayfarer"),
    appearancePrimaryColor: text("appearance_primary_color", {
      enum: ["azure", "ember", "moss", "violet"],
    })
      .notNull()
      .default("azure"),
    class: text("class", { enum: ["warrior", "ranger", "priest"] })
      .notNull()
      .default("warrior"),
    potions: integer("potions").notNull().default(2),
    gold: integer("gold").notNull().default(0),
    crystals: integer("crystals").notNull().default(0),
    weapon: text("weapon", { enum: ["rusty_sword"] })
      .notNull()
      .default("rusty_sword"),
    mainHand: text("main_hand", {
      enum: ["weathered_sword", "hunter_bow", "heartwood_staff"],
    })
      .notNull()
      .default("weathered_sword"),
    offHand: text("off_hand", { enum: ["oak_shield"] }),
    questStatus: text("quest_status", {
      enum: ["available", "active", "ready", "completed"],
    })
      .notNull()
      .default("available"),
    questChapter: text("quest_chapter", {
      enum: ["three_offerings", "bone_choir", "mire_runes", "ward_run"],
    })
      .notNull()
      .default("three_offerings"),
    questProgress: integer("quest_progress").notNull().default(0),
    zoneId: text("zone_id").notNull().default("verdant-reach"),
    instanceId: text("instance_id").notNull().default("main"),
    sessionEpoch: integer("session_epoch").notNull().default(0),
    wardRunExpiresAt: integer("ward_run_expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [index("character_account_idx").on(table.accountId)],
);

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type Character = typeof character.$inferSelect;
export type NewCharacter = typeof character.$inferInsert;
