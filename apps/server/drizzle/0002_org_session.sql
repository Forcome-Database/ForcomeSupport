CREATE TABLE "org"."session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"member_id" uuid NOT NULL,
	"member_name" text NOT NULL,
	"member_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "session_member_idx" ON "org"."session" USING btree ("member_id");