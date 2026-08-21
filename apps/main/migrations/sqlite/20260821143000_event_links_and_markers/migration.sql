-- Linked passages are stored on both endpoints so authoring, deletion and bundle import keep the
-- pair atomic. Existing events retain their visible locator ring.
ALTER TABLE `mapEvents` ADD `linked_event_id` text;
ALTER TABLE `mapEvents` ADD `show_marker` integer DEFAULT true NOT NULL;
