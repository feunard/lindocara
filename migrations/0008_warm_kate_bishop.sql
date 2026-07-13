CREATE TABLE `character_equipment` (
	`character_id` text NOT NULL,
	`slot` text NOT NULL,
	`character_item_id` text NOT NULL,
	`equipped_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`character_id`, `slot`),
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`,`character_item_id`) REFERENCES `character_item`(`character_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_equipment_item_unique` ON `character_equipment` (`character_item_id`);--> statement-breakpoint
CREATE TABLE `character_item` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`item_definition_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_definition_id`) REFERENCES `item_definition`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "character_item_quantity_non_negative" CHECK("character_item"."quantity" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_item_definition_unique` ON `character_item` (`character_id`,`item_definition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `character_item_owner_id_unique` ON `character_item` (`character_id`,`id`);--> statement-breakpoint
CREATE INDEX `character_item_character_idx` ON `character_item` (`character_id`);--> statement-breakpoint
CREATE TABLE `character_quest` (
	`character_id` text NOT NULL,
	`quest_id` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`accepted_at` integer,
	`completed_at` integer,
	`data` text,
	`reward_claim_id` text,
	PRIMARY KEY(`character_id`, `quest_id`),
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "character_quest_progress_non_negative" CHECK("character_quest"."progress" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_quest_reward_claim_id_unique` ON `character_quest` (`reward_claim_id`);--> statement-breakpoint
CREATE INDEX `character_quest_character_status_idx` ON `character_quest` (`character_id`,`status`);--> statement-breakpoint
CREATE TABLE `character_skill` (
	`character_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`unlocked` integer DEFAULT false NOT NULL,
	`equipped` integer DEFAULT false NOT NULL,
	`slot` integer,
	`unlocked_at` integer,
	PRIMARY KEY(`character_id`, `skill_id`),
	FOREIGN KEY (`character_id`) REFERENCES `character`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "character_skill_slot_range" CHECK("character_skill"."slot" IS NULL OR "character_skill"."slot" BETWEEN 1 AND 5),
	CONSTRAINT "character_skill_equipped_shape" CHECK(("character_skill"."equipped" = 0 AND "character_skill"."slot" IS NULL) OR ("character_skill"."equipped" = 1 AND "character_skill"."unlocked" = 1 AND "character_skill"."slot" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `character_skill_slot_unique` ON `character_skill` (`character_id`,`slot`);--> statement-breakpoint
CREATE TABLE `item_definition` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`stackable` integer NOT NULL,
	`max_stack` integer NOT NULL,
	`equipment_slot` text,
	`allowed_class` text,
	CONSTRAINT "item_definition_max_stack_positive" CHECK("item_definition"."max_stack" > 0),
	CONSTRAINT "item_definition_stack_shape" CHECK("item_definition"."stackable" = 1 OR "item_definition"."max_stack" = 1)
);
--> statement-breakpoint
INSERT INTO `item_definition` (`id`, `type`, `stackable`, `max_stack`, `equipment_slot`, `allowed_class`) VALUES
	('health_potion', 'consumable', 1, 9999, NULL, NULL),
	('weathered_sword', 'weapon', 0, 1, 'main_hand', 'warrior'),
	('hunter_bow', 'weapon', 0, 1, 'main_hand', 'ranger'),
	('heartwood_staff', 'weapon', 0, 1, 'main_hand', 'priest'),
	('oak_shield', 'shield', 0, 1, 'off_hand', 'warrior');
--> statement-breakpoint
INSERT INTO `character_item` (`id`, `character_id`, `item_definition_id`, `quantity`, `created_at`)
SELECT `id` || ':health_potion', `id`, 'health_potion', `potions`, `created_at`
FROM `character`
WHERE `potions` > 0;
--> statement-breakpoint
INSERT INTO `character_item` (`id`, `character_id`, `item_definition_id`, `quantity`, `created_at`)
SELECT `id` || ':' || `main_hand`, `id`, `main_hand`, 1, `created_at`
FROM `character`;
--> statement-breakpoint
INSERT INTO `character_item` (`id`, `character_id`, `item_definition_id`, `quantity`, `created_at`)
SELECT `id` || ':' || `off_hand`, `id`, `off_hand`, 1, `created_at`
FROM `character`
WHERE `off_hand` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `character_equipment` (`character_id`, `slot`, `character_item_id`, `equipped_at`)
SELECT `id`, 'main_hand', `id` || ':' || `main_hand`, `last_seen_at`
FROM `character`;
--> statement-breakpoint
INSERT INTO `character_equipment` (`character_id`, `slot`, `character_item_id`, `equipped_at`)
SELECT `id`, 'off_hand', `id` || ':' || `off_hand`, `last_seen_at`
FROM `character`
WHERE `off_hand` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `character_quest` (`character_id`, `quest_id`, `status`, `progress`, `accepted_at`, `completed_at`, `data`)
SELECT
	`id`,
	`quest_chapter`,
	`quest_status`,
	`quest_progress`,
	CASE WHEN `quest_status` = 'available' THEN NULL ELSE `created_at` END,
	CASE WHEN `quest_status` = 'completed' THEN `last_seen_at` ELSE NULL END,
	CASE WHEN `ward_run_expires_at` IS NULL THEN NULL ELSE json_object('wardRunExpiresAt', `ward_run_expires_at`) END
FROM `character`;
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'cleave', 1, 1, 1, `created_at` FROM `character` WHERE `class` = 'warrior';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'iron_guard', `level` >= 3, `level` >= 3, CASE WHEN `level` >= 3 THEN 2 END, CASE WHEN `level` >= 3 THEN `created_at` END FROM `character` WHERE `class` = 'warrior';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'shield_bash', `level` >= 5, `level` >= 5, CASE WHEN `level` >= 5 THEN 3 END, CASE WHEN `level` >= 5 THEN `created_at` END FROM `character` WHERE `class` = 'warrior';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'battle_cry', `level` >= 7, `level` >= 7, CASE WHEN `level` >= 7 THEN 4 END, CASE WHEN `level` >= 7 THEN `created_at` END FROM `character` WHERE `class` = 'warrior';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'whirlwind', `level` >= 10, `level` >= 10, CASE WHEN `level` >= 10 THEN 5 END, CASE WHEN `level` >= 10 THEN `created_at` END FROM `character` WHERE `class` = 'warrior';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'quick_shot', 1, 1, 1, `created_at` FROM `character` WHERE `class` = 'ranger';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'piercing_arrow', `level` >= 3, `level` >= 3, CASE WHEN `level` >= 3 THEN 2 END, CASE WHEN `level` >= 3 THEN `created_at` END FROM `character` WHERE `class` = 'ranger';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'volley', `level` >= 5, `level` >= 5, CASE WHEN `level` >= 5 THEN 3 END, CASE WHEN `level` >= 5 THEN `created_at` END FROM `character` WHERE `class` = 'ranger';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'dash', `level` >= 7, `level` >= 7, CASE WHEN `level` >= 7 THEN 4 END, CASE WHEN `level` >= 7 THEN `created_at` END FROM `character` WHERE `class` = 'ranger';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'heartseeker', `level` >= 10, `level` >= 10, CASE WHEN `level` >= 10 THEN 5 END, CASE WHEN `level` >= 10 THEN `created_at` END FROM `character` WHERE `class` = 'ranger';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'radiant_bolt', 1, 1, 1, `created_at` FROM `character` WHERE `class` = 'priest';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'mend', `level` >= 3, `level` >= 3, CASE WHEN `level` >= 3 THEN 2 END, CASE WHEN `level` >= 3 THEN `created_at` END FROM `character` WHERE `class` = 'priest';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'blink', `level` >= 5, `level` >= 5, CASE WHEN `level` >= 5 THEN 3 END, CASE WHEN `level` >= 5 THEN `created_at` END FROM `character` WHERE `class` = 'priest';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'prayer', `level` >= 7, `level` >= 7, CASE WHEN `level` >= 7 THEN 4 END, CASE WHEN `level` >= 7 THEN `created_at` END FROM `character` WHERE `class` = 'priest';
--> statement-breakpoint
INSERT INTO `character_skill` (`character_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT `id`, 'divine_nova', `level` >= 10, `level` >= 10, CASE WHEN `level` >= 10 THEN 5 END, CASE WHEN `level` >= 10 THEN `created_at` END FROM `character` WHERE `class` = 'priest';
