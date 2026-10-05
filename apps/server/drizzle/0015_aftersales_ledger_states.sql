ALTER TABLE "aftersales"."aftersales" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "product_cost_kept" boolean;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "freight_kept" boolean;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "compensation_kept" boolean;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "other_cost_kept" boolean;--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD COLUMN "updated_by_name" text;--> statement-breakpoint
CREATE INDEX "aftersales_completed_at_idx" ON "aftersales"."aftersales" USING btree ("completed_at");--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD CONSTRAINT "aftersales_completed_at_check" CHECK ("aftersales"."aftersales"."status" = 'completed' OR "aftersales"."aftersales"."completed_at" IS NULL);--> statement-breakpoint
ALTER TABLE "aftersales"."aftersales" ADD CONSTRAINT "aftersales_cancellation_check" CHECK ("aftersales"."aftersales"."status" = 'cancelled' OR ("aftersales"."aftersales"."cancel_reason" IS NULL AND "aftersales"."aftersales"."cancelled_at" IS NULL
        AND "aftersales"."aftersales"."product_cost_kept" IS NULL AND "aftersales"."aftersales"."freight_kept" IS NULL
        AND "aftersales"."aftersales"."compensation_kept" IS NULL AND "aftersales"."aftersales"."other_cost_kept" IS NULL));