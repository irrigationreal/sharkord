CREATE TABLE `device_prekeys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`device_id` text NOT NULL,
	`prekey_id` text NOT NULL,
	`prekey_pub` text NOT NULL,
	`signature` text,
	`one_time` integer NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_prekeys_device_prekey_idx` ON `device_prekeys` (`device_id`,`prekey_id`);
--> statement-breakpoint
CREATE INDEX `device_prekeys_user_device_idx` ON `device_prekeys` (`user_id`,`device_id`);
--> statement-breakpoint
CREATE INDEX `device_prekeys_device_one_time_used_idx` ON `device_prekeys` (`device_id`,`one_time`,`used_at`);
--> statement-breakpoint
CREATE TABLE `channel_epoch_device_envelopes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer NOT NULL,
	`epoch` integer NOT NULL,
	`recipient_device_id` text NOT NULL,
	`envelope` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `channel_epoch_device_envelopes_unique_idx` ON `channel_epoch_device_envelopes` (`channel_id`,`epoch`,`recipient_device_id`);
--> statement-breakpoint
CREATE INDEX `channel_epoch_device_envelopes_channel_epoch_idx` ON `channel_epoch_device_envelopes` (`channel_id`,`epoch`);
--> statement-breakpoint
CREATE INDEX `channel_epoch_device_envelopes_recipient_idx` ON `channel_epoch_device_envelopes` (`recipient_device_id`);
