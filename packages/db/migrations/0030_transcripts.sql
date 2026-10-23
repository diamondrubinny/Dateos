ALTER TABLE "audio_clips" ADD COLUMN "lang" varchar(5);--> statement-breakpoint
ALTER TABLE "audio_clips" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "audio_clips" ADD COLUMN "transcript_status" varchar(12);--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "allow_transcripts" boolean DEFAULT true NOT NULL;