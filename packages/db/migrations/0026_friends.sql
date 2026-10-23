CREATE TABLE "double_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_a" uuid NOT NULL,
	"pair_b" uuid NOT NULL,
	"members" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text
);
--> statement-breakpoint
CREATE TABLE "double_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"double_id" uuid NOT NULL,
	"sender_id" text NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"body" varchar(1000) NOT NULL,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friend_links" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" varchar(4) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "friend_takes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(40) NOT NULL,
	"relation" varchar(12) NOT NULL,
	"text" varchar(200) NOT NULL,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pair_interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_id" uuid NOT NULL,
	"target_pair_id" uuid NOT NULL,
	"actor_id" text,
	"kind" "interaction_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "interactions" ADD COLUMN "mode" varchar(6) DEFAULT 'date' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "mode" varchar(6) DEFAULT 'date' NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "friend_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "friend_age_min" smallint DEFAULT 18 NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "friend_age_max" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "friend_genders" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "double_matches" ADD CONSTRAINT "double_matches_pair_a_pairs_id_fk" FOREIGN KEY ("pair_a") REFERENCES "public"."pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "double_matches" ADD CONSTRAINT "double_matches_pair_b_pairs_id_fk" FOREIGN KEY ("pair_b") REFERENCES "public"."pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "double_matches" ADD CONSTRAINT "double_matches_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "double_messages" ADD CONSTRAINT "double_messages_double_id_double_matches_id_fk" FOREIGN KEY ("double_id") REFERENCES "public"."double_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "double_messages" ADD CONSTRAINT "double_messages_sender_id_user_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_links" ADD CONSTRAINT "friend_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_takes" ADD CONSTRAINT "friend_takes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_interactions" ADD CONSTRAINT "pair_interactions_pair_id_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_interactions" ADD CONSTRAINT "pair_interactions_target_pair_id_pairs_id_fk" FOREIGN KEY ("target_pair_id") REFERENCES "public"."pairs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pair_interactions" ADD CONSTRAINT "pair_interactions_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_user_a_user_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairs" ADD CONSTRAINT "pairs_user_b_user_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "double_matches_pairs_uq" ON "double_matches" USING btree ("pair_a","pair_b");--> statement-breakpoint
CREATE INDEX "double_matches_members_idx" ON "double_matches" USING gin ("members");--> statement-breakpoint
CREATE UNIQUE INDEX "double_messages_sender_client_uq" ON "double_messages" USING btree ("sender_id","client_id");--> statement-breakpoint
CREATE INDEX "double_messages_double_created_idx" ON "double_messages" USING btree ("double_id","created_at");--> statement-breakpoint
CREATE INDEX "friend_links_owner_idx" ON "friend_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "friend_takes_owner_idx" ON "friend_takes" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pair_interactions_uq" ON "pair_interactions" USING btree ("pair_id","target_pair_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pairs_user_a_active_uq" ON "pairs" USING btree ("user_a") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pairs_user_b_active_uq" ON "pairs" USING btree ("user_b") WHERE ended_at IS NULL;