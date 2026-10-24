CREATE TABLE "federation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"mine" boolean NOT NULL,
	"client_id" varchar(64),
	"body" varchar(2000) NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "federation_matches" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "federation_messages" ADD CONSTRAINT "federation_messages_match_id_federation_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."federation_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "federation_messages_id_uq" ON "federation_messages" USING btree ("match_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "federation_messages_client_uq" ON "federation_messages" USING btree ("match_id","client_id");--> statement-breakpoint
CREATE INDEX "federation_messages_match_created_idx" ON "federation_messages" USING btree ("match_id","created_at");