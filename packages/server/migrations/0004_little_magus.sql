ALTER TABLE `character` ADD `appearance_body` text DEFAULT 'wayfarer' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `appearance_primary_color` text DEFAULT 'azure' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `main_hand` text DEFAULT 'weathered_sword' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `off_hand` text;--> statement-breakpoint
UPDATE `character`
SET `appearance_primary_color` = CASE
  WHEN `appearance` IN ('azure', 'ember', 'moss', 'violet') THEN `appearance`
  ELSE 'azure'
END;--> statement-breakpoint
UPDATE `character`
SET
  `main_hand` = CASE `class`
    WHEN 'ranger' THEN 'hunter_bow'
    WHEN 'priest' THEN 'heartwood_staff'
    ELSE 'weathered_sword'
  END,
  `off_hand` = CASE `class`
    WHEN 'warrior' THEN 'oak_shield'
    ELSE NULL
  END;
