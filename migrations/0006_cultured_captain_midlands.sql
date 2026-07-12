ALTER TABLE `character` ADD `zone_id` text DEFAULT 'verdant-reach' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `instance_id` text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `session_epoch` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `ward_run_expires_at` integer;--> statement-breakpoint
ALTER TABLE `character` ADD `life` text DEFAULT 'alive' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `corpse_x` real;--> statement-breakpoint
ALTER TABLE `character` ADD `corpse_y` real;
