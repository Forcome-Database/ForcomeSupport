# 定稿工作计划（2026-09-21 起）

目标：PRD 与原型整体定稿，可直接进入研发。预算 3 个子代理。

## 产出物
- `spec/prd.md` → 生成 `forcome-blueprint-guide.html`（PRD v2.0 定稿）
- `spec/data.py` 统一示例数据（所有原型只从这里取数）
- `spec/ui.py` 组件库（所有高保真页面只用这里的组件）
- 画布：设计规范、页面地图、高保真页面 P01–P21、状态板、流程图、邮件流转、视觉方向归档
- 决策记录增补本轮决策

## 分工
- 我：data.py、ui.py、DesignSystem / GlobalStates / PageMap 三张板、PRD 全文、流程图同步、决策记录、集成发布
- 子代理 1：P01–P06、P15–P17 与状态板 StatesInbox / StatesApproval
- 子代理 2：P07–P14、P18–P21 与状态板 StatesAfterSales / StatesFactory / StatesAdmin
- 子代理 3：最终交叉审查（PRD ↔ 原型 ↔ 流程图），只报告

## 进度
- [x] data.py
- [x] ui.py + DesignSystem + GlobalStates + PageMap
- [x] PRD 核心章节（术语、状态机、规则、页面规格）
- [x] 子代理 1、2 交付并按其反馈修正规格、数据、组件库
- [x] PRD 其余章节（异常、权限、验收、待确认）+ build_prd.py
- [x] 流程图同步 + 决策记录 13–19 + build_canvas.py
- [x] 集成、检查、发布（画布 v25、PRD v10、决策记录 v8）
- [x] 子代理 3 审查与修复（09-22）：39 条全部落地——D-11 至 D-13、R-CL 工作日历、R-SL-07、R-LG-04、备用审批人（Q-19）、生产厂日历（Q-20）、I14–I15、F8–F9、K11–K14、五张流程图与决策记录口径统一；画布 v26、PRD v11、决策记录 v9 已发布
- [x] 客户答复待确认与视觉升级（09-22）：Q-01 官方接入（D-14，积加预留）、Q-19 备用审批人确认、Q-20 工作日不扣节假日 + 生产厂 FQD / FZJ（D-15）；按参考稿 forcome-support-console.html 升级 v3 视觉（ui.py 换肤、收件箱三栏重排、浮动面板），设计规范第 12 节 shadcn/ui + Tailwind v4 映射；新增 Q-21–Q-24；画布 v27、PRD v12、决策记录 v10（决策 20–22）已发布
- [x] 第二批客户答复（09-22）：Q-22 配件全由两厂生产 + 成员部门来自钉钉（D-16、决策 23，Q-02 一并关闭）；Q-23 亚马逊退款取消经 SP-API，人工操作清单只作兜底；Q-24 第一期浅色 + 舒适/紧凑两档密度（全局状态 G9，顶栏去掉主题切换）；画布 v28、PRD v13、决策记录 v11 已发布
