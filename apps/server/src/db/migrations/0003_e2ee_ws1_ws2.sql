CREATE TABLE `user_root_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`ark_version` integer NOT NULL,
	`ark_pub` text NOT NULL,
	`ark_record_cbor` text NOT NULL,
	`ark_hash` text NOT NULL,
	`prev_ark_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_root_keys_user_version_idx` ON `user_root_keys` (`user_id`,`ark_version`);
--> statement-breakpoint
CREATE INDEX `user_root_keys_user_created_idx` ON `user_root_keys` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `e2ee_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`device_id` text NOT NULL,
	`device_seq` integer NOT NULL,
	`sign_pub` text NOT NULL,
	`kem_pub` text NOT NULL,
	`crypto_profile` text NOT NULL,
	`capabilities` integer NOT NULL,
	`device_record_cbor` text NOT NULL,
	`device_record_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `e2ee_devices_user_device_id_idx` ON `e2ee_devices` (`user_id`,`device_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `e2ee_devices_user_device_seq_idx` ON `e2ee_devices` (`user_id`,`device_seq`);
--> statement-breakpoint
CREATE INDEX `e2ee_devices_user_revoked_idx` ON `e2ee_devices` (`user_id`,`revoked_at`);
--> statement-breakpoint
CREATE TABLE `device_authorizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`device_id` text NOT NULL,
	`ark_version` integer NOT NULL,
	`device_record_hash` text NOT NULL,
	`device_seq` integer NOT NULL,
	`action` integer NOT NULL,
	`statement_cbor` text NOT NULL,
	`signature` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `device_auth_user_device_created_idx` ON `device_authorizations` (`user_id`,`device_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `device_auth_user_device_action_idx` ON `device_authorizations` (`user_id`,`device_id`,`action`);
--> statement-breakpoint
CREATE TABLE `channel_state_commitments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer NOT NULL,
	`epoch` integer NOT NULL,
	`csc_hash` text NOT NULL,
	`prev_csc_hash` text,
	`membership_digest` text NOT NULL,
	`policy_digest` text NOT NULL,
	`signer_user_id` integer NOT NULL,
	`signer_device_id` text NOT NULL,
	`payload_cbor` text NOT NULL,
	`signature` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels` (`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`signer_user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_state_commitments_channel_epoch_idx` ON `channel_state_commitments` (`channel_id`,`epoch`);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_state_commitments_channel_hash_idx` ON `channel_state_commitments` (`channel_id`,`csc_hash`);
--> statement-breakpoint
CREATE INDEX `channel_state_commitments_channel_created_idx` ON `channel_state_commitments` (`channel_id`,`created_at`);
