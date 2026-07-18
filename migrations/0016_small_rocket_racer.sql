PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_map` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`name` text NOT NULL,
	`cols` integer NOT NULL,
	`rows` integer NOT NULL,
	`blocks` text NOT NULL,
	`spawn_col` integer NOT NULL,
	`spawn_row` integer NOT NULL,
	`markers` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_first` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "map_revision_positive" CHECK("__new_map"."revision" >= 1)
);
--> statement-breakpoint
-- Historical maps had no owner. Attribute a row only when every adventure that references it has
-- the same author; unreferenced and cross-author rows stay NULL and are quarantined by all
-- account-facing queries. No historical map becomes implicitly public.
INSERT INTO `__new_map`("id", "account_id", "name", "cols", "rows", "blocks", "spawn_col", "spawn_row", "markers", "revision", "is_first", "created_at", "updated_at")
SELECT
	old_map."id",
	(
		SELECT CASE
			WHEN count(DISTINCT owner_adventure."account_id") = 1 THEN min(owner_adventure."account_id")
			ELSE NULL
		END
		FROM "adventure_map" AS membership
		INNER JOIN "adventure" AS owner_adventure ON owner_adventure."id" = membership."adventure_id"
		WHERE membership."map_id" = old_map."id"
	),
	old_map."name",
	old_map."cols",
	old_map."rows",
	old_map."blocks",
	old_map."spawn_col",
	old_map."spawn_row",
	old_map."markers",
	1,
	old_map."is_first",
	old_map."created_at",
	old_map."updated_at"
FROM `map` AS old_map;--> statement-breakpoint
DROP TABLE `map`;--> statement-breakpoint
ALTER TABLE `__new_map` RENAME TO `map`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `map_account_idx` ON `map` (`account_id`);--> statement-breakpoint
UPDATE `map` SET `is_first` = 0;--> statement-breakpoint
UPDATE `map`
SET `is_first` = 1
WHERE `account_id` IS NOT NULL
  AND `id` = (
	SELECT candidate.`id`
	FROM `map` AS candidate
	WHERE candidate.`account_id` = `map`.`account_id`
	ORDER BY candidate.`created_at` ASC, candidate.`id` ASC
	LIMIT 1
  );--> statement-breakpoint
CREATE UNIQUE INDEX `map_account_first_unique` ON `map` (`account_id`) WHERE "map"."is_first" = 1 AND "map"."account_id" IS NOT NULL;
