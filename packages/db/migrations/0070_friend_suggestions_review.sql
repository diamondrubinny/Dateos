ALTER TABLE "instance_settings" ADD COLUMN "profile_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "introductions" ADD COLUMN "kind" varchar(10) DEFAULT 'matchmaker' NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "friend_suggestions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "review_status" varchar(10) DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "review_reason" varchar(10);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "review_note" varchar(300);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "resubmitted_at" timestamp with time zone;