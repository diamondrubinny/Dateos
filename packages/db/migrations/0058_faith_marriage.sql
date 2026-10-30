ALTER TYPE "public"."intention" ADD VALUE 'marriage' BEFORE 'short_term';--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "intentions_offered" text[];--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "faith_module" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "faith_ok" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "stream_ok" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_about" ADD COLUMN "relationship_history" varchar(16);--> statement-breakpoint
ALTER TABLE "profile_about" ADD COLUMN "faith" varchar(16);--> statement-breakpoint
ALTER TABLE "profile_about" ADD COLUMN "faith_stream" varchar(20);--> statement-breakpoint
ALTER TABLE "profile_about" ADD COLUMN "observance" jsonb DEFAULT '{}'::jsonb NOT NULL;