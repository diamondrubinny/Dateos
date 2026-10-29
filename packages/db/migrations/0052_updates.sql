CREATE TABLE "update_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_commit" varchar(40) NOT NULL,
	"from_commit" varchar(40),
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"requested_by" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"message" varchar(500),
	CONSTRAINT "update_requests_status" CHECK ("update_requests"."status" IN ('pending', 'running', 'done', 'failed', 'cancelled')),
	CONSTRAINT "update_requests_commit" CHECK ("update_requests"."target_commit" ~ '^[0-9a-f]{40}$')
);
--> statement-breakpoint
CREATE TABLE "update_status" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"current_commit" varchar(40),
	"latest_commit" varchar(40),
	"latest_at" timestamp with time zone,
	"behind" integer DEFAULT 0 NOT NULL,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" varchar(200),
	CONSTRAINT "update_status_single_row" CHECK ("update_status"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "update_requests" ADD CONSTRAINT "update_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "update_requests_open_uq" ON "update_requests" USING btree ((true)) WHERE "update_requests"."status" IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX "update_requests_time_idx" ON "update_requests" USING btree ("requested_at");