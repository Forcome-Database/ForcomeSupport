-- 待办 10：来源规则表的种子（所有环境相同，协调者 2026-10-05 决定；清单与匹配优先级见规格 channel「来源识别」，
-- 实现见 channel/recognition.ts，参考数据用迁移写入的约定见 ADR 0006「待办 10 落地」修订）。
-- 发件域一律精确等于（不含子域）：amazon.com 不会命中买家消息的中转域 marketplace.amazon.com。
-- 生产厂邮箱不在这里：非生产环境随示例数据灌入，生产环境的真实名单与其他供应商等业务提供后另写迁移补（待办 32 跟踪）。
INSERT INTO "channel"."sender_rule" ("kind", "pattern", "header_value", "source", "label", "created_at") VALUES
  ('domain', 'amazon.com', NULL, 'platform_notification', '亚马逊平台通知（美国站）', now()),
  ('domain', 'amazon.ca', NULL, 'platform_notification', '亚马逊平台通知（加拿大站）', now()),
  ('domain', 'amazon.com.mx', NULL, 'platform_notification', '亚马逊平台通知（墨西哥站）', now()),
  ('domain', 'shopify.com', NULL, 'platform_notification', 'Shopify 系统邮件', now()),
  ('header', 'list-unsubscribe', NULL, 'marketing', '营销邮件（带退订头）', now()),
  ('header', 'precedence', 'bulk', 'marketing', '群发邮件（Precedence: bulk）', now()),
  ('header', 'precedence', 'list', 'marketing', '邮件列表（Precedence: list）', now()),
  ('header', 'precedence', 'junk', 'marketing', '垃圾邮件（Precedence: junk）', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 08 期间已入库的来信（本机与开发测试环境的示例回放）没有识别结果：先按「客户、发件地址即客户身份」补上，
-- 让下一个迁移能把工单的来源设为必填。这些旧数据按 08 的过渡口径入库（渠道一律邮件、站点取店铺默认站点），
-- 要按新口径重新识别时用「重放来信」清掉重来（非生产环境，docs/部署说明.md）。
UPDATE "channel"."message"
SET "source" = 'customer', "sender_address" = "from_address", "sender_name" = "from_name"
WHERE "duplicate_of_id" IS NULL AND "source" IS NULL;
--> statement-breakpoint
UPDATE "ticket"."ticket" SET "source" = 'customer' WHERE "source" IS NULL;
