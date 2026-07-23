CREATE TABLE `adventure_test_session` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`adventure_id` text NOT NULL,
	`party_id` text NOT NULL,
	`start_map_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`adventure_id`) REFERENCES `adventure`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`party_id`) REFERENCES `party`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `adventure_test_session_account_unique` ON `adventure_test_session` (`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `adventure_test_session_party_unique` ON `adventure_test_session` (`party_id`);--> statement-breakpoint
CREATE INDEX `adventure_test_session_expiry_idx` ON `adventure_test_session` (`expires_at`);