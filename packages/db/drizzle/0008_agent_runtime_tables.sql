CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`school_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`ended_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_runs_status_frozen" CHECK("agent_runs"."status" IN ('queued', 'running', 'needs_input', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`school_id` text NOT NULL,
	`runtime_profile_id` text NOT NULL,
	`acp_session_id` text,
	`cwd` text NOT NULL,
	`compatibility` text NOT NULL,
	`protocol_version` integer,
	`agent_name` text,
	`agent_version` text,
	`created_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`school_id`) REFERENCES `schools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runtime_profile_id`) REFERENCES `runtime_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_sessions_compatibility_frozen" CHECK("agent_sessions"."compatibility" IN ('verified', 'compatible', 'unsupported'))
);
--> statement-breakpoint
CREATE TABLE `runtime_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`display_name` text NOT NULL,
	`transport` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "runtime_profiles_transport_acp" CHECK("runtime_profiles"."transport" = 'acp')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_profiles_key_unique` ON `runtime_profiles` (`key`);