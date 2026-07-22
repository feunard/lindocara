PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_map_element` (
	`map_id` text NOT NULL,
	`col` integer NOT NULL,
	`row` integer NOT NULL,
	`offset_x` integer DEFAULT 0 NOT NULL,
	`offset_y` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`variant` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`map_id`, `col`, `row`, `offset_x`, `offset_y`),
	FOREIGN KEY (`map_id`) REFERENCES `map`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_map_element`("map_id", "col", "row", "offset_x", "offset_y", "kind", "variant") SELECT "map_id", "col", "row", 0, 0, "kind", "variant" FROM `map_element`;--> statement-breakpoint
DROP TABLE `map_element`;--> statement-breakpoint
ALTER TABLE `__new_map_element` RENAME TO `map_element`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `map_element_map_idx` ON `map_element` (`map_id`);