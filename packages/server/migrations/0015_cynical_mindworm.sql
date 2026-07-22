CREATE TABLE `hero` (
	`id` text PRIMARY KEY NOT NULL,
	`party_id` text NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`class` text DEFAULT 'warrior' NOT NULL,
	`map_id` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`hp` integer DEFAULT 100 NOT NULL,
	`session_epoch` integer DEFAULT 0 NOT NULL,
	`life` text DEFAULT 'alive' NOT NULL,
	`corpse_x` real,
	`corpse_y` real,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `party`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hero_party_account_idx` ON `hero` (`party_id`,`account_id`);