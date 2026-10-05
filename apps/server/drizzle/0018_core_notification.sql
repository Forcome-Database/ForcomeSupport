CREATE TABLE "core"."notification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"object_label" text NOT NULL,
	"store_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "notification_recipient_idx" ON "core"."notification" USING btree ("recipient_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "core"."notification" USING btree ("recipient_id","created_at" desc) WHERE "core"."notification"."read_at" IS NULL;