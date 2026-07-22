ALTER TABLE `player` ADD `x` real DEFAULT 784 NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `y` real DEFAULT 450 NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `level` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `xp` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `hp` integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `appearance` text DEFAULT 'azure' NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `potions` integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `gold` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `crystals` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `weapon` text DEFAULT 'rusty_sword' NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `quest_status` text DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE `player` ADD `quest_progress` integer DEFAULT 0 NOT NULL;