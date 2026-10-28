CREATE TABLE "saved_profiles" (
	"user_id" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_profiles_user_id_target_id_pk" PRIMARY KEY("user_id","target_id")
);
--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "notify_matches" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "notify_messages" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "notify_events" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_profiles" ADD CONSTRAINT "saved_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_profiles" ADD CONSTRAINT "saved_profiles_target_id_user_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;