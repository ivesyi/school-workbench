CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`source_type` text NOT NULL,
	`uri` text,
	`inline_text` text,
	`title` text NOT NULL,
	`locator_json` text,
	`content_hash` text,
	`captured_at` text,
	`registered_by` text NOT NULL,
	`agent_run_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `observation_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`fact_type` text NOT NULL,
	`text` text NOT NULL,
	`locator_json` text NOT NULL,
	`directness` text NOT NULL,
	`extracted_by` text NOT NULL,
	`agent_run_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`subject_ref_json` text NOT NULL,
	`predicate_key` text NOT NULL,
	`object_ref_json` text,
	`statement` text NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`scope_json` text NOT NULL,
	`created_by` text NOT NULL,
	`agent_run_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `claim_facts` (
	`claim_id` text NOT NULL,
	`fact_id` text NOT NULL,
	`stance` text NOT NULL,
	`sequence` integer NOT NULL,
	PRIMARY KEY(`claim_id`, `fact_id`, `stance`),
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fact_id`) REFERENCES `observation_facts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `diagnosis_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`agent_run_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`scope_json` text NOT NULL,
	`interpretations_json` text NOT NULL,
	`provisional_judgment` text,
	`mechanism` text,
	`alternative_hypotheses_json` text NOT NULL,
	`unresolved_questions_json` text NOT NULL,
	`recommended_actions_json` text NOT NULL,
	`next_observations_json` text NOT NULL,
	`impact_evidence_plan_json` text NOT NULL,
	`evidence_quality_json` text NOT NULL,
	`confidence` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `diagnosis_claims` (
	`proposal_id` text NOT NULL,
	`claim_id` text NOT NULL,
	PRIMARY KEY(`proposal_id`, `claim_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `diagnosis_proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `human_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`proposal_id` text NOT NULL UNIQUE,
	`decision` text NOT NULL,
	`feedback` text,
	`final_text` text,
	`reason` text,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`proposal_id`) REFERENCES `diagnosis_proposals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `accepted_judgments` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`review_id` text NOT NULL UNIQUE,
	`statement` text NOT NULL,
	`scope_json` text NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`review_id`) REFERENCES `human_reviews`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `judgment_claims` (
	`judgment_id` text NOT NULL,
	`claim_id` text NOT NULL,
	PRIMARY KEY(`judgment_id`, `claim_id`),
	FOREIGN KEY (`judgment_id`) REFERENCES `accepted_judgments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade
);
