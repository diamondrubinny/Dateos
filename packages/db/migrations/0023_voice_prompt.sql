ALTER TABLE "profile_about" ADD COLUMN "voice_prompt_key" varchar(40);--> statement-breakpoint
ALTER TABLE "profile_about" ADD COLUMN "voice_audio_id" uuid;--> statement-breakpoint
ALTER TABLE "profile_about" ADD CONSTRAINT "profile_about_voice_audio_id_audio_clips_id_fk" FOREIGN KEY ("voice_audio_id") REFERENCES "public"."audio_clips"("id") ON DELETE set null ON UPDATE no action;