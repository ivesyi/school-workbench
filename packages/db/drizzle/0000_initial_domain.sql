CREATE TABLE `schools` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`current_stage_id` text,
	`baseline_snapshot_id` text,
	`current_snapshot_id` text,
	`created_at` text NOT NULL,
	`archived_at` text
);
