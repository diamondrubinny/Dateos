ALTER TABLE "federation_keys" ADD COLUMN "previous_public_key" text;--> statement-breakpoint
ALTER TABLE "federation_keys" ADD COLUMN "previous_private_key_sealed" text;--> statement-breakpoint
ALTER TABLE "federation_keys" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "federation_outbox" ADD COLUMN "sign_with_previous" boolean DEFAULT false NOT NULL;