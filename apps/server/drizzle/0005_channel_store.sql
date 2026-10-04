CREATE TABLE "channel"."store" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"sites" text[] NOT NULL,
	"default_site" text NOT NULL,
	"platform_id" text NOT NULL,
	"adapter_mode" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_name" text,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel"."store_mailbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store_id" uuid NOT NULL,
	"address" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "store_mailbox_address_key" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "channel"."store_mailbox" ADD CONSTRAINT "store_mailbox_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "channel"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "store_name_key" ON "channel"."store" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "store_mailbox_store_idx" ON "channel"."store_mailbox" USING btree ("store_id");