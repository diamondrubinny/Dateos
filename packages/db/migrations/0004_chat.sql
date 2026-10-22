CREATE TYPE "public"."message_kind" AS ENUM('text', 'image');--> statement-breakpoint
CREATE TYPE "public"."photo_purpose" AS ENUM('profile', 'chat');--> statement-breakpoint
CREATE TABLE "match_reads" (
	"match_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"last_read_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"kind" "message_kind" NOT NULL,
	"body" varchar(2000),
	"photo_id" uuid,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "purpose" "photo_purpose" DEFAULT 'profile' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_reads" ADD CONSTRAINT "match_reads_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_reads" ADD CONSTRAINT "match_reads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_photo_id_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "match_reads_uq" ON "match_reads" USING btree ("match_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_sender_client_uq" ON "messages" USING btree ("sender_id","client_id");--> statement-breakpoint
CREATE INDEX "messages_match_created_idx" ON "messages" USING btree ("match_id","created_at");