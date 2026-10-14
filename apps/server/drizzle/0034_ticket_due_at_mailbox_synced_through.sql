ALTER TABLE "channel"."mailbox_sync" ADD COLUMN "synced_through" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket"."status_change" ADD COLUMN "due_at" timestamp with time zone;