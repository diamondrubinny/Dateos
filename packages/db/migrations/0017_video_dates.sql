CREATE TYPE "public"."call_status" AS ENUM('ringing', 'active', 'ended', 'missed', 'declined');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'call';--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"caller_id" text NOT NULL,
	"callee_id" text NOT NULL,
	"video" boolean NOT NULL,
	"status" "call_status" DEFAULT 'ringing' NOT NULL,
	"room" varchar(64) NOT NULL,
	"max_minutes" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "calls_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "call_max_minutes" smallint DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "call_id" uuid;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "accept_calls" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_id_user_id_fk" FOREIGN KEY ("caller_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_callee_id_user_id_fk" FOREIGN KEY ("callee_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calls_room_uq" ON "calls" USING btree ("room");--> statement-breakpoint
CREATE UNIQUE INDEX "calls_open_uq" ON "calls" USING btree ("match_id") WHERE "calls"."status" IN ('ringing', 'active');--> statement-breakpoint
CREATE INDEX "calls_caller_idx" ON "calls" USING btree ("caller_id","created_at");--> statement-breakpoint
CREATE INDEX "calls_callee_idx" ON "calls" USING btree ("callee_id","created_at");--> statement-breakpoint
CREATE INDEX "calls_open_idx" ON "calls" USING btree ("status") WHERE "calls"."status" IN ('ringing', 'active');--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;