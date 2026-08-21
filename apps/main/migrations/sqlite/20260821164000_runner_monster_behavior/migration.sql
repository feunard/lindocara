ALTER TABLE `mapEvents` ADD `monster_pursuit_mode` text;--> statement-breakpoint
ALTER TABLE `mapEvents` ADD `monster_acceleration` real;--> statement-breakpoint
ALTER TABLE `mapEvents` ADD `monster_max_speed` real;--> statement-breakpoint
ALTER TABLE `mapEvents` ADD `monster_one_hit_kill` integer DEFAULT false NOT NULL;