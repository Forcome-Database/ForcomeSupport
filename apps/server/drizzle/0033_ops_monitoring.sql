CREATE TABLE "core"."alert" (
	"key" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"problem" text NOT NULL,
	"firing_since" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."backup_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"succeeded" boolean,
	"detail" text,
	CONSTRAINT "backup_run_kind_check" CHECK ("core"."backup_run"."kind" IN ('daily', 'manual', 'pre_migrate', 'after_restore'))
);
--> statement-breakpoint
CREATE TABLE "core"."exchange_rate_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "exchange_rate_sync_singleton_check" CHECK ("core"."exchange_rate_sync"."id" = 'exchange_rate'),
	CONSTRAINT "exchange_rate_sync_failures_check" CHECK ("core"."exchange_rate_sync"."consecutive_failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "core"."worker_heartbeat" (
	"id" text PRIMARY KEY NOT NULL,
	"beat_at" timestamp with time zone NOT NULL,
	"host" text NOT NULL,
	"pid" integer NOT NULL,
	CONSTRAINT "worker_heartbeat_singleton_check" CHECK ("core"."worker_heartbeat"."id" = 'worker')
);
--> statement-breakpoint
ALTER TABLE "order"."order_sweep" ADD COLUMN "failing_since" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "backup_run_started_idx" ON "core"."backup_run" USING btree ("started_at" desc);