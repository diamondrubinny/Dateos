CREATE TABLE "federation_signals_in" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"hash" bigint NOT NULL,
	"category" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_signals_out" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ADD COLUMN "share_trust_signals" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_signals_in" ADD CONSTRAINT "federation_signals_in_partner_id_federation_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."federation_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_signals_out" ADD CONSTRAINT "federation_signals_out_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "federation_signals_in_uq" ON "federation_signals_in" USING btree ("partner_id","signal_id","hash");--> statement-breakpoint
CREATE INDEX "federation_signals_in_created_idx" ON "federation_signals_in" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "federation_signals_out_user_idx" ON "federation_signals_out" USING btree ("user_id");