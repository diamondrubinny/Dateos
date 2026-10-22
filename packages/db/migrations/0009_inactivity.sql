ALTER TABLE "user" ADD COLUMN "inactivity_notice_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;