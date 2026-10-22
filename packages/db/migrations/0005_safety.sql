CREATE TYPE "public"."moderation_action" AS ENUM('dismiss', 'warn', 'suspend', 'ban', 'unsuspend');--> statement-breakpoint
CREATE TYPE "public"."report_category" AS ENUM('underage', 'threat', 'harassment', 'scam', 'fake_profile', 'inappropriate_photos', 'spam', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_priority" AS ENUM('urgent', 'high', 'normal');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'dismissed', 'actioned');--> statement-breakpoint
CREATE TYPE "public"."verification_pose" AS ENUM('thumbs_up', 'peace_sign', 'hand_on_head', 'point_at_camera', 'wave');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('awaiting_selfie', 'pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."photo_purpose" ADD VALUE 'verification';--> statement-breakpoint
CREATE TABLE "banned_emails" (
	"email_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_id" text NOT NULL,
	"staff_id" text,
	"report_id" uuid,
	"action" "moderation_action" NOT NULL,
	"category" "report_category",
	"reason" varchar(500) NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"from_reported" boolean NOT NULL,
	"body" varchar(2000) NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" text,
	"reported_id" text NOT NULL,
	"match_id" uuid,
	"category" "report_category" NOT NULL,
	"priority" "report_priority" NOT NULL,
	"details" varchar(1000),
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_action" "moderation_action",
	"resolved_reason" varchar(500),
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_mfa" (
	"user_id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"enabled_at" timestamp with time zone,
	"last_step" bigint DEFAULT 0 NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mfa_verified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"pose" "verification_pose" NOT NULL,
	"status" "verification_status" DEFAULT 'awaiting_selfie' NOT NULL,
	"selfie_photo_id" uuid,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_target_id_user_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_staff_id_user_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_evidence" ADD CONSTRAINT "report_evidence_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_user_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_id_user_id_fk" FOREIGN KEY ("reported_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_mfa" ADD CONSTRAINT "staff_mfa_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_session_id_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_selfie_photo_id_photos_id_fk" FOREIGN KEY ("selfie_photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_actions_target_idx" ON "moderation_actions" USING btree ("target_id","created_at");--> statement-breakpoint
CREATE INDEX "report_evidence_report_idx" ON "report_evidence" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "reports_queue_idx" ON "reports" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE INDEX "reports_reported_idx" ON "reports" USING btree ("reported_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_open_pair_uq" ON "reports" USING btree ("reporter_id","reported_id") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "verifications_user_idx" ON "verifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "verifications_status_idx" ON "verifications" USING btree ("status","created_at");