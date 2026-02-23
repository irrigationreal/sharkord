CREATE TABLE `e2ee_message_envelopes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`channel_id` integer NOT NULL,
	`epoch` integer NOT NULL,
	`sender_user_id` integer NOT NULL,
	`sender_device_id` text NOT NULL,
	`sender_key_id` text NOT NULL,
	`counter` integer NOT NULL,
	`client_message_id` text NOT NULL,
	`content_type` integer NOT NULL,
	`flags` integer NOT NULL,
	`csc_hash` text NOT NULL,
	`header_cbor` text NOT NULL,
	`nonce_b64` text NOT NULL,
	`ciphertext_b64` text NOT NULL,
	`tag_b64` text NOT NULL,
	`sig_b64` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `channels` (`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_user_id`) REFERENCES `users` (`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `e2ee_message_envelopes_message_idx` ON `e2ee_message_envelopes` (`client_message_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `e2ee_message_envelopes_sender_counter_idx` ON `e2ee_message_envelopes` (`channel_id`,`sender_device_id`,`sender_key_id`,`counter`);
--> statement-breakpoint
CREATE INDEX `e2ee_message_envelopes_channel_epoch_idx` ON `e2ee_message_envelopes` (`channel_id`,`epoch`);
--> statement-breakpoint
CREATE INDEX `e2ee_message_envelopes_channel_created_idx` ON `e2ee_message_envelopes` (`channel_id`,`created_at`);
