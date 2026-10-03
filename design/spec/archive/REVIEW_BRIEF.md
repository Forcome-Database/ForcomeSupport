# 交叉审查任务书（子代理 3）

> 历史归档（2026-09-22 已完成）：本任务书针对当时的 P01–P21 与左侧导航，现行页面为 P01–P27、顶栏导航，以 PRD v2.12 与原型为准。

只读审查，不改任何文件，最后返回问题清单。

## 审查对象
- PRD 源：spec/prd_a.md、prd_b.md、prd_c.md、prd_d.md（生成的 forcome-blueprint-guide.html 与之等价）
- 示例数据：spec/data.py
- 高保真页面 P01–P21：Main、TicketEmail、TicketEscalated、Tickets、TicketDetail、Customer、AfterSalesList、AfterSalesConfirm、AfterSalesTicket、AfterSalesInStock、AfterSalesRefund、AfterSalesNegotiation、AfterSalesLog、AfterSalesSettlement、Actions、KnowledgeBase、Reports、Settings、SettingsRules、SettingsTeam、FactoryPortal（.dc.html，截图在 spec/shots/*.png）
- 状态板：GlobalStates、StatesInbox、StatesApproval、StatesAfterSales、StatesFactory、StatesAdmin；规范板 DesignSystem；页面地图 PageMap
- 流程图：Architecture、LifeCycle、AfterSales、DecisionTree、EmailFlow
- 决策记录：forcome-agent-decision-scheme.html

## 检查项
1. 页面与规格一致：prd_c.md 每页列出的元素、按钮文案、计数、数据、状态，页面上是否都有、是否一致；页面上有而规格没有的业务行为。
2. 数据一致：同一单号、金额、时间、状态在不同页面、PRD、状态板里是否一致；计数（角标、分段、页签、指标）能否由 data.py 推出。
3. 规则一致：页面、流程图、PRD 第 5–7 节在状态名、审批人、时限、报备类型、归并规则、SLA 定义、协商轮次、权限上有无冲突；旧说法残留（动作审批后发、待动作审批、工厂门户、索赔回款、向工厂索赔、坐席主管、四道门、剧本、承担方单字段）。
4. 状态覆盖：prd_c.md 第 8A 节每个编号在状态板上都有画面；每个页面的「状态」行引用的编号都存在。
5. 权限一致：每页左侧导航项是否符合 PRD 4.1 的角色可见性；页面上出现的按钮是否符合 10.1 权限（例如售后负责人看不到报备「批准」）。
6. 可用性与表达：术语、文案规范（设计规范第 11 节）、按钮动词、禁用原因说明、错误文案是否写清怎么改。
7. 可实现性：规格里有没有研发无法实现或无法测试的模糊描述。

## 输出格式
按严重程度排序，每条：编号 · 位置（文件与元素或 PRD 小节）· 问题 · 应改为（写出具体改法）。最后给出「未发现问题」的检查项。
