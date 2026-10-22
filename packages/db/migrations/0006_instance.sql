ALTER TYPE "public"."photo_purpose" ADD VALUE 'branding';--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" varchar(40),
	"tagline" varchar(120),
	"primary_color" varchar(7),
	"default_locale" varchar(5),
	"operator_name" varchar(100),
	"contact_email" varchar(254),
	"sponsor_url" varchar(300),
	"logo_photo_id" uuid,
	"setup_completed_at" timestamp with time zone,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_single_row" CHECK ("instance_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_logo_photo_id_photos_id_fk" FOREIGN KEY ("logo_photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;