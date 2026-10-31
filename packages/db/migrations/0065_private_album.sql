ALTER TYPE "public"."photo_purpose" ADD VALUE 'album';--> statement-breakpoint
CREATE TABLE "album_shares" (
	"match_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"mode" varchar(12) NOT NULL,
	"opened_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "album_shares_match_id_user_id_pk" PRIMARY KEY("match_id","user_id"),
	CONSTRAINT "album_shares_mode" CHECK ("album_shares"."mode" IN ('once', 'ten_minutes', 'unlimited'))
);
--> statement-breakpoint
ALTER TABLE "album_shares" ADD CONSTRAINT "album_shares_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "album_shares" ADD CONSTRAINT "album_shares_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;