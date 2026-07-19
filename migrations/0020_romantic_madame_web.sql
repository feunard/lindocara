CREATE TABLE `party_adventure_state` (
	`party_id` text PRIMARY KEY NOT NULL,
	`switches` text NOT NULL,
	`variables` text NOT NULL,
	`self_switches` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`party_id`) REFERENCES `party`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `adventure` ADD `registry` text DEFAULT '' NOT NULL;