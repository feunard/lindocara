CREATE TABLE `harvestGoldClaims` (
	`id` text PRIMARY KEY,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`party_id` text NOT NULL,
	`node_id` text NOT NULL,
	`generation` integer NOT NULL,
	`recipient_hero_id` text NOT NULL,
	`amount` integer NOT NULL,
	CONSTRAINT `fk_harvestGoldClaims_party_id_parties_id_fk` FOREIGN KEY (`party_id`) REFERENCES `parties`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_harvestGoldClaims_recipient_hero_id_heroes_id_fk` FOREIGN KEY (`recipient_hero_id`) REFERENCES `heroes`(`id`) ON DELETE CASCADE,
	CONSTRAINT "harvest_gold_generation_nonnegative" CHECK(generation >= 0),
	CONSTRAINT "harvest_gold_amount_positive" CHECK(amount > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `harvest_gold_party_node_generation_unique` ON `harvestGoldClaims` (`party_id`,`node_id`,`generation`);--> statement-breakpoint
CREATE INDEX `harvest_gold_recipient_idx` ON `harvestGoldClaims` (`recipient_hero_id`);