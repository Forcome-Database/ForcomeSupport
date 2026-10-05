-- 待办 08：工单状态只能经迁移表改变（ADR 0008）。状态由 ticket 模块的 ticket-status.ts 按迁移表写入，
-- 同一事务里写一条状态变更记录。提交时检查每张新建或改了状态的工单：状态必须等于它最近一条状态变更记录的
-- 目标状态，否则拒绝提交——绕过迁移表直接改状态列的写入因此无法生效。
CREATE FUNCTION "ticket"."check_status_matches_log"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_status text;
  logged_status text;
BEGIN
  -- 约束触发器在提交时才执行，NEW 是当时那一次写入的行，要重新读出提交前的最终状态
  SELECT status INTO current_status FROM "ticket"."ticket" WHERE id = NEW.id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT to_status INTO logged_status
    FROM "ticket"."status_change"
    WHERE ticket_id = NEW.id
    ORDER BY occurred_at DESC, id DESC
    LIMIT 1;
  IF logged_status IS DISTINCT FROM current_status THEN
    RAISE EXCEPTION '工单状态只能经迁移表改变（ADR 0008）：工单 % 的状态 % 与最近一条状态变更记录（%）不一致',
      NEW.number, current_status, coalesce(logged_status, '无')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ticket_status_matches_log"
  AFTER INSERT OR UPDATE OF "status" ON "ticket"."ticket"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ticket"."check_status_matches_log"();
