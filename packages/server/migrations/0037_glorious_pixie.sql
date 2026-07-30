ALTER TABLE `character` ADD `combat_stat_bonuses` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `character` ADD `combat_stat_boosts` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `hero` ADD `combat_stat_bonuses` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `hero` ADD `combat_stat_boosts` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `item_definition`
  (`id`, `type`, `stackable`, `max_stack`, `equipment_slot`, `allowed_class`)
VALUES
  ('evasion_tonic', 'consumable', 1, 9999, NULL, NULL),
  ('parrying_oil', 'consumable', 1, 9999, NULL, NULL),
  ('stoneskin_tonic', 'consumable', 1, 9999, NULL, NULL),
  ('arcane_ward_tonic', 'consumable', 1, 9999, NULL, NULL),
  ('precision_tonic', 'consumable', 1, 9999, NULL, NULL),
  ('evasion_manual', 'consumable', 1, 9999, NULL, NULL),
  ('parrying_manual', 'consumable', 1, 9999, NULL, NULL),
  ('physical_resistance_manual', 'consumable', 1, 9999, NULL, NULL),
  ('magical_resistance_manual', 'consumable', 1, 9999, NULL, NULL),
  ('critical_manual', 'consumable', 1, 9999, NULL, NULL);
