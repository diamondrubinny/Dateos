ALTER TYPE "public"."consent_kind" ADD VALUE 'shabbat';--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "shabbat_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "shabbat_show" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "shabbat_candles" smallint DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "shabbat_second_day" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "shabbat_time_zone" varchar(64);--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "shabbat_held" boolean DEFAULT false NOT NULL;