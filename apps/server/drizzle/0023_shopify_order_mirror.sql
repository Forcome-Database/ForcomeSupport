CREATE TABLE "integration"."credential" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"system" text NOT NULL,
	"store_id" uuid NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "credential_system_store_key" UNIQUE("system","store_id")
);
--> statement-breakpoint
CREATE TABLE "order"."order_sync" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store_id" uuid NOT NULL,
	"source" text NOT NULL,
	"watermark" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"failing_since" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "order_sync_store_source_key" UNIQUE("store_id","source")
);
--> statement-breakpoint
CREATE TABLE "order"."platform_order" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"platform_order_id" text NOT NULL,
	"name" text,
	"status" text NOT NULL,
	"financial_status" text,
	"cancelled_at" timestamp with time zone,
	"line_items" jsonb NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"total_currency" text NOT NULL,
	"customer_email" text,
	"ship_country" text,
	"ship_address" jsonb,
	"tracking" jsonb NOT NULL,
	"placed_at" timestamp with time zone NOT NULL,
	"platform_updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "platform_order_store_order_key" ON "order"."platform_order" USING btree ("store_id","platform_order_id");--> statement-breakpoint
CREATE INDEX "platform_order_store_name_idx" ON "order"."platform_order" USING btree ("store_id","name") WHERE "order"."platform_order"."name" is not null;--> statement-breakpoint
CREATE INDEX "platform_order_store_email_idx" ON "order"."platform_order" USING btree ("store_id","customer_email");