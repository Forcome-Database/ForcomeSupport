-- 待办 19：售后台账的参考数据（所有环境相同，参考数据用迁移写入的约定见 ADR 0006「待办 10 落地」修订）。
-- 1. 集团内的两家生产厂（PRD 6.5「生产厂」、R-FT-07）：台账「生产厂」字段的取值；对接人、来信邮箱与工作台账号随第二期 P24。
-- 2. 责任类型的默认承担比例（R-AS-02、D-19，客户确认 Q-03）：三组都写工厂一侧（FSH = 100 − 工厂）；第二期 P23 维护。
-- SKU 与生产厂的归属不在这里：真实的归属表由业务提供后另写迁移（待办 32 跟踪），在那之前只在非生产环境随示例数据灌入。
INSERT INTO "factory"."factory" ("code", "created_at") VALUES
  ('FQD', now()),
  ('FZJ', now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "aftersales"."responsibility_ratio"
  ("responsibility", "product_factory_pct", "freight_factory_pct", "other_factory_pct", "created_at", "updated_at") VALUES
  ('customer_use', 0, 0, 0, now(), now()),
  ('product_quality', 100, 100, 100, now(), now()),
  ('logistics', 0, 0, 0, now(), now()),
  ('other', 50, 50, 50, now(), now())
ON CONFLICT DO NOTHING;
