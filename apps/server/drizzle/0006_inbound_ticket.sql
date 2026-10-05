CREATE TABLE "channel"."mailbox_sync" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"address" text NOT NULL,
	"history_id" text,
	"watch_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mailbox_sync_address_key" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "channel"."message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"mailbox" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"gmail_thread_id" text NOT NULL,
	"direction" text NOT NULL,
	"rfc_message_id" text,
	"in_reply_to" text,
	"references" text[] DEFAULT '{}'::text[] NOT NULL,
	"from_address" text NOT NULL,
	"from_name" text NOT NULL,
	"to_addresses" text[] DEFAULT '{}'::text[] NOT NULL,
	"subject" text NOT NULL,
	"text_body" text,
	"html_body" text,
	"headers" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"store_id" uuid,
	"channel" text,
	"site" text,
	"duplicate_of_id" uuid,
	"also_sent_to" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "message_mailbox_gmail_id_key" UNIQUE("mailbox","gmail_message_id")
);
--> statement-breakpoint
CREATE TABLE "ticket"."customer" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket"."customer_identity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"customer_id" uuid NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "customer_identity_address_key" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "ticket"."status_change" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"event" text NOT NULL,
	"trigger" text NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"close_reason" text,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket"."ticket" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"store_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"site" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"order_number" text,
	"status" text NOT NULL,
	"close_reason" text,
	"first_inbound_at" timestamp with time zone NOT NULL,
	"last_inbound_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ticket_number_key" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "ticket"."ticket_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"channel_message_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel"."message" ADD CONSTRAINT "message_store_id_store_id_fk" FOREIGN KEY ("store_id") REFERENCES "channel"."store"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel"."message" ADD CONSTRAINT "message_duplicate_of_id_message_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "channel"."message"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket"."customer_identity" ADD CONSTRAINT "customer_identity_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "ticket"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket"."status_change" ADD CONSTRAINT "status_change_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "ticket"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket"."ticket" ADD CONSTRAINT "ticket_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "ticket"."customer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket"."ticket_message" ADD CONSTRAINT "ticket_message_ticket_id_ticket_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "ticket"."ticket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "message_rfc_message_id_key" ON "channel"."message" USING btree ("rfc_message_id") WHERE "channel"."message"."duplicate_of_id" IS NULL AND "channel"."message"."rfc_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "message_store_received_idx" ON "channel"."message" USING btree ("store_id","received_at");--> statement-breakpoint
CREATE INDEX "customer_identity_customer_idx" ON "ticket"."customer_identity" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "status_change_ticket_idx" ON "ticket"."status_change" USING btree ("ticket_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ticket_open_without_order_idx" ON "ticket"."ticket" USING btree ("store_id","customer_id") WHERE "ticket"."ticket"."order_number" IS NULL AND "ticket"."ticket"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "ticket_store_last_inbound_idx" ON "ticket"."ticket" USING btree ("store_id","last_inbound_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_message_channel_message_key" ON "ticket"."ticket_message" USING btree ("channel_message_id");--> statement-breakpoint
CREATE INDEX "ticket_message_ticket_idx" ON "ticket"."ticket_message" USING btree ("ticket_id","received_at");