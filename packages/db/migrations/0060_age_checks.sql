CREATE TABLE "age_check_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "age_checks" (
	"user_id" text PRIMARY KEY NOT NULL,
	"result" varchar(12) NOT NULL,
	"method" varchar(40) NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "age_check_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "age_check_sessions" ADD CONSTRAINT "age_check_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "age_checks" ADD CONSTRAINT "age_checks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "age_check_sessions_user_idx" ON "age_check_sessions" USING btree ("user_id");