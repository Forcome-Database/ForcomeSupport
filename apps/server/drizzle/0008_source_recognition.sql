CREATE TABLE "channel"."sender_rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"pattern" text NOT NULL,
	"header_value" text,
	"source" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel"."message" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "channel"."message" ADD COLUMN "sender_address" text;--> statement-breakpoint
ALTER TABLE "channel"."message" ADD COLUMN "sender_name" text;--> statement-breakpoint
ALTER TABLE "ticket"."ticket" ADD COLUMN "source" text;--> statement-breakpoint
CREATE UNIQUE INDEX "sender_rule_match_key" ON "channel"."sender_rule" USING btree ("kind","pattern",coalesce("header_value", ''));