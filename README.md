# Forcome Support 智能客服 · 产品设计

亚马逊 + Shopify（北美三站）智能客服系统的设计与实现依据：PRD、高保真原型与设计画布，技术方案与 ADR，各期规格与待办；生产系统的代码在 `apps/` 与 `packages/`（见「开发」）。原型是静态页面，全部由 `design/spec` 下的 Python 脚本从同一份示例数据和组件库生成。

## 目录

```
CLAUDE.md                            AI 代理规则：工程技能配置（问题跟踪、分诊标签、领域文档）与实现依据
AGENTS.md                            其他代理（Codex 等）的入口，指向 CLAUDE.md
CONTEXT.md                           项目级术语（业务术语以 PRD 1.4 为准）
docs/agents/                         上述配置的细则，含原型对照（prototype.md）
docs/技术方案.md                     技术方案总文档（v1.2；口径以 PRD 与各期规格为准）
docs/部署说明.md                     部署与运维清单：开发测试环境、根证书、放行域名与 NO_PROXY、迁移到服务器
docs/adr/                            技术决策记录 0001–0014（后续修订写在各篇末尾）
apps/、packages/                     生产系统代码（pnpm 工作区，见「开发」）；.github/ 为 CI，scripts/ 为仓库级检查脚本，deploy/ 为部署
.scratch/                            本地问题跟踪：各期规格与待办（phase1-reporting、phase2-aftersales、phase3-ai-reply），技术方案阶段的过程记录（tech-plan，历史）
design/
├── *.dc.html                        画板（生成物，不要手改；5 张流程图例外，见下）
├── canvas.json                      画布布局（build_canvas.py 生成）
├── forcome-support-blueprint.html   设计画布（全部画板打包，已发布）
├── forcome-blueprint-guide.html     PRD（build_prd.py 生成，已发布）
├── forcome-agent-decision-scheme.html  决策记录（手工维护，已发布）
└── spec/
    ├── prd_a.md … prd_d.md          PRD 源文（0–3 节 / 4–7 节 / 8、8A 节 / 9–16 节）
    ├── data.py                      示例数据，原型的唯一数据来源
    ├── ui.py                        组件库与设计令牌（对应 shadcn/ui + Tailwind v4）
    ├── pages/                       页面与状态板生成脚本（build_*.py）
    ├── build_ds.py                  设计规范 + 全局状态
    ├── build_map.py                 页面地图
    ├── build_prd.py                 PRD 合成
    ├── build_canvas.py              画布打包
    ├── check.py                     渲染检查（溢出、裁切）与截图
    ├── shot_doc.py                  截取文档局部（临时排查用）
    ├── shot_phase1.py               第一期页面全尺寸参照图（输出 phase1/ 与 shots/phase1/）
    ├── phase1/                      第一期参照页面（shot_phase1.py 生成）
    ├── shots/                       各画板截图（check.py --shots 输出）；phase1/ 为第一期参照图
    ├── WORKPLAN.md                  工作记录与发布版本
    └── archive/                     已完成的任务书
```

### 画板清单

| 分组 | 画板 |
|---|---|
| 高保真页面 P01–P27 | Main、TicketEmail、TicketEscalated、Tickets、TicketDetail、Customer、AfterSalesList、AfterSalesConfirm、AfterSalesTicket、AfterSalesInStock、AfterSalesRefund、AfterSalesNegotiation、AfterSalesLog、AfterSalesSettlement、Actions、KnowledgeBase、Reports、Settings、SettingsRules、SettingsTeam、FactoryPortal、SettingsActions、SettingsAfterSales、SettingsFactory、SettingsModels、SettingsHealth、AuditLog |
| 状态板 | StatesInbox、StatesApproval、StatesAfterSales、StatesFactory、StatesAdmin（第一阶段过渡界面在 I16–I18、S13–S15、K18–K20，第二阶段在 I19–I21、S16） |
| 规范 | DesignSystem、GlobalStates、PageMap |
| 流程图（手工维护） | Architecture、LifeCycle、AfterSales、DecisionTree、EmailFlow |
| 早期视觉方向（存档） | DirectionA、DirectionB、DirectionC |

页面编号、状态编号（G/I/A/S/F/K）、规则编号（R-xx）、验收编号（AC-xx）在 PRD、画板与画布中一致。原型按完整产品画一套；各阶段的裁剪写在 PRD 各页「第一阶段」「第二阶段」小节，过渡界面用状态板表达（决策 31、PRD D-24、D-25）；第一期另有全尺寸参照图（`spec/shots/phase1/`）。

## 修改与重建

改内容时改源（`prd_*.md`、`data.py`、`ui.py`、`pages/*.py`），再重新生成；不要直接改生成的 `.dc.html`。流程图与决策记录没有生成脚本，直接改 HTML。

在 `design/spec` 目录下：

```powershell
# 1 重新生成画板（按需运行对应脚本，或全部运行）
Get-ChildItem pages/build_*.py -Name | % { python "pages/$_" }
python build_ds.py
python build_map.py

# 2 检查溢出与裁切，并更新截图
$f = Get-ChildItem ../*.dc.html -Name | ? { $_ -notmatch '^Direction' }
python check.py --shots @f

# 3 合成 PRD
python build_prd.py

# 4 打包画布（量高度、写 canvas.json、生成 forcome-support-blueprint.html）
python build_canvas.py --seed

# 5 改了第一期页面（P04、P05、P13、P17、P18、P20、P27）或示例数据时，重新生成第一期参照图
python shot_phase1.py
```

依赖：Python 3.11、`playwright`（使用本机 Chrome）。`build_canvas.py --seed` 还依赖 Claude Code 的 design 技能脚本 `seed-canvas.mjs`，路径写在脚本的 `SKILL` 常量里，技能版本更新后需要同步改这个路径。

## 开发

生产系统的代码在 `apps/` 与 `packages/`（pnpm 工作区，ADR 0005）：

```
apps/web                 前端：Vite + React 19 单页应用，shadcn/ui + Tailwind v4（ADR 0007）
├── src/styles/globals.css  设计令牌（由设计规范板转来，此后以它为准）
├── src/components/ui/   shadcn/ui 组件（已按设计规范改过默认样式）
├── src/router.tsx       路由（TanStack Router）；登录后的页面挂在 app 布局下
└── e2e/                 Playwright 端到端（playwright.config.ts）
apps/server              后端：一个镜像，三个入口（ADR 0005、0006、0008）
├── src/api.ts           入口：HTTP 服务（app.ts 组装接口）
├── src/worker.ts        入口：后台任务（jobs.ts 汇总各模块的任务定义与处理器）
├── src/migrate.ts       入口：只向前执行迁移（一次性，先于 api 与 worker）
├── src/seed.ts          入口：灌示例数据（只用于非生产环境；fixture-steps.ts 汇总各模块的加载步骤）
├── src/import-aftersales.ts 入口：售后登记表导入（一次性，各环境都用；映射表 modules/aftersales/history-mapping.json）
├── src/deps.ts          组装根：接口与任务共用的依赖（运行时、日志、配置、外部客户端）
├── src/modules/<模块>/  12 个模块；index.ts 是唯一对外入口，schema.ts 放本模块的表（一个模块一个 schema）
├── drizzle/             drizzle-kit 生成的 SQL 迁移（提交进仓库，不手改；自定义 SQL 用 drizzle-kit generate --custom）
├── test/                集成测试的数据库准备、主接缝测试工具（harness.ts）与跨模块测试
├── scripts/e2e-api.ts   Playwright 用的 api（重建 e2e 库、迁移、灌示例数据后启动，同一进程里起 worker）
├── dev.env · e2e.env    本机开发与 e2e 的环境变量默认值（只有本机库口令，没有外部凭据）
└── Dockerfile           后端镜像
packages/contracts       前后端共享的 zod 模式与类型
packages/calendar        日界与工作日历纯函数
packages/fixtures        示例数据夹具：data/demo.json 由 data.py 生成（不手改），加载时按模式校验
packages/config          共享的 tsconfig 与 ESLint 配置（含模块边界规则 eslint-boundaries.js）
scripts/                 仓库级脚本：迁移一致性、工作流语法、示例数据夹具（fixtures/ 下是生成脚本）
deploy/                  部署（ADR 0013 修订，docs/部署说明.md）
├── compose.yml          开发测试与生产共用的 Compose（caddy、api、worker、migrate、seed、postgres、smoke）
├── .env.example         环境变量模板（本机的 deploy/.env.staging 由部署脚本生成，不进 git）
├── deploy.mjs           部署脚本；lib/ 为它的模块与单元测试，verify.mjs 为 CI 用的配置检查
├── web/                 前端的两个镜像（Dockerfile 的两个目标）：web = caddy（Caddyfile）+ 前端静态文件，smoke = 部署后冒烟
├── postgres/            自建 PostgreSQL 镜像
└── smoke/               冒烟容器的入口脚本（信任 caddy 根证书后跑 Playwright）
.github/workflows/       CI（ci.yml）；部署到开发测试环境（deploy-staging.yml，上 GitHub 后启用）
```

共享包以 TypeScript 源码被引用（`exports` 指向 `src/index.ts`），由前端的 Vite 与后端的 tsdown 打进各自的产物，它们的 `build` 只做类型检查。

**环境**：Node 24（`.node-version`）；pnpm 10，先 `corepack enable`，版本按 `package.json` 的 `packageManager` 自动取用；Docker（含 compose）；Python 3（只在重新生成示例数据夹具时需要）。不需要任何外部账号，外部服务一律用 Fake。

**本机端口**（本期本机可用 4510–4520，ADR 0013 修订）：开发库 4520 · api 4516 · 前端开发服务器 4517 · Playwright 用的 e2e api 4518 与前端预览 4519；开发测试环境 4510（HTTPS）与 4511（PostgreSQL）；4512–4513 预留给生产（28 号待办），4514–4515 机动。

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm db:up` / `pnpm db:down` | 起停本机 PostgreSQL 18（`docker-compose.dev.yml`，端口 4520，可用 `DEV_PG_PORT` 覆盖） |
| `pnpm db:migrate` | 执行迁移；默认对本机开发库（`apps/server/dev.env`），设 `DATABASE_URL` 可指向别的库 |
| `pnpm db:seed` | 灌示例数据夹具（各模块登记的加载步骤；生产环境拒绝），先跑 `db:migrate` |
| `pnpm db:reset-inbound` | 重放来信：清空本机开发库的收信与工单（识别或归并口径变了以后用；先停 `dev:worker`，再启动后按新口径重新回放；生产环境拒绝） |
| `pnpm db:generate` | 改了某个模块的 `schema.ts` 后生成迁移 |
| `pnpm --filter @forcome/server import:aftersales <登记表> [--mapping <映射表>] [--dry-run]` | 把售后登记表导入本机开发库（相对路径从 `apps/server` 算；`--dry-run` 只报告不写库；映射表与步骤见 `docs/部署说明.md` 第 10 节）；`history:sample` 重新生成合成样本 `test/fixtures/history-import/register-sample.xlsx` |
| `pnpm --filter @forcome/server dev:api` / `dev:worker` | 本机运行 api（4516）/ worker，环境变量默认取 `apps/server/dev.env`（开启开发登录）；worker 启动时 Fake Gmail 回放示例来信，几秒后在 P04 归并成工单 |
| `pnpm --filter @forcome/web dev` | 本机运行前端（http://127.0.0.1:4517），`/api` 转给本机 api；未登录时进入开发登录页，选一位示例成员即可登录 |
| `pnpm typecheck` · `pnpm lint` · `pnpm build` | 类型检查 · lint（含模块边界）与格式 · 构建 |
| `pnpm lint:workflows` | 用 actionlint（Docker）校验 CI 工作流语法 |
| `pnpm fixtures:generate` · `pnpm fixtures:verify` | 从 `design/spec/data.py` 重新生成示例数据夹具 · 核对产物与 data.py 一致 |
| `pnpm test:unit` · `pnpm test:integration` | 单元测试 · 集成测试（需要 `pnpm db:up`；CI 经 `TEST_DATABASE_URL` 指向服务容器） |
| `pnpm test:e2e` | Playwright 端到端（需要 `pnpm db:up`；自己起 4518、4519 两个服务，用 e2e 专用库 `forcome_e2e`） |
| `pnpm ci:local` | 本机跑一遍与 CI 相同的检查（先 `pnpm db:up`，并且需要 Docker 构建镜像） |
| `pnpm deploy:staging` | 部署到开发测试环境（本机 Docker）：构建镜像 → migrate → 示例数据 → 起服务 → 用根证书核对 HTTPS → Playwright 冒烟，报告在 `deploy/.state/staging/`（`docs/部署说明.md`）；识别或归并口径变了的版本加 `--reset-inbound`，起服务前先重放来信 |
| `pnpm staging smoke` · `cert` · `compose …` · `down` · `reset-inbound` · `import-aftersales …` · `order-backfill …` | 对开发测试环境：重跑 HTTPS 核对与冒烟 · 导出根证书 · 执行 docker compose · 停止（保留数据） · 重放来信（停 worker、清空收信与工单、起 worker，`docs/部署说明.md`） · 导入售后登记表（第 10 节） · 开始订单回补（第 15 节） |
| `pnpm deploy:verify` | 部署配置检查：Compose 文件、前端镜像、Caddyfile（CI 与 `ci:local` 执行） |

**测试**：`*.test.ts` 是单元测试；`*.int.test.ts` 是集成测试，用真实 PostgreSQL 18——每次运行先建模板库并迁移，各测试文件再复制出自己的库，互不干扰。集成测试只经主接缝（规格「测试接缝」）：用 `apps/server/test/harness.ts` 的 `startTestHarness()` 在测试进程内调用 HTTP 接口，`t.loginAs('坐席')` 以某个角色登录（`t.addMember(…)` 建多角色、店铺范围受限等示例数据里没有的成员后用 `t.loginAs({ memberId })`），`t.clients.fake(…)` 往 Fake 里放数据、注入故障，`t.clock` 推进时钟，`t.runJobs()` 把 worker 跑到空闲（每轮先拉常驻拉取源，如 Fake Gmail 的推送通知，再跑已排队的任务），`t.auditRecords()` 核对审计；要验证生产环境的限制时用 `startTestHarness({ appEnv: 'production' })`（应用按生产组装，测试工具另用非生产实例做开发登录，见 `apps/server/test/stores.int.test.ts`）；样板见 `apps/server/test/dev-login.int.test.ts`；还没有业务接口使用的公共工具（店铺范围、越权审计、财务字段过滤）用 `startTestHarness({ routes })` 挂示范接口来测，见 `apps/server/test/access-tools.int.test.ts`。外部客户端的「接口 + 真实现 + Fake」写法见 `apps/server/src/modules/integration/fake-framework.test.ts`。来信用 `t.clients.fake(gmailClient).deliver(…)` 放进 Fake Gmail（邮箱要先开始监听：灌完店铺先 `t.runJobs()` 一次），见 `apps/server/test/inbound-to-ticket.int.test.ts`。历史导入的售后单经 `t.importAftersales({ file } | { rows })` 走售后登记表导入命令的同一个函数（默认用合成样本的映射表），见 `apps/server/test/aftersales-history-import.int.test.ts`。

**开发登录**：只在非生产环境、`DEV_LOGIN_ENABLED=true` 时开启（`dev.env` 已开启），从成员表里的在职成员（示例数据灌入）里选一位直接登录，换出与钉钉扫码登录相同的会话，能不能进入与正式登录同一套判断（第一期只有生产厂对接人角色的陈工、张工会看到「暂时无法进入」）；生产环境配置了就拒绝启动（ADR 0010 修订）。

**钉钉**（待办 05）：开发与测试一律用 Fake 钉钉，不需要任何钉钉凭据。worker 启动时 Fake 钉钉从示例数据回放通讯录（8 位示例成员、两家生产厂负责人与新入职待添加的吴桐，后三位没有角色），全量对账一次、之后每个整点一次；开发登录列表里因此多出「未分配角色」的刘厂长、周厂长、吴桐，他们也是 P20「从钉钉添加」的候选（待办 06）。要让一位已添加的人回到候选，用开发工具「模拟回到通讯录」：`POST /api/dev/dingtalk/rejoin { "userId": "wutong" }`（先按钉钉离职停用、再恢复在职，角色与店铺范围清空；Playwright 的 `apps/web/e2e/team.spec.ts` 用它让「添加成员」可以重复执行）。钉钉扫码登录页在 `/login`（示意二维码；开启开发登录时未登录的访问仍去开发登录页），要走一遍扫码时用开发工具「模拟扫码」：`POST /api/dev/dingtalk/scan { "userId": "liting" }` 拿到授权码，再打开 `/login/dingtalk?authCode=<授权码>&state=<Cookie forcome_login_state 的值>`（Playwright 写法见 `apps/web/e2e/dingtalk-login.spec.ts`）。集成测试里 `t.scanLogin(钉钉用户 ID)` 一步做完，往 Fake 钉钉放人与事件用 `t.clients.fake(dingtalkClient)`（`apps/server/test/dingtalk-sync.int.test.ts`）。连真实钉钉的配置与步骤见 `docs/部署说明.md` 第 11 节。

**Gmail**（待办 09）：开发与测试一律用 Fake Gmail，不需要任何 Google 凭据。worker 启动时与之后每 5 分钟给每个进线邮箱同步一次，P18 的 Gmail 卡与店铺表「状态」按各邮箱的同步记录显示（超过 10 分钟没同步成功为同步延迟、连续 3 次失败为连接异常并出全站横幅）。集成测试里放「已发送」用 `t.clients.fake(gmailClient).send(…)`，游标过期、调用失败用 `t.clients.fake(gmailClient).faults.failNext(…)`，兜底同步与续订 watch 用 `t.enqueue(gmailPollJob, {})`、`t.enqueue(gmailRenewWatchJob, {})` 后 `t.runJobs()`（`apps/server/test/gmail-sync-health.int.test.ts`）。连真实 Gmail（服务账号 + 全域委派、Pub/Sub）的配置与步骤见 `docs/部署说明.md` 第 12 节。

**Shopify 订单**（待办 11）：开发与测试一律用 Fake Shopify，不需要任何 Shopify 凭据。worker 启动时与之后每分钟给每个 Shopify 店铺增量同步一次订单进本地镜像（`order` 模块），P18 的 Shopify 卡与店铺表「状态」按各店铺的同步记录显示；本机与开发测试环境的 Fake 回放示例数据里第一阶段的 5 笔 Shopify 订单（历史订单，增量拉不到，按订单名补拉）。集成测试里放订单用 `t.clients.fake(shopifyClient).put(店铺 ID, { name, updatedAt, … })`，只让一个店铺失败用 `.faultsOf(店铺 ID).failNext(…)`（操作名 `orders`、`order_by_name`、`shop`），每分钟的同步用 `t.enqueue(shopifyPollJob, {})` 后 `t.runJobs()`；查镜像用 `t.findOrder(店铺 ID, { name } | { platformOrderId })`（镜像没有时按订单名补拉）与 `t.ordersByEmail(店铺 ID, 邮箱)`（`apps/server/test/shopify-orders.int.test.ts`）；访问令牌与 Admin GraphQL 的真实现用 undici MockAgent 回放（`apps/server/src/modules/integration/shopify-real.int.test.ts`）。连真实 Shopify（自建应用的客户端凭据、主密钥）的配置与步骤见 `docs/部署说明.md` 第 13 节。

**亚马逊订单**（待办 12）：开发与测试一律用 Fake SP-API 与 Fake SQS，不需要任何亚马逊或 AWS 凭据。worker 常驻拉取订单通知队列（SQS，每条 ORDER_CHANGE 按订单号取一遍写镜像），并在启动时与之后每 4 分钟给每个亚马逊店铺增量同步一次，P18 的亚马逊卡与店铺表「状态」按各店铺的同步记录显示，卡上另有「订单通知队列（SQS）」一行；本机与开发测试环境的 Fake 回放示例数据里第一阶段的 12 笔亚马逊订单（历史订单，增量拉不到，按订单号补拉）。集成测试里放订单用 `t.clients.fake(amazonOrdersClient).put(店铺 ID, { orderId, updatedAt, … })`，放通知用 `t.clients.fake(amazonSqsClient).orderChanged(卖家 ID, 订单号)` 后 `t.runJobs()`（每轮先拉一次 SQS），增量用 `t.enqueue(amazonPollJob, {})`；故障的操作名 `searchOrders`、`getOrder`、`getMarketplaceParticipations`、`ReceiveMessage`、`DeleteMessageBatch`、`GetQueueAttributes`（`apps/server/test/amazon-orders.int.test.ts`）；LWA、令牌桶与 SQS 签名的真实现用 undici MockAgent 回放（`integration/amazon-orders-real.int.test.ts`、`amazon-sqs-real.test.ts`）。本机录入卖家授权：`pnpm --filter @forcome/server sp-api-token --seller <卖家 ID> < <放刷新令牌的文件>`（要有主密钥）。连真实 SP-API 与 SQS 的配置与步骤见 `docs/部署说明.md` 第 14 节。

**订单回补与夜间对账**（待办 13）：`pnpm db:seed`（与开发测试环境、Playwright 的示例数据）灌完数据即开始回补，worker 起来后逐页把 Fake 回放的历史订单读进镜像，P18 两张卡的回补行为亚马逊「订单回补 90 天 · 已完成」、Shopify「订单回补 60 天 · 未开通 read_all_orders」（示例的 Shopify 应用没开通 read_all_orders）。本机手动开始：`pnpm --filter @forcome/server order-backfill [--store <店铺名>]… [--again]`（已完成的跳过、`--again` 从头重来）。夜间对账每天 03:30 跑一次。集成测试里开始回补用 order 的 `startOrderBackfill(t.runtime, listOrderStores, { storeIds })` 后 `t.runJobs()`，对账用 `t.enqueue(orderReconcileJob, {})`；Fake Shopify 没开通 read_all_orders 用 `.limitHistory()`，模拟配额用完用 Fake 的 `.quota.limit(0)` / `.grant(1)`（`apps/server/test/order-backfill.int.test.ts`）。上线前的执行时机与用法见 `docs/部署说明.md` 第 15 节。

**按订单归并**（待办 14）：来信里的订单号（亚马逊 3-7-7、Shopify 订单名 `#1063` 与「order 1063」等写法）在该店铺的订单镜像中校验、镜像没有时补拉，按 R-TK-01 追加、重开或新建；抽不到或校验不到时 Shopify 店铺按客户邮箱反查镜像，唯一命中才关联，否则按客户归并（R-TK-02）。本机与开发测试环境的示例来信回放后，P04 订单号列与原型一致（Priya Raman 的 #1057、#1049 分成两张）。归并口径变了，已有的开发库与开发测试环境要重放来信（`pnpm db:reset-inbound`、`pnpm deploy:staging --reset-inbound`）。集成测试写法见 `apps/server/test/order-merge.int.test.ts`。

**回复识别、SLA 与按时关闭**（待办 16）：店铺邮箱「已发送」里的我方邮件按 In-Reply-To、References、Gmail 线程归到工单（带 Auto-Submitted 等自动回复标记的不算回复），每封客户来信记首次回复与 SLA 结果；worker 每分钟扫描一次：SLA 过截止的记未达标，待回复 14 天、等客户与已解决 7 天无来信的按时关闭。本机与开发测试环境的 Fake Gmail 除了示例来信还回放我方回复（等客户的几张、P05 时间线、生产厂工单的自动回复），并按整天平移到当前日期——P04 的状态与原型一致，之后照规则随时间推进；本机按演示时刻 `CLOCK_START` 启动时不平移，截图对得上原型。集成测试写法见 `apps/server/test/reply-sla.int.test.ts`。

**演示时刻**：非生产环境可设 `CLOCK_START`（带时区的 ISO 时刻，例如 `CLOCK_START=2026-09-11T10:20:00+08:00 pnpm --filter @forcome/server dev:api`，worker 同样设），api 与 worker 的时钟从该时刻起随系统时钟前进，本机截图与演示对上原型的演示时刻（例如当月登记完整率落在 9 月）；生产环境配置了就拒绝启动，开发测试环境不设（ADR 0008「待办 21 落地」修订）。

**CI 与合并**：`.github/workflows/ci.yml` 在 PR 与 main 上跑类型检查、lint、迁移一致性、示例数据夹具一致性、构建、单元与集成测试、镜像构建与部署配置检查，最后由「CI 通过」汇总。仓库推到 GitHub 后，在 Settings → Branches 为 `main` 加保护规则：Require a pull request before merging（至少 1 个批准）、Require status checks to pass（必需检查选「CI 通过」）。仓库暂不上 GitHub，期间用 `pnpm ci:local` 代替。

**部署**：main 上 CI 通过后，`.github/workflows/deploy-staging.yml` 在内网的开发测试运行器上执行 `deploy/deploy.mjs`，部署后对开发测试环境跑 Playwright（`apps/web/e2e` 全部用例）并在作业摘要里报告。仓库暂不上 GitHub，期间在本机用 `pnpm deploy:staging` 部署与冒烟；启用步骤、根证书安装与运维清单见 `docs/部署说明.md`。本机开发时的端到端用 `pnpm test:e2e`。

**镜像**：`docker build -f apps/server/Dockerfile -t forcome-server .`（构建上下文是仓库根目录）；默认运行 api，`node dist/worker.mjs`、`node dist/migrate.mjs` 运行另两个入口，`node dist/seed.mjs` 在非生产环境灌示例数据，`node dist/reset-inbound.mjs` 在非生产环境重放来信，`node dist/import-aftersales.mjs <登记表>` 导入售后登记表（各环境都用）。前端镜像（caddy + 静态文件）、自建 PostgreSQL 与冒烟镜像在 `deploy/`，由部署脚本构建。

## 约定

- 文件编码 UTF-8 无 BOM；新建文档用 CRLF。代码与配置（`apps/`、`packages/`、`.github/`、`scripts/`、`deploy/` 与根目录的配置文件）一律 LF，由 `.gitattributes` 与 prettier 保证。已有的 LF 文件（部分 ADR、各期规格与第一期待办、`build_canvas.py`、`build_prd.py`、`check.py` 等）保持原换行，改动时不要改变换行符（提交前用 `git ls-files --eol` 核对）。
- 所有原型数据从 `data.py` 取，页面脚本里不写死业务数字。
- 固定尺寸页面为 1440 × 900，`check.py` 报溢出或裁切必须修到 OK。
- 已发布页面（画布、PRD、决策记录）的链接与当前版本记在 `spec/WORKPLAN.md`。
