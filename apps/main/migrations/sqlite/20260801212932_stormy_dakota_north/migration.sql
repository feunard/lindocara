ALTER TABLE `harvestGoldClaims` ADD `earned_session_epoch` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `harvestGoldClaims` ADD `ledger_amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `harvestGoldClaims` ADD `ledger_status` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `harvestGoldClaims` ADD `settled_at` integer;--> statement-breakpoint
-- Claims created before this ledger already contributed directly to heroes.gold. The legacy
-- discriminator keeps them out of SUM(ledger_amount), including writes from an older rolling
-- Worker that omits the new columns, so no deployment path can credit them twice.
UPDATE `harvestGoldClaims`
SET `settled_at` = `created_at`
WHERE `ledger_status` = 'legacy' AND `settled_at` IS NULL;
