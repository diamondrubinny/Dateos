ALTER TYPE "public"."consent_kind" ADD VALUE 'accessibility';--> statement-breakpoint
ALTER TABLE "profile_about" ADD COLUMN "access_needs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_about" ADD COLUMN "show_access_needs" boolean DEFAULT false NOT NULL;