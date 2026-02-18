CREATE TABLE `sender_nonce_allocators` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sender_key_id` text NOT NULL,
	`nonce_prefix` integer NOT NULL,
	`next_counter` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sender_nonce_allocators_sender_key_idx` ON `sender_nonce_allocators` (`sender_key_id`);
--> statement-breakpoint
CREATE INDEX `sender_nonce_allocators_updated_idx` ON `sender_nonce_allocators` (`updated_at`);
--> statement-breakpoint
CREATE TABLE `replay_windows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer NOT NULL,
	`sender_device_id` text NOT NULL,
	`sender_key_id` text NOT NULL,
	`max_counter` integer NOT NULL,
	`bitmap_base64` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `replay_windows_unique_idx` ON `replay_windows` (`channel_id`,`sender_device_id`,`sender_key_id`);
--> statement-breakpoint
CREATE INDEX `replay_windows_updated_idx` ON `replay_windows` (`updated_at`);
