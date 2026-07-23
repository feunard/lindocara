CREATE TABLE `authored_quest_reward_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`recipient_hero_id` text NOT NULL,
	`quest_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`recipient_hero_id`) REFERENCES `hero`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "authored_quest_reward_attempt_positive" CHECK("authored_quest_reward_claim"."attempt" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authored_quest_reward_owner_attempt_unique` ON `authored_quest_reward_claim` (`owner_kind`,`owner_id`,`quest_id`,`attempt`);--> statement-breakpoint
CREATE INDEX `authored_quest_reward_recipient_idx` ON `authored_quest_reward_claim` (`recipient_hero_id`);