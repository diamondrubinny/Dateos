ALTER TABLE "date_plans" ADD COLUMN "venue_kosher" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "date_plans" ADD COLUMN "venue_shabbat_closed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "kosher" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "shabbat_closed" boolean DEFAULT false NOT NULL;