-- 待办 08：工单状态只能经迁移表改变（ADR 0008）。状态由 ticket 模块的 ticket-status.ts 按迁移表写入，
-- 同一事务里写一条状态变更记录。提交时检查每张新建或改了状态（或关闭原因）的工单：状态与关闭原因必须等于
-- 它最近一条状态变更记录的目标状态与关闭原因，否则拒绝提交——绕过迁移表直接改这两列的写入因此无法生效。
-- 「最近一条」按写入先后（UUIDv7 主键，同一连接内单调递增），不按业务时间：回放与测试会把时钟拨回过去。
CREATE FUNCTION "ticket"."check_status_matches_log"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_status text;
  current_reason text;
  logged_status text;
  logged_reason text;
BEGIN
  -- 约束触发器在提交时才执行，NEW 是当时那一次写入的行，要重新读出提交前的最终状态
  SELECT status, close_reason INTO current_status, current_reason
    FROM "ticket"."ticket" WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT to_status, close_reason INTO logged_status, logged_reason
    FROM "ticket"."status_change"
    WHERE ticket_id = NEW.id
    ORDER BY id DESC
    LIMIT 1;
  IF logged_status IS DISTINCT FROM current_status
     OR logged_reason IS DISTINCT FROM current_reason THEN
    RAISE EXCEPTION '工单状态只能经迁移表改变（ADR 0008）：工单 % 的状态 %（关闭原因 %）与最近一条状态变更记录（% / %）不一致',
      NEW.number, current_status, coalesce(current_reason, '无'),
      coalesce(logged_status, '无'), coalesce(logged_reason, '无')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ticket_status_matches_log"
  AFTER INSERT OR UPDATE OF "status", "close_reason" ON "ticket"."ticket"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ticket"."check_status_matches_log"();
