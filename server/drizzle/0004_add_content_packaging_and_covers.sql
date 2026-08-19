CREATE TABLE `cover_references` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`object_path` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text DEFAULT 'uploading' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `cover_references_user_updated_idx` ON `cover_references` (`user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `cover_references_project_idx` ON `cover_references` (`project_id`);--> statement-breakpoint
CREATE TABLE `script_analyses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`script_version_id` text NOT NULL,
	`core_title` text NOT NULL,
	`alternative_titles_json` text DEFAULT '[]' NOT NULL,
	`cover_subtitle` text DEFAULT '' NOT NULL,
	`keywords_json` text DEFAULT '[]' NOT NULL,
	`content_type` text DEFAULT '观点口播' NOT NULL,
	`emotion` text DEFAULT '有力量' NOT NULL,
	`animation_plan_json` text DEFAULT '[]' NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`script_version_id`) REFERENCES `script_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `script_analyses_version_unique` ON `script_analyses` (`script_version_id`);--> statement-breakpoint
CREATE INDEX `script_analyses_project_updated_idx` ON `script_analyses` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `script_analyses_user_idx` ON `script_analyses` (`user_id`);--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `progress` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `lease_owner` text;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `lease_expires_at` integer;--> statement-breakpoint
CREATE INDEX `generation_jobs_type_status_idx` ON `generation_jobs` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `generation_jobs_lease_idx` ON `generation_jobs` (`lease_expires_at`);