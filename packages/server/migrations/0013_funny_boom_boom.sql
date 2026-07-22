CREATE TABLE `adventure` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`title` text NOT NULL,
	`max_players` integer DEFAULT 4 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`graph` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "adventure_max_players_range" CHECK("adventure"."max_players" BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE INDEX `adventure_account_idx` ON `adventure` (`account_id`);--> statement-breakpoint
CREATE TABLE `adventure_map` (
	`adventure_id` text NOT NULL,
	`map_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`adventure_id`, `map_id`),
	FOREIGN KEY (`adventure_id`) REFERENCES `adventure`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`map_id`) REFERENCES `map`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `adventure_map_map_idx` ON `adventure_map` (`map_id`);