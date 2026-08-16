CREATE TABLE `stage_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`stage_id` text NOT NULL,
	`school_id` text NOT NULL,
	`dimension_key` text NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`confirmed_at` text,
	FOREIGN KEY (`stage_id`) REFERENCES `stages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stage_targets_stage_dimension_unique` ON `stage_targets` (`stage_id`,`dimension_key`);--> statement-breakpoint
CREATE TABLE `stages` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`focus` text NOT NULL,
	`status` text NOT NULL,
	`source_judgment_ids_json` text NOT NULL,
	`adjustment_feedback` text,
	`created_at` text NOT NULL,
	`activated_at` text,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stages_one_active_per_school` ON `stages` (`school_id`) WHERE "stages"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `stages_one_planned_per_school` ON `stages` (`school_id`) WHERE "stages"."status" = 'planned';--> statement-breakpoint
CREATE UNIQUE INDEX `human_reviews_proposal_id_unique` ON `human_reviews` (`proposal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accepted_judgments_review_id_unique` ON `accepted_judgments` (`review_id`);