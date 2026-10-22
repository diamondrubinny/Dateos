ALTER TABLE "locations" ADD COLUMN "travel_city_id" integer;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "travel_geo" geography(Point, 4326);--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "travel_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "travel_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "locations_travel_geo_gist" ON "locations" USING gist ("travel_geo") WHERE travel_geo IS NOT NULL;