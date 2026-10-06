-- 待办 06：给 0020 加的成员列补上已有的值（P20「最近登录」与 G7 的「刚被谁修改」），只用一次。
-- 两者以前只记在审计里：最近登录取每人最后一条「登录」（auth.login）；最近一次改角色、店铺范围或在职状态取该成员最后一条成员记录
-- （待办 05 的「钉钉离职停用」「钉钉恢复在职」，操作人「系统」）。审计表在 core，这是迁移里的一次性数据修补，代码里 org 仍不读它。
UPDATE "org"."member" AS m
  SET "last_login_at" = l."at"
  FROM (
    SELECT "actor_id", max("occurred_at") AS "at"
    FROM "core"."audit_log"
    WHERE "action" = 'auth.login' AND "actor_id" IS NOT NULL
    GROUP BY "actor_id"
  ) AS l
  WHERE m."id" = l."actor_id" AND m."last_login_at" IS NULL;
--> statement-breakpoint
UPDATE "org"."member" AS m
  SET "changed_at" = c."occurred_at", "changed_by_name" = c."actor_name"
  FROM (
    SELECT DISTINCT ON ("object_id") "object_id", "occurred_at", "actor_name"
    FROM "core"."audit_log"
    WHERE "object_type" = 'member' AND "action" LIKE 'member.%'
    ORDER BY "object_id", "occurred_at" DESC
  ) AS c
  WHERE m."id"::text = c."object_id" AND m."changed_at" IS NULL;
