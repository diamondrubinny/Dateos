CREATE TYPE "public"."date_status" AS ENUM('proposed', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."venue_category" AS ENUM('cafe', 'restaurant', 'bar', 'park', 'museum', 'activity', 'other');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'date';--> statement-breakpoint
CREATE TABLE "date_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"proposer_id" text NOT NULL,
	"venue_id" uuid,
	"venue_name" varchar(80) NOT NULL,
	"venue_area" varchar(80) NOT NULL,
	"venue_category" "venue_category" NOT NULL,
	"venue_address" varchar(160) NOT NULL,
	"venue_note" varchar(300),
	"venue_step_free" boolean NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"note" varchar(200),
	"status" date_status DEFAULT 'proposed' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"area" varchar(80) NOT NULL,
	"category" "venue_category" NOT NULL,
	"address" varchar(160) NOT NULL,
	"note" varchar(300),
	"step_free" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "date_plan_id" uuid;--> statement-breakpoint
ALTER TABLE "date_plans" ADD CONSTRAINT "date_plans_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_plans" ADD CONSTRAINT "date_plans_proposer_id_user_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_plans" ADD CONSTRAINT "date_plans_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "date_plans_open_uq" ON "date_plans" USING btree ("match_id") WHERE "date_plans"."status" = 'proposed';--> statement-breakpoint
CREATE INDEX "date_plans_proposer_idx" ON "date_plans" USING btree ("proposer_id","created_at");--> statement-breakpoint
CREATE INDEX "venues_active_idx" ON "venues" USING btree ("active","area","name");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_date_plan_id_date_plans_id_fk" FOREIGN KEY ("date_plan_id") REFERENCES "public"."date_plans"("id") ON DELETE cascade ON UPDATE no action;