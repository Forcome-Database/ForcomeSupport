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

## 修订（2026-09-24，交叉审查复核，见 `.scratch/tech-plan/reviews/复核结论.md`）

- **锁的活动时间**：租约行的「最后活动时间」是最后一次**用户操作**的时间（编辑、点击、输入），不是心跳时间。前端心跳只证明连接仍在，并携带最后一次用户操作时间；服务端按它判断 5 分钟（R-TK-06）或 10 分钟（R-AP-03）无操作后释放。验收须覆盖「页面开着但不操作」的场景。
- **收信并发**：消息表对「邮箱 + Gmail 消息 ID」加唯一约束，冲突即视为重复；归并在事务内按「店铺 + 订单号」或「店铺 + 客户渠道身份」取 `pg_advisory_xact_lock` 后再查再写；归并任务幂等。
- Compose 服务中「是否加 Redis 由后台任务讨论决定」已由 ADR 0008 定为不加。

## 修订（2026-10-04，待办 01 落地）

- **工具链**：TypeScript 6.0（typescript-eslint 尚不支持 TypeScript 7 的原生编译器）；后端用 tsdown 打包成 `dist/api.mjs`、`dist/worker.mjs`、`dist/migrate.mjs`，工作区包打进包里，其余依赖留在 `node_modules`；本机开发用 tsx 直接运行源码。三个入口共用 `core` 的 `startRuntime(数据库地址, { role })` 组装数据库连接池与 pg-boss；`core` 不再单独导出建连接池、建任务队列的函数，避免绕开它。
- **schema 与迁移**：schema 名就是模块名（`order` 是 SQL 保留字，drizzle 自动加引号，手写 SQL 必须写成 `"order"`）。drizzle-kit 读 `apps/server/src/modules/*/schema.ts`，迁移在 `apps/server/drizzle/`，执行记录在 drizzle-kit 默认的 `drizzle.__drizzle_migrations`；手写 SQL（角色、授权等）用 `drizzle-kit generate --custom` 生成空迁移再填写。CI 的 `pnpm db:verify` 重新生成一次，迁移目录有变化即失败（改了表却没生成迁移）。
- **执行迁移的数据库用户**需要 CREATEROLE（或为超级用户），因为迁移要创建 `report_reader` 角色并授予自己；生产库开通时由运维按此授权。
- **数据约定的落地**：主键默认值用 PostgreSQL 18 内置的 `uuidv7()`；列助手 `primaryId`、`timestamptz`、`amount`、`currency`、`version` 由 `core` 导出，各模块建表一律使用。每个费用项另存的汇率、汇率日期与来源、冻结美元值（PRD 11.1 AfterSales）随售后台账待办（19、20）按 R-AS-08 一起定义列组合，届时补进 `core` 的列助手。集成测试逐表核对：时间列都是 timestamptz、JSON 列都是 jsonb、numeric 都是 (12,2)、有金额列的表必须有币种列、`version` 是非空整数且默认 1、主键是 UUIDv7 的 `id`；例外登记在测试里并写明原因。
- **乐观锁**：主表更新经 `core` 的 `updateWithVersion(tx, 表, { id, version }, 新值)`，只在版本一致时更新并把版本加 1；没命中抛 `OptimisticLockError`，接口统一返回 409（`{ error: 'optimistic_lock', message: '数据已被他人修改' }`，不带表名与行 ID）。数据不做物理删除，没命中即视为版本冲突。它按 id 更新，调用方要先在店铺范围内取到对象（拿到 version）再调用；店铺范围的编译期约束随 04 号待办加到各模块仓储。
- **report 只读角色**：迁移创建 `report_reader`（NOLOGIN），授予应用自己的数据库用户；对各模块 schema 有 USAGE、全部表的 SELECT 以及以后新表的默认 SELECT，读不到 `pgboss` 与 `drizzle`。`report` 模块经 `runReportQuery` 在只读事务里 `SET LOCAL ROLE report_reader` 后查询，不另设登录账号与口令。
- **审计表** `core.audit_log`：操作人姓名与角色在写入时快照；带对象所属店铺 `store_id`，供 PRD 10.2 的店铺范围过滤；动作写成「对象.动词」（如 `store.create`、`member.disable`、`auth.login`），对象类型取 `contracts` 的 `auditObjectTypeLabels`（与 P27 筛选一致）。`core` 只对外提供写入 `recordAudit`；不带店铺范围的读取函数只供 `core` 内部与测试，不从 `index.ts` 导出（ADR 0010），P27 的查询由 30 号待办按 10.2 实现。
- **事务的当前时间**：`core` 的 `transaction(runtime, fn)` 在事务开始时从可注入时钟取一次时间（`tx.now`），事务内的审计与业务写入共用；回放与测试换成手动时钟即可。
- **业务编号**：`core.business_number_counter` 按（编号种类，计数周期）upsert 加 1，并发事务在同一行上排队，事务回滚则号不被占用。

## 修订（2026-10-04，待办 02 落地）

- **前端调接口**不用 `hono/client`，改为 `fetch` + `contracts` 的 zod 模式解析，原因见 ADR 0007 修订（前端不能引用后端代码）；接口仍用 `@hono/zod-openapi` 以 `contracts` 的模式声明。
- **接口约定**：请求参数不符合模式返回 400（`{ error: 'invalid_request', message: '请求参数不对：…' }`），不存在的接口返回 404 的 JSON（`{ error: 'not_found', message: '接口不存在' }`），请求体不是合法 JSON 返回 400 `invalid_request`，框架抛出的其他 HTTP 错误为 `http_error`，错误码与说明的形状是 `contracts` 的 `apiErrorSchema`。
- **会话表** `org.session`（ADR 0010 修订）：令牌只存 SHA-256，`member_id` 有索引供停用时失效会话。
