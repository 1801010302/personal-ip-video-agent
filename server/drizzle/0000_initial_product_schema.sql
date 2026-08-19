CREATE TABLE `access_grants` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source` text DEFAULT 'invite_code' NOT NULL,
	`granted_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`revoked_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `access_grants_status_idx` ON `access_grants` (`status`);--> statement-breakpoint
CREATE TABLE `app_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`role` text DEFAULT 'user' NOT NULL,
	`onboarding_step` text DEFAULT 'activate' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_profiles_role_idx` ON `app_profiles` (`role`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`safe_metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_logs_actor_created_idx` ON `audit_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_logs_target_idx` ON `audit_logs` (`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`type` text NOT NULL,
	`provider_job_id` text,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`estimated_points` integer,
	`final_points` integer,
	`request_id` text,
	`error_code` text,
	`error_message` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generation_jobs_user_idempotency_unique` ON `generation_jobs` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `generation_jobs_user_updated_idx` ON `generation_jobs` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `generation_jobs_project_idx` ON `generation_jobs` (`project_id`);--> statement-breakpoint
CREATE TABLE `invite_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_digest` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`max_uses` integer,
	`used_count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_codes_digest_unique` ON `invite_codes` (`code_digest`);--> statement-breakpoint
CREATE INDEX `invite_codes_status_expires_idx` ON `invite_codes` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `invite_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`invite_code_id` text NOT NULL,
	`user_id` text NOT NULL,
	`redeemed_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invite_code_id`) REFERENCES `invite_codes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_redemptions_user_unique` ON `invite_redemptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `invite_redemptions_code_idx` ON `invite_redemptions` (`invite_code_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`raw_ideas` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `projects_user_updated_idx` ON `projects` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `projects_user_status_idx` ON `projects` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `provider_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text DEFAULT 'chuanshenyun' NOT NULL,
	`provider_asset_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`sha256` text,
	`status` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_assets_user_provider_asset_unique` ON `provider_assets` (`user_id`,`provider`,`provider_asset_id`);--> statement-breakpoint
CREATE INDEX `provider_assets_user_kind_idx` ON `provider_assets` (`user_id`,`kind`);--> statement-breakpoint
CREATE INDEX `provider_assets_user_hash_idx` ON `provider_assets` (`user_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `provider_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`ciphertext` text NOT NULL,
	`iv` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`key_prefix` text NOT NULL,
	`key_last4` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`available_points` integer,
	`frozen_points` integer,
	`verified_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_credentials_user_provider_unique` ON `provider_credentials` (`user_id`,`provider`);--> statement-breakpoint
CREATE INDEX `provider_credentials_user_status_idx` ON `provider_credentials` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `script_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`content` text NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`source` text DEFAULT 'deepseek' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `script_versions_project_created_idx` ON `script_versions` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `video_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`generation_job_id` text NOT NULL,
	`provider_asset_id` text,
	`provider_expires_at` integer,
	`r2_uri` text,
	`status` text DEFAULT 'available' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`generation_job_id`) REFERENCES `generation_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `video_outputs_user_created_idx` ON `video_outputs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `video_outputs_job_unique` ON `video_outputs` (`generation_job_id`);--> statement-breakpoint
CREATE TABLE `voice_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider_profile_id` text NOT NULL,
	`reference_asset_id` text,
	`name` text NOT NULL,
	`prompt_text` text,
	`status` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_asset_id`) REFERENCES `provider_assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voice_profiles_user_provider_profile_unique` ON `voice_profiles` (`user_id`,`provider_profile_id`);--> statement-breakpoint
CREATE INDEX `voice_profiles_user_status_idx` ON `voice_profiles` (`user_id`,`status`);