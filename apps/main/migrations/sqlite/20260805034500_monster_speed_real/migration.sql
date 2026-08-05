-- `mapEvents.monster_speed` becomes `real`.
--
-- A monster's speed is TILES per second now, not pixels, and the bestiary's values are exact
-- quotients of the former pixel numbers (105/64, 88/64, ...) — no longer whole numbers. The stored
-- column was `integer`, which in SQLite is a type affinity rather than a constraint, so existing
-- rows read back unchanged and no value is converted here: authored maps keep whatever they
-- authored, and the map boundary converts them with the rest of the authored geometry.
--
-- Every other tuning column beside it is still a whole number and is untouched. Written by hand
-- because `alepha db migrations create` cannot run in this repo (a top-level `await` inside an `if`
-- in `apps/main/src/main.ts` defeats drizzle-kit's bundling); the statements below are verbatim
-- what `alepha db migrations check` reported as the drift.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mapEvents` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`map_id` text NOT NULL,
	`col` integer NOT NULL,
	`row` integer NOT NULL,
	`name` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text DEFAULT 'normal' NOT NULL,
	`species` text,
	`patrol_radius` integer,
	`monster_rank` text,
	`monster_max_hp` integer,
	`monster_damage` integer,
	`monster_speed` real,
	`monster_xp` integer,
	`monster_weakness` text,
	`monster_weakness_percent` integer,
	`monster_special_technique` text,
	`monster_attack_profile` text,
	`monster_respawn_mode` text,
	`monster_respawn_delay_ms` integer,
	`harvest_profile` text,
	CONSTRAINT `fk_mapEvents_map_id_maps_id_fk` FOREIGN KEY (`map_id`) REFERENCES `maps`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_mapEvents`(`id`, `created_at`, `map_id`, `col`, `row`, `name`, `ordinal`, `kind`, `species`, `patrol_radius`, `monster_rank`, `monster_max_hp`, `monster_damage`, `monster_speed`, `monster_xp`, `monster_weakness`, `monster_weakness_percent`, `monster_special_technique`, `monster_attack_profile`, `monster_respawn_mode`, `monster_respawn_delay_ms`, `harvest_profile`) SELECT `id`, `created_at`, `map_id`, `col`, `row`, `name`, `ordinal`, `kind`, `species`, `patrol_radius`, `monster_rank`, `monster_max_hp`, `monster_damage`, `monster_speed`, `monster_xp`, `monster_weakness`, `monster_weakness_percent`, `monster_special_technique`, `monster_attack_profile`, `monster_respawn_mode`, `monster_respawn_delay_ms`, `harvest_profile` FROM `mapEvents`;--> statement-breakpoint
DROP TABLE `mapEvents`;--> statement-breakpoint
ALTER TABLE `__new_mapEvents` RENAME TO `mapEvents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `map_event_cell_unique` ON `mapEvents` (`map_id`,`col`,`row`);--> statement-breakpoint
CREATE INDEX `map_event_map_idx` ON `mapEvents` (`map_id`);
