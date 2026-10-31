ALTER TABLE "event_rsvps" ADD COLUMN "pool" varchar(16);--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "audience_genders" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "age_min" smallint;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "age_max" smallint;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "faith_streams" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "pools" jsonb;