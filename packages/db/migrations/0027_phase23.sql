CREATE TABLE "speed_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"round" smallint NOT NULL,
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	"room" varchar(64) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"answer_a" boolean,
	"answer_b" boolean,
	"ended_early_by" text,
	"match_id" uuid,
	CONSTRAINT "speed_dates_order" CHECK ("speed_dates"."user_a" COLLATE "C" < "speed_dates"."user_b")
);
--> statement-breakpoint
CREATE TABLE "speed_lobby" (
	"event_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD COLUMN "checked_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "kind" varchar(8) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "round_minutes" smallint;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "check_in_secret" varchar(64);--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "show_event_badge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "event_check_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "speed_dates" ADD CONSTRAINT "speed_dates_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speed_dates" ADD CONSTRAINT "speed_dates_user_a_user_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speed_dates" ADD CONSTRAINT "speed_dates_user_b_user_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speed_dates" ADD CONSTRAINT "speed_dates_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speed_lobby" ADD CONSTRAINT "speed_lobby_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "speed_lobby" ADD CONSTRAINT "speed_lobby_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "speed_dates_room_uq" ON "speed_dates" USING btree ("room");--> statement-breakpoint
CREATE UNIQUE INDEX "speed_dates_pair_uq" ON "speed_dates" USING btree ("event_id","user_a","user_b");--> statement-breakpoint
CREATE INDEX "speed_dates_event_round_idx" ON "speed_dates" USING btree ("event_id","round");--> statement-breakpoint
CREATE INDEX "speed_dates_user_a_idx" ON "speed_dates" USING btree ("user_a");--> statement-breakpoint
CREATE INDEX "speed_dates_user_b_idx" ON "speed_dates" USING btree ("user_b");--> statement-breakpoint
CREATE UNIQUE INDEX "speed_lobby_uq" ON "speed_lobby" USING btree ("event_id","user_id");