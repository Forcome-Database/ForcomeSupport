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

## 修订（2026-10-05，待办 07 落地）

- **表单字段级错误**：保存类接口判断出字段填错时，模块抛 `core` 的 `FieldValidationError(fields)`，接口统一返回 400 `{ error: 'invalid_request', message: '请按提示修改后再保存', fields }`；`fields` 的键是字段路径（如 `name`、`mailboxes.2`），值是写在字段下方的中文说明（「哪里错 + 怎么改」），形状见 `contracts` 的 `FieldErrors` 与 `apiErrorSchema.fields`。要查库的错误（店铺名、邮箱重复等）与表单本身能判断的错误在同一次响应里列全（K8：保存后定位到第一个错误）。请求体形状不符（类型不对）仍是不带 `fields` 的 400。
- **先查后写的唯一性**：「不能重复」要给出字段级错误，所以先查后写，并在事务级咨询锁下串行（店铺配置用 `pg_advisory_xact_lock(hashtext('channel.store_config'))`），表上另有唯一约束兜底（`lower(name)`、进线邮箱地址）。
- **编辑与乐观锁**：编辑接口先比版本号（不是最新的返回 409，表单是照旧版本填的，不拿别人改过的数据判断对错），再把表单本身的错误与查库的重复一次列全；更新经 `updateWithVersion`。
- 迁移 `0005_channel_store`：`channel.store`（店铺）、`channel.store_mailbox`（进线邮箱，地址小写、全表唯一）。

## 修订（2026-10-05，待办 10 落地）

- **参考数据用迁移写入**：所有环境都要有、内容相同的配置数据（第一个是来源规则表的平台通知与营销规则）由 `drizzle-kit generate --custom` 生成的自定义迁移写入（迁移 0009，`INSERT … ON CONFLICT DO NOTHING`），随 `migrate` 进入生产；示例数据夹具只用于非生产环境，不能承担这类数据。只在某些环境才有、或要等业务提供的内容（真实生产厂邮箱、其他供应商名单）拿到后另写迁移补。第一期没有维护页面，改规则也写迁移。
- **给已有数据的表加必填列分三步**：先在 `schema.ts` 里按可空加列并生成迁移（0008），再用自定义迁移给旧行补值（0009），最后改成 `.notNull()` 生成 `SET NOT NULL`（0010）——迁移在有数据的库（本机、开发测试环境）上也能执行，不依赖先清数据；三步都由 drizzle-kit 生成或登记，`pnpm db:verify` 照常通过。

## 修订（2026-10-05，待办 19 落地）

- **费用项的一组列**：PRD 11.1 要求每个费用项保存原币、汇率、汇率日期与来源、冻结美元值。`core` 的 `feeColumns(键, 列名)` 一次定义一个费用项的列（第一期先有原币金额 `键` 与币种 `${键}Currency`，20 号待办在这里补汇率等列），表上用 `feeCurrencyCheck` 保证「有金额就有币种」（没登记的费用项两列都空）。售后单的四个费用项（产品成本、运费、额外赔偿、其他）与列的互换只在 `aftersales/fees.ts` 一处，读出时缺币种直接报错，不静默按美元处理。
- **日历日期用 `date`**：费用发生日、寄出日期是北京时间的日期而不是时刻，用 PostgreSQL `date`（drizzle `mode: 'string'`，`YYYY-MM-DD`）；「时间一律 timestamptz」只约束时刻。
- **承担比例只存工厂一侧**：三组各一个 `smallint`（`*_factory_pct`），CHECK 0–100；FSH 一侧 = 100 − 工厂，由 `contracts` 的 `ratioPairsOf` 写成两侧。
- **参考数据**（续 10 号待办的约定）：迁移 0012 写入集团内两家生产厂（FQD、FZJ）与 R-AS-02 的四类默认比例，所有环境相同；SKU 与生产厂的归属表要等业务提供（32 号待办），在那之前只在非生产环境随示例数据灌入（加载步骤 `factory.parts`），拿到后另写迁移。
- **带着既有编号写入的对象**：示例数据、历史导入沿用原编号写入后，用 `core` 的 `reserveBusinessNumbers(tx, 'aftersales', 序号)` 把全局递增的计数推到至少这个值（只用于不按日重置的编号），之后新发的号接在后面；`businessNumberSequence` 从编号里取序号。示例台账预留到原型用过的最大序号（含第一期丢弃的待确认单 S-20260911-0022，夹具字段 `aftersalesLastSequence`），以后补回那张单不会撞号。
- 迁移 `0011_aftersales_ledger`（售后单、默认比例、生产厂、配件）、`0012_aftersales_reference_data`（上面的参考数据）。

## 修订（2026-10-05，待办 20 落地）

- **费用项的汇率与冻结美元值**：`core` 的 `feeColumns` 补齐一个费用项的整组列——原币金额与币种、冻结美元值 `*_usd`（numeric(12,2)）、汇率 `*_rate`、汇率日期 `*_rate_date`（`date`）、来源 `*_rate_source`（欧洲央行 / Frankfurter / 手工修改）。汇率是「1 USD = 汇率 原币」，numeric(12,6)，不是金额（迁移测试的 `NUMERIC_COLUMNS_NOT_MONEY` 登记）。美元金额不折算：汇率三列为空、美元值等于原值；非美元按费用发生日取汇率，冻结美元值四舍五入到分。约束由 `feeChecks` 一次给出（`*_currency_check` 沿用原名、新增 `*_conversion_check`：美元值只跟着金额，汇率三列同有同无、只用于非美元且大于 0，美元金额的美元值等于原值，非美元有美元值就有汇率）。
- **「有金额就有美元值」由应用把关**：`aftersales/fees.ts` 的 `feesOf` 读出时缺美元值直接报错，不写进数据库约束——加列时开发与开发测试库里已有非美元的示例单（S-20260911-0020），迁移取不到它当时的汇率。加列分三步（续待办 10 的约定）：0013 按可空加列与约束（旧行全空能通过），0014 自定义迁移给美元金额补美元值，非美元的示例单由加载步骤 `aftersales.ledger` 按夹具补齐（只补缺美元值的行、只动汇率与美元值的列）；生产库此时没有台账数据。
- **汇率表** `core.exchange_rate`：日期 + 币种唯一，`rate` numeric(12,6)、来源（欧洲央行 / Frankfurter，`contracts` 的 `publishedRateSources`；费用项的来源另有「手工修改」，`rateSources`），只增不改（每日同步遇到已有的日期跳过），已保存的金额冻结了自己的汇率，后来的同步不回改（E-20）。「按日期取汇率」`exchangeRateOn` 取当天、缺失时取此前最近一个有汇率的日期，不取之后的。
- **十进制运算用 big.js**：EUR 交叉计算（6 位小数）、折算美元（到分）都四舍五入（ROUND_HALF_UP，不是银行家舍入），不经浮点；算法在 `contracts/exchange-rate.ts`（`crossRate`、`usdOf`、`normalizeRate`），前端抽屉的即时折算与后端冻结的值一致。`contracts` 以源码被打进后端产物，产物里对 big.js 的引用留在 `node_modules`，所以后端也直接依赖 big.js（同 zod）。
- **按日期取的汇率没有时**：保存时在该金额上报错、不保存（不存没有美元值的金额）；同步一次写入的行多（第一次是 1999 年起的全量，上万行），分批 INSERT，避开 PostgreSQL 一条语句 65535 个参数的上限。
- 迁移 `0013_exchange_rates`（汇率表、费用项的汇率与美元值列与约束）、`0014_aftersales_fee_usd_backfill`（美元金额补美元值）。

## 修订（2026-10-05，待办 21 落地）

- **迁移 0015**：售后单加取消原因与时刻（`cancel_reason`、`cancelled_at`）、确认保留的已产生费用（一个费用项一列布尔 `<费用项>_kept`，只在已取消的单上有值，没登记的项为空）、最近保存的人（`updated_by_name`，G7 横幅写谁改的）与完成时间索引。原登记的费用列取消时不动，售后成本视图（22）按保留项计、原登记额在悬停里。两条 CHECK 把关状态与时间：只有已完成的单有完成时间；只有已取消的单有取消原因、时刻与保留项（历史导入的单可以没有完成或取消时间）。
- **「适用字段是否齐全」不写成 SQL**：缺失字段与当月登记完整率都在应用层用 `contracts` 的 `missingFields` 判断（与前端同一条规则；坐席拿不到费用与比例，所以台账每行由后端算好 `missing`，只对已完成的单算）。当月按完成时间换成北京时间的本地时刻比月份（`completed_at AT TIME ZONE 'Asia/Shanghai'`），日界不随 UTC 走；历史导入不计。第一期台账量小，按月取已完成的单在应用层数，以后变慢再挪进视图。
- **编辑登记与补登一个接口**（`PATCH /api/aftersales/{单号}`，体 `{ version, changes?, rates? }`）：服务层把这次提交盖到原登记上，按 `contracts` 的 `registrationItems`（登记项清单，前后端共用）逐项比较。进行中按新建登记的规则整张校验（不适用的字段清空；改了原币金额、币种或费用发生日的项按费用发生日重新取汇率，没改的保留原来冻结的值）；已完成只认原来空着的、或按 R-AS-08 算缺的项（例如退款的额外赔偿登记成 0），其余已填的项改了报「已完成的单只能补登缺失的字段」，原值一律不动，只校验这次填的项。随保存一起改汇率在同一个事务里先改字段、再改汇率（同 `PUT …/rates` 的 `applyRateChanges`），版本只加一次，改字段与改汇率各记一条审计。
