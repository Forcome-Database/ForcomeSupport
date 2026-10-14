CREATE INDEX "status_change_trigger_message_idx" ON "ticket"."status_change" USING btree ("channel_message_id") WHERE "ticket"."status_change"."event" = 'inbound_reopen' OR ("ticket"."status_change"."event" = 'inbound' AND "ticket"."status_change"."from_status" IS NULL);--> statement-breakpoint
CREATE INDEX "ticket_message_customer_received_idx" ON "ticket"."ticket_message" USING btree ("received_at") WHERE "ticket"."ticket_message"."direction" = 'inbound' AND "ticket"."ticket_message"."source" = 'customer';--> statement-breakpoint
CREATE VIEW "ticket"."customer_letter" AS (SELECT "ticket"."ticket_message"."id" AS ticket_message_id, "ticket"."ticket_message"."ticket_id" AS ticket_id,
  "ticket"."ticket"."store_id" AS store_id, "ticket"."ticket"."site" AS site, "ticket"."ticket_message"."received_at" AS received_at,
  "ticket"."ticket_message"."channel" AS channel, "ticket"."ticket_message"."first_reply_at" AS first_reply_at, "ticket"."ticket_message"."sla_result" AS sla_result
FROM "ticket"."ticket_message"
JOIN "ticket"."ticket" ON "ticket"."ticket"."id" = "ticket"."ticket_message"."ticket_id"
WHERE "ticket"."ticket_message"."direction" = 'inbound' AND "ticket"."ticket_message"."source" = 'customer');--> statement-breakpoint
CREATE VIEW "ticket"."customer_trigger_event" AS (SELECT "ticket"."status_change"."id" AS status_change_id, "ticket"."status_change"."ticket_id" AS ticket_id,
  "ticket"."ticket"."store_id" AS store_id, "ticket"."ticket"."site" AS site,
  "ticket"."ticket_message"."received_at" AS received_at, "ticket"."ticket_message"."channel" AS channel
FROM "ticket"."status_change"
JOIN "ticket"."ticket_message" ON "ticket"."ticket_message"."channel_message_id" = "ticket"."status_change"."channel_message_id"
JOIN "ticket"."ticket" ON "ticket"."ticket"."id" = "ticket"."status_change"."ticket_id"
WHERE ("ticket"."status_change"."event" = 'inbound_reopen' OR ("ticket"."status_change"."event" = 'inbound' AND "ticket"."status_change"."from_status" IS NULL))
  AND "ticket"."ticket_message"."direction" = 'inbound' AND "ticket"."ticket_message"."source" = 'customer');