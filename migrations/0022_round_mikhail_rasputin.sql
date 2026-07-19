-- UX wave #12 / Task 5: markers become typed events. This adds the three kind columns; every
-- existing event is `normal` by the column default. The data transform (old markers -> entry/exit/
-- monster events + rewriting each adventure graph's marker-id bindings to the new event uuids) is
-- `migrateMarkersToEvents` / `planMarkerEventMigration` (server/map-marker-event-migrate.ts), which
-- mints v4 uuids and rewrites graph JSON — work SQL cannot do. The runtime-equivalence proof drives
-- that runner against a live D1. Production wiring of the runner is a documented POC gap (no
-- production authored-map data; the exit-gate campaign rebuilds adventures from scratch on the new
-- event model). Same split as migration 0021's planner-vs-SQL gap.
ALTER TABLE `map_event` ADD `kind` text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE `map_event` ADD `species` text;--> statement-breakpoint
ALTER TABLE `map_event` ADD `patrol_radius` integer;