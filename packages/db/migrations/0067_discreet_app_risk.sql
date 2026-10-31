ALTER TABLE "instance_settings" ADD COLUMN "discreet_name" varchar(30);--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "risk_countries" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "travel_hidden" boolean DEFAULT false NOT NULL;