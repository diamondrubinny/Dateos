ALTER TABLE "preferences" ADD COLUMN "quiet_start" smallint;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "quiet_end" smallint;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "quiet_time_zone" varchar(64);