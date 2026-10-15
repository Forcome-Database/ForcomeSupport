-- 待办 35（ADR 0015、ADR 0006「加列分三步」的第一步）：进线邮箱加服务商与 IMAP 服务器、端口（可空，0038 给已有的行补 gmail，0039 改为必填）；
-- 163 企业邮箱的客户端授权码表；同步记录加 IMAP 游标；消息与回放清单加与服务商无关的消息标识、线程（0038 从 gmail_* 回填，0039 删旧列）。
CREATE TABLE "integration"."mailbox_credential" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"address" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mailbox_credential_address_key" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "channel"."mail_replay_item" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "channel"."mailbox_sync" ADD COLUMN "imap_cursor" jsonb;--> statement-breakpoint
ALTER TABLE "channel"."mailbox_sync" ADD COLUMN "imap_backfill_cursor" jsonb;--> statement-breakpoint
ALTER TABLE "channel"."message" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "channel"."message" ADD COLUMN "thread_id" text;--> statement-breakpoint
ALTER TABLE "channel"."store_mailbox" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "channel"."store_mailbox" ADD COLUMN "imap_host" text;--> statement-breakpoint
ALTER TABLE "channel"."store_mailbox" ADD COLUMN "imap_port" integer;--> statement-breakpoint
ALTER TABLE "ticket"."pending_reply" ADD COLUMN "thread_id" text;