-- 报表只读角色（ADR 0005、0006）：report 模块在事务里 SET LOCAL ROLE report_reader 后直读各模块的表。
-- 角色是整个数据库集群共用的，同一集群里的第二个库（测试模板、开发测试库）再跑迁移时不能重复创建。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'report_reader') THEN
    CREATE ROLE report_reader NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- 应用自己的数据库用户要能切换到这个角色
GRANT report_reader TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "aftersales", "ai", "approval", "channel", "core", "factory", "integration", "knowledge", "order", "org", "report", "ticket" TO report_reader;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA "aftersales", "ai", "approval", "channel", "core", "factory", "integration", "knowledge", "order", "org", "report", "ticket" TO report_reader;
--> statement-breakpoint
-- 以后迁移在这些 schema 里新建的表与视图自动可读（迁移始终由同一个应用用户执行）
ALTER DEFAULT PRIVILEGES IN SCHEMA "aftersales", "ai", "approval", "channel", "core", "factory", "integration", "knowledge", "order", "org", "report", "ticket" GRANT SELECT ON TABLES TO report_reader;
