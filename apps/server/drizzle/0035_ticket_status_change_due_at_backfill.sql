-- 待办 33：给 0034 加的到期时刻补上已有的按时关闭，只用一次（已部署的开发测试环境有 16 号以来的关闭；生产还没有数据）。
-- 到期时刻 = 关闭时已归并的最近一封来信（工单消息建于关闭之前；回放里同一时刻先扫描再入库，同一时刻建的不算）+ 7 / 14 天，
-- 不晚于关闭时刻；回填不出的（没有这样的来信，LEAST 忽略空值）取关闭时刻。邮箱的 synced_through 不回填：下一次同步成功时写上，
-- 在那之前按时关闭等着（最多约 5 分钟）。
UPDATE "ticket"."status_change" AS sc
SET "due_at" = LEAST(
  sc."occurred_at",
  (SELECT max(tm."received_at") FROM "ticket"."ticket_message" AS tm
    WHERE tm."ticket_id" = sc."ticket_id" AND tm."direction" = 'inbound' AND tm."created_at" < sc."occurred_at")
    + CASE sc."event" WHEN 'idle_14_days' THEN interval '14 days' ELSE interval '7 days' END
)
WHERE sc."event" IN ('idle_7_days', 'idle_14_days');
