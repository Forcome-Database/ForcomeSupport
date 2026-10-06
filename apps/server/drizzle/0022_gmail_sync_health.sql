CREATE TABLE "integration"."call_record" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"system" text NOT NULL,
	"operation" text NOT NULL,
	"store_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"outcome" text NOT NULL,
	"status" integer,
	"request" text NOT NULL,
	"response" text
);
--> statement-breakpoint
DROP INDEX "channel"."message_rfc_message_id_key";--> statement-breakpoint
ALTER TABLE "channel"."mailbox_sync" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel"."mailbox_sync" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "channel"."mailbox_sync" ADD COLUMN "failing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel"."mailbox_sync" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "channel"."mailbox_sync" ADD COLUMN "backfill_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channel"."mailbox_sync" ADD COLUMN "backfill_history_id" text;--> statement-breakpoint
CREATE INDEX "call_record_system_started_idx" ON "integration"."call_record" USING btree ("system","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_rfc_message_id_key" ON "channel"."message" USING btree ("direction","rfc_message_id") WHERE "channel"."message"."duplicate_of_id" IS NULL AND "channel"."message"."rfc_message_id" IS NOT NULL;