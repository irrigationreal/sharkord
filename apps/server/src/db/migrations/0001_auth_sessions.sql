CREATE TABLE `user_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`user_agent` text,
	`os` text,
	`device` text,
	`ip` text,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`last_seen_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_devices_user_idx` ON `user_devices` (`user_id`);
--> statement-breakpoint
CREATE INDEX `user_devices_fingerprint_idx` ON `user_devices` (`fingerprint`);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_devices_user_fingerprint_idx` ON `user_devices` (`user_id`,`fingerprint`);
--> statement-breakpoint
CREATE INDEX `user_devices_user_last_seen_idx` ON `user_devices` (`user_id`,`last_seen_at`);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`user_device_id` integer,
	`access_token_hash` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_reason` text,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_device_id`) REFERENCES `user_devices` (`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_idx` ON `auth_sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_device_idx` ON `auth_sessions` (`user_device_id`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_access_expires_idx` ON `auth_sessions` (`access_expires_at`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_refresh_expires_idx` ON `auth_sessions` (`refresh_expires_at`);
--> statement-breakpoint
CREATE INDEX `auth_sessions_revoked_idx` ON `auth_sessions` (`revoked_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_access_token_hash_unique` ON `auth_sessions` (`access_token_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_refresh_token_hash_unique` ON `auth_sessions` (`refresh_token_hash`);
--> statement-breakpoint
CREATE TABLE `auth_session_refresh_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`auth_session_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`reason` text DEFAULT 'rotated' NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer NOT NULL,
	FOREIGN KEY (`auth_session_id`) REFERENCES `auth_sessions` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_session_refresh_tokens_session_idx` ON `auth_session_refresh_tokens` (`auth_session_id`);
--> statement-breakpoint
CREATE INDEX `auth_session_refresh_tokens_reason_idx` ON `auth_session_refresh_tokens` (`reason`);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_session_refresh_tokens_token_hash_unique` ON `auth_session_refresh_tokens` (`token_hash`);
