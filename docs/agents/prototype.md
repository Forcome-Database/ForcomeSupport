# 原型

原型在 `design/`，由 `design/spec` 下的脚本生成（示例数据唯一来源 `design/spec/data.py`）。它是生产系统的界面规格和验收依据，前端严格照做（规则见 `CLAUDE.md`「界面严格按原型」），不进入生产代码。

- **截图**：`design/spec/shots/<画板>.png`。页面是 1440 × 900 的整页截图，状态板是长图。做界面时先看它。
- **原文**：要逐字核对文案、数字或结构时，读同名的 `design/<画板>.dc.html`；口径以 PRD（`design/spec/prd_a.md`–`prd_d.md`）为准。
- **截图过时**：画板改过而截图没更新时，在 `design/spec` 下运行 `python check.py --shots <画板>.dc.html` 重新生成。

原型画的是完整产品（第三阶段形态）。第一、二阶段的差异由 PRD 各页「第一阶段」「第二阶段」小节与下表的状态板表达，被裁掉的部分不用做。状态板里的阶段画面是缩小的，当期页面另有全尺寸参照图（见下方「当期参照图」）。标「当期」的列与「当期参照图」一节，每期开工时替换。

## 页面编号 → 画板

「上线」取自 PRD 10.1 的阶段：一起 = 第一阶段起，二起 = 第二阶段起，三 = 第三阶段。

| 页面 | 画板 | 上线 | 分阶段形态 | 当期（第一期） |
|---|---|---|---|---|
| P01 收件箱 · 亚马逊工单 | `Main` | 二起 | 第二阶段为人工处理界面 I19–I21，完整版随第三阶段 | 只参考顶栏外壳 |
| P02 收件箱 · 邮件工单 | `TicketEmail` | 二起 | 同 P01 | |
| P03 收件箱 · 转人工工单 | `TicketEscalated` | 二起 | 同 P01 | |
| P04 工单列表 | `Tickets` | 一起 | 第一阶段 I16、I17；第二阶段见 P04「第二阶段」 | ✓ `P04_Tickets`、`P04_Tickets_drill`、`P04_Tickets_unassigned`、`P04_Tickets_unassigned_empty`（未归属店铺队列与空队列，I17 补充小样③④）；下钻的芯片与计数行看 I16 ②，列表为空看 I10 与 I16 的说明（PRD P04「第一阶段」v2.36），指定与撤销看 I17 其余补充小样 |
| P05 工单详情 · 全程记录 | `TicketDetail` | 一起 | 第一阶段 I18；第二阶段见 P05「第二阶段」 | ✓ `P05_TicketDetail`、`P05_TicketDetail_awaiting`、`P05_TicketDetail_customer`、`P05_TicketDetail_closed`（待回复、等客户、已关闭，I18 补充小样③–⑤；其余写法与 G2/G3 看 I18 ⑥–⑧） |
| P06 客户档案 | `Customer` | 二起 | | |
| P07 售后单列表 | `AfterSalesList` | 二起 | 第一阶段遗留的手工登记单 S16 | |
| P08 确认责任与处理方式 | `AfterSalesConfirm` | 二起 | 第二阶段见 P08「第二阶段」 | |
| P09 售后单详情 · 易仓无货 | `AfterSalesTicket` | 二起 | | |
| P10 售后单详情 · 易仓有货 | `AfterSalesInStock` | 二起 | | |
| P11 售后单详情 · 部分补偿 | `AfterSalesRefund` | 二起 | | |
| P12 承担比例协商 | `AfterSalesNegotiation` | 二起 | | |
| P13 登记台账 | `AfterSalesLog` | 一起 | 第一阶段 S13–S15 | ✓ `P13_AfterSalesLog`、`P13_AfterSalesLog_agent`；筛选行、列表为空、列设置、合计行与导出看 S13 补充小样；抽屉与弹窗看 S14、S15 及 S14 补充小样（之二 · 汇率、之三 · 编辑登记）、S15 补充小样（含「改派负责人与待分配」） |
| P14 内部结算 | `AfterSalesSettlement` | 二起 | | |
| P15 审批 | `Actions` | 二起 | A1–A11 | |
| P16 知识库 | `KnowledgeBase` | 三 | | |
| P17 报表 | `Reports` | 一起 | 第一阶段 K19；第二阶段见 P17「第二阶段」 | ✓ `P17_Reports`；指标对比、下钻、K3 与 K4、售后成本卡与导出看 K19 补充小样①–⑧ |
| P18 设置 · 渠道与店铺 | `Settings` | 一起 | 第一阶段 K20 | ✓ `P18_Settings`；店铺抽屉看 K8，渠道卡的连接状态与回补行看 K20 |
| P19 设置 · 处理规则 | `SettingsRules` | 三 | K15、K16、K21 | |
| P20 设置 · 团队与权限 | `SettingsTeam` | 一起 | 第一阶段见 P20「第一阶段」、K10 第一阶段补充小样与 K17 补充小样 | ✓ `P20_SettingsTeam`；角色权限页签看 K17，格内修改与保存栏看 K17 补充小样，停用成员看 K10 第一阶段补充小样 |
| P21 工厂工作台 | `FactoryPortal` | 二起 | F1–F9 | |
| P22 设置 · 动作映射 | `SettingsActions` | 二起 | | |
| P23 设置 · 售后规则 | `SettingsAfterSales` | 二起 | | |
| P24 设置 · 工厂账号 | `SettingsFactory` | 二起 | | |
| P25 设置 · 模型 | `SettingsModels` | 二起 | | |
| P26 设置 · 系统状态 | `SettingsHealth` | 二起 | | |
| P27 审计日志 | `AuditLog` | 一起 | K18；第一阶段对象类型见 P27「第一阶段」 | ✓ `P27_AuditLog`；可见范围看 K18 及其补充小样 |
| 设置 · SLA、标签库、模板 | `StatesAdmin` 的 K22–K24 | 二起 | | |
| 登录、登录被拒、站内通知 | `GlobalStates` 的 G11、G12、G10 | 一起 | | ✓ |

## 当期参照图（第一期）

`design/spec/shots/phase1/<名称>.png`，1440 × 900 整页，示例数据与演示时刻同原型（2026-09-11 10:20）；逐字核对读 `design/spec/phase1/<名称>.dc.html`。画面与状态板同源，改了页面脚本或示例数据后在 `design/spec` 下运行 `python shot_phase1.py` 重新生成。上表「当期」列的名称即文件名。

## 规范与状态

| 内容 | 画板 |
|---|---|
| 设计规范：颜色、字体、间距、组件，以及与 shadcn/ui 的对应 | `DesignSystem` |
| 全局状态（G1–G12）：整页加载、无权限、找不到、断网、浮层提示、二次确认、并发、未保存离开、密度、站内通知、登录、登录被拒 | `GlobalStates` |
| 收件箱与工单的状态（I1–I21） | `StatesInbox` |
| 审批（A1–A11）、售后（S1–S16）、工厂工作台（F1–F9） | `StatesApproval`、`StatesAfterSales`、`StatesFactory` |
| 知识库、报表、设置的状态（K1–K24） | `StatesAdmin` |
| 页面之间的跳转（卡片标「第一阶段」的为第一期页面） | `PageMap` |
| 流程图：架构、生命周期、售后流程、决策逻辑、邮件流转 | `Architecture`、`LifeCycle`、`AfterSales`、`DecisionTree`、`EmailFlow` |

## 当期没有原型的界面（第一期）

- 开发登录页（只在非生产环境出现）。

这些界面用设计规范板、全局状态板和已做好页面的组件来拼，不自创样式。
