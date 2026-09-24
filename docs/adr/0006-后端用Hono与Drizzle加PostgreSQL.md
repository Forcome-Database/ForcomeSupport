---
status: accepted
---

# 后端用 Node 24 + Hono + Drizzle + PostgreSQL 18，锁与实时推送都落在数据库上

后端技术栈（2026-09-24 用户同意）：

- **运行时与框架**：Node.js 24 LTS；Hono + `@hono/zod-openapi`。REST 接口直接用 `packages/contracts` 的 zod 模式声明，自动生成 OpenAPI 文档；前端用 `hono/client` 获得端到端类型。
- **数据库**：PostgreSQL 18，一个库；每个模块一个 schema，与 ADR 0005 的模块边界一一对应；`report` 使用只读角色。
- **数据访问与迁移**：Drizzle ORM，表结构写在各模块目录内；drizzle-kit 生成 SQL 迁移文件并提交进仓库，部署时先跑一次性的 `migrate` 容器。
- **数据约定**：主键用 UUIDv7，业务编号另设一列，由 `core` 在事务内生成；时间用 `timestamptz`（UTC）；金额用 `numeric(12,2)` + 币种，另存汇率与美元折算值；主表带 `version` 列做乐观锁；不做软删除，作废、取消用状态表示。
- **锁**：编辑锁（R-TK-06）与处理锁（R-AP-03）实现为数据库租约行（持锁人、加锁时间、最后活动时间），前端每 30 秒心跳，超时视为已释放，用单条 SQL 原子取锁。
- **审计**：应用层在同一事务内写入，记录操作人、角色、来源 IP 和完整的前后值；不用数据库触发器。
- **实时推送**：SSE。api 通过 PostgreSQL `LISTEN/NOTIFY` 获知变化，只推「某个对象变了」，前端收到后重新拉数据。
- **Compose 服务**：`caddy`（HTTPS、托管前端静态文件、外网路径白名单）、`api`、`worker`、`migrate`、`postgres`；附件存本地卷，经 `core` 的存储接口读写。是否加 Redis，由「讨论：后台任务与流程引擎」决定。

## Considered Options

- Fastify + tRPC：类型体验最好，但接口不是标准 REST，以后要把动作暴露为 MCP 工具或给外部调用，还得再包一层。
- NestJS：结构重，自带的模块系统与 ADR 0005 的 lint 边界重复。
- Prisma：有独立的 schema 语言，复杂查询要退回原生 SQL；Kysely 则需要自己写迁移。
- 锁和推送用 Redis：多一个有状态组件，要多备份一份；每天约 300 封来信的量级，数据库完全够用。
- WebSocket：双向通信在这里用不上；轮询会让锁释放和新来信有明显延迟。
- MinIO：社区版已砍掉管理界面，许可证改为 AGPL；本地卷加每日备份足够。

## Consequences

- 所有有状态的东西都在 PostgreSQL 和附件卷里，备份与恢复只需要处理这两处。
- `LISTEN/NOTIFY` 只在单个数据库内生效；api 扩成多个实例时，每个实例各自监听即可，不用改代码。
- 前端必须实现心跳和 SSE 断线重连；锁的剩余时间以服务端时间为准。
