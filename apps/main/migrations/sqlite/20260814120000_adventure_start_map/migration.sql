-- Written by hand because `alepha db migrations create` cannot run in this repo (a top-level
-- `await` inside an `if` in `apps/main/src/main.ts` defeats drizzle-kit's bundling, and every
-- `alepha db` command boots that entry). `npm run check:migrations` is unaffected and is the gate.
--
-- The two UPDATEs reproduce, once and in SQL, the derivation `HeroService.resolveHeroStart` used to
-- perform on every join: tier 1 the earliest-created member map carrying a spawn event, then tier 2
-- the legacy `graph.start` map. Tier 3 (the earliest member map) is deliberately NOT baked in —
-- that is what a NULL column already means, and writing it would freeze a fallback that should stay
-- live. Without this backfill, deleting tier 1 in the next commit would silently restart every
-- published adventure on its oldest map.
ALTER TABLE `adventures` ADD `start_map_id` text;--> statement-breakpoint
UPDATE `adventures` SET `start_map_id` = (
  SELECT m.`id` FROM `maps` m
  JOIN `mapEvents` e ON e.`map_id` = m.`id`
  WHERE m.`adventure_id` = `adventures`.`id` AND e.`kind` = 'spawn'
  ORDER BY m.`created_at`
  LIMIT 1
) WHERE `start_map_id` IS NULL;--> statement-breakpoint
UPDATE `adventures` SET `start_map_id` = (
  SELECT m.`id` FROM `maps` m
  WHERE m.`adventure_id` = `adventures`.`id`
    AND m.`id` = json_extract(`adventures`.`graph`, '$.start.mapId')
) WHERE `start_map_id` IS NULL;
