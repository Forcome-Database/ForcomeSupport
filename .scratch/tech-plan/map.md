Label: wayfinder:map

# 技术方案

> 历史记录（技术方案阶段，2026-09-24 已完成）：现行口径以 PRD v2.12、`docs/adr/`（含各篇「修订」一节）、`docs/技术方案.md` 与 `.scratch/` 各期规格为准；文中行号指当时版本。

## Destination

一套锁定的技术决策（每项一份 ADR，放 `docs/adr/`）加一份技术方案总文档 `docs/技术方案.md`，足以直接进入第一期（报表与台账）的 `/to-spec` → `/to-tickets` → `/implement`。架构与选型按三期完整功能来定，细化到可实施的只到第一期。

## Notes

- **领域**：按 PRD 从零建设**生产系统**，**原型**只作界面规格与验收依据（见 `CONTEXT.md`）。业务术语以 `design/spec/prd_a.md` 1.4 术语表为准，规则、页面、状态沿用 PRD 编号。
- **技能**：讨论类待办调用 `grilling` 与 `domain-modeling`；调研类待办由后台代理调用 `research`。每项定下的决策如满足「难以回退、不看背景会意外、确有取舍」三条，写 ADR；术语写进 `CONTEXT.md`。
- **语言**：沟通、文档、ADR 一律中文。
- **已定约束（2026-09-24）**：
  - 团队：TypeScript 小团队，以 AI 编程代理（Claude Code 按待办实现）为主，1–2 人把关。
  - 时间：第一期 6–8 周上线。
  - 部署：私有化部署在公司服务器，经代理访问外部接口；有运维，前期 Docker Compose。
  - 海外仓：是「易仓」（已作为三方仓接入积加），PRD 与原型中的「良仓」为错名，已在 PRD v2.7 全局更正。
  - 账号：Shopify、钉钉、Gmail（Google Workspace）管理权限已有；积加开放接口、亚马逊 SP-API 尚未开通。
  - 模型：Claude 经 NewAPI 网关接入（2026-09-24 用户决定）；调用合规与网络问题不在考虑范围内。模型层必须同时适配 Claude、OpenAI GPT 与任意 OpenAI 兼容接口，不绑定单一厂商；接入层用 Vercel AI SDK（ADR [0001](../../docs/adr/0001-模型接入层用VercelAISDK.md)）。
- **PRD 已锁定、不再讨论**：前端 shadcn/ui + Tailwind CSS v4（D-10）；读走积加（订单读取已由 ADR 0011 改为平台直读）、写走 SP-API 与 Shopify Admin API、来信走 Gmail、组织与通知走钉钉（D-14、D-16、D-17）；适配器为 MCP 形式（F-AP-02）；审计保留 ≥ 2 年；三期交付顺序 报表与台账 → 售后流程 → AI 回信。
- **已定 ADR**：[0001 模型接入层用 Vercel AI SDK](../../docs/adr/0001-模型接入层用VercelAISDK.md)；[0002 按记账方选择外部数据来源](../../docs/adr/0002-按记账方选择外部数据来源.md)；[0003 内网零入站与工厂工作台单一公网入口](../../docs/adr/0003-内网零入站与工厂工作台单一公网入口.md)；[0004 不设个人信息脱敏与留存限制](../../docs/adr/0004-不设个人信息脱敏与留存限制.md)；[0005 模块化单体与强制模块边界](../../docs/adr/0005-模块化单体与强制模块边界.md)；[0006 后端用 Hono 与 Drizzle 加 PostgreSQL](../../docs/adr/0006-后端用Hono与Drizzle加PostgreSQL.md)；[0007 前端用 Vite 单页应用与工厂工作台独立入口](../../docs/adr/0007-前端用Vite单页应用与工厂工作台独立入口.md)；[0008 后台任务用 pg-boss 与扫描式时限](../../docs/adr/0008-后台任务用pg-boss与扫描式时限.md)；[0009 统一动作接口对齐 MCP 形状的进程内适配器](../../docs/adr/0009-统一动作接口对齐MCP形状的进程内适配器.md)；[0010 会话在服务端与权限在应用层强制](../../docs/adr/0010-会话在服务端与权限在应用层强制.md)；[0011 订单读取改为平台直读](../../docs/adr/0011-订单读取改为平台直读.md)；[0012 模型按用途配置，不引入网关与可观测平台](../../docs/adr/0012-模型按用途配置不引入网关与可观测平台.md)；[0013 GitHub 托管与内网自托管运行器部署](../../docs/adr/0013-GitHub托管与内网自托管运行器部署.md)；[0014 AI 处理为固定流水线加意图流程与代码治理](../../docs/adr/0014-AI处理为固定流水线加意图流程与代码治理.md)。
- **合规**：整个方案不考虑合规问题，按最佳体验设计（2026-09-24 用户决定，ADR [0004](../../docs/adr/0004-不设个人信息脱敏与留存限制.md)）。
- **已知风险**：SP-API 没有直接的自发货退款、取消接口，已由调研确认改走 Feeds 异步。

## Decisions so far

<!-- 每关闭一张待办追加一行：[待办标题](路径)：一句话结论 -->
- [调研：私有化部署经代理调用 Claude API](issues/04-claude-api.md)：（接入方式已改为 NewAPI 网关）草稿用 Sonnet 5、其余用 Haiku 4.5，约 650–800 美元/月（模型分工已取代：按用途配置，ADR 0012）
- [调研：积加开放接口能力与申请方式](issues/01-jijia-api.md)：易仓是积加三方仓名单首位，推单、取消、运费、轨迹、库存同步均支持；补发走补单间接路径（部分可行，补单参数待确认）；库存、出库状态、单号、运费（次日）可读；轨迹与取消无开放接口，轨迹用 17TRACK，易仓 OMS 接口可作取消与费用的备用
- [调研：Gmail、Shopify Admin API 与钉钉开放平台的能力与限制](issues/03-gmail-shopify-dingtalk.md)：三者均可只出站使用（Gmail Pub/Sub pull + history 轮询、Shopify 轮询或 Webhook 经 Pub/Sub、钉钉 Stream 长连接）；唯一绕不开的入站是工厂人员手机在钉钉内打开系统页；钉钉标准版配额紧
- [调研：亚马逊 SP-API 退款、取消、读订单与开发者资质](issues/02-sp-api.md)：Q-23 可行但须改为经 Feeds 异步执行（退款用订单调整 feed、取消用订单确认 feed，最长约 8 小时出结果）；亚马逊不允许卖家改地址；订单走积加即可只申请非受限角色、不碰买家 PII；数据政策不限地域但 PII 交付后最多留 30 天（已取代：订单改平台直读，ADR 0011；不设留存限制，ADR 0004）
- [调研：物流轨迹来源](issues/15-tracking-source.md)：推荐 17TRACK 聚合 + 主动轮询（覆盖本项目全部承运商，约 70–120 美元/月，无需公网入口）；不建议逐家直连承运商；退路为「超预计送达满 3 个工作日仍无签收」
- [调研：多模型接入能力差异（Claude、OpenAI GPT、OpenAI 兼容接口、NewAPI 网关）](issues/16-llm-compat.md)：经 NewAPI 调 Claude 用 Anthropic 原生 /v1/messages（OpenAI 格式会丢结构化输出、strict 工具与缓存断点）；GPT 用 Responses、其他兼容接口用 Chat Completions；推荐两家官方 SDK + 自写薄适配层与能力配置表（未采纳，接入层用 Vercel AI SDK，见 ADR 0001），结构化输出四档降级
- [讨论：部署拓扑与数据合规](issues/05-deploy-topology.md)：大陆公司服务器，境内直连、境外经固定代理；外部系统零入站，唯一公网入口是工厂工作台；不考虑合规；每日备份（已取代：WAL-G 归档 + 每日基础备份，ADR 0013 修订）；生产加开发测试两套环境
- [讨论：架构形态与代码仓库结构](issues/06-architecture-shape.md)：模块化单体，9 个业务模块加 integration、core（已取代：含 `order` 共 10 个，ADR 0005）；lint 强制边界，跨模块走发件箱事件；pnpm workspace；api 与 worker 两个容器
- [讨论：后端与数据库选型](issues/07-backend-db.md)：Node 24 + Hono（zod-openapi）+ Drizzle + PostgreSQL 18，一个模块一个 schema；锁用数据库租约，实时推送用 SSE + LISTEN/NOTIFY，暂无 Redis
- [讨论：前端框架与工程](issues/08-frontend.md)：Vite + React 19 单页应用，TanStack Router/Query/Table + react-hook-form + shadcn Charts；工厂工作台是同一项目的独立构建入口，以手机为主
- [讨论：后台任务与流程引擎](issues/09-jobs-workflow.md)：pg-boss（任务表即发件箱，无 Redis）；状态机手写迁移表；时限每分钟扫描；工作日历为前后端共用的纯函数包
- [讨论：集成层设计与「MCP 形式」的含义](issues/10-integration-layer.md)：进程内适配器、形状对齐 MCP，不拆独立服务；9 个动作结果含 pending 异步回执；映射存库；缺口转人工操作清单；每个适配器配 Fake
- [讨论：身份与权限](issues/11-identity-access.md)：服务端会话；6 个固定角色，能力矩阵前后端共用；店铺范围与生产厂隔离在应用层强制（不用 RLS）；钉钉版本待确认
- [调研：订单数据的准实时来源（SP-API 非受限订单接口、Shopify Admin API、第三方聚合平台）](issues/19-order-source.md)：推荐亚马逊订单走 SP-API v2026-01-01 非受限角色（ORDER_CHANGE 经 SQS + 增量兜底），Shopify 走 Admin API，买家姓名与地址仍取积加；不接聚合平台；MFN 单号能否读到待实测
- [调研：领星能否替代积加](issues/20-lingxing.md)：不建议替代，也不建议作补充数据源（读不到亚马逊收件人、时效未公布）；优势是运费约 30 分钟、可接口取消补发；是否换 ERP 由客户决定
- [讨论：第一期报表的数据来源与同步](issues/12-phase1-reporting-data.md)：订单改为平台直读（ADR 0011），新增 order 模块；第一期 7 个页面（已取代：另有 P27 审计日志，见第一期规格），17TRACK 推到第二期；首次回复按 Gmail 线程反推；报表直查业务表；台账即售后单；历史走同一流程导入
- [调研：电商客服 AI 工作流与模型应用](issues/21-llm-uses-and-approaches.md)：保留五步流水线，R-IN 升级为「意图流程」；上下文由代码预取装配、来信按不可信输入隔离；治理以代码为主；用途 11 个（第二期 4 个）；不加网关、可观测平台、向量库
- [讨论：模型接入层设计](issues/17-llm-gateway-layer.md)：11 个用途、业务只按用途调用；配置存库加管理员「模型」页；60 秒只管 triage + draft，按用途 × 模型熔断；完整调用记录；提示词分两层；第二期上线 4 个用途
- [讨论：工程与运维](issues/18-eng-ops.md)：GitHub + Actions，内网自托管运行器部署；PR 门槛含边界 lint 与真实 PG 集成测试；动态凭据加密存库；restic 备份到 NAS；监控先确认运维现状
- [讨论：AI 处理的编排与治理](issues/22-ai-orchestration.md)：五步流水线不上智能体；R-IN 升级为意图流程（P19 处理说明页签）；7 段上下文；治理以代码为主，承诺与审批项双向对账；可复算置信度；一次调用生成 3 版；回归集门控
- [事务：PRD 回写与升版](issues/23-prd-writeback.md)：PRD v2.8，新增 D-21，42 处回写加原型 5 处口径；停滞判定统一为「或」；P19 处理说明、P25、P26 三个画板待出图（已于 10-02 补齐，见 WORKPLAN）
- 交叉审查（[复核结论](reviews/复核结论.md)，未单列待办）：GPT-6-Astra 与 Claude Opus 5.5 独立审查，38 条全部采纳；总文档 v1.1、PRD v2.9（D-22）；待办 05、07、08、09、10、11、12、18、22 追加修订评论；第二轮复审 27 条全部采纳，总文档 v1.2、PRD v2.10（D-23）；待办 10、12、18 追加评论
- [事务：汇总技术方案总文档](issues/24-tech-doc.md)：`docs/技术方案.md` v1.2 定稿（PRD v2.10），第一期实现契约 11 条、实施切片 11 片；**目的地已到达**

## Not yet specified

（2026-09-24：目的地已到达。仅剩「事务：申请积加开放接口与 SP-API 开发者资质」由用户办理，它不阻塞进入第一期 `/to-spec`。）

（迷雾已全部拆成待办：PRD 回写见「事务：PRD 回写与升版」，编排演进与总文档见「事务：汇总技术方案总文档」。）

## Out of scope

- 写代码、搭项目骨架、CI 跑通：属于第一期实施，由 `/to-spec` 之后的待办完成。
- 二、三期的实施细化：本次只定架构，不细化到可实施。
- [事务：确认 Claude 签约主体与模型网关的部署地](issues/14-claude-contract.md)：Claude 改经 NewAPI 网关接入，用户决定不考虑调用合规与网络问题，签约主体与网关部署地不再需要确认。
