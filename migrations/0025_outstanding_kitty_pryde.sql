CREATE TABLE `hero_equipment` (
	`hero_id` text NOT NULL,
	`slot` text NOT NULL,
	`hero_item_id` text NOT NULL,
	`equipped_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`hero_id`, `slot`),
	FOREIGN KEY (`hero_id`) REFERENCES `hero`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hero_id`,`hero_item_id`) REFERENCES `hero_item`(`hero_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hero_equipment_item_unique` ON `hero_equipment` (`hero_item_id`);--> statement-breakpoint
CREATE TABLE `hero_item` (
	`id` text PRIMARY KEY NOT NULL,
	`hero_id` text NOT NULL,
	`item_definition_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`hero_id`) REFERENCES `hero`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_definition_id`) REFERENCES `item_definition`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "hero_item_quantity_non_negative" CHECK("hero_item"."quantity" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hero_item_definition_unique` ON `hero_item` (`hero_id`,`item_definition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hero_item_owner_id_unique` ON `hero_item` (`hero_id`,`id`);--> statement-breakpoint
CREATE INDEX `hero_item_hero_idx` ON `hero_item` (`hero_id`);--> statement-breakpoint
CREATE TABLE `hero_quest` (
	`hero_id` text NOT NULL,
	`quest_id` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`accepted_at` integer,
	`completed_at` integer,
	`data` text,
	`reward_claim_id` text,
	PRIMARY KEY(`hero_id`, `quest_id`),
	FOREIGN KEY (`hero_id`) REFERENCES `hero`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "hero_quest_progress_non_negative" CHECK("hero_quest"."progress" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hero_quest_reward_claim_id_unique` ON `hero_quest` (`reward_claim_id`);--> statement-breakpoint
CREATE INDEX `hero_quest_hero_status_idx` ON `hero_quest` (`hero_id`,`status`);--> statement-breakpoint
CREATE TABLE `hero_skill` (
	`hero_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`unlocked` integer DEFAULT false NOT NULL,
	`equipped` integer DEFAULT false NOT NULL,
	`slot` integer,
	`unlocked_at` integer,
	PRIMARY KEY(`hero_id`, `skill_id`),
	FOREIGN KEY (`hero_id`) REFERENCES `hero`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "hero_skill_slot_range" CHECK("hero_skill"."slot" IS NULL OR "hero_skill"."slot" BETWEEN 1 AND 5),
	CONSTRAINT "hero_skill_equipped_shape" CHECK(("hero_skill"."equipped" = 0 AND "hero_skill"."slot" IS NULL) OR ("hero_skill"."equipped" = 1 AND "hero_skill"."unlocked" = 1 AND "hero_skill"."slot" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hero_skill_slot_unique` ON `hero_skill` (`hero_id`,`slot`);--> statement-breakpoint
ALTER TABLE `hero` ADD `gold` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hero` ADD `crystals` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hero` ADD `resource_current` real;--> statement-breakpoint
ALTER TABLE `hero` ADD `combat_cooldowns` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `hero` ADD `consumable_cooldown_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hero` ADD `damage_boost_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hero` ADD `forgotten_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hero` ADD `invisible_until` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hero` ADD `resurrection_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO `item_definition`
  (`id`, `type`, `stackable`, `max_stack`, `equipment_slot`, `allowed_class`) VALUES
  ('mana_potion', 'consumable', 1, 9999, NULL, NULL),
  ('damage_elixir', 'consumable', 1, 9999, NULL, NULL),
  ('oblivion_draught', 'consumable', 1, 9999, NULL, NULL),
  ('invisibility_potion', 'consumable', 1, 9999, NULL, NULL),
  ('resurrection_potion', 'consumable', 1, 9999, NULL, NULL);
--> statement-breakpoint
INSERT OR IGNORE INTO `hero_item` (`id`, `hero_id`, `item_definition_id`, `quantity`, `created_at`)
SELECT `id` || ':health_potion', `id`, 'health_potion', 2, `created_at` FROM `hero`;
--> statement-breakpoint
INSERT OR IGNORE INTO `hero_item` (`id`, `hero_id`, `item_definition_id`, `quantity`, `created_at`)
SELECT `id` || ':' || CASE `class`
  WHEN 'warrior' THEN 'weathered_sword'
  WHEN 'ranger' THEN 'hunter_bow'
  ELSE 'heartwood_staff'
END, `id`, CASE `class`
  WHEN 'warrior' THEN 'weathered_sword'
  WHEN 'ranger' THEN 'hunter_bow'
  ELSE 'heartwood_staff'
END, 1, `created_at` FROM `hero`;
--> statement-breakpoint
INSERT OR IGNORE INTO `hero_item` (`id`, `hero_id`, `item_definition_id`, `quantity`, `created_at`)
SELECT `id` || ':oak_shield', `id`, 'oak_shield', 1, `created_at`
FROM `hero` WHERE `class` = 'warrior';
--> statement-breakpoint
INSERT OR IGNORE INTO `hero_equipment` (`hero_id`, `slot`, `hero_item_id`, `equipped_at`)
SELECT `id`, 'main_hand', `id` || ':' || CASE `class`
  WHEN 'warrior' THEN 'weathered_sword'
  WHEN 'ranger' THEN 'hunter_bow'
  ELSE 'heartwood_staff'
END, `updated_at` FROM `hero`;
--> statement-breakpoint
INSERT OR IGNORE INTO `hero_equipment` (`hero_id`, `slot`, `hero_item_id`, `equipped_at`)
SELECT `id`, 'off_hand', `id` || ':oak_shield', `updated_at`
FROM `hero` WHERE `class` = 'warrior';
--> statement-breakpoint
INSERT OR IGNORE INTO `hero_quest`
  (`hero_id`, `quest_id`, `status`, `progress`, `accepted_at`, `completed_at`, `data`)
SELECT `id`, 'three_offerings', 'available', 0, NULL, NULL, NULL FROM `hero`;
--> statement-breakpoint
WITH `skill_definition` (`class`, `skill_id`, `slot`, `unlock_level`) AS (VALUES
  ('warrior', 'cleave', 1, 1), ('warrior', 'iron_guard', 2, 3),
  ('warrior', 'shield_bash', 3, 5), ('warrior', 'battle_cry', 4, 7),
  ('warrior', 'whirlwind', 5, 10), ('ranger', 'quick_shot', 1, 1),
  ('ranger', 'piercing_arrow', 2, 3), ('ranger', 'volley', 3, 5),
  ('ranger', 'dash', 4, 7), ('ranger', 'heartseeker', 5, 10),
  ('priest', 'radiant_bolt', 1, 1), ('priest', 'mend', 2, 3),
  ('priest', 'blink', 3, 5), ('priest', 'prayer', 4, 7),
  ('priest', 'divine_nova', 5, 10)
)
INSERT OR IGNORE INTO `hero_skill`
  (`hero_id`, `skill_id`, `unlocked`, `equipped`, `slot`, `unlocked_at`)
SELECT h.`id`, s.`skill_id`, h.`level` >= s.`unlock_level`, h.`level` >= s.`unlock_level`,
  CASE WHEN h.`level` >= s.`unlock_level` THEN s.`slot` ELSE NULL END,
  CASE WHEN h.`level` >= s.`unlock_level` THEN h.`created_at` ELSE NULL END
FROM `hero` h JOIN `skill_definition` s ON s.`class` = h.`class`;
