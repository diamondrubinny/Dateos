ALTER TABLE "user" ADD COLUMN "paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "paused_until" timestamp with time zone;