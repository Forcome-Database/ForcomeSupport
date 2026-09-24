Label: wayfinder:map

# 技术方案

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
  - 海外仓：是「易仓」（已作为三方仓接入积加），PRD 与原型中的「良仓」为错名，待全局更正。
  - 账号：Shopify、钉钉、Gmail（Google Workspace）管理权限已有；积加开放接口、亚马逊 SP-API 尚未开通。
  - 模型：Claude 经 NewAPI 网关接入（2026-09-24 用户决定）；调用合规与网络问题不在考虑范围内。模型层必须同时适配 Claude、OpenAI GPT 与任意 OpenAI 兼容接口，不绑定单一厂商；接入层用 Vercel AI SDK（ADR [0001](../../docs/adr/0001-模型接入层用VercelAISDK.md)）。
- **PRD 已锁定、不再讨论**：前端 shadcn/ui + Tailwind CSS v4（D-10）；读走积加、写走 SP-API 与 Shopify Admin API、来信走 Gmail、组织与通知走钉钉（D-14、D-16、D-17）；适配器为 MCP 形式（F-AP-02）；审计保留 ≥ 2 年；三期交付顺序 报表与台账 → 售后流程 → AI 回信。
- **已定 ADR**：[0001 模型接入层用 Vercel AI SDK](../../docs/adr/0001-模型接入层用VercelAISDK.md)；[0002 按记账方选择外部数据来源](../../docs/adr/0002-按记账方选择外部数据来源.md)；[0003 内网零入站与工厂工作台单一公网入口](../../docs/adr/0003-内网零入站与工厂工作台单一公网入口.md)；[0004 不设个人信息脱敏与留存限制](../../docs/adr/0004-不设个人信息脱敏与留存限制.md)；[0005 模块化单体与强制模块边界](../../docs/adr/0005-模块化单体与强制模块边界.md)；[0006 后端用 Hono 与 Drizzle 加 PostgreSQL](../../docs/adr/0006-后端用Hono与Drizzle加PostgreSQL.md)；[0007 前端用 Vite 单页应用与工厂工作台独立入口](../../docs/adr/0007-前端用Vite单页应用与工厂工作台独立入口.md)；[0008 后台任务用 pg-boss 与扫描式时限](../../docs/adr/0008-后台任务用pg-boss与扫描式时限.md)。
- **合规**：整个方案不考虑合规问题，按最佳体验设计（2026-09-24 用户决定，ADR [0004](../../docs/adr/0004-不设个人信息脱敏与留存限制.md)）。
- **已知风险**：SP-API 没有直接的自发货退款、取消接口，已由调研确认改走 Feeds 异步。

## Decisions so far

<!-- 每关闭一张待办追加一行：[待办标题](路径)：一句话结论 -->
- [调研：私有化部署经代理调用 Claude API](issues/04-claude-api.md)：（接入方式已改为 NewAPI 网关）草稿用 Sonnet 5、其余用 Haiku 4.5，约 650–800 美元/月
- [调研：积加开放接口能力与申请方式](issues/01-jijia-api.md)：易仓是积加三方仓名单首位，推单、取消、运费、轨迹、库存同步均支持；补发走补单间接路径（部分可行，补单参数待确认）；库存、出库状态、单号、运费（次日）可读；轨迹与取消无开放接口，轨迹用 17TRACK，易仓 OMS 接口可作取消与费用的备用
- [调研：Gmail、Shopify Admin API 与钉钉开放平台的能力与限制](issues/03-gmail-shopify-dingtalk.md)：三者均可只出站使用（Gmail Pub/Sub pull + history 轮询、Shopify 轮询或 Webhook 经 Pub/Sub、钉钉 Stream 长连接）；唯一绕不开的入站是工厂人员手机在钉钉内打开系统页；钉钉标准版配额紧
- [调研：亚马逊 SP-API 退款、取消、读订单与开发者资质](issues/02-sp-api.md)：Q-23 可行但须改为经 Feeds 异步执行（退款用订单调整 feed、取消用订单确认 feed，最长约 8 小时出结果）；亚马逊不允许卖家改地址；订单走积加即可只申请非受限角色、不碰买家 PII；数据政策不限地域但 PII 交付后最多留 30 天
- [调研：物流轨迹来源](issues/15-tracking-source.md)：推荐 17TRACK 聚合 + 主动轮询（覆盖本项目全部承运商，约 70–120 美元/月，无需公网入口）；不建议逐家直连承运商；退路为「超预计送达满 3 个工作日仍无签收」
- [调研：多模型接入能力差异（Claude、OpenAI GPT、OpenAI 兼容接口、NewAPI 网关）](issues/16-llm-compat.md)：经 NewAPI 调 Claude 用 Anthropic 原生 /v1/messages（OpenAI 格式会丢结构化输出、strict 工具与缓存断点）；GPT 用 Responses、其他兼容接口用 Chat Completions；推荐两家官方 SDK + 自写薄适配层与能力配置表，结构化输出四档降级
- [讨论：部署拓扑与数据合规](issues/05-deploy-topology.md)：大陆公司服务器，境内直连、境外经固定代理；外部系统零入站，唯一公网入口是工厂工作台；不考虑合规；每日备份；生产加开发测试两套环境
- [讨论：架构形态与代码仓库结构](issues/06-architecture-shape.md)：模块化单体，9 个业务模块加 integration、core；lint 强制边界，跨模块走发件箱事件；pnpm workspace；api 与 worker 两个容器
- [讨论：后端与数据库选型](issues/07-backend-db.md)：Node 24 + Hono（zod-openapi）+ Drizzle + PostgreSQL 18，一个模块一个 schema；锁用数据库租约，实时推送用 SSE + LISTEN/NOTIFY，暂无 Redis
- [讨论：前端框架与工程](issues/08-frontend.md)：Vite + React 19 单页应用，TanStack Router/Query/Table + react-hook-form + shadcn Charts；工厂工作台是同一项目的独立构建入口，以手机为主
- [讨论：后台任务与流程引擎](issues/09-jobs-workflow.md)：pg-boss（任务表即发件箱，无 Redis）；状态机手写迁移表；时限每分钟扫描；工作日历为前后端共用的纯函数包

## Not yet specified

- **AI 处理的实现**：五步处理的提示与流程、知识库检索方式、草稿质量评测与回归。模型接入已拆出「调研：多模型接入能力差异」「讨论：模型接入层设计」；其余等「集成层设计」「后端与数据库选型」「讨论：模型接入层设计」定了再拆。
- **编排演进**：从 Docker Compose 迁移到更正式编排的时机与条件。
- **PRD 回写**：调研发现需要改 PRD 的地方，定稿前统一回写并升版：Q-23、R-AP-04、R-AP-05 改为亚马逊经 Feeds 异步执行（审批单执行中可持续数小时）；P22 改地址悬停说明；D-17、术语表、E-33、P18 中「物流轨迹经积加」改为经轨迹服务；R-IN（或）与 R-AS-02（且）的停滞判定口径统一。等相关讨论定完后拆成待办。
- **技术方案总文档**：各决策定完后汇总成 `docs/技术方案.md`，届时拆成一张待办。

## Out of scope

- 写代码、搭项目骨架、CI 跑通：属于第一期实施，由 `/to-spec` 之后的待办完成。
- 二、三期的实施细化：本次只定架构，不细化到可实施。
- [事务：确认 Claude 签约主体与模型网关的部署地](issues/14-claude-contract.md)：Claude 改经 NewAPI 网关接入，用户决定不考虑调用合规与网络问题，签约主体与网关部署地不再需要确认。
