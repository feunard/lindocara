CREATE TABLE `adventureTestSessions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`adventure_id` text NOT NULL,
	`party_id` text NOT NULL,
	`start_map_id` text,
	`expires_at` integer NOT NULL,
	CONSTRAINT `fk_adventureTestSessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_adventureTestSessions_adventure_id_adventures_id_fk` FOREIGN KEY (`adventure_id`) REFERENCES `adventures`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_adventureTestSessions_party_id_parties_id_fk` FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `adventures` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`max_players` integer DEFAULT 4 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`graph` text NOT NULL,
	`registry` text DEFAULT '' NOT NULL,
	`audio` text DEFAULT '' NOT NULL,
	CONSTRAINT `fk_adventures_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "adventures_max_players_check" CHECK(max_players BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE TABLE `alepha_sequences` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`name` text NOT NULL,
	`scope` text DEFAULT 'default' NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `authoredQuestRewardClaims` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`recipient_hero_id` text NOT NULL,
	`quest_id` text NOT NULL,
	`attempt` integer NOT NULL,
	CONSTRAINT `fk_authoredQuestRewardClaims_recipient_hero_id_heroes_id_fk` FOREIGN KEY (`recipient_hero_id`) REFERENCES `heroes`(`id`) ON DELETE CASCADE,
	CONSTRAINT "authored_quest_reward_attempt_positive" CHECK(attempt >= 1)
);
--> statement-breakpoint
CREATE TABLE `cache_entries` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`container` text NOT NULL,
	`cache_key` text NOT NULL,
	`value` text,
	`count` integer,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `heroEquipment` (
	`id` text PRIMARY KEY,
	`hero_id` text NOT NULL,
	`slot` text NOT NULL,
	`hero_item_id` text NOT NULL,
	`equipped_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_heroEquipment_hero_id_heroes_id_fk` FOREIGN KEY (`hero_id`) REFERENCES `heroes`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `heroItems` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`hero_id` text NOT NULL,
	`item_definition_id` text NOT NULL,
	`quantity` integer NOT NULL,
	CONSTRAINT `fk_heroItems_hero_id_heroes_id_fk` FOREIGN KEY (`hero_id`) REFERENCES `heroes`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_heroItems_item_definition_id_itemDefinitions_id_fk` FOREIGN KEY (`item_definition_id`) REFERENCES `itemDefinitions`(`id`) ON DELETE RESTRICT,
	CONSTRAINT "heroItems_quantity_check" CHECK(quantity >= 0)
);
--> statement-breakpoint
CREATE TABLE `heroQuests` (
	`id` text PRIMARY KEY,
	`hero_id` text NOT NULL,
	`quest_id` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`accepted_at` integer,
	`completed_at` integer,
	`data` text,
	`reward_claim_id` text,
	CONSTRAINT `fk_heroQuests_hero_id_heroes_id_fk` FOREIGN KEY (`hero_id`) REFERENCES `heroes`(`id`) ON DELETE CASCADE,
	CONSTRAINT "heroQuests_progress_check" CHECK(progress >= 0)
);
--> statement-breakpoint
CREATE TABLE `heroSkills` (
	`id` text PRIMARY KEY,
	`hero_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`unlocked` integer DEFAULT false NOT NULL,
	`equipped` integer DEFAULT false NOT NULL,
	`slot` integer,
	`unlocked_at` integer,
	CONSTRAINT `fk_heroSkills_hero_id_heroes_id_fk` FOREIGN KEY (`hero_id`) REFERENCES `heroes`(`id`) ON DELETE CASCADE,
	CONSTRAINT "hero_skill_slot_range" CHECK(slot IS NULL OR slot BETWEEN 1 AND 5),
	CONSTRAINT "hero_skill_equipped_shape" CHECK((equipped = 0 AND slot IS NULL) OR (equipped = 1 AND unlocked = 1 AND slot IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `heroes` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`party_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`class` text DEFAULT 'warrior' NOT NULL,
	`map_id` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`hp` integer DEFAULT 100 NOT NULL,
	`gold` integer DEFAULT 0 NOT NULL,
	`crystals` integer DEFAULT 0 NOT NULL,
	`resource_current` real,
	`combat_cooldowns` text DEFAULT '{}' NOT NULL,
	`consumable_cooldown_until` integer DEFAULT 0 NOT NULL,
	`damage_boost_until` integer DEFAULT 0 NOT NULL,
	`forgotten_until` integer DEFAULT 0 NOT NULL,
	`invisible_until` integer DEFAULT 0 NOT NULL,
	`resurrection_at` integer DEFAULT 0 NOT NULL,
	`talents` text DEFAULT '[]' NOT NULL,
	`session_epoch` integer DEFAULT 0 NOT NULL,
	`life` text DEFAULT 'alive' NOT NULL,
	`corpse_x` real,
	`corpse_y` real,
	CONSTRAINT `fk_heroes_party_id_parties_id_fk` FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_heroes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `identities` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`password` text,
	`provider` text NOT NULL,
	`provider_user_id` text,
	`provider_data` text,
	CONSTRAINT `fk_identities_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `itemDefinitions` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`stackable` integer NOT NULL,
	`max_stack` integer NOT NULL,
	`equipment_slot` text,
	`allowed_class` text,
	CONSTRAINT "item_definition_max_stack_positive" CHECK(max_stack > 0),
	CONSTRAINT "item_definition_stack_shape" CHECK(stackable = 1 OR max_stack = 1)
);
--> statement-breakpoint
CREATE TABLE `job_executions` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`job_name` text NOT NULL,
	`key` text,
	`organization_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 1 NOT NULL,
	`payload` text,
	`scheduled_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`error` text,
	`logs` text,
	`triggered_by` text,
	`triggered_by_name` text,
	`cancelled_by` text,
	`cancelled_by_name` text
);
--> statement-breakpoint
CREATE TABLE `mapElements` (
	`id` text PRIMARY KEY,
	`map_id` text NOT NULL,
	`col` integer NOT NULL,
	`row` integer NOT NULL,
	`offset_x` integer DEFAULT 0 NOT NULL,
	`offset_y` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`variant` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `fk_mapElements_map_id_maps_id_fk` FOREIGN KEY (`map_id`) REFERENCES `maps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `mapEventPages` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`position` integer NOT NULL,
	`cond_switch_id` text,
	`cond_variable_id` text,
	`cond_variable_min` integer,
	`cond_self_switch` text,
	`graphic_asset_id` text,
	`move_type` text NOT NULL,
	`move_speed` integer NOT NULL,
	`move_freq` integer NOT NULL,
	`opt_move_anim` integer NOT NULL,
	`opt_stop_anim` integer NOT NULL,
	`opt_dir_fix` integer NOT NULL,
	`opt_through` integer NOT NULL,
	`opt_on_top` integer NOT NULL,
	`trigger` text NOT NULL,
	`commands` text DEFAULT '[]' NOT NULL,
	CONSTRAINT `fk_mapEventPages_event_id_mapEvents_id_fk` FOREIGN KEY (`event_id`) REFERENCES `mapEvents`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `mapEvents` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`map_id` text NOT NULL,
	`col` integer NOT NULL,
	`row` integer NOT NULL,
	`name` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text DEFAULT 'normal' NOT NULL,
	`species` text,
	`patrol_radius` integer,
	`monster_rank` text,
	`monster_max_hp` integer,
	`monster_damage` integer,
	`monster_speed` integer,
	`monster_xp` integer,
	`monster_weakness` text,
	`monster_weakness_percent` integer,
	`monster_special_technique` text,
	`monster_respawn_mode` text,
	CONSTRAINT `fk_mapEvents_map_id_maps_id_fk` FOREIGN KEY (`map_id`) REFERENCES `maps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `maps` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`user_id` text NOT NULL,
	`adventure_id` text NOT NULL,
	`name` text NOT NULL,
	`cols` integer NOT NULL,
	`rows` integer NOT NULL,
	`tileset_id` text DEFAULT 'tiny-swords' NOT NULL,
	`layers` text NOT NULL,
	`spawn_col` integer NOT NULL,
	`spawn_row` integer NOT NULL,
	`markers` text,
	`audio` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`write_token` text DEFAULT '' NOT NULL,
	`is_first` integer DEFAULT false NOT NULL,
	CONSTRAINT `fk_maps_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_maps_adventure_id_adventures_id_fk` FOREIGN KEY (`adventure_id`) REFERENCES `adventures`(`id`) ON DELETE CASCADE,
	CONSTRAINT "maps_revision_check" CHECK(revision >= 1)
);
--> statement-breakpoint
CREATE TABLE `parties` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`adventure_id` text NOT NULL,
	`adventure_version` integer NOT NULL,
	`max_players` integer NOT NULL,
	`host_user_id` text NOT NULL,
	`name` text,
	`status` text DEFAULT 'open' NOT NULL,
	CONSTRAINT `fk_parties_adventure_id_adventures_id_fk` FOREIGN KEY (`adventure_id`) REFERENCES `adventures`(`id`) ON DELETE RESTRICT,
	CONSTRAINT `fk_parties_host_user_id_users_id_fk` FOREIGN KEY (`host_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `partyAdventureStates` (
	`party_id` text PRIMARY KEY,
	`switches` text NOT NULL,
	`variables` text NOT NULL,
	`self_switches` text NOT NULL,
	`quests` text DEFAULT '{}' NOT NULL,
	`defeated_monsters` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_partyAdventureStates_party_id_parties_id_fk` FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `partyMembers` (
	`id` text PRIMARY KEY,
	`party_id` text NOT NULL,
	`user_id` text NOT NULL,
	`color` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT `fk_partyMembers_party_id_parties_id_fk` FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_partyMembers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`refresh_token` text NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	`ip` text,
	`country` text,
	`user_agent` text,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`realm` text DEFAULT 'default' NOT NULL,
	`username` text,
	`email` text,
	`phone_number` text,
	`roles` text DEFAULT '[]' NOT NULL,
	`first_name` text,
	`last_name` text,
	`picture` text,
	`enabled` integer DEFAULT true NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`last_login_at` integer,
	`organization_id` text
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`target` text NOT NULL,
	`purpose` text DEFAULT 'default' NOT NULL,
	`code` text NOT NULL,
	`verified_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `adventure_test_session_account_unique` ON `adventureTestSessions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `adventure_test_session_party_unique` ON `adventureTestSessions` (`party_id`);--> statement-breakpoint
CREATE INDEX `adventure_test_session_expiry_idx` ON `adventureTestSessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `adventures_user_id_idx` ON `adventures` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `alepha_sequences_name_scope_idx` ON `alepha_sequences` (`name`,`scope`);--> statement-breakpoint
CREATE UNIQUE INDEX `authored_quest_reward_owner_attempt_unique` ON `authoredQuestRewardClaims` (`owner_kind`,`owner_id`,`quest_id`,`attempt`);--> statement-breakpoint
CREATE INDEX `authored_quest_reward_recipient_idx` ON `authoredQuestRewardClaims` (`recipient_hero_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cache_entries_container_cache_key_idx` ON `cache_entries` (`container`,`cache_key`);--> statement-breakpoint
CREATE INDEX `cache_entries_expires_at_idx` ON `cache_entries` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `hero_equipment_identity_unique` ON `heroEquipment` (`hero_id`,`slot`);--> statement-breakpoint
CREATE UNIQUE INDEX `hero_equipment_item_unique` ON `heroEquipment` (`hero_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hero_item_definition_unique` ON `heroItems` (`hero_id`,`item_definition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hero_item_owner_id_unique` ON `heroItems` (`hero_id`,`id`);--> statement-breakpoint
CREATE INDEX `hero_item_hero_idx` ON `heroItems` (`hero_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hero_quest_identity_unique` ON `heroQuests` (`hero_id`,`quest_id`);--> statement-breakpoint
CREATE INDEX `hero_quest_hero_status_idx` ON `heroQuests` (`hero_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `hero_quest_reward_claim_unique` ON `heroQuests` (`reward_claim_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hero_skill_identity_unique` ON `heroSkills` (`hero_id`,`skill_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hero_skill_slot_unique` ON `heroSkills` (`hero_id`,`slot`);--> statement-breakpoint
CREATE INDEX `hero_party_account_idx` ON `heroes` (`party_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `identities_user_id_idx` ON `identities` (`user_id`);--> statement-breakpoint
CREATE INDEX `identities_provider_idx` ON `identities` (`provider`);--> statement-breakpoint
CREATE INDEX `identities_user_id_provider_idx` ON `identities` (`user_id`,`provider`);--> statement-breakpoint
CREATE UNIQUE INDEX `identities_provider_provider_user_id_idx` ON `identities` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_scheduled_at_idx` ON `job_executions` (`job_name`,`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_status_created_at_idx` ON `job_executions` (`job_name`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `job_executions_job_name_started_at_idx` ON `job_executions` (`job_name`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_executions_job_name_key_idx` ON `job_executions` (`job_name`,`key`);--> statement-breakpoint
CREATE INDEX `map_element_map_idx` ON `mapElements` (`map_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `map_element_identity_unique` ON `mapElements` (`map_id`,`col`,`row`,`offset_x`,`offset_y`);--> statement-breakpoint
CREATE UNIQUE INDEX `map_event_page_position_unique` ON `mapEventPages` (`event_id`,`position`);--> statement-breakpoint
CREATE INDEX `map_event_page_event_idx` ON `mapEventPages` (`event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `map_event_cell_unique` ON `mapEvents` (`map_id`,`col`,`row`);--> statement-breakpoint
CREATE INDEX `map_event_map_idx` ON `mapEvents` (`map_id`);--> statement-breakpoint
CREATE INDEX `map_account_idx` ON `maps` (`user_id`);--> statement-breakpoint
CREATE INDEX `map_adventure_idx` ON `maps` (`adventure_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `map_account_first_unique` ON `maps` (`user_id`) WHERE is_first = 1;--> statement-breakpoint
CREATE INDEX `party_adventure_idx` ON `parties` (`adventure_id`);--> statement-breakpoint
CREATE INDEX `party_host_idx` ON `parties` (`host_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `party_member_identity_unique` ON `partyMembers` (`party_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `party_member_colour_unique` ON `partyMembers` (`party_id`,`color`);--> statement-breakpoint
CREATE INDEX `party_member_account_idx` ON `partyMembers` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_refresh_token_idx` ON `sessions` (`refresh_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_username_lower_idx` ON `users` (`realm`,LOWER("username"));--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_email_idx` ON `users` (`realm`,`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_realm_phone_number_idx` ON `users` (`realm`,`phone_number`);--> statement-breakpoint
CREATE INDEX `verification_created_at_idx` ON `verification` (`created_at`);--> statement-breakpoint
CREATE INDEX `verification_target_code_idx` ON `verification` (`target`,`code`);