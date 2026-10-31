ALTER TABLE "instance_settings" ADD COLUMN "safety_resources" varchar(2000);--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "hide_distance" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "discreet_notifications" boolean DEFAULT false NOT NULL;