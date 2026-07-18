ALTER TABLE `map` ADD `tileset_id` text DEFAULT 'tiny-swords' NOT NULL;--> statement-breakpoint
-- SQLite refuses `ADD COLUMN ... NOT NULL` without a default, so `layers` arrives with an empty
-- default that the UPDATE below immediately replaces. The empty string is never a valid layer.
ALTER TABLE `map` ADD `layers` text DEFAULT '' NOT NULL;--> statement-breakpoint
-- POC: no production maps exist. Rows carried over from the `blocks` era (dropped in 0017) keep
-- their size and lose their terrain; they are re-drawn in the editor, not migrated. The value
-- written is a *valid* three-layer payload of all-empty cells rather than '', because
-- `decodeLayers` degrades a malformed row to empty layers silently and would hide the problem.
UPDATE `map` SET `layers` = '["0*' || (`cols` * `rows`) || '","0*' || (`cols` * `rows`) || '","0*' || (`cols` * `rows`) || '"]' WHERE `layers` = '';
