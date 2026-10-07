CREATE TABLE "ticket"."no_reply_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"channel_message_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"to_status" text,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD COLUMN "no_reply_by_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD COLUMN "no_reply_by_name" text;--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD COLUMN "no_reply_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket"."no_reply_event" ADD CONSTRAINT "no_reply_event_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "ticket"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "no_reply_event_ticket_idx" ON "ticket"."no_reply_event" USING btree ("ticket_id","occurred_at");--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD CONSTRAINT "ticket_message_no_reply" CHECK (("ticket"."ticket_message"."no_reply_by_id" IS NULL AND "ticket"."ticket_message"."no_reply_by_name" IS NULL AND "ticket"."ticket_message"."no_reply_at" IS NULL)
        OR ("ticket"."ticket_message"."no_reply_by_id" IS NOT NULL AND "ticket"."ticket_message"."no_reply_by_name" IS NOT NULL AND "ticket"."ticket_message"."no_reply_at" IS NOT NULL
          AND "ticket"."ticket_message"."direction" = 'inbound'));