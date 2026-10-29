CREATE TABLE "maintenance_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(32) NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bytes" bigint
);
--> statement-breakpoint
CREATE INDEX "maintenance_runs_kind_idx" ON "maintenance_runs" USING btree ("kind","finished_at");