Title: 讨论：后台任务与流程引擎
Type: grilling
Status: open
Blocked by: 07
Map: ../map.md

# 讨论：后台任务与流程引擎

## Question

SLA 计时、审批时限、重试、生产厂任务时限、月度批次这些时间驱动与长流程，用什么机制实现？

要定：任务队列与调度方案（如基于 PostgreSQL 的 pg-boss / Graphile Worker、Redis 的 BullMQ、Temporal 这类持久化工作流）；工作时间日历（R-CL-01、R-CL-02）的计算放在哪；动作执行的幂等与重试（R-AP-05：1、5、15 分钟）；审批单与售后单状态机的落地方式；Docker Compose 下的部署形态（ADR 0006 已把锁和推送放在 PostgreSQL 上，目前没有 Redis；选 BullMQ 就要新增 Redis）；ADR 0005 要求的事务性发件箱如何实现；外部轮询任务（Gmail、17TRACK 每 4 小时、SP-API feed 回执、积加同步）的调度。
