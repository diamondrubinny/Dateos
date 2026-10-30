CREATE TABLE "security_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(120) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"severity" varchar(12) NOT NULL,
	"occurred_at" timestamp with time zone,
	"discovered_at" timestamp with time zone NOT NULL,
	"affected_members" integer,
	"description" varchar(2000) NOT NULL,
	"actions" varchar(2000),
	"authority_notified_at" timestamp with time zone,
	"members_notified_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_incidents_kind" CHECK ("security_incidents"."kind" IN ('unauthorized_access', 'data_leak', 'lost_device', 'malware', 'outage', 'other')),
	CONSTRAINT "security_incidents_severity" CHECK ("security_incidents"."severity" IN ('low', 'medium', 'high', 'severe'))
);
--> statement-breakpoint
ALTER TABLE "security_incidents" ADD CONSTRAINT "security_incidents_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_incidents_time_idx" ON "security_incidents" USING btree ("discovered_at");