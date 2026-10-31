ALTER TABLE "event_rsvps" ADD COLUMN "table_answers" jsonb;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD COLUMN "table_no" smallint;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "reveal_hours" smallint;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "table_size" smallint;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "tables_set_at" timestamp with time zone;