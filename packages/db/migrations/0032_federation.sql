CREATE TABLE "federation_keys" (
	"id" smallint PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key_sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"public_key" text NOT NULL,
	"contact" varchar(200),
	"privacy_url" text,
	"status" varchar(16) NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_error" varchar(200)
);
--> statement-breakpoint
ALTER TABLE "federation_partners" ADD CONSTRAINT "federation_partners_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "federation_partners_url_uq" ON "federation_partners" USING btree ("url");