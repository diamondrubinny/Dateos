CREATE TABLE "resume_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"label" varchar(40) NOT NULL,
	"sections" text[] DEFAULT '{}'::text[] NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume_links" ADD CONSTRAINT "resume_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resume_links_token_uq" ON "resume_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "resume_links_owner_idx" ON "resume_links" USING btree ("user_id");