ALTER TABLE "messages" ADD COLUMN "unsent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_to_id" uuid;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "read_receipts" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "report_evidence" ADD COLUMN "unsent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;