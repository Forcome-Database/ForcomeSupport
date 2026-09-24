Title: 讨论：后台任务与流程引擎
Type: grilling
Status: resolved
Blocked by: 07
Map: ../map.md

# 讨论：后台任务与流程引擎

## Question

SLA 计时、审批时限、重试、生产厂任务时限、月度批次这些时间驱动与长流程，用什么机制实现？

要定：任务队列与调度方案（如基于 PostgreSQL 的 pg-boss / Graphile Worker、Redis 的 BullMQ、Temporal 这类持久化工作流）；工作时间日历（R-CL-01、R-CL-02）的计算放在哪；动作执行的幂等与重试（R-AP-05：1、5、15 分钟）；审批单与售后单状态机的落地方式；Docker Compose 下的部署形态（ADR 0006 已把锁和推送放在 PostgreSQL 上，目前没有 Redis；选 BullMQ 就要新增 Redis）；ADR 0005 要求的事务性发件箱如何实现；外部轮询任务（Gmail、17TRACK 每 4 小时、SP-API feed 回执、积加同步）的调度。

## Answer

2026-09-24 用户同意全部推荐，详见 ADR [0008 后台任务用 pg-boss 与扫描式时限](../../../docs/adr/0008-后台任务用pg-boss与扫描式时限.md)。

- **队列**：pg-boss，不加 Redis、不用 Temporal；业务事务内插入任务，任务表即发件箱。
- **状态机**：PRD 第 6 章翻译成纯函数迁移表，放在各自模块内，单元测试全覆盖。
- **时限**：每分钟扫描截止时间列；月度结算批次用 cron + 单例键。
- **工作日历**：纯函数，放在 `packages/calendar`，前后端共用。
- **动作执行**：幂等键；重试间隔 1、5、15 分钟；3 次失败后由发起人决定重试或转人工；结果不明先查询确认。
- **轮询**：Gmail pull + 每 5 分钟 history 兜底、feed 回执每 5 分钟、17TRACK 每 4 小时、Shopify 令牌每 20 小时；常驻连接用 advisory lock 选主。积加同步频率归「讨论：第一期报表的数据来源与同步」。

## Comments

2026-09-24（交叉审查复核后修订，见 `reviews/复核结论.md`、PRD D-22）：
- R-AP-05 明确为「初次失败后最多重试 3 次，共最多 4 次尝试」。
- Shopify 令牌：24 小时过期，每 20 小时提前刷新。
- 新增：Gmail 每天续订 `watch`、游标过期（404）按时间区间全量补拉、同时覆盖「已发送」；积加补发以 `pending` 等到「已推送易仓且未缺货」；SP-API 共享令牌桶；可注入时钟与历史回放；绑定回复前校验新来信（ADR 0008 修订）。
