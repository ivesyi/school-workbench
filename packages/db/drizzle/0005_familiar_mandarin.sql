CREATE TABLE `behavior_anchors` (
	`id` text PRIMARY KEY NOT NULL,
	`criterion_id` text NOT NULL,
	`level_key` text NOT NULL,
	`label` text NOT NULL,
	`description` text NOT NULL,
	`source_locator_json` text NOT NULL,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`criterion_id`) REFERENCES `methodology_criteria`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `behavior_anchors_criterion_level_unique` ON `behavior_anchors` (`criterion_id`,`level_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `behavior_anchors_criterion_sequence_unique` ON `behavior_anchors` (`criterion_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `methodology_criteria` (
	`id` text PRIMARY KEY NOT NULL,
	`pack_id` text NOT NULL,
	`stable_key` text NOT NULL,
	`parent_id` text,
	`construct_key` text NOT NULL,
	`dimension_key` text,
	`practice_type` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`evidence_guidance_json` text NOT NULL,
	`counter_indicators_json` text NOT NULL,
	`guardrails_json` text NOT NULL,
	`source_locator_json` text NOT NULL,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`pack_id`) REFERENCES `methodology_packs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `methodology_criteria`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `methodology_criteria_pack_stable_unique` ON `methodology_criteria` (`pack_id`,`stable_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `methodology_criteria_pack_sequence_unique` ON `methodology_criteria` (`pack_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `methodology_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`version` text NOT NULL,
	`title` text NOT NULL,
	`source_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`content_hash` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `methodology_packs_key_version_unique` ON `methodology_packs` (`key`,`version`);