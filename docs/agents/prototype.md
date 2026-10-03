# 原型

原型在 `design/`，由 `design/spec` 下的脚本生成（示例数据唯一来源 `design/spec/data.py`）。它是生产系统的界面规格和验收依据，不进入生产代码。

- **截图**：`design/spec/shots/<画板>.png`。页面是 1440 × 900 的整页截图，状态板是长图。做界面时先看它。
- **原文**：要逐字核对文案、数字或结构时，读同名的 `design/<画板>.dc.html`；口径以 PRD（`design/spec/prd_a.md`–`prd_d.md`）为准。
- **截图过时**：画板改过而截图没更新时，在 `design/spec` 下运行 `python check.py --shots <画板>.dc.html` 重新生成。

原型画的是完整产品（第三阶段形态）。第一、二阶段的差异由 PRD 各页「第一阶段」「第二阶段」小节与下表的状态板表达，被裁掉的部分不用做。标「当期」的列，每期开工时替换。

## 页面编号 → 画板

「上线」取自 PRD 10.1 的阶段：一起 = 第一阶段起，二起 = 第二阶段起，三 = 第三阶段。

| 页面 | 画板 | 上线 | 分阶段形态 | 当期（第一期） |
|---|---|---|---|---|
| P01 收件箱 · 亚马逊工单 | `Main` | 二起 | 第二阶段为人工处理界面 I19–I21，完整版随第三阶段 | 只参考顶栏外壳 |
| P02 收件箱 · 邮件工单 | `TicketEmail` | 二起 | 同 P01 | |
| P03 收件箱 · 转人工工单 | `TicketEscalated` | 二起 | 同 P01 | |
| P04 工单列表 | `Tickets` | 一起 | 第一阶段 I16、I17；第二阶段见 P04「第二阶段」 | ✓ I16、I17 |
| P05 工单详情 · 全程记录 | `TicketDetail` | 一起 | 第一阶段 I18；第二阶段见 P05「第二阶段」 | ✓ I18 |
| P06 客户档案 | `Customer` | 二起 | | |
| P07 售后单列表 | `AfterSalesList` | 二起 | 第一阶段遗留的手工登记单 S16 | |
| P08 确认责任与处理方式 | `AfterSalesConfirm` | 二起 | 第二阶段见 P08「第二阶段」 | |
| P09 售后单详情 · 易仓无货 | `AfterSalesTicket` | 二起 | | |
| P10 售后单详情 · 易仓有货 | `AfterSalesInStock` | 二起 | | |
| P11 售后单详情 · 部分补偿 | `AfterSalesRefund` | 二起 | | |
| P12 承担比例协商 | `AfterSalesNegotiation` | 二起 | | |
| P13 登记台账 | `AfterSalesLog` | 一起 | 第一阶段 S13–S15 | ✓ S13–S15 |
| P14 内部结算 | `AfterSalesSettlement` | 二起 | | |
| P15 审批 | `Actions` | 二起 | A1–A11 | |
| P16 知识库 | `KnowledgeBase` | 三 | | |
| P17 报表 | `Reports` | 一起 | 第一阶段 K19；第二阶段见 P17「第二阶段」 | ✓ K19 |
| P18 设置 · 渠道与店铺 | `Settings` | 一起 | 第一阶段 K20 | ✓ K20 |
| P19 设置 · 处理规则 | `SettingsRules` | 三 | K15、K16、K21 | |
| P20 设置 · 团队与权限 | `SettingsTeam` | 一起 | 第一阶段见 P20「第一阶段」、K10 与 K17 的第一阶段小图 | ✓ |
| P21 工厂工作台 | `FactoryPortal` | 二起 | F1–F9 | |
| P22 设置 · 动作映射 | `SettingsActions` | 二起 | | |
| P23 设置 · 售后规则 | `SettingsAfterSales` | 二起 | | |
| P24 设置 · 工厂账号 | `SettingsFactory` | 二起 | | |
| P25 设置 · 模型 | `SettingsModels` | 二起 | | |
| P26 设置 · 系统状态 | `SettingsHealth` | 二起 | | |
| P27 审计日志 | `AuditLog` | 一起 | K18；第一阶段对象类型见 P27「第一阶段」 | ✓ K18 |
| 设置 · SLA、标签库、模板 | `StatesAdmin` 的 K22–K24 | 二起 | | |
| 登录、登录被拒、站内通知 | `GlobalStates` 的 G11、G12、G10 | 一起 | | ✓ |

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
