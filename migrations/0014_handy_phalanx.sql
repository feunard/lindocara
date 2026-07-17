CREATE TABLE `party` (
	`id` text PRIMARY KEY NOT NULL,
	`adventure_id` text NOT NULL,
	`adventure_version` integer NOT NULL,
	`max_players` integer NOT NULL,
	`host_account_id` text NOT NULL,
	`name` text,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`adventure_id`) REFERENCES `adventure`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`host_account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `party_adventure_idx` ON `party` (`adventure_id`);--> statement-breakpoint
CREATE INDEX `party_host_idx` ON `party` (`host_account_id`);--> statement-breakpoint
CREATE TABLE `party_member` (
	`party_id` text NOT NULL,
	`account_id` text NOT NULL,
	`color` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`party_id`, `account_id`),
	FOREIGN KEY (`party_id`) REFERENCES `party`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `party_member_colour_unique` ON `party_member` (`party_id`,`color`);--> statement-breakpoint
CREATE INDEX `party_member_account_idx` ON `party_member` (`account_id`);