CREATE TYPE "public"."push_platform" AS ENUM('ios', 'android');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'voice';--> statement-breakpoint
CREATE TABLE "audio_clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" "photo_status" DEFAULT 'quarantine' NOT NULL,
	"quarantine_key" text,
	"media_key" text,
	"duration_ms" integer,
	"reject_reason" varchar(32),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"token" varchar(200) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"platform" "push_platform" NOT NULL,
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "report_evidence" ALTER COLUMN "body" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "audio_id" uuid;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "accept_voice" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "report_evidence" ADD COLUMN "kind" "message_kind" DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "report_evidence" ADD COLUMN "media_key" text;--> statement-breakpoint
ALTER TABLE "report_evidence" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "audio_clips" ADD CONSTRAINT "audio_clips_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_clips_user_idx" ON "audio_clips" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_tokens_user_idx" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_audio_id_audio_clips_id_fk" FOREIGN KEY ("audio_id") REFERENCES "public"."audio_clips"("id") ON DELETE set null ON UPDATE no action;