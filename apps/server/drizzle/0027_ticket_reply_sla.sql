CREATE TABLE "ticket"."pending_reply" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"channel_message_id" uuid NOT NULL,
	"mailbox" text NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"reply_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"waiting_since" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket"."status_change" ADD COLUMN "channel_message_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD COLUMN "channel" text;--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD COLUMN "first_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD COLUMN "sla_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD COLUMN "sla_result" text;--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD COLUMN "auto_reply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pending_reply_channel_message_key" ON "ticket"."pending_reply" USING btree ("channel_message_id");--> statement-breakpoint
CREATE INDEX "pending_reply_thread_idx" ON "ticket"."pending_reply" USING btree ("mailbox","gmail_thread_id");--> statement-breakpoint
CREATE INDEX "ticket_open_last_inbound_idx" ON "ticket"."ticket" USING btree ("status","last_inbound_at") WHERE "ticket"."ticket"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "ticket_message_sla_pending_idx" ON "ticket"."ticket_message" USING btree ("sla_due_at") WHERE "ticket"."ticket_message"."sla_result" = 'pending';--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD CONSTRAINT "ticket_message_sla_pair" CHECK (("ticket"."ticket_message"."sla_due_at" IS NULL) = ("ticket"."ticket_message"."sla_result" IS NULL));