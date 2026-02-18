ALTER TABLE `messages` ADD `parent_message_id` integer REFERENCES `messages`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `messages_parent_idx` ON `messages` (`parent_message_id`);--> statement-breakpoint
CREATE INDEX `messages_parent_created_idx` ON `messages` (`parent_message_id`,`created_at`);
