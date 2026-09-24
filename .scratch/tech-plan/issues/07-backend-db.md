Title: 讨论：后端与数据库选型
Type: grilling
Status: open
Blocked by: 06
Map: ../map.md

# 讨论：后端与数据库选型

## Question

后端用什么 TypeScript 框架与数据访问方式，数据库用什么？

要定：Node 运行时与框架（如 NestJS、Fastify、Hono）；ORM 或查询构建器（如 Drizzle、Prisma、Kysely）；数据库（推荐 PostgreSQL）及版本；迁移管理；共享校验（zod）与接口约定（REST/OpenAPI、tRPC）；审计日志与乐观锁、编辑锁（R-TK-06）、审批处理锁（R-AP-03）的实现基础；Docker Compose 的服务划分（「讨论：部署拓扑与数据合规」留下），在 ADR 0005 的 api 与 worker 两个容器之外还需要哪些（数据库、缓存、反向代理、对象存储）。
