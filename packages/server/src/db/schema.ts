/**
 * The D1 schema: accounts own up to three characters.
 *
 * `username` is stored lowercase, so its UNIQUE constraint is case-insensitive by
 * construction — "Nico" and "nico" are the same account. Character `name` is deliberately
 * NOT unique: accounts claim usernames; characters do not claim names.
 */

import type { MonsterSpecies } from "@lindocara/engine/game.js";
import {
  EVENT_KINDS,
  EVENT_TRIGGERS,
  MOVE_TYPES,
  SELF_SWITCHES,
} from "@lindocara/engine/map-events.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
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

/**
 * A map is terrain, not a zone: tile layers, the things standing on them, and where you arrive.
 *
 * `layers` is a JSON array of exactly three run-length encoded layer strings (`tile-layer-codec.ts`),
 * ground first, each `cols * rows` cells. `cols` and `rows` are the only source of a layer's shape,
 * so a layer string is meaningless without them. Runs keep a mostly-uniform 40x30 map around a
 * kilobyte: diffable, readable in a failing test, and cheap enough to send in a welcome.
 *
 * Authored maps are private to their account. `accountId` remains nullable only so the ownership
 * migration can quarantine historical rows whose author cannot be inferred without guessing;
 * every application write supplies a real owner and no account-facing query exposes NULL rows.
 *
 * `adventureId` is the owning adventure (UX wave #5): a map belongs to exactly ONE adventure and is
 * never shared. It is NOT NULL and cascades — deleting an adventure deletes its maps. `accountId`
 * always equals the owning adventure's account by construction, but is kept for the per-account
 * `is_first` front-door flag and the character rollback seam (`resolveMapFor`).
 */
export const map = sqliteTable(
  "map",
  {
    /** Server-minted uuid. A client never supplies this. */
    id: text("id").primaryKey(),
    accountId: text("account_id").references(() => account.id, { onDelete: "cascade" }),
    /** The one adventure that owns this map. A map is created inside an adventure and never moves. */
    adventureId: text("adventure_id")
      .notNull()
      .references(() => adventure.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cols: integer("cols").notNull(),
    rows: integer("rows").notNull(),
    /** Tileset the layer ids index into. */
    tilesetId: text("tileset_id").notNull().default("tiny-swords"),
    /** JSON array of exactly three run-length encoded tile layers. Ground first. */
    layers: text("layers").notNull(),
    spawnCol: integer("spawn_col").notNull(),
    spawnRow: integer("spawn_row").notNull(),
    /** JSON MapMarkers (entries/exits/monster spawns); NULL for maps saved before markers existed. */
    markers: text("markers"),
    /** Monotone authored-content revision. Cache identity is `(mapId, revision)`. */
    revision: integer("revision").notNull().default(1),
    /**
     * Internal compare-and-swap token for a whole-map rewrite. `updateMap` changes it in the same
     * D1 batch as terrain, elements and events, then uses it to make a losing concurrent writer
     * abort the transaction before it can replace the winner's child rows. It is deliberately not
     * exposed on the authoring API; creators reason about the monotone `revision` above.
     */
    writeToken: text("write_token").notNull().default(""),
    /** Exactly one owned map carries this per account. Quarantined legacy rows are never selected. */
    isFirst: integer("is_first").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    index("map_account_idx").on(table.accountId),
    index("map_adventure_idx").on(table.adventureId),
    uniqueIndex("map_account_first_unique")
      .on(table.accountId)
      .where(sql`${table.isFirst} = 1 AND ${table.accountId} IS NOT NULL`),
    check("map_revision_positive", sql`${table.revision} >= 1`),
  ],
);

/**
 * Element identity now includes its quarter-tile offset, not just its cell — the primary key is
 * `(mapId, col, row, offsetX, offsetY)`, not a rule somebody has to remember to check. A cell can
 * hold up to `ELEMENT_OFFSET_STEPS`² = 16 decorations, one per distinct offset; "you can't set two
 * elements at the same cell AND offset" is enforced by the database itself.
 */
export const mapElement = sqliteTable(
  "map_element",
  {
    mapId: text("map_id")
      .notNull()
      .references(() => map.id, { onDelete: "cascade" }),
    col: integer("col").notNull(),
    row: integer("row").notNull(),
    /** Integer in `0..ELEMENT_OFFSET_STEPS - 1` (shared/map-data.ts), quarter tiles right of origin. */
    offsetX: integer("offset_x").notNull().default(0),
    /** Integer in `0..ELEMENT_OFFSET_STEPS - 1` (shared/map-data.ts), quarter tiles below origin. */
    offsetY: integer("offset_y").notNull().default(0),
    /** Stable Tiny Swords editor asset id; legacy tree/bush/stone rows are normalized on read. */
    kind: text("kind").notNull(),
    variant: integer("variant").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.mapId, table.col, table.row, table.offsetX, table.offsetY] }),
    index("map_element_map_idx").on(table.mapId),
  ],
);

/**
 * An authored map event: a stateful, one-cell entity with ordered pages. Unlike a `map_element`
 * (catalogue scenery baked into collision), an event is addressable and never contributes to
 * collision this tranche — it floats above terrain. Nothing here executes yet; a later tranche
 * evaluates `map_event_page` conditions to drive behaviour. See
 * `docs/superpowers/specs/2026-07-19-map-events-design.md` (Decisions 1, 2, 8).
 */
export const mapEvent = sqliteTable(
  "map_event",
  {
    /** Client-minted uuid, stable across edits — the referenceable identity tranche 5's commands
     *  will point at. `ordinal` is the wireframe's `EV{ordinal}` display order, never identity. */
    id: text("id").primaryKey(),
    mapId: text("map_id")
      .notNull()
      .references(() => map.id, { onDelete: "cascade" }),
    col: integer("col").notNull(),
    row: integer("row").notNull(),
    /** Doubles as the entry/exit marker label for functional kinds; decorative for `normal`. */
    name: text("name").notNull(),
    /** Creation order, per map. Display only. */
    ordinal: integer("ordinal").notNull(),
    /** UX wave #12: `normal` is the scripted event; entry/exit/monster are the reborn markers. */
    kind: text("kind", { enum: EVENT_KINDS }).notNull().default("normal"),
    /** Monster spawn, set iff `kind = 'monster'`. */
    species: text("species").$type<MonsterSpecies>(),
    /** Monster patrol radius (px), set iff `kind = 'monster'`. */
    patrolRadius: integer("patrol_radius"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    // One event per cell — the editor moves an event rather than replacing on overlap.
    uniqueIndex("map_event_cell_unique").on(table.mapId, table.col, table.row),
    index("map_event_map_idx").on(table.mapId),
  ],
);

/**
 * One page of an event, XP semantics: conditions, appearance, movement, options and trigger belong
 * to the page, not the event. A page's durable identity is `(event_id, position)`; the `id` pk is
 * an internal row id, freshly minted every save because a save deletes and reinserts an event's
 * pages wholesale. Condition switch/variable ids are free 4-digit ordinals with no registry yet
 * (Decision 5), so they are stored as plain text this file does not constrain.
 */
export const mapEventPage = sqliteTable(
  "map_event_page",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => mapEvent.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    condSwitchId: text("cond_switch_id"),
    condVariableId: text("cond_variable_id"),
    condVariableMin: integer("cond_variable_min"),
    condSelfSwitch: text("cond_self_switch", { enum: SELF_SWITCHES }),
    graphicAssetId: text("graphic_asset_id").$type<EditorAssetId>(),
    moveType: text("move_type", { enum: MOVE_TYPES }).notNull(),
    moveSpeed: integer("move_speed").notNull(),
    moveFreq: integer("move_freq").notNull(),
    optMoveAnim: integer("opt_move_anim", { mode: "boolean" }).notNull(),
    optStopAnim: integer("opt_stop_anim", { mode: "boolean" }).notNull(),
    optDirFix: integer("opt_dir_fix", { mode: "boolean" }).notNull(),
    optThrough: integer("opt_through", { mode: "boolean" }).notNull(),
    optOnTop: integer("opt_on_top", { mode: "boolean" }).notNull(),
    trigger: text("trigger", { enum: EVENT_TRIGGERS }).notNull(),
    /** Tranche 5: the page's authored command program, a JSON array parsed by `parseEventCommands`
     *  (`shared/event-commands.ts`). Stored as one TEXT blob (not one row per command) so nested
     *  bodies persist without a self-referential table; `'[]'` is the empty program a page carries
     *  until authored, and the column default so every pre-tranche-5 page reads back as empty. Normal
     *  events run it on trigger; monster events may run it on defeat; entry/exit keep it empty. */
    commands: text("commands").notNull().default("[]"),
  },
  (table) => [
    uniqueIndex("map_event_page_position_unique").on(table.eventId, table.position),
    index("map_event_page_event_idx").on(table.eventId),
  ],
);

export type MapEventRow = typeof mapEvent.$inferSelect;
export type MapEventPageRow = typeof mapEventPage.$inferSelect;

export const adventure = sqliteTable(
  "adventure",
  {
    /** Server-minted uuid. A client never supplies this. */
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    maxPlayers: integer("max_players").notNull().default(4),
    /** Reserved seam for immutable published versions; always 1 until then. */
    version: integer("version").notNull().default(1),
    /** JSON AdventureGraph: start anchor plus one binding per placed exit. */
    graph: text("graph").notNull(),
    /**
     * JSON `AdventureRegistry` (the switch/variable catalogue, adventure-state design Decision
     * 1). The empty string, not `'{"switches":[],"variables":[]}'`, is both the column default
     * and the legacy-row sentinel — `adventures.ts`'s `toStored` reads either one back as
     * `EMPTY_REGISTRY`, so a freshly created adventure never needs a write to have a valid
     * registry. Bounded (200 switches + 200 variables max), so it rides this row rather than a
     * table of its own.
     */
    registry: text("registry").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    index("adventure_account_idx").on(table.accountId),
    check("adventure_max_players_range", sql`${table.maxPlayers} BETWEEN 1 AND 4`),
  ],
);

export const party = sqliteTable(
  "party",
  {
    /** Server-minted uuid. A client never supplies this. */
    id: text("id").primaryKey(),
    /** restrict: a party pins its adventure; deleting a referenced adventure is refused. */
    adventureId: text("adventure_id")
      .notNull()
      .references(() => adventure.id, { onDelete: "restrict" }),
    /** Pinned at creation so later adventure edits never move a live party's version or cap. */
    adventureVersion: integer("adventure_version").notNull(),
    maxPlayers: integer("max_players").notNull(),
    hostAccountId: text("host_account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    name: text("name"),
    status: text("status", { enum: ["open", "completed"] })
      .notNull()
      .default("open"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    index("party_adventure_idx").on(table.adventureId),
    index("party_host_idx").on(table.hostAccountId),
  ],
);

export const partyMember = sqliteTable(
  "party_member",
  {
    partyId: text("party_id")
      .notNull()
      .references(() => party.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    color: text("color", { enum: ["blue", "red", "yellow", "purple"] }).notNull(),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    primaryKey({ columns: [table.partyId, table.accountId] }),
    uniqueIndex("party_member_colour_unique").on(table.partyId, table.color),
    index("party_member_account_idx").on(table.accountId),
  ],
);

export const hero = sqliteTable(
  "hero",
  {
    /** Server-minted uuid. A client never supplies this. */
    id: text("id").primaryKey(),
    partyId: text("party_id")
      .notNull()
      .references(() => party.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    class: text("class", { enum: ["warrior", "ranger", "priest"] })
      .notNull()
      .default("warrior"),
    /** The D1 map the hero is on; starts at the adventure's start map. */
    mapId: text("map_id").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    level: integer("level").notNull().default(1),
    xp: integer("xp").notNull().default(0),
    hp: integer("hp").notNull().default(100),
    gold: integer("gold").notNull().default(0),
    crystals: integer("crystals").notNull().default(0),
    resourceCurrent: real("resource_current"),
    /** JSON CombatCooldownState. Deadlines are normalized against server time on restore. */
    combatCooldowns: text("combat_cooldowns").notNull().default("{}"),
    consumableCooldownUntil: integer("consumable_cooldown_until").notNull().default(0),
    damageBoostUntil: integer("damage_boost_until").notNull().default(0),
    forgottenUntil: integer("forgotten_until").notNull().default(0),
    invisibleUntil: integer("invisible_until").notNull().default(0),
    resurrectionAt: integer("resurrection_at").notNull().default(0),
    /** JSON array of server-validated talent ids. Roots are derived and never stored. */
    talents: text("talents").notNull().default("[]"),
    sessionEpoch: integer("session_epoch").notNull().default(0),
    /** Death is persistent, mirroring `character`. `corpseX/Y` are null exactly when life is alive. */
    life: text("life", { enum: ["alive", "corpse", "ghost"] })
      .notNull()
      .default("alive"),
    corpseX: real("corpse_x"),
    corpseY: real("corpse_y"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [index("hero_party_account_idx").on(table.partyId, table.accountId)],
);

/**
 * A disposable, editor-owned playtest envelope around a normal party/hero runtime.
 *
 * The party is intentionally real so the authoritative World/GameSession path is exercised, but
 * this row keeps it out of save/join lists and gives it a bounded lifetime. Deleting the party
 * cascades this row, its hero and every progression/reward child, leaving no player save behind.
 */
export const adventureTestSession = sqliteTable(
  "adventure_test_session",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => account.id, { onDelete: "cascade" }),
    adventureId: text("adventure_id")
      .notNull()
      .references(() => adventure.id, { onDelete: "cascade" }),
    partyId: text("party_id")
      .notNull()
      .references(() => party.id, { onDelete: "cascade" }),
    /** Null means the authored global adventure start; otherwise the map's fallback/test point. */
    startMapId: text("start_map_id"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("adventure_test_session_account_unique").on(table.accountId),
    uniqueIndex("adventure_test_session_party_unique").on(table.partyId),
    index("adventure_test_session_expiry_idx").on(table.expiresAt),
  ],
);

/** Hero-owned normalized gameplay state. These tables intentionally do not point at `character`:
 * the party/hero flow has its own ownership and fencing boundary. */
export const heroItem = sqliteTable(
  "hero_item",
  {
    id: text("id").primaryKey(),
    heroId: text("hero_id")
      .notNull()
      .references(() => hero.id, { onDelete: "cascade" }),
    itemDefinitionId: text("item_definition_id")
      .notNull()
      .references(() => itemDefinition.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    check("hero_item_quantity_non_negative", sql`${table.quantity} >= 0`),
    uniqueIndex("hero_item_definition_unique").on(table.heroId, table.itemDefinitionId),
    uniqueIndex("hero_item_owner_id_unique").on(table.heroId, table.id),
    index("hero_item_hero_idx").on(table.heroId),
  ],
);

export const heroEquipment = sqliteTable(
  "hero_equipment",
  {
    heroId: text("hero_id")
      .notNull()
      .references(() => hero.id, { onDelete: "cascade" }),
    slot: text("slot", { enum: EQUIPMENT_SLOTS }).notNull(),
    heroItemId: text("hero_item_id").notNull(),
    equippedAt: integer("equipped_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    primaryKey({ columns: [table.heroId, table.slot] }),
    uniqueIndex("hero_equipment_item_unique").on(table.heroItemId),
    foreignKey({
      columns: [table.heroId, table.heroItemId],
      foreignColumns: [heroItem.heroId, heroItem.id],
      name: "hero_equipment_owned_item_fk",
    }).onDelete("cascade"),
  ],
);

export const heroSkill = sqliteTable(
  "hero_skill",
  {
    heroId: text("hero_id")
      .notNull()
      .references(() => hero.id, { onDelete: "cascade" }),
    skillId: text("skill_id").notNull(),
    unlocked: integer("unlocked", { mode: "boolean" }).notNull().default(false),
    equipped: integer("equipped", { mode: "boolean" }).notNull().default(false),
    slot: integer("slot"),
    unlockedAt: integer("unlocked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    primaryKey({ columns: [table.heroId, table.skillId] }),
    uniqueIndex("hero_skill_slot_unique").on(table.heroId, table.slot),
    check("hero_skill_slot_range", sql`${table.slot} IS NULL OR ${table.slot} BETWEEN 1 AND 5`),
    check(
      "hero_skill_equipped_shape",
      sql`(${table.equipped} = 0 AND ${table.slot} IS NULL) OR (${table.equipped} = 1 AND ${table.unlocked} = 1 AND ${table.slot} IS NOT NULL)`,
    ),
  ],
);

export const heroQuest = sqliteTable(
  "hero_quest",
  {
    heroId: text("hero_id")
      .notNull()
      .references(() => hero.id, { onDelete: "cascade" }),
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
    primaryKey({ columns: [table.heroId, table.questId] }),
    check("hero_quest_progress_non_negative", sql`${table.progress} >= 0`),
    index("hero_quest_hero_status_idx").on(table.heroId, table.status),
  ],
);

/** Idempotency fence for authored rewards, including repeatable quest attempts. */
export const authoredQuestRewardClaim = sqliteTable(
  "authored_quest_reward_claim",
  {
    id: text("id").primaryKey(),
    ownerKind: text("owner_kind", { enum: ["party", "personal"] }).notNull(),
    /** Party id for shared quests, hero id for personal quests. */
    ownerId: text("owner_id").notNull(),
    recipientHeroId: text("recipient_hero_id")
      .notNull()
      .references(() => hero.id, { onDelete: "cascade" }),
    questId: text("quest_id").notNull(),
    attempt: integer("attempt").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("authored_quest_reward_owner_attempt_unique").on(
      table.ownerKind,
      table.ownerId,
      table.questId,
      table.attempt,
    ),
    index("authored_quest_reward_recipient_idx").on(table.recipientHeroId),
    check("authored_quest_reward_attempt_positive", sql`${table.attempt} >= 1`),
  ],
);

/**
 * A party's live adventure-state save: switches, variables, per-event self-switches and authored
 * quest progress. One row per party — state is party-owned, not
 * hero-owned (adventure-state design Decision 2), because a party is the save and four heroes
 * in it share one state. `GameSession` is the only writer; the event interpreter sends mutations
 * to it and it upserts on debounce/party-empty. The four state fields are JSON columns, validated
 * on read by `shared/adventure-state.ts`'s `parsePartyAdventureState`
 * with the same never-throw degrade discipline `maps.ts`'s `decodeLayers` uses for a corrupt or
 * missing map-layer row.
 */
export const partyAdventureState = sqliteTable("party_adventure_state", {
  partyId: text("party_id")
    .primaryKey()
    .references(() => party.id, { onDelete: "cascade" }),
  switches: text("switches").notNull(),
  variables: text("variables").notNull(),
  selfSwitches: text("self_switches").notNull(),
  quests: text("quests").notNull().default("{}"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(nowMs),
});

export type Adventure = typeof adventure.$inferSelect;
export type Party = typeof party.$inferSelect;
export type PartyMember = typeof partyMember.$inferSelect;
export type Hero = typeof hero.$inferSelect;
export type AdventureTestSession = typeof adventureTestSession.$inferSelect;
export type HeroItem = typeof heroItem.$inferSelect;
export type HeroEquipment = typeof heroEquipment.$inferSelect;
export type HeroSkill = typeof heroSkill.$inferSelect;
export type HeroQuest = typeof heroQuest.$inferSelect;
export type AuthoredQuestRewardClaim = typeof authoredQuestRewardClaim.$inferSelect;
export type PartyAdventureStateRow = typeof partyAdventureState.$inferSelect;
