ALTER TABLE `auth_sessions`
ADD COLUMN `auth_provider` text;
--> statement-breakpoint

CREATE TABLE `auth_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	`last_login_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_identities_user_idx` ON `auth_identities` (`user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_identities_provider_subject_idx` ON `auth_identities` (`provider`, `provider_subject`);
--> statement-breakpoint

CREATE TABLE `oauth_states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`state_hash` text NOT NULL,
	`provider` text NOT NULL,
	`device_id` text,
	`invite_code` text,
	`redirect_path` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	UNIQUE (`state_hash`)
);
--> statement-breakpoint
CREATE INDEX `oauth_states_provider_idx` ON `oauth_states` (`provider`, `expires_at`);
