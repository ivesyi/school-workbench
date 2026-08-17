CREATE TABLE `diagnosis_criteria` (
	`proposal_id` text NOT NULL,
	`criterion_id` text NOT NULL,
	PRIMARY KEY(`proposal_id`, `criterion_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `diagnosis_proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`criterion_id`) REFERENCES `methodology_criteria`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `diagnosis_stage_targets` (
	`proposal_id` text NOT NULL,
	`stage_target_id` text NOT NULL,
	PRIMARY KEY(`proposal_id`, `stage_target_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `diagnosis_proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stage_target_id`) REFERENCES `stage_targets`(`id`) ON UPDATE no action ON DELETE no action
);
