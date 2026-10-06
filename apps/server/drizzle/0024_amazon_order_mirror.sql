CREATE TABLE "order"."order_queue" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"failing_since" timestamp with time zone,
	"last_error" text,
	"backlog" integer,
	"checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "order_queue_name_key" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "order"."platform_order" ALTER COLUMN "total_amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order"."platform_order" ALTER COLUMN "total_currency" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order"."platform_order" ADD COLUMN "fulfillment_channel" text;--> statement-breakpoint
ALTER TABLE "order"."platform_order" ADD COLUMN "promised_ship_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order"."platform_order" ADD COLUMN "promised_delivery_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order"."platform_order" ADD CONSTRAINT "platform_order_total_pair" CHECK (("order"."platform_order"."total_amount" is null) = ("order"."platform_order"."total_currency" is null));