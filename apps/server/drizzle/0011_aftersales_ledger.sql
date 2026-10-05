CREATE TABLE "aftersales"."aftersales" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" text NOT NULL,
	"status" text NOT NULL,
	"origin" text NOT NULL,
	"store_id" uuid NOT NULL,
	"site" text,
	"source_ticket_id" uuid,
	"source_ticket_number" text,
	"order_number" text,
	"customer_id" uuid,
	"customer_name" text,
	"registered_by_id" uuid,
	"registered_by_name" text,
	"owner_id" uuid,
	"fee_date" date,
	"completed_at" timestamp with time zone,
	"method" text,
	"responsibility" text,
	"responsibility_reason" text,
	"factory_code" text,
	"part_sku" text,
	"part_quantity" smallint,
	"shipper" text,
	"carrier" text,
	"ship_date" date,
	"tracking_number" text,
	"claim_target" text,
	"claim_status" text,
	"product_cost" numeric(12, 2),
	"product_cost_currency" text,
	"freight" numeric(12, 2),
	"freight_currency" text,
	"compensation" numeric(12, 2),
	"compensation_currency" text,
	"other_cost" numeric(12, 2),
	"other_cost_currency" text,
	"product_factory_pct" smallint,
	"freight_factory_pct" smallint,
	"other_factory_pct" smallint,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "aftersales_number_key" UNIQUE("number"),
	CONSTRAINT "aftersales_product_factory_pct_check" CHECK ("aftersales"."aftersales"."product_factory_pct" BETWEEN 0 AND 100),
	CONSTRAINT "aftersales_freight_factory_pct_check" CHECK ("aftersales"."aftersales"."freight_factory_pct" BETWEEN 0 AND 100),
	CONSTRAINT "aftersales_other_factory_pct_check" CHECK ("aftersales"."aftersales"."other_factory_pct" BETWEEN 0 AND 100),
	CONSTRAINT "aftersales_part_quantity_check" CHECK ("aftersales"."aftersales"."part_quantity" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "aftersales"."responsibility_ratio" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"responsibility" text NOT NULL,
	"product_factory_pct" smallint NOT NULL,
	"freight_factory_pct" smallint NOT NULL,
	"other_factory_pct" smallint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "responsibility_ratio_responsibility_key" UNIQUE("responsibility"),
	CONSTRAINT "responsibility_ratio_product_check" CHECK ("aftersales"."responsibility_ratio"."product_factory_pct" BETWEEN 0 AND 100),
	CONSTRAINT "responsibility_ratio_freight_check" CHECK ("aftersales"."responsibility_ratio"."freight_factory_pct" BETWEEN 0 AND 100),
	CONSTRAINT "responsibility_ratio_other_check" CHECK ("aftersales"."responsibility_ratio"."other_factory_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "factory"."factory" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "factory_code_key" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "factory"."part" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"factory_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "part_sku_key" UNIQUE("sku")
);
--> statement-breakpoint
ALTER TABLE "factory"."part" ADD CONSTRAINT "part_factory_id_factory_id_fk" FOREIGN KEY ("factory_id") REFERENCES "factory"."factory"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aftersales_store_fee_date_idx" ON "aftersales"."aftersales" USING btree ("store_id","fee_date");