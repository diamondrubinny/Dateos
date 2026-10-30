CREATE TYPE "public"."appeal_status" AS ENUM('open', 'upheld', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."moderation_ground" AS ENUM('terms', 'illegal');--> statement-breakpoint
CREATE TABLE "moderation_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"decision_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"text" varchar(1000) NOT NULL,
	"status" "appeal_status" DEFAULT 'open' NOT NULL,
	"reviewer_id" text,
	"response" varchar(1000),
	"decided_at" timestamp with time zone,
	"member_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_appeals_decision_id_unique" UNIQUE("decision_id")
);
--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD COLUMN "ground" "moderation_ground" DEFAULT 'terms' NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD COLUMN "explanation" varchar(1000);--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD COLUMN "automated_detection" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_decision_id_moderation_actions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."moderation_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_appeals_queue_idx" ON "moderation_appeals" USING btree ("status","created_at");