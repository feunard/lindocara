-- The hero row gains its third axis, and every stored position is RESET rather than converted.
--
-- The world moved to TILE units with the grid centre as origin: `x` and `z` are the two GROUND
-- axes and `y` is ELEVATION. In the pixel world `y` was the second GROUND axis, so the two columns
-- that already exist do not mean what they used to, and `corpse_x`/`corpse_y` are in the same
-- position.
--
-- THE RESET IS NOT DATA LOSS, IT IS THE ONLY SAFE READING. A stored `2176` was 2176 pixels, i.e.
-- 34 tiles; read as tile units it is 2176 TILES, which is thirty-four times the width of the
-- largest grid a map can have. There is no conversion available either: the pixel coordinate was
-- anchored at the map's top-left corner and a tile-unit grid is anchored at its centre, so the
-- shift depends on a grid size the hero row does not carry, and the tile map the hero was standing
-- on no longer exists as geometry at all (a room's collision is baked from its heightfield now).
-- `0,0,0` is the grid CENTRE in the new system, and admission does not take it literally: it seats
-- the body on the map's own authored spawn, or on the standable cell nearest to it
-- (`mapEntryPosition`, `packages/engine/src/terrain-access.ts`). A hero therefore lands somewhere
-- sane rather than at a coordinate 64 times too large, or in the sea.
--
-- Death is reset with it: a corpse whose coordinates cannot be trusted would send a ghost walking
-- to a point on no map. Clearing `life` back to `alive` alongside the two corpse columns is what
-- keeps the pair consistent — `restoredLife` refuses to restore a corpse with a missing axis, and
-- a hero flagged dead with no body to walk back to is unplayable.
--
-- Written by hand because `alepha db migrations create` cannot run in this repo (a top-level
-- `await` inside an `if` in `apps/main/src/main.ts` defeats drizzle-kit's bundling); the two ALTER
-- statements below are verbatim what `alepha db migrations check` reported as the drift.
ALTER TABLE `heroes` ADD `z` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `heroes` ADD `corpse_z` real;--> statement-breakpoint
UPDATE `heroes` SET `x` = 0, `y` = 0, `z` = 0, `life` = 'alive', `corpse_x` = NULL, `corpse_y` = NULL, `corpse_z` = NULL;
