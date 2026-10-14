ALTER TABLE "ticket"."status_change" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
-- 已有的按时关闭（待办 33）：到期时刻 = 关闭时已归并的最近一封来信（工单消息建于关闭之前）+ 7 / 14 天，不晚于关闭时刻；
-- 回填不出的（没有这样的来信，LEAST 忽略空值）取关闭时刻
UPDATE "ticket"."status_change" AS sc
SET "due_at" = LEAST(
  sc."occurred_at",
  (SELECT max(tm."received_at") FROM "ticket"."ticket_message" AS tm
    WHERE tm."ticket_id" = sc."ticket_id" AND tm."direction" = 'inbound' AND tm."created_at" <= sc."occurred_at")
    + CASE sc."event" WHEN 'idle_14_days' THEN interval '14 days' ELSE interval '7 days' END
)
WHERE sc."event" IN ('idle_7_days', 'idle_14_days');--> statement-breakpoint
ALTER TABLE "ticket"."status_change" ADD CONSTRAINT "status_change_due_at" CHECK (("ticket"."status_change"."event" IN ('idle_7_days', 'idle_14_days')) = ("ticket"."status_change"."due_at" IS NOT NULL) AND "ticket"."status_change"."due_at" <= "ticket"."status_change"."occurred_at");
