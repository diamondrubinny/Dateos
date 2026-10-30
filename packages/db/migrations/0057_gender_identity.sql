ALTER TABLE "instance_settings" ADD COLUMN "identity_vocabulary" varchar(10) DEFAULT 'extended' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "identity_custom" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "identity_pronouns" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_about" ADD COLUMN "gender_identity" varchar(24);--> statement-breakpoint
ALTER TABLE "profile_about" ADD COLUMN "gender_custom" varchar(30);--> statement-breakpoint
ALTER TABLE "profile_about" ADD COLUMN "pronouns" varchar(12);--> statement-breakpoint
ALTER TABLE "profile_about" ADD COLUMN "identity_visibility" varchar(10) DEFAULT 'matches' NOT NULL;