CREATE TABLE "chaperones" (
	"user_id" text PRIMARY KEY NOT NULL,
	"chaperone_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_viewed_at" timestamp with time zone,
	CONSTRAINT "chaperones_not_self" CHECK ("chaperones"."user_id" <> "chaperones"."chaperone_id")
);
--> statement-breakpoint
ALTER TABLE "chaperones" ADD CONSTRAINT "chaperones_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chaperones" ADD CONSTRAINT "chaperones_chaperone_id_user_id_fk" FOREIGN KEY ("chaperone_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chaperones_chaperone_idx" ON "chaperones" USING btree ("chaperone_id");