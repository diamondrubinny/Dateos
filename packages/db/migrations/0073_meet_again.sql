CREATE TABLE "event_picks" (
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD COLUMN "promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD COLUMN "meet_again_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD COLUMN "excused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_picks" ADD CONSTRAINT "event_picks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_picks" ADD CONSTRAINT "event_picks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_picks" ADD CONSTRAINT "event_picks_target_id_user_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_picks_uq" ON "event_picks" USING btree ("event_id","user_id","target_id");--> statement-breakpoint
CREATE INDEX "event_picks_target_idx" ON "event_picks" USING btree ("event_id","target_id");