CREATE TABLE "core"."exchange_rate" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"date" date NOT NULL,
	"currency" text NOT NULL,
	"rate" numeric(12, 6) NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exchange_rate_date_currency_key" UNIQUE("date","currency"),
	CONSTRAINT "exchange_rate_rate_check" CHECK ("core"."exchange_rate"."rate" > 0),
	CONSTRAINT "exchange_rate_source_check" CHECK ("core"."exchange_rate"."source" IN ('ecb', 'frankfurter'))
);
--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "product_cost_usd" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "product_cost_rate" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "product_cost_rate_date" date;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "product_cost_rate_source" text;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "freight_usd" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "freight_rate" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "freight_rate_date" date;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "freight_rate_source" text;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "compensation_usd" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "compensation_rate" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "compensation_rate_date" date;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "compensation_rate_source" text;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "other_cost_usd" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "other_cost_rate" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "other_cost_rate_date" date;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "other_cost_rate_source" text;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD CONSTRAINT "aftersales_product_cost_conversion_check" CHECK (("aftersales"."aftersales"."product_cost_usd" IS NULL OR "aftersales"."aftersales"."product_cost" IS NOT NULL)
        AND (("aftersales"."aftersales"."product_cost_rate" IS NULL) = ("aftersales"."aftersales"."product_cost_rate_date" IS NULL))
        AND (("aftersales"."aftersales"."product_cost_rate" IS NULL) = ("aftersales"."aftersales"."product_cost_rate_source" IS NULL))
        AND ("aftersales"."aftersales"."product_cost_rate" IS NULL OR ("aftersales"."aftersales"."product_cost_rate" > 0 AND coalesce("aftersales"."aftersales"."product_cost_currency" <> 'USD', false)))
        AND ("aftersales"."aftersales"."product_cost_usd" IS NULL OR "aftersales"."aftersales"."product_cost_currency" <> 'USD' OR "aftersales"."aftersales"."product_cost_usd" = "aftersales"."aftersales"."product_cost")
        AND ("aftersales"."aftersales"."product_cost_usd" IS NULL OR "aftersales"."aftersales"."product_cost_currency" = 'USD' OR "aftersales"."aftersales"."product_cost_rate" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD CONSTRAINT "aftersales_freight_conversion_check" CHECK (("aftersales"."aftersales"."freight_usd" IS NULL OR "aftersales"."aftersales"."freight" IS NOT NULL)
        AND (("aftersales"."aftersales"."freight_rate" IS NULL) = ("aftersales"."aftersales"."freight_rate_date" IS NULL))
        AND (("aftersales"."aftersales"."freight_rate" IS NULL) = ("aftersales"."aftersales"."freight_rate_source" IS NULL))
        AND ("aftersales"."aftersales"."freight_rate" IS NULL OR ("aftersales"."aftersales"."freight_rate" > 0 AND coalesce("aftersales"."aftersales"."freight_currency" <> 'USD', false)))
        AND ("aftersales"."aftersales"."freight_usd" IS NULL OR "aftersales"."aftersales"."freight_currency" <> 'USD' OR "aftersales"."aftersales"."freight_usd" = "aftersales"."aftersales"."freight")
        AND ("aftersales"."aftersales"."freight_usd" IS NULL OR "aftersales"."aftersales"."freight_currency" = 'USD' OR "aftersales"."aftersales"."freight_rate" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD CONSTRAINT "aftersales_compensation_conversion_check" CHECK (("aftersales"."aftersales"."compensation_usd" IS NULL OR "aftersales"."aftersales"."compensation" IS NOT NULL)
        AND (("aftersales"."aftersales"."compensation_rate" IS NULL) = ("aftersales"."aftersales"."compensation_rate_date" IS NULL))
        AND (("aftersales"."aftersales"."compensation_rate" IS NULL) = ("aftersales"."aftersales"."compensation_rate_source" IS NULL))
        AND ("aftersales"."aftersales"."compensation_rate" IS NULL OR ("aftersales"."aftersales"."compensation_rate" > 0 AND coalesce("aftersales"."aftersales"."compensation_currency" <> 'USD', false)))
        AND ("aftersales"."aftersales"."compensation_usd" IS NULL OR "aftersales"."aftersales"."compensation_currency" <> 'USD' OR "aftersales"."aftersales"."compensation_usd" = "aftersales"."aftersales"."compensation")
        AND ("aftersales"."aftersales"."compensation_usd" IS NULL OR "aftersales"."aftersales"."compensation_currency" = 'USD' OR "aftersales"."aftersales"."compensation_rate" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD CONSTRAINT "aftersales_other_cost_conversion_check" CHECK (("aftersales"."aftersales"."other_cost_usd" IS NULL OR "aftersales"."aftersales"."other_cost" IS NOT NULL)
        AND (("aftersales"."aftersales"."other_cost_rate" IS NULL) = ("aftersales"."aftersales"."other_cost_rate_date" IS NULL))
        AND (("aftersales"."aftersales"."other_cost_rate" IS NULL) = ("aftersales"."aftersales"."other_cost_rate_source" IS NULL))
        AND ("aftersales"."aftersales"."other_cost_rate" IS NULL OR ("aftersales"."aftersales"."other_cost_rate" > 0 AND coalesce("aftersales"."aftersales"."other_cost_currency" <> 'USD', false)))
        AND ("aftersales"."aftersales"."other_cost_usd" IS NULL OR "aftersales"."aftersales"."other_cost_currency" <> 'USD' OR "aftersales"."aftersales"."other_cost_usd" = "aftersales"."aftersales"."other_cost")
        AND ("aftersales"."aftersales"."other_cost_usd" IS NULL OR "aftersales"."aftersales"."other_cost_currency" = 'USD' OR "aftersales"."aftersales"."other_cost_rate" IS NOT NULL));