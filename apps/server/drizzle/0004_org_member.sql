CREATE TABLE "org"."member" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"dept" text NOT NULL,
	"roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"all_stores" boolean DEFAULT true NOT NULL,
	"store_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"factory_code" text,
	"status" text DEFAULT 'active' NOT NULL,
	"density" text DEFAULT 'comfortable' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "member_status_idx" ON "org"."member" USING btree ("status");--> statement-breakpoint
ALTER TABLE "org"."session" ADD CONSTRAINT "session_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "org"."member"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org"."session" DROP COLUMN "member_name";--> statement-breakpoint
ALTER TABLE "org"."session" DROP COLUMN "member_roles";