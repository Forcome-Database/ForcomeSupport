CREATE TABLE "channel"."mail_cutover" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"t0" timestamp with time zone NOT NULL,
	"replay_from" timestamp with time zone NOT NULL,
	"listed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_cutover_single_row_check" CHECK ("channel"."mail_cutover"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "channel"."mail_replay_item" (
	"mailbox" text NOT NULL,
	"gmail_message_id" text NOT NULL,
	"internal_date" timestamp with time zone NOT NULL,
	"replayed_at" timestamp with time zone,
	CONSTRAINT "mail_replay_item_mailbox_gmail_message_id_pk" PRIMARY KEY("mailbox","gmail_message_id")
);
--> statement-breakpoint
ALTER TABLE "channel"."mailbox_sync" ADD COLUMN "watched_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "mail_replay_item_pending_idx" ON "channel"."mail_replay_item" USING btree ("internal_date","mailbox","gmail_message_id") WHERE "channel"."mail_replay_item"."replayed_at" IS NULL;--> statement-breakpoint
-- 已有游标的邮箱：第一次 watch 的时刻按同步记录建立的时刻算（待办 26，历史回放的 T0 不能早于它）
UPDATE "channel"."mailbox_sync" SET "watched_at" = "created_at" WHERE "history_id" IS NOT NULL;
