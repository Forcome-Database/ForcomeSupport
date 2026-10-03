CREATE SCHEMA "aftersales";
--> statement-breakpoint
CREATE SCHEMA "ai";
--> statement-breakpoint
CREATE SCHEMA "approval";
--> statement-breakpoint
CREATE SCHEMA "channel";
--> statement-breakpoint
CREATE SCHEMA "core";
--> statement-breakpoint
CREATE SCHEMA "factory";
--> statement-breakpoint
CREATE SCHEMA "integration";
--> statement-breakpoint
CREATE SCHEMA "knowledge";
--> statement-breakpoint
CREATE SCHEMA "order";
--> statement-breakpoint
CREATE SCHEMA "org";
--> statement-breakpoint
CREATE SCHEMA "report";
--> statement-breakpoint
CREATE SCHEMA "ticket";
--> statement-breakpoint
CREATE TABLE "core"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"actor_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"ip" "inet",
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"object_label" text,
	"store_id" uuid,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "core"."business_number_counter" (
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "business_number_counter_kind_period_pk" PRIMARY KEY("kind","period")
);
--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "core"."audit_log" USING btree ("occurred_at" desc);--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "core"."audit_log" USING btree ("actor_id","occurred_at" desc);--> statement-breakpoint
CREATE INDEX "audit_log_object_idx" ON "core"."audit_log" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX "audit_log_store_idx" ON "core"."audit_log" USING btree ("store_id","occurred_at" desc);