CREATE TABLE `player` (
	`id` text PRIMARY KEY NOT NULL,
	`nick` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `player_nick_idx` ON `player` (`nick`);