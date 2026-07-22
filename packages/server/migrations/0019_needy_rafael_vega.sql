CREATE TABLE `map_event` (
	`id` text PRIMARY KEY NOT NULL,
	`map_id` text NOT NULL,
	`col` integer NOT NULL,
	`row` integer NOT NULL,
	`name` text NOT NULL,
	`ordinal` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`map_id`) REFERENCES `map`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_event_cell_unique` ON `map_event` (`map_id`,`col`,`row`);--> statement-breakpoint
CREATE INDEX `map_event_map_idx` ON `map_event` (`map_id`);--> statement-breakpoint
CREATE TABLE `map_event_page` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`event_id`) REFERENCES `map_event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `map_event_page_position_unique` ON `map_event_page` (`event_id`,`position`);--> statement-breakpoint
CREATE INDEX `map_event_page_event_idx` ON `map_event_page` (`event_id`);