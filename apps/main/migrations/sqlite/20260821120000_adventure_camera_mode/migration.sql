-- Existing adventures keep the authored HD-2D composition. Only an explicit editor choice opts an
-- adventure into full yaw + pitch controls.
ALTER TABLE `adventures` ADD `camera_mode` text DEFAULT 'hd2d' NOT NULL;
