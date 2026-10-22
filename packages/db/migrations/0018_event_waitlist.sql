CREATE TYPE "public"."rsvp_status" AS ENUM('going', 'waiting');--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD COLUMN "status" "rsvp_status" DEFAULT 'going' NOT NULL;--> statement-breakpoint
CREATE INDEX "event_rsvps_waiting_idx" ON "event_rsvps" USING btree ("event_id","status","created_at");