CREATE TABLE `assessment_judgments` (
	`assessment_id` text NOT NULL,
	`judgment_id` text NOT NULL,
	PRIMARY KEY(`assessment_id`, `judgment_id`),
	FOREIGN KEY (`assessment_id`) REFERENCES `dimension_assessments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`judgment_id`) REFERENCES `accepted_judgments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dimension_assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`dimension_key` text NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `state_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dimension_assessments_snapshot_dimension_unique` ON `dimension_assessments` (`snapshot_id`,`dimension_key`);--> statement-breakpoint
CREATE TABLE `snapshot_judgments` (
	`snapshot_id` text NOT NULL,
	`judgment_id` text NOT NULL,
	PRIMARY KEY(`snapshot_id`, `judgment_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `state_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`judgment_id`) REFERENCES `accepted_judgments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `state_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`stage_id` text,
	`previous_snapshot_id` text,
	`sequence` integer NOT NULL,
	`summary` text NOT NULL,
	`is_baseline` integer DEFAULT false NOT NULL,
	`confirmed_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stage_id`) REFERENCES `stages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`previous_snapshot_id`) REFERENCES `state_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `state_snapshots_school_sequence_unique` ON `state_snapshots` (`school_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `state_snapshots_one_baseline_per_school` ON `state_snapshots` (`school_id`) WHERE "state_snapshots"."is_baseline" = 1;