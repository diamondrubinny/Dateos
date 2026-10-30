ALTER TABLE "instance_settings" ADD COLUMN "join_min_age" smallint DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "join_max_age" smallint;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "join_genders" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "join_declaration" varchar(300);--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "declaration_accepted_at" timestamp with time zone;