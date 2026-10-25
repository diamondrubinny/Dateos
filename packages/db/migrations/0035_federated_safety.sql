CREATE TABLE "federation_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"path" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_reports_out" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"alias" varchar(22) NOT NULL,
	"category" "report_category" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "partner_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "partner_report_id" uuid;--> statement-breakpoint
ALTER TABLE "federation_outbox" ADD CONSTRAINT "federation_outbox_partner_id_federation_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."federation_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_reports_out" ADD CONSTRAINT "federation_reports_out_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_reports_out" ADD CONSTRAINT "federation_reports_out_partner_id_federation_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."federation_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "federation_outbox_due_idx" ON "federation_outbox" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE INDEX "federation_reports_out_partner_idx" ON "federation_reports_out" USING btree ("partner_id");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_partner_id_federation_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."federation_partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_partner_report_uq" ON "reports" USING btree ("partner_id","partner_report_id");