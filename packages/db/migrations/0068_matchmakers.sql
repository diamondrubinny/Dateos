CREATE TABLE "introductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"matchmaker_id" text,
	"a_id" text NOT NULL,
	"b_id" text NOT NULL,
	"note" varchar(300) NOT NULL,
	"first_id" text,
	"a_answer" varchar(3),
	"b_answer" varchar(3),
	"a_answered_at" timestamp with time zone,
	"b_answered_at" timestamp with time zone,
	"match_id" uuid,
	"matched_at" timestamp with time zone,
	"outcome" varchar(8),
	"outcome_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "introductions_two" CHECK ("introductions"."a_id" <> "introductions"."b_id"),
	CONSTRAINT "introductions_a_answer" CHECK ("introductions"."a_answer" IN ('yes', 'no')),
	CONSTRAINT "introductions_b_answer" CHECK ("introductions"."b_answer" IN ('yes', 'no')),
	CONSTRAINT "introductions_outcome" CHECK ("introductions"."outcome" IN ('met', 'engaged', 'married'))
);
--> statement-breakpoint
CREATE TABLE "matchmakers" (
	"user_id" text PRIMARY KEY NOT NULL,
	"granted_by" text,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "introduction_order" varchar(12) DEFAULT 'together' NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "open_to_matchmakers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_matchmaker_id_user_id_fk" FOREIGN KEY ("matchmaker_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_a_id_user_id_fk" FOREIGN KEY ("a_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_b_id_user_id_fk" FOREIGN KEY ("b_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introductions" ADD CONSTRAINT "introductions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmakers" ADD CONSTRAINT "matchmakers_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchmakers" ADD CONSTRAINT "matchmakers_granted_by_user_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "introductions_matchmaker_idx" ON "introductions" USING btree ("matchmaker_id","created_at");--> statement-breakpoint
CREATE INDEX "introductions_a_idx" ON "introductions" USING btree ("a_id");--> statement-breakpoint
CREATE INDEX "introductions_b_idx" ON "introductions" USING btree ("b_id");