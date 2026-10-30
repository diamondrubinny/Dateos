ALTER TABLE "update_requests" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "update_status" ADD COLUMN "notified_commit" varchar(40);--> statement-breakpoint
ALTER TABLE "update_status" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
-- Results from before phase 54 were already seen in the dashboard: don't email them now.
UPDATE "update_requests" SET "notified_at" = coalesce("finished_at", now()) WHERE "status" IN ('done', 'failed', 'cancelled');
