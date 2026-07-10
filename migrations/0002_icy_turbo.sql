CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_username_unique` ON `account` (`username`);--> statement-breakpoint
CREATE TABLE `character` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`x` real DEFAULT 784 NOT NULL,
	`y` real DEFAULT 450 NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`hp` integer DEFAULT 100 NOT NULL,
	`appearance` text DEFAULT 'azure' NOT NULL,
	`potions` integer DEFAULT 2 NOT NULL,
	`gold` integer DEFAULT 0 NOT NULL,
	`crystals` integer DEFAULT 0 NOT NULL,
	`weapon` text DEFAULT 'rusty_sword' NOT NULL,
	`quest_status` text DEFAULT 'available' NOT NULL,
	`quest_progress` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `character_account_idx` ON `character` (`account_id`);--> statement-breakpoint
DROP TABLE `player`;