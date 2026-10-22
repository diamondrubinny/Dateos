ALTER TYPE "public"."consent_kind" ADD VALUE 'religion';--> statement-breakpoint
CREATE TABLE "profile_about" (
	"user_id" text PRIMARY KEY NOT NULL,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"children" varchar(24),
	"smoking" varchar(16),
	"drinking" varchar(16),
	"height_cm" smallint,
	"religion" varchar(24),
	"opening_question" varchar(140),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "smoking_ok" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "children_ok" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "religion_ok" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "height_min" smallint;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "height_max" smallint;--> statement-breakpoint
ALTER TABLE "profile_about" ADD CONSTRAINT "profile_about_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;