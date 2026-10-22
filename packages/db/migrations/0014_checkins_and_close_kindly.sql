CREATE TYPE "public"."checkin_status" AS ENUM('active', 'ok', 'alerted', 'cancelled');--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"match_id" uuid,
	"match_name" varchar(40),
	"place" varchar(200) NOT NULL,
	"note" varchar(300),
	"contact_name" varchar(60) NOT NULL,
	"contact_email" varchar(254) NOT NULL,
	"locale" varchar(5) NOT NULL,
	"time_zone" varchar(64) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"check_at" timestamp with time zone NOT NULL,
	"status" "checkin_status" DEFAULT 'active' NOT NULL,
	"sos_count" smallint DEFAULT 0 NOT NULL,
	"reminded_at" timestamp with time zone,
	"alerted_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "close_message" varchar(300);--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "close_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checkins_user_idx" ON "checkins" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "checkins_due_idx" ON "checkins" USING btree ("status","check_at");