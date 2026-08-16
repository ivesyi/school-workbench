CREATE TABLE `__new_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`focus` text NOT NULL,
	`sequence` integer NOT NULL,
	`status` text NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`adjustment_feedback` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_stages` (`id`, `school_id`, `title`, `summary`, `focus`, `sequence`, `status`, `starts_at`, `ends_at`, `adjustment_feedback`, `created_at`, `updated_at`)
SELECT `id`, `school_id`, `title`, `summary`, `focus`, 1, `status`, `activated_at`, NULL, `adjustment_feedback`, `created_at`, COALESCE(`activated_at`, `created_at`)
FROM `stages`;
--> statement-breakpoint
CREATE TABLE `__new_stage_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`stage_id` text NOT NULL,
	`school_id` text NOT NULL,
	`dimension_key` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`stage_id`) REFERENCES `__new_stages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_stage_targets` (`id`, `stage_id`, `school_id`, `dimension_key`, `title`, `description`, `status`, `sequence`, `created_at`, `updated_at`)
SELECT
	`id`,
	`stage_id`,
	`school_id`,
	CASE `dimension_key`
		WHEN 'critical_tasks' THEN 'key_tasks'
		WHEN 'structure_systems' THEN 'structure'
		WHEN 'capacity' THEN 'capability'
		ELSE `dimension_key`
	END,
	CASE `dimension_key`
		WHEN 'leadership' THEN '领导力'
		WHEN 'critical_tasks' THEN '关键任务'
		WHEN 'key_tasks' THEN '关键任务'
		WHEN 'structure_systems' THEN '结构与机制'
		WHEN 'structure' THEN '结构与机制'
		WHEN 'culture' THEN '文化'
		WHEN 'capacity' THEN '能力'
		WHEN 'capability' THEN '能力'
		ELSE `dimension_key`
	END,
	`text`,
	`status`,
	CASE `dimension_key`
		WHEN 'leadership' THEN 1
		WHEN 'critical_tasks' THEN 2
		WHEN 'key_tasks' THEN 2
		WHEN 'structure_systems' THEN 3
		WHEN 'structure' THEN 3
		WHEN 'culture' THEN 4
		WHEN 'capacity' THEN 5
		WHEN 'capability' THEN 5
		ELSE 99
	END,
	`created_at`,
	COALESCE(`confirmed_at`, `created_at`)
FROM `stage_targets`;
--> statement-breakpoint
CREATE TABLE `__new_stage_judgments` (
	`stage_id` text NOT NULL,
	`judgment_id` text NOT NULL,
	`sequence` integer NOT NULL,
	PRIMARY KEY(`stage_id`, `judgment_id`),
	FOREIGN KEY (`stage_id`) REFERENCES `__new_stages`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`judgment_id`) REFERENCES `accepted_judgments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_stage_judgments` (`stage_id`, `judgment_id`, `sequence`)
SELECT `stages`.`id`, `accepted_judgments`.`id`, CAST(`source`.`key` AS integer) + 1
FROM `stages`, json_each(`stages`.`source_judgment_ids_json`) AS `source`
JOIN `accepted_judgments`
	ON `accepted_judgments`.`id` = `source`.`value`
	AND `accepted_judgments`.`school_id` = `stages`.`school_id`;
--> statement-breakpoint
DROP TABLE `stage_targets`;
--> statement-breakpoint
DROP TABLE `stages`;
--> statement-breakpoint
ALTER TABLE `__new_stages` RENAME TO `stages`;
--> statement-breakpoint
ALTER TABLE `__new_stage_targets` RENAME TO `stage_targets`;
--> statement-breakpoint
ALTER TABLE `__new_stage_judgments` RENAME TO `stage_judgments`;
--> statement-breakpoint
CREATE UNIQUE INDEX `stages_school_sequence_unique` ON `stages` (`school_id`,`sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `stages_one_active_per_school` ON `stages` (`school_id`) WHERE "stages"."status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `stages_one_planned_per_school` ON `stages` (`school_id`) WHERE "stages"."status" = 'planned';
--> statement-breakpoint
CREATE UNIQUE INDEX `stage_targets_stage_dimension_unique` ON `stage_targets` (`stage_id`,`dimension_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `stage_targets_stage_sequence_unique` ON `stage_targets` (`stage_id`,`sequence`);
--> statement-breakpoint
CREATE UNIQUE INDEX `stage_judgments_stage_sequence_unique` ON `stage_judgments` (`stage_id`,`sequence`);
