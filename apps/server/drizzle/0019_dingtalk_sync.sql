CREATE TABLE "core"."work_notification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"dingtalk_user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"object_label" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"task_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failed_at" timestamp with time zone,
	CONSTRAINT "work_notification_attempts_check" CHECK ("core"."work_notification"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "org"."department" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"dingtalk_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_dingtalk_id" text,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "department_dingtalk_id_unique" UNIQUE("dingtalk_id")
);
--> statement-breakpoint
CREATE TABLE "org"."dingtalk_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "dingtalk_sync_singleton_check" CHECK ("org"."dingtalk_sync"."id" = 'directory'),
	CONSTRAINT "dingtalk_sync_failures_check" CHECK ("org"."dingtalk_sync"."consecutive_failures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "org"."member" ADD COLUMN "dingtalk_user_id" text;--> statement-breakpoint
ALTER TABLE "org"."member" ADD COLUMN "dingtalk_union_id" text;--> statement-breakpoint
ALTER TABLE "org"."member" ADD COLUMN "dingtalk_department_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "org"."member" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "org"."member" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "org"."member" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org"."member" ADD COLUMN "dingtalk_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "work_notification_pending_idx" ON "core"."work_notification" USING btree ("dingtalk_user_id","created_at") WHERE "core"."work_notification"."sent_at" IS NULL AND "core"."work_notification"."failed_at" IS NULL;--> statement-breakpoint
ALTER TABLE "org"."member" ADD CONSTRAINT "member_dingtalk_user_id_unique" UNIQUE("dingtalk_user_id");--> statement-breakpoint
ALTER TABLE "org"."member" ADD CONSTRAINT "member_dingtalk_union_id_unique" UNIQUE("dingtalk_union_id");--> statement-breakpoint
ALTER TABLE "org"."member" ADD CONSTRAINT "member_disabled_reason_check" CHECK ("org"."member"."disabled_reason" IS NULL OR "org"."member"."status" = 'disabled');