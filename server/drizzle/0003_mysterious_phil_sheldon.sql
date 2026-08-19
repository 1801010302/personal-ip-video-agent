CREATE TABLE `tutorial_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '新手教学' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`object_path` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`duration_ms` integer,
	`status` text DEFAULT 'uploading' NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `es_system__auth_user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tutorial_videos_status_updated_idx` ON `tutorial_videos` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `tutorial_videos_uploader_idx` ON `tutorial_videos` (`uploaded_by`);