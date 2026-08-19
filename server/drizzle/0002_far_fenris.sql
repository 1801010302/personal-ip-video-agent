ALTER TABLE `generation_jobs` ADD `name` text DEFAULT '未命名任务' NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `request_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `generation_jobs` ADD `result_json` text DEFAULT '{}' NOT NULL;