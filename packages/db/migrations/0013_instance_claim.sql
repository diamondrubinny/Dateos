CREATE TABLE "instance_claim" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_claim" ADD CONSTRAINT "instance_claim_claimed_by_user_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Instances that already have an admin count as claimed.
INSERT INTO "instance_claim" ("id") SELECT 1 WHERE EXISTS (SELECT 1 FROM "user" WHERE "role" = 'admin');
