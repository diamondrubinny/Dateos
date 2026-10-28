ALTER TABLE "push_tokens" ADD COLUMN "device_secret_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "device_label" varchar(40);