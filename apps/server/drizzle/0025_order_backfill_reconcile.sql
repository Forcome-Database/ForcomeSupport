CREATE TABLE "order"."order_sweep" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"window_days" integer NOT NULL,
	"history_limited" boolean DEFAULT false NOT NULL,
	"since" timestamp with time zone NOT NULL,
	"cursor" text,
	"cursor_at" timestamp with time zone,
	"pages" integer DEFAULT 0 NOT NULL,
	"orders" integer DEFAULT 0 NOT NULL,
	"changed" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "order_sweep_store_kind_key" UNIQUE("store_id","kind")
);
