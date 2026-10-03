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
├── src/deps.ts          组装根：接口与任务共用的依赖（运行时、日志、配置、外部客户端）
├── src/modules/<模块>/  12 个模块；index.ts 是唯一对外入口，schema.ts 放本模块的表（一个模块一个 schema）
├── drizzle/             drizzle-kit 生成的 SQL 迁移（提交进仓库，不手改；自定义 SQL 用 drizzle-kit generate --custom）
├── test/                集成测试的数据库准备、主接缝测试工具（harness.ts）与跨模块测试
├── scripts/e2e-api.ts   Playwright 用的 api（重建 e2e 库、迁移、灌示例数据后启动）
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
├── deploy.mjs           部署脚本；lib/ 为它的纯逻辑与测试，verify.mjs 为 CI 用的配置检查
├── web/                 前端镜像：caddy（Caddyfile）+ 前端静态文件
├── postgres/            自建 PostgreSQL 镜像
└── smoke/               部署后冒烟的 Playwright 镜像
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
| `pnpm db:generate` | 改了某个模块的 `schema.ts` 后生成迁移 |
| `pnpm --filter @forcome/server dev:api` / `dev:worker` | 本机运行 api（4516）/ worker，环境变量默认取 `apps/server/dev.env`（开启开发登录） |
| `pnpm --filter @forcome/web dev` | 本机运行前端（http://127.0.0.1:4517），`/api` 转给本机 api；未登录时进入开发登录页，选一位示例成员即可登录 |
| `pnpm typecheck` · `pnpm lint` · `pnpm build` | 类型检查 · lint（含模块边界）与格式 · 构建 |
| `pnpm lint:workflows` | 用 actionlint（Docker）校验 CI 工作流语法 |
| `pnpm fixtures:generate` · `pnpm fixtures:verify` | 从 `design/spec/data.py` 重新生成示例数据夹具 · 核对产物与 data.py 一致 |
| `pnpm test:unit` · `pnpm test:integration` | 单元测试 · 集成测试（需要 `pnpm db:up`；CI 经 `TEST_DATABASE_URL` 指向服务容器） |
| `pnpm test:e2e` | Playwright 端到端（需要 `pnpm db:up`；自己起 4518、4519 两个服务，用 e2e 专用库 `forcome_e2e`） |
| `pnpm ci:local` | 本机跑一遍与 CI 相同的检查（先 `pnpm db:up`，并且需要 Docker 构建镜像） |
| `pnpm deploy:staging` | 部署到开发测试环境（本机 Docker）：构建镜像 → migrate → 示例数据 → 起服务 → 用根证书核对 HTTPS → Playwright 冒烟，报告在 `deploy/.state/staging/`（`docs/部署说明.md`） |
| `pnpm staging smoke` · `cert` · `compose …` · `down` | 对开发测试环境：只重跑冒烟 · 导出根证书 · 执行 docker compose · 停止（保留数据） |
| `pnpm deploy:verify` | 部署配置检查：Compose 文件、前端镜像、Caddyfile（CI 与 `ci:local` 执行） |

**测试**：`*.test.ts` 是单元测试；`*.int.test.ts` 是集成测试，用真实 PostgreSQL 18——每次运行先建模板库并迁移，各测试文件再复制出自己的库，互不干扰。集成测试只经主接缝（规格「测试接缝」）：用 `apps/server/test/harness.ts` 的 `startTestHarness()` 在测试进程内调用 HTTP 接口，`t.loginAs('坐席')` 以某个角色登录，`t.clients.fake(…)` 往 Fake 里放数据、注入故障，`t.clock` 推进时钟，`t.runJobs()` 把后台任务跑到空闲，`t.auditRecords()` 核对审计；样板见 `apps/server/test/dev-login.int.test.ts`。外部客户端的「接口 + 真实现 + Fake」写法见 `apps/server/src/modules/integration/fake-framework.test.ts`。

**开发登录**：只在非生产环境、`DEV_LOGIN_ENABLED=true` 时开启（`dev.env` 已开启），从示例数据的成员里选一位直接登录，换出与钉钉扫码登录相同的会话；生产环境配置了就拒绝启动（ADR 0010 修订）。

**CI 与合并**：`.github/workflows/ci.yml` 在 PR 与 main 上跑类型检查、lint、迁移一致性、示例数据夹具一致性、构建、单元与集成测试、镜像构建与部署配置检查，最后由「CI 通过」汇总。仓库推到 GitHub 后，在 Settings → Branches 为 `main` 加保护规则：Require a pull request before merging（至少 1 个批准）、Require status checks to pass（必需检查选「CI 通过」）。仓库暂不上 GitHub，期间用 `pnpm ci:local` 代替。

**部署**：main 上 CI 通过后，`.github/workflows/deploy-staging.yml` 在内网的开发测试运行器上执行 `deploy/deploy.mjs`，部署后对开发测试环境跑 Playwright（`apps/web/e2e` 全部用例）并在作业摘要里报告。仓库暂不上 GitHub，期间在本机用 `pnpm deploy:staging` 部署与冒烟；启用步骤、根证书安装与运维清单见 `docs/部署说明.md`。本机开发时的端到端用 `pnpm test:e2e`。

**镜像**：`docker build -f apps/server/Dockerfile -t forcome-server .`（构建上下文是仓库根目录）；默认运行 api，`node dist/worker.mjs`、`node dist/migrate.mjs` 运行另两个入口，`node dist/seed.mjs` 在非生产环境灌示例数据。前端镜像（caddy + 静态文件）、自建 PostgreSQL 与冒烟镜像在 `deploy/`，由部署脚本构建。

## 约定

- 文件编码 UTF-8 无 BOM；新建文档用 CRLF。代码与配置（`apps/`、`packages/`、`.github/`、`scripts/` 与根目录的配置文件）一律 LF，由 `.gitattributes` 与 prettier 保证。已有的 LF 文件（部分 ADR、各期规格与第一期待办、`build_canvas.py`、`build_prd.py`、`check.py` 等）保持原换行，改动时不要改变换行符（提交前用 `git ls-files --eol` 核对）。
- 所有原型数据从 `data.py` 取，页面脚本里不写死业务数字。
- 固定尺寸页面为 1440 × 900，`check.py` 报溢出或裁切必须修到 OK。
- 已发布页面（画布、PRD、决策记录）的链接与当前版本记在 `spec/WORKPLAN.md`。
