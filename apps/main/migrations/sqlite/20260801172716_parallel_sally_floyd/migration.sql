-- Existing rows intentionally stay NULL: the shipped maps use species-native attacks. NULL is the
-- compatibility value resolved from species, so legacy maps load without reintroducing asset-name
-- inference into the runtime.
ALTER TABLE `mapEvents` ADD `monster_attack_profile` text;
