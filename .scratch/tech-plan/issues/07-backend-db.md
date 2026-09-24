Title: 讨论：后端与数据库选型
Type: grilling
Status: resolved
Blocked by: 06
Map: ../map.md

# 讨论：后端与数据库选型

## Question

后端用什么 TypeScript 框架与数据访问方式，数据库用什么？

要定：Node 运行时与框架（如 NestJS、Fastify、Hono）；ORM 或查询构建器（如 Drizzle、Prisma、Kysely）；数据库（推荐 PostgreSQL）及版本；迁移管理；共享校验（zod）与接口约定（REST/OpenAPI、tRPC）；审计日志与乐观锁、编辑锁（R-TK-06）、审批处理锁（R-AP-03）的实现基础；Docker Compose 的服务划分（「讨论：部署拓扑与数据合规」留下），在 ADR 0005 的 api 与 worker 两个容器之外还需要哪些（数据库、缓存、反向代理、对象存储）。

## Answer

2026-09-24 用户同意全部推荐，详见 ADR [0006 后端用 Hono 与 Drizzle 加 PostgreSQL](../../../docs/adr/0006-后端用Hono与Drizzle加PostgreSQL.md)。

- **运行时与框架**：Node 24 LTS；Hono + `@hono/zod-openapi`（REST + OpenAPI，前端用 `hono/client` 获得类型）。
- **数据库**：PostgreSQL 18，一个模块一个 schema，`report` 用只读角色。
- **数据访问**：Drizzle ORM；drizzle-kit 生成 SQL 迁移并提交进仓库，部署时先跑 `migrate` 容器。
- **数据约定**：UUIDv7 主键 + 业务编号列；`timestamptz`（UTC）；`numeric(12,2)` + 币种 + 汇率；`version` 乐观锁；不做软删除。
- **锁**：数据库租约行 + 前端每 30 秒心跳。
- **审计**：应用层在同一事务内写入，记完整的前后值。
- **实时**：SSE + PostgreSQL `LISTEN/NOTIFY`。
- **Compose**：`caddy`、`api`、`worker`、`migrate`、`postgres`；附件存本地卷。Redis 待「讨论：后台任务与流程引擎」决定。

## Comments

2026-09-24（交叉审查复核后修订，见 `reviews/复核结论.md`、PRD D-22）：
- 锁的「最后活动时间」是最后一次用户操作的时间，心跳只证明连接在、不续期（原 Answer 未区分）。
- 新增：收信去重用「邮箱 + Gmail 消息 ID」唯一约束，归并按合并键取 advisory lock（ADR 0006 修订）。
