Title: 讨论：架构形态与代码仓库结构
Type: grilling
Status: resolved
Map: ../map.md

# 讨论：架构形态与代码仓库结构

## Question

生产系统采用什么架构形态、代码怎么组织？

要定：模块化单体还是微服务（推荐模块化单体：团队小、AI 代理开发、Docker Compose 部署）；模块边界如何对应 PRD 领域（工单与收件、审批单与动作、售后与台账、工厂工作台、知识库、报表、设置与组织）；单仓库多包（前端、后端、共享类型、适配器）的结构；Web 进程与后台任务进程是否分开部署。

## Answer

2026-09-24 用户同意全部推荐，详见 ADR [0005 模块化单体与强制模块边界](../../../docs/adr/0005-模块化单体与强制模块边界.md)。

- **形态**：模块化单体；同一个后端镜像分 `api`、`worker` 两个入口，在 Compose 里是两个容器。
- **模块**：`org`、`channel`、`ticket`、`approval`、`aftersales`、`factory`、`ai`、`knowledge`、`report`；基础设施层 `integration`、`core`；设置页的配置归各自所属的模块。
- **边界**：只通过模块公开接口调用，不跨模块读写表（`report` 可以只读）；跨模块联动用领域事件，经事务性发件箱交给 worker；lint 在 CI 中强制检查。
- **仓库**：pnpm workspace，包括 `apps/web`、`apps/server`、`packages/contracts`、`packages/config`；暂不引入 Turborepo 或 Nx。
- **命名**：沿用 PRD 11.1 的英文对象名；状态、表、列用 snake_case；注释写中文并标注规则编号。
- **留给后续**：发件箱实现归「讨论：后台任务与流程引擎」；工厂工作台是否与主应用同一个前端应用，归「讨论：前端框架与工程」；适配器是否拆成独立的 MCP 服务，归「讨论：集成层设计与「MCP 形式」的含义」。
