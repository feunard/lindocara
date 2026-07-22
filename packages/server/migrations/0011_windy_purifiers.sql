CREATE TABLE `map` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cols` integer NOT NULL,
	`rows` integer NOT NULL,
	`blocks` text NOT NULL,
	`spawn_col` integer NOT NULL,
	`spawn_row` integer NOT NULL,
	`is_first` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `map_element` (
	`map_id` text NOT NULL,
	`col` integer NOT NULL,
	`row` integer NOT NULL,
	`kind` text NOT NULL,
	`variant` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`map_id`, `col`, `row`),
	FOREIGN KEY (`map_id`) REFERENCES `map`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `map_element_map_idx` ON `map_element` (`map_id`);