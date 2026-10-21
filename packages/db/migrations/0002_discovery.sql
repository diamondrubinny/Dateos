CREATE TYPE "public"."impression_surface" AS ENUM('discover', 'picks');--> statement-breakpoint
CREATE TYPE "public"."interaction_item_type" AS ENUM('photo', 'prompt');--> statement-breakpoint
CREATE TYPE "public"."interaction_kind" AS ENUM('like', 'pass');--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_picks" (
	"user_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"served_on" date NOT NULL,
	"score" integer NOT NULL,
	"reasons" text[] NOT NULL,
	"position" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"viewer_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"surface" "impression_surface" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text NOT NULL,
	"target_id" text NOT NULL,
	"kind" "interaction_kind" NOT NULL,
	"item_type" "interaction_item_type",
	"item_id" uuid,
	"comment" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"user_id" text PRIMARY KEY NOT NULL,
	"geo" geography(Point, 4326) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unmatched_at" timestamp with time zone,
	"unmatched_by" text,
	CONSTRAINT "matches_ordered_pair" CHECK ("matches"."user_a" < "matches"."user_b")
);
--> statement-breakpoint
CREATE TABLE "profile_embeddings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"embedding" vector(768) NOT NULL,
	"model" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_user_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_user_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_picks" ADD CONSTRAINT "daily_picks_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_picks" ADD CONSTRAINT "daily_picks_candidate_id_user_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_viewer_id_user_id_fk" FOREIGN KEY ("viewer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_candidate_id_user_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_target_id_user_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_a_user_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_b_user_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_unmatched_by_user_id_fk" FOREIGN KEY ("unmatched_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_embeddings" ADD CONSTRAINT "profile_embeddings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_pair_uq" ON "blocks" USING btree ("blocker_id","blocked_id");--> statement-breakpoint
CREATE INDEX "blocks_blocked_idx" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_picks_uq" ON "daily_picks" USING btree ("user_id","served_on","candidate_id");--> statement-breakpoint
CREATE INDEX "impressions_candidate_created_idx" ON "impressions" USING btree ("candidate_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "interactions_actor_target_uq" ON "interactions" USING btree ("actor_id","target_id");--> statement-breakpoint
CREATE INDEX "interactions_target_kind_idx" ON "interactions" USING btree ("target_id","kind");--> statement-breakpoint
CREATE INDEX "interactions_actor_created_idx" ON "interactions" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "locations_geo_gist" ON "locations" USING gist ("geo");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_pair_uq" ON "matches" USING btree ("user_a","user_b");--> statement-breakpoint
CREATE INDEX "matches_user_b_idx" ON "matches" USING btree ("user_b");