CREATE VIEW "aftersales"."aftersales_cost" AS (SELECT aftersales_id, store_id, fee_date, responsibility,
  product_cost_usd::numeric(12, 2) AS product_cost_usd, freight_usd::numeric(12, 2) AS freight_usd, compensation_usd::numeric(12, 2) AS compensation_usd, other_cost_usd::numeric(12, 2) AS other_cost_usd,
  (coalesce(product_cost_usd, 0) + coalesce(freight_usd, 0) + coalesce(compensation_usd, 0) + coalesce(other_cost_usd, 0))::numeric(12, 2) AS total_usd
FROM (
  SELECT "aftersales"."aftersales"."id" AS aftersales_id, "aftersales"."aftersales"."store_id" AS store_id,
    "aftersales"."aftersales"."fee_date" AS fee_date, "aftersales"."aftersales"."responsibility" AS responsibility,
    CASE WHEN "aftersales"."aftersales"."status" = 'cancelled' AND "aftersales"."aftersales"."product_cost_usd" IS NOT NULL AND "aftersales"."aftersales"."product_cost_kept" IS NOT TRUE THEN 0 ELSE "aftersales"."aftersales"."product_cost_usd" END AS product_cost_usd,
    CASE WHEN "aftersales"."aftersales"."status" = 'cancelled' AND "aftersales"."aftersales"."freight_usd" IS NOT NULL AND "aftersales"."aftersales"."freight_kept" IS NOT TRUE THEN 0 ELSE "aftersales"."aftersales"."freight_usd" END AS freight_usd,
    CASE WHEN "aftersales"."aftersales"."status" = 'cancelled' AND "aftersales"."aftersales"."compensation_usd" IS NOT NULL AND "aftersales"."aftersales"."compensation_kept" IS NOT TRUE THEN 0 ELSE "aftersales"."aftersales"."compensation_usd" END AS compensation_usd,
    CASE WHEN "aftersales"."aftersales"."status" = 'cancelled' AND "aftersales"."aftersales"."other_cost_usd" IS NOT NULL AND "aftersales"."aftersales"."other_cost_kept" IS NOT TRUE THEN 0 ELSE "aftersales"."aftersales"."other_cost_usd" END AS other_cost_usd
  FROM "aftersales"."aftersales"
  WHERE "aftersales"."aftersales"."status" <> 'pending_confirmation'
) AS counted);