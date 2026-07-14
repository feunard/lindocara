/**
 * The D1 schema: accounts own up to three characters.
 *
 * `username` is stored lowercase, so its UNIQUE constraint is case-insensitive by
 * construction — "Nico" and "nico" are the same account. Character `name` is deliberately
 * NOT unique: accounts claim usernames; characters do not claim names.
 */

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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
    resourceCurrent: real("resource_current"),
    /** 0 means legacy columns still need their one-way normalized backfill. */
    persistenceVersion: integer("persistence_version").notNull().default(0),
    wardRunExpiresAt: integer("ward_run_expires_at", { mode: "timestamp_ms" }),
    /**
     * Death is persistent, not a session detail. If it lived only in memory, logging out
     * would be a free resurrection — you would reconnect alive, standing over nothing.
     * `corpseX`/`corpseY` are null exactly when `life` is "alive".
     */
    life: text("life", { enum: ["alive", "corpse", "ghost"] })
      .notNull()
      .default("alive"),
    corpseX: real("corpse_x"),
    corpseY: real("corpse_y"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [index("character_account_idx").on(table.accountId)],
);

export const EQUIPMENT_SLOTS = [
  "main_hand",
  "off_hand",
  "head",
  "chest",
  "legs",
  "feet",
  "ring",
  "amulet",
] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

/** Static catalogue rows. Gameplay definitions remain intentionally small and code-owned. */
export const itemDefinition = sqliteTable(
  "item_definition",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    stackable: integer("stackable", { mode: "boolean" }).notNull(),
    maxStack: integer("max_stack").notNull(),
    equipmentSlot: text("equipment_slot", { enum: EQUIPMENT_SLOTS }),
    allowedClass: text("allowed_class", { enum: ["warrior", "ranger", "priest"] }),
  },
  (table) => [
    check("item_definition_max_stack_positive", sql`${table.maxStack} > 0`),
    check("item_definition_stack_shape", sql`${table.stackable} = 1 OR ${table.maxStack} = 1`),
  ],
);

export const characterItem = sqliteTable(
  "character_item",
  {
    id: text("id").primaryKey(),
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "cascade" }),
    itemDefinitionId: text("item_definition_id")
      .notNull()
      .references(() => itemDefinition.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    check("character_item_quantity_non_negative", sql`${table.quantity} >= 0`),
    uniqueIndex("character_item_definition_unique").on(table.characterId, table.itemDefinitionId),
    uniqueIndex("character_item_owner_id_unique").on(table.characterId, table.id),
    index("character_item_character_idx").on(table.characterId),
  ],
);

export const characterEquipment = sqliteTable(
  "character_equipment",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "cascade" }),
    slot: text("slot", { enum: EQUIPMENT_SLOTS }).notNull(),
    characterItemId: text("character_item_id").notNull(),
    equippedAt: integer("equipped_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.slot] }),
    uniqueIndex("character_equipment_item_unique").on(table.characterItemId),
    foreignKey({
      columns: [table.characterId, table.characterItemId],
      foreignColumns: [characterItem.characterId, characterItem.id],
      name: "character_equipment_owned_item_fk",
    }).onDelete("cascade"),
  ],
);

export const characterSkill = sqliteTable(
  "character_skill",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull(),
    unlocked: integer("unlocked", { mode: "boolean" }).notNull().default(false),
    equipped: integer("equipped", { mode: "boolean" }).notNull().default(false),
    slot: integer("slot"),
    unlockedAt: integer("unlocked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.skillId] }),
    uniqueIndex("character_skill_slot_unique").on(table.characterId, table.slot),
    check(
      "character_skill_slot_range",
      sql`${table.slot} IS NULL OR ${table.slot} BETWEEN 1 AND 5`,
    ),
    check(
      "character_skill_equipped_shape",
      sql`(${table.equipped} = 0 AND ${table.slot} IS NULL) OR (${table.equipped} = 1 AND ${table.unlocked} = 1 AND ${table.slot} IS NOT NULL)`,
    ),
  ],
);

export const characterQuest = sqliteTable(
  "character_quest",
  {
    characterId: text("character_id")
      .notNull()
      .references(() => character.id, { onDelete: "cascade" }),
    questId: text("quest_id").notNull(),
    status: text("status", { enum: ["available", "active", "ready", "completed"] })
      .notNull()
      .default("available"),
    progress: integer("progress").notNull().default(0),
    acceptedAt: integer("accepted_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    data: text("data", { mode: "json" }).$type<Record<string, unknown>>(),
    rewardClaimId: text("reward_claim_id").unique(),
  },
  (table) => [
    primaryKey({ columns: [table.characterId, table.questId] }),
    check("character_quest_progress_non_negative", sql`${table.progress} >= 0`),
    index("character_quest_character_status_idx").on(table.characterId, table.status),
  ],
);

export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type Character = typeof character.$inferSelect;
export type NewCharacter = typeof character.$inferInsert;
export type ItemDefinition = typeof itemDefinition.$inferSelect;
export type CharacterItem = typeof characterItem.$inferSelect;
export type CharacterEquipment = typeof characterEquipment.$inferSelect;
export type CharacterSkill = typeof characterSkill.$inferSelect;
export type CharacterQuest = typeof characterQuest.$inferSelect;
