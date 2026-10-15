-- 待办 35（ADR 0006「加列分三步」的第二步）：已有的进线邮箱都是 Gmail；消息、回放清单与等着的回复的消息标识、线程从 gmail_* 列回填。
-- 只补空值，重跑无害。0039 再把服务商与消息标识改为必填、删掉 gmail_* 列。
UPDATE "channel"."store_mailbox" SET "provider" = 'gmail' WHERE "provider" IS NULL;
--> statement-breakpoint
UPDATE "channel"."message"
SET "provider_message_id" = "gmail_message_id", "thread_id" = "gmail_thread_id"
WHERE "provider_message_id" IS NULL;
--> statement-breakpoint
UPDATE "channel"."mail_replay_item" SET "provider_message_id" = "gmail_message_id" WHERE "provider_message_id" IS NULL;
--> statement-breakpoint
UPDATE "ticket"."pending_reply" SET "thread_id" = "gmail_thread_id" WHERE "thread_id" IS NULL;
