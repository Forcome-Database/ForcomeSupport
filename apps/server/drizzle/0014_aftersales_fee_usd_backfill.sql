-- 待办 20：给加列之前登记的售后单补冻结美元值（加列见 0013；分步加列的约定见 ADR 0006「待办 10 落地」修订）。
-- 美元金额不折算，美元值就是原值，汇率、汇率日期与来源留空。
-- 非美元金额要按费用发生日的汇率折算，迁移时汇率表还是空的，取不到当时的汇率：这类单只在开发与开发测试库里有
-- （原型示例单 S-20260911-0020 的 MX$889.00），由示例数据的加载步骤 aftersales.ledger 按夹具补齐；生产库此时没有台账数据。
UPDATE "aftersales"."aftersales" SET "product_cost_usd" = "product_cost"
  WHERE "product_cost_currency" = 'USD' AND "product_cost_usd" IS NULL;
--> statement-breakpoint
UPDATE "aftersales"."aftersales" SET "freight_usd" = "freight"
  WHERE "freight_currency" = 'USD' AND "freight_usd" IS NULL;
--> statement-breakpoint
UPDATE "aftersales"."aftersales" SET "compensation_usd" = "compensation"
  WHERE "compensation_currency" = 'USD' AND "compensation_usd" IS NULL;
--> statement-breakpoint
UPDATE "aftersales"."aftersales" SET "other_cost_usd" = "other_cost"
  WHERE "other_cost_currency" = 'USD' AND "other_cost_usd" IS NULL;
