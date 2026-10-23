ALTER TYPE "public"."consent_kind" ADD VALUE 'federation';--> statement-breakpoint
CREATE TABLE "federation_aliases" (
	"partner_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"alias" varchar(22) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "federation_aliases_partner_id_user_id_pk" PRIMARY KEY("partner_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "federation_decisions" (
	"user_id" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"alias" varchar(22) NOT NULL,
	"kind" varchar(8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "federation_decisions_user_id_partner_id_alias_pk" PRIMARY KEY("user_id","partner_id","alias")
);
--> statement-breakpoint
CREATE TABLE "federation_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"alias" varchar(22) NOT NULL,
	"name" varchar(40) NOT NULL,
	"photo_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "federation_aliases" ADD CONSTRAINT "federation_aliases_partner_id_federation_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."federation_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_aliases" ADD CONSTRAINT "federation_aliases_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_decisions" ADD CONSTRAINT "federation_decisions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_decisions" ADD CONSTRAINT "federation_decisions_partner_id_federation_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."federation_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_matches" ADD CONSTRAINT "federation_matches_partner_id_federation_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."federation_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_matches" ADD CONSTRAINT "federation_matches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "federation_aliases_alias_uq" ON "federation_aliases" USING btree ("partner_id","alias");--> statement-breakpoint
CREATE INDEX "federation_decisions_alias_idx" ON "federation_decisions" USING btree ("partner_id","alias");--> statement-breakpoint
CREATE UNIQUE INDEX "federation_matches_pair_uq" ON "federation_matches" USING btree ("partner_id","user_id","alias");--> statement-breakpoint
CREATE INDEX "federation_matches_user_idx" ON "federation_matches" USING btree ("user_id");