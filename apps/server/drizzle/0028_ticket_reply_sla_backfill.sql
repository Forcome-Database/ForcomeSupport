-- 待办 16：给 0027 加的列补上已有的值，只用一次（已部署的开发测试环境有 08–14 归并出的工单；生产还没有数据）。
-- 来信的来源与渠道以前只记在收取的邮件上（channel.message）：工单里的来信照抄过来。应回复来信（来源为客户）补 SLA 截止
-- （到达 + 24 小时），以前没有回复识别、都还没回复，过了截止的为未达标、其余未到期。新建、追加与重开的状态变更补上触发的来信：
-- 与它同一事务写入的工单消息（写入时刻相同）。收取的邮件在 channel，这是迁移里的一次性数据修补，代码里 ticket 仍经 channel 的读服务取。
UPDATE "ticket"."ticket_message" AS tm
  SET "source" = m."source", "channel" = m."channel"
  FROM "channel"."message" AS m
  WHERE m."id" = tm."channel_message_id" AND tm."direction" = 'inbound' AND tm."source" IS NULL;
--> statement-breakpoint
UPDATE "ticket"."ticket_message"
  SET "sla_due_at" = "received_at" + interval '24 hours',
      "sla_result" = CASE WHEN "received_at" + interval '24 hours' < now() THEN 'missed' ELSE 'pending' END
  WHERE "direction" = 'inbound' AND "source" = 'customer' AND "sla_due_at" IS NULL;
--> statement-breakpoint
UPDATE "ticket"."status_change" AS c
  SET "channel_message_id" = tm."channel_message_id"
  FROM "ticket"."ticket_message" AS tm
  WHERE c."event" IN ('inbound', 'inbound_reopen') AND c."channel_message_id" IS NULL
    AND tm."ticket_id" = c."ticket_id" AND tm."created_at" = c."occurred_at" AND tm."direction" = 'inbound';
