ALTER TABLE "preferences" ADD COLUMN "daily_like_limit" smallint;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "verified_contact_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "interactions_target_created_idx" ON "interactions" USING btree ("target_id","created_at");