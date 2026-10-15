-- 待办 35（ADR 0006「加列分三步」的第三步）：服务商与消息标识改为必填，消息标识的唯一键、回放清单的主键与线程的索引换到新列，
-- 删掉 gmail_message_id、gmail_thread_id；163 企业邮箱要有 IMAP 服务器与端口。另加「同一邮箱 + 方向 + Message-ID」的索引（ADR 0015 的去重）。
ALTER TABLE "channel"."message" DROP CONSTRAINT "message_mailbox_gmail_id_key";--> statement-breakpoint
DROP INDEX "channel"."mail_replay_item_pending_idx";--> statement-breakpoint
DROP INDEX "ticket"."pending_reply_thread_idx";--> statement-breakpoint
ALTER TABLE "channel"."mail_replay_item" DROP CONSTRAINT "mail_replay_item_mailbox_gmail_message_id_pk";--> statement-breakpoint
ALTER TABLE "channel"."mail_replay_item" ALTER COLUMN "provider_message_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "channel"."message" ALTER COLUMN "provider_message_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "channel"."store_mailbox" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "channel"."mail_replay_item" ADD CONSTRAINT "mail_replay_item_mailbox_provider_message_id_pk" PRIMARY KEY("mailbox","provider_message_id");--> statement-breakpoint
CREATE INDEX "message_mailbox_rfc_message_id_idx" ON "channel"."message" USING btree ("mailbox","direction","rfc_message_id");--> statement-breakpoint
CREATE INDEX "mail_replay_item_pending_idx" ON "channel"."mail_replay_item" USING btree ("internal_date","mailbox","provider_message_id") WHERE "channel"."mail_replay_item"."replayed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "pending_reply_thread_idx" ON "ticket"."pending_reply" USING btree ("mailbox","thread_id");--> statement-breakpoint
ALTER TABLE "channel"."mail_replay_item" DROP COLUMN "gmail_message_id";--> statement-breakpoint
ALTER TABLE "channel"."message" DROP COLUMN "gmail_message_id";--> statement-breakpoint
ALTER TABLE "channel"."message" DROP COLUMN "gmail_thread_id";--> statement-breakpoint
ALTER TABLE "ticket"."pending_reply" DROP COLUMN "gmail_thread_id";--> statement-breakpoint
ALTER TABLE "channel"."message" ADD CONSTRAINT "message_mailbox_provider_id_key" UNIQUE("mailbox","provider_message_id");--> statement-breakpoint
ALTER TABLE "channel"."store_mailbox" ADD CONSTRAINT "store_mailbox_imap_server_check" CHECK (("channel"."store_mailbox"."provider" = 'gmail' AND "channel"."store_mailbox"."imap_host" IS NULL AND "channel"."store_mailbox"."imap_port" IS NULL)
        OR ("channel"."store_mailbox"."provider" = 'qiye163' AND "channel"."store_mailbox"."imap_host" IS NOT NULL AND "channel"."store_mailbox"."imap_port" BETWEEN 1 AND 65535));