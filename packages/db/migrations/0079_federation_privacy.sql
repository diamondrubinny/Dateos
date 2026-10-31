ALTER TABLE "federation_partners" ADD COLUMN "country" varchar(2);--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "partner_cards" varchar(10) DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "community_country" varchar(2);--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "partner_short_card" boolean DEFAULT false NOT NULL;