ALTER TABLE `character` ADD `persistence_version` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `character` SET `persistence_version` = 1;
