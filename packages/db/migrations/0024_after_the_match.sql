CREATE TABLE "match_availability" (
	"match_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"slots" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "match_availability_match_id_user_id_pk" PRIMARY KEY("match_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "date_plans" ADD COLUMN "proposer_met" boolean;--> statement-breakpoint
ALTER TABLE "date_plans" ADD COLUMN "receiver_met" boolean;--> statement-breakpoint
ALTER TABLE "date_plans" ADD COLUMN "proposer_again" varchar(8);--> statement-breakpoint
ALTER TABLE "date_plans" ADD COLUMN "receiver_again" varchar(8);--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "show_met_badge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "match_availability" ADD CONSTRAINT "match_availability_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_availability" ADD CONSTRAINT "match_availability_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;