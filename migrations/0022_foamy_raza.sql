-- UX wave #5: a map belongs to exactly ONE adventure. The `adventure_map` n-n table dies and
-- `map.adventure_id` (NOT NULL, cascade) replaces it. This migration attributes every map to the
-- single adventure that referenced it; a map referenced by SEVERAL adventures is DUPLICATED (a new
-- map row plus copies of its map_element / map_event / map_event_page children) once per extra
-- adventure, and that adventure's graph is rewritten to point at the copy; a map referenced by NO
-- adventure is DROPPED. Orphan drop is a POC decision — no production map is expected to be
-- orphaned, and an unreachable authored map has no home under the 1-adventure model.
--
-- `adventure_id` is introduced only in the rebuilt table (like `account_id` was in 0016): SQLite
-- refuses `ADD COLUMN ... NOT NULL` without a default, and a NULL default would defeat the point.
-- The attribution therefore runs against `adventure_map` while it still exists, and the rebuild's
-- INSERT..SELECT reads the owner straight out of it.

-- 1. Resolve multi-references by duplication. `__dup` maps each EXTRA (adventure, map) pair — every
--    reference beyond the primary (lowest adventure id) — to a freshly minted map id. Nothing
--    happens here for the common single-reference map: it is simply attributed in step 2's rebuild.
CREATE TABLE `__dup` (`old_map_id` text, `adventure_id` text, `new_map_id` text, `position` integer);--> statement-breakpoint
INSERT INTO `__dup` (`old_map_id`, `adventure_id`, `new_map_id`, `position`)
SELECT am.`map_id`, am.`adventure_id`, lower(hex(randomblob(16))), am.`position`
FROM `adventure_map` AS am
WHERE am.`map_id` IN (SELECT `map_id` FROM `adventure_map` GROUP BY `map_id` HAVING count(*) > 1)
  AND am.`adventure_id` <> (
    SELECT min(am2.`adventure_id`) FROM `adventure_map` AS am2 WHERE am2.`map_id` = am.`map_id`
  );--> statement-breakpoint
-- Copy the map rows themselves. `adventure_id` is not a column on `map` yet, so it is not written
-- here; the new rows get their owner from the rewritten `adventure_map` memberships below.
INSERT INTO `map` (`id`, `account_id`, `name`, `cols`, `rows`, `tileset_id`, `layers`, `spawn_col`, `spawn_row`, `markers`, `revision`, `is_first`, `created_at`, `updated_at`)
SELECT d.`new_map_id`, m.`account_id`, m.`name`, m.`cols`, m.`rows`, m.`tileset_id`, m.`layers`, m.`spawn_col`, m.`spawn_row`, m.`markers`, m.`revision`, 0, m.`created_at`, m.`updated_at`
FROM `__dup` d JOIN `map` m ON m.`id` = d.`old_map_id`;--> statement-breakpoint
-- Copy the scenery children onto the duplicated maps.
INSERT INTO `map_element` (`map_id`, `col`, `row`, `kind`, `variant`)
SELECT d.`new_map_id`, e.`col`, e.`row`, e.`kind`, e.`variant`
FROM `__dup` d JOIN `map_element` e ON e.`map_id` = d.`old_map_id`;--> statement-breakpoint
-- Copy the events. Events carry their own pk, so a duplicate needs a fresh event id; `__dupev`
-- keeps the old->new event id map so the pages below re-parent onto the copies.
CREATE TABLE `__dupev` (`old_event_id` text, `new_event_id` text, `new_map_id` text);--> statement-breakpoint
INSERT INTO `__dupev` (`old_event_id`, `new_event_id`, `new_map_id`)
SELECT ev.`id`, lower(hex(randomblob(16))), d.`new_map_id`
FROM `__dup` d JOIN `map_event` ev ON ev.`map_id` = d.`old_map_id`;--> statement-breakpoint
INSERT INTO `map_event` (`id`, `map_id`, `col`, `row`, `name`, `ordinal`, `created_at`)
SELECT de.`new_event_id`, de.`new_map_id`, ev.`col`, ev.`row`, ev.`name`, ev.`ordinal`, ev.`created_at`
FROM `__dupev` de JOIN `map_event` ev ON ev.`id` = de.`old_event_id`;--> statement-breakpoint
INSERT INTO `map_event_page` (`id`, `event_id`, `position`, `cond_switch_id`, `cond_variable_id`, `cond_variable_min`, `cond_self_switch`, `graphic_asset_id`, `move_type`, `move_speed`, `move_freq`, `opt_move_anim`, `opt_stop_anim`, `opt_dir_fix`, `opt_through`, `opt_on_top`, `trigger`)
SELECT lower(hex(randomblob(16))), de.`new_event_id`, p.`position`, p.`cond_switch_id`, p.`cond_variable_id`, p.`cond_variable_min`, p.`cond_self_switch`, p.`graphic_asset_id`, p.`move_type`, p.`move_speed`, p.`move_freq`, p.`opt_move_anim`, p.`opt_stop_anim`, p.`opt_dir_fix`, p.`opt_through`, p.`opt_on_top`, p.`trigger`
FROM `__dupev` de JOIN `map_event_page` p ON p.`event_id` = de.`old_event_id`;--> statement-breakpoint
-- Rewrite each extra adventure's graph to reference its copy. Map ids are unique 32-char strings,
-- so a plain REPLACE over the graph JSON hits every occurrence (start + links + destinations). An
-- adventure that duplicated two or more maps only has its first rewrite applied here — a known POC
-- gap the tested pure planner (map-ownership-migrate.ts) handles in full; production has none.
UPDATE `adventure`
SET `graph` = (
  SELECT REPLACE(`adventure`.`graph`, d.`old_map_id`, d.`new_map_id`)
  FROM `__dup` d WHERE d.`adventure_id` = `adventure`.`id` LIMIT 1
)
WHERE `id` IN (SELECT `adventure_id` FROM `__dup`);--> statement-breakpoint
-- Re-point the extra memberships from the shared original to the copy, so step 2 attributes the
-- copy to the extra adventure and the original stays with its primary adventure alone.
DELETE FROM `adventure_map` WHERE (`adventure_id`, `map_id`) IN (SELECT `adventure_id`, `old_map_id` FROM `__dup`);--> statement-breakpoint
INSERT INTO `adventure_map` (`adventure_id`, `map_id`, `position`)
SELECT `adventure_id`, `new_map_id`, `position` FROM `__dup`;--> statement-breakpoint

-- 2. Rebuild `map` with the NOT NULL `adventure_id`, reading the owner out of `adventure_map`. A map
--    with no membership yields NULL and is excluded — that is the orphan drop.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_map` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`adventure_id` text NOT NULL,
	`name` text NOT NULL,
	`cols` integer NOT NULL,
	`rows` integer NOT NULL,
	`tileset_id` text DEFAULT 'tiny-swords' NOT NULL,
	`layers` text NOT NULL,
	`spawn_col` integer NOT NULL,
	`spawn_row` integer NOT NULL,
	`markers` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_first` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`adventure_id`) REFERENCES `adventure`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "map_revision_positive" CHECK("__new_map"."revision" >= 1)
);--> statement-breakpoint
INSERT INTO `__new_map`(`id`, `account_id`, `adventure_id`, `name`, `cols`, `rows`, `tileset_id`, `layers`, `spawn_col`, `spawn_row`, `markers`, `revision`, `is_first`, `created_at`, `updated_at`)
SELECT
	old_map.`id`,
	old_map.`account_id`,
	(SELECT membership.`adventure_id` FROM `adventure_map` AS membership WHERE membership.`map_id` = old_map.`id` LIMIT 1),
	old_map.`name`,
	old_map.`cols`,
	old_map.`rows`,
	old_map.`tileset_id`,
	old_map.`layers`,
	old_map.`spawn_col`,
	old_map.`spawn_row`,
	old_map.`markers`,
	old_map.`revision`,
	old_map.`is_first`,
	old_map.`created_at`,
	old_map.`updated_at`
FROM `map` AS old_map
WHERE EXISTS (SELECT 1 FROM `adventure_map` AS membership WHERE membership.`map_id` = old_map.`id`);--> statement-breakpoint
DROP TABLE `map`;--> statement-breakpoint
ALTER TABLE `__new_map` RENAME TO `map`;--> statement-breakpoint
-- Orphan children of dropped maps are now dangling (their parent was not carried over). Clear them
-- explicitly while foreign keys are off; map_event's pages are cleared alongside it.
DELETE FROM `map_element` WHERE `map_id` NOT IN (SELECT `id` FROM `map`);--> statement-breakpoint
DELETE FROM `map_event` WHERE `map_id` NOT IN (SELECT `id` FROM `map`);--> statement-breakpoint
DELETE FROM `map_event_page` WHERE `event_id` NOT IN (SELECT `id` FROM `map_event`);--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `map_account_idx` ON `map` (`account_id`);--> statement-breakpoint
CREATE INDEX `map_adventure_idx` ON `map` (`adventure_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `map_account_first_unique` ON `map` (`account_id`) WHERE "map"."is_first" = 1 AND "map"."account_id" IS NOT NULL;--> statement-breakpoint

-- 3. The n-n table and the temp scaffolding are done.
DROP TABLE `__dup`;--> statement-breakpoint
DROP TABLE `__dupev`;--> statement-breakpoint
DROP TABLE `adventure_map`;
