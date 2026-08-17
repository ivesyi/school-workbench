CREATE TABLE `methodology_pack_criterion_verdicts` (
	`id` text PRIMARY KEY NOT NULL,
	`sign_off_id` text NOT NULL,
	`criterion_stable_key` text NOT NULL,
	`verdict` text NOT NULL,
	`note` text,
	`sequence` integer NOT NULL,
	FOREIGN KEY (`sign_off_id`) REFERENCES `methodology_pack_sign_offs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `methodology_pack_criterion_verdicts_criterion_unique` ON `methodology_pack_criterion_verdicts` (`sign_off_id`,`criterion_stable_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `methodology_pack_criterion_verdicts_sequence_unique` ON `methodology_pack_criterion_verdicts` (`sign_off_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `methodology_pack_sign_offs` (
	`id` text PRIMARY KEY NOT NULL,
	`pack_key` text NOT NULL,
	`pack_version` text NOT NULL,
	`content_hash` text NOT NULL,
	`decision` text NOT NULL,
	`note` text,
	`signed_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `methodology_pack_sign_offs_pack_idx` ON `methodology_pack_sign_offs` (`pack_key`,`pack_version`,`signed_at`);--> statement-breakpoint
CREATE INDEX `methodology_pack_sign_offs_content_idx` ON `methodology_pack_sign_offs` (`pack_key`,`pack_version`,`content_hash`);