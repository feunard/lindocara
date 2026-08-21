-- The previous migration placed two ALTER TABLE statements in one Drizzle statement. The
-- node:sqlite runner executed and journalled only the first one in production, so linked_event_id
-- exists there but show_marker does not. Keep the repair as one statement so every existing Bay
-- database and every fresh install converge on the entity schema.
ALTER TABLE `mapEvents` ADD `show_marker` integer DEFAULT true NOT NULL;
