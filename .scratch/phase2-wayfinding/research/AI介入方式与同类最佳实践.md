# AI 介入方式与同类最佳实践（调研）

Type: research
票：[02 AI 介入方式与同类最佳实践](../issues/02-AI介入方式与同类最佳实践.md)（地图：[第二期探路地图](../map.md)）
日期：2026-10-24
下游：[09 AI 介入方式与编排](../issues/09-AI介入方式与编排.md)（grilling）

## 0 问题、对照对象与方法

**问题**（用户 2026-10-24）：「整个流程中，AI 该如何介入，当前的事项方案是不是最佳的，比如意图识别，比如生成草稿回复是多轮工具调用，还是单一工作流等等，调查一下同类型做得好的最新方案。」

**对照的现行方案**：ADR 0014（五步固定外层流水线 + 意图流程 + 代码治理；`draft` 不开放工具、数据由代码按意图预取；写动作只作为审批项）、ADR 0012（按用途调用、自有调用记录、不引入网关与可观测平台）、ADR 0009（形状对齐 MCP 的统一动作接口）、`docs/技术方案.md` 第 9 节、PRD 5.1–5.2 与 7.3–7.6、7.13、`.scratch/phase3-ai-reply/spec.md`。

**与早先调研的关系**：2026-09-24 的 `research/llm-uses`（票 21）与票 22 已得出「保留五步流水线、主流平台都在往自然语言流程 + 确定性控制收敛」等结论，ADR 0014 据此定稿。那份报告所在分支不在本仓库，本次只依据票 21、22 的结论摘要，不重复它的平台逐家介绍，而是：① 用 2025-10 之后的新资料复核这些结论还成不成立；② 回答当时没细答的几处——意图「怎么分」、预取覆盖不到时怎么办、写动作在同类里到底是谁批准、放量与评测门槛的具体做法；③ 结合 D-30（二三期合并交付、不与海帆并行）带来的新约束。

**方法与来源分级**：优先官方帮助中心与开发文档、官方工程博客、论文全文；产品页标「营销页」，只作旁证。取证限制：developer.salesforce.com 返回 403、help.salesforce.com 是动态页，这两处只拿到检索摘要（文中标「摘要」）；亚马逊 Seller Central 帮助页需登录，用的是亚马逊 CDN 上的公开 PDF；eDesk 帮助中心页面不标日期；Yuma、Siena 没有公开帮助中心，只有官方博客与产品页。网页正文经抽取工具读取，个别英文引文可能有轻微改写，正式引用前建议打开原文核对。

## 1 结论摘要

一句话：**现行方案的骨架（固定外层流水线、显式意图、写动作只提审批、代码治理）与 2025–2026 做得好的同类一致，不需要改成自主智能体；要补的是几处「怎么做」——预取覆盖不到时的受控补查、意图边界的写法、评测门槛的分层与量化、放量与发送前护栏的细节。**

先说清楚同类的真实形态，免得误读：Fin、Ada、Zendesk、Sierra、Decagon 这些做实时聊天的头部产品，前线代理都是**模型在程序约束下多轮调用工具**（Fin 的 planner 与链式连接器 [I3]、Ada 2025-10 起的快慢双推理器 [AD4]、Zendesk 的生成式 procedure [Z8]、Agentforce 的 Atlas 循环 [F4]），并不是固定工作流。但它们同时在做三件事：把能写成代码的部分改回确定性逻辑（Agentforce Agent Script [F2]、Fin 与 Ada 的 IF/ELSE 与固定步骤 [I2][AD5]）；把写动作收紧到人或流程把关（Zendesk 建议写操作由坐席批准 [Z7]、Fin 建议写操作连接器关闭自动触发 [I8]）；用回归集与模拟挡发布 [I12][S8][AD4]。本项目是异步邮件——一封来信处理一次、数据需求按意图可知、写动作全部审批、`triage` + `draft` 共 60 秒——工具循环在聊天里换来的「边问边查」在这里价值有限，所以固定工作流仍是更合适的默认。

### 1.1 保留（按重要性）

1. **五步固定外层流水线 + 意图流程（结构化部分由代码执行、处理说明由客服主管维护）。** 2025–2026 最明确的趋势是「确定性骨架 + 局部模型推理」：Salesforce 把 Agentforce 从纯 ReAct 循环的 Atlas 推到 Agent Script 混合推理，架构指南直说「The default position should be deterministic」「if you can express a decision as code, it should be written as logic」[F2]；Fin Procedure 是自然语言步骤加 IF/ELSE 与「Code snippets for when absolute accuracy is essential」[I2]；Ada 的 Playbook 每一步可选「fixed」或「AI-driven」[AD5]；Zendesk 在同一个代理里混用生成式 procedure 与确定性分支的 dialogue [Z3]；Decagon 的 AOP 是自然语言加代码 [D4]；eDesk 的 Procedure 是 Condition / Gate / Guidance / Outcome 组成的流程图 [E2]。Zendesk 还明说指令只是「strong guidance rather than rigid commands」[Z5]——必须守住的规则不能只写在提示词里，这正是本项目「结构化部分由代码执行」的理由。
2. **显式意图分类（12 个意图 + 来源类别）。** 本项目的意图不只是标签，它决定允许的动作、默认发送方式、自动发送白名单、采纳率与熔断的统计口径。同类分两种用法：
   - 分类直接触发流程：Gorgias 内置 24 个意图，每个意图有「AI 处理 / 转人工」的状态开关 [G1][G4]；eDesk 先分类再按类型选 Procedure [E1][E2]；Agentforce 每句话只选一个 subagent（原 topic），按「classification description」匹配 [F1]。
   - 前线代理按程序的「何时适用」描述选程序，显式分类另用于路由、转人工与报表：Fin 拿每条消息比对各 Procedure 的「trigger description」[I1]，运行时由微调的小模型按相关度加阈值挑选，生产流量里 84% 的程序相关度检查结果是「没有适用的」[I3]，同时 Fin Attributes 做显式分类，供工作流路由、自动转人工与报表 [I4]；Zendesk 的 use case 只按名称与描述匹配，旧的意图预测「might not match the use case the AI agent ultimately selected」[Z1][Z2]，工单侧仍由 intelligent triage 做主题、情绪、语言分类，供触发器与路由 [Z4]；Ada 选 Playbook 的主要依据是「When to use this Playbook」[AD2]，Topic / Intent 分类用于分析并随转人工传给帮助台 [AD3]；Decagon、Sierra、Yuma 2.0 类似 [D1][D3][Y1]。
   - 两种用法的共同点是「先选定一套流程」，差别在选择依据写成什么。业界淘汰的是「用语料训练的意图模型 + 脚本对话」（Zendesk 术语表里的上一代做法 [Z3]），不是「先选流程」。本项目用 LLM 按意图描述分类，本质上就是「按描述选流程」；改进写法见 1.2 第 2 条。
3. **写动作只作为审批项提出，前置条件由代码判定，草稿承诺与审批项对账。** 同类的写动作基本都要过人或流程：Zendesk auto assist「Actions that write data, such as an action that refunds an order, should be marked as agent-approved」，并警告预先批准的动作「may execute the action without satisfying its prior conditions」[Z7]；Fin 建议写操作连接器选「Disabled (manual trigger)」，「where you want human or workflow oversight before anything runs」[I8]，Procedure 有暂停待批的 Checkpoint [I2]，前置条件虽可用自然语言写，官方仍建议在服务端校验 [I10]；面向买家直接执行的 Gorgias 也要靠平台判定的条件与买家确认兜底（取消订单先查是否未履约，不可逆动作默认要求买家确认）[G5][G6]。τ-bench 里政策写明「obtain explicit user confirmation (yes)」，模型仍会不经确认就办退货 [P5]；OpenAI 指南要求取消订单、大额退款、付款「trigger human oversight until confidence in the agent's reliability grows」[O1]；坐席辅助产品（Sierra Live Assist、Decagon Assist、Agentforce Service Assistant、Shopify Sidekick）一律是 AI 提出、人执行或批准 [S10][D10][F7][H3]。本项目的退款、补发是 FSH 现金支出，亚马逊退款经 Feeds 异步执行，业务已定审批，保留。
4. **风险信号「关键词 + 模型取并集」、安全事故与平台风险硬转人工、疑似提示注入。** 同类的转人工都不只靠提示词：Zendesk「Instructions cannot trigger escalations」，必须用专门的升级块 [Z5][Z8]；Fin 的升级判断由专门的分类模型做（「handles 90% of cases with >98% accuracy」，难例交给 LLM）[I11]；Gorgias 的愤怒、要求真人、敏感话题信号不可关 [G7]；Sierra 专设检测输入威胁的 supervisor [S6]。论文原则是「once an LLM agent has ingested untrusted input, it must be constrained」[P1]：本项目模型读买家来信，但输出只能落到枚举与审批项，属于论文的 Action-Selector / Plan-Then-Execute 一类做法。
5. **置信度为可复算的综合分，不用模型自报。** 模型口头给出的置信度普遍偏高 [P3]；同类公开资料里没有一家公开自动发送的置信度口径（eDesk 只说「If the AI Agent is confident」[E3]），R-SD-05 的做法更可控。
6. **知识按「店铺 × 语言 × 渠道 × 意图 × 有效期」过滤后全量放入，放不下再检索。** 知识量在 20 万词元以内可以整体放进提示词并配合缓存 [A5]；但上下文越长越不稳定、一个相关的干扰段落就会拉低表现 [P4][A2]，所以「先过滤」比「放得下」更要紧。Fin（语义检索 40 篇、重排后留 5–10 篇 [I19]）、Zendesk（最多 5 篇 [Z13]）、Gorgias（按相关性、每店上限 100 条 [G3]）都用检索，那是因为它们服务的知识库大且不受控；本项目知识量小、维度清楚，过滤后全量更简单，也省掉检索失败这一类错误。
7. **自动发送按意图白名单、采纳率门槛、回归门槛、抽检熔断。** 同类的放量单位都是「意图 / 程序 / 渠道」[G4][E2]，上线后全量或抽样质检 [D8][G9][I13]，版本可回滚 [I12][AD8][S5]。本项目 R-SD-02、03、06 已覆盖主要部分，调整见 1.2 第 5 条。
8. **不上多智能体。** OpenAI「maximize a single agent's capabilities first」[O1]，Shopify「Avoid multi-agent architectures early」[H1]。

### 1.2 建议调整（按重要性）

1. **草稿生成：默认仍是「代码按意图预取 + 一次生成」，但把「受控补查」写进合并期规格，不再整体留到上线后。**
   - 第一级（建议进合并期）：**结构化补查一次。** `triage` 或 `draft` 输出结构化的「缺少的事实」（来信提到的另一个订单号、运单号、配件号等），代码校验（同店铺、同客户、属于本意图允许的查询类型）后取数，再调用一次 `draft`；计入 60 秒时限（来不及就按 E-03 降级），调用记录写明补查项。做法对应 [P1] 的 Plan-Then-Execute 和 [A3] 的「把多步查询合成一个工具」。
   - 第二级（保持 ADR 0014「回归集与线上数据稳定后再评估」）：**按意图开关的只读工具循环。** 工具只读、店铺与客户由代码绑定而不是模型传参（R-ST-03）、步数有上限（AI SDK 里结构化输出本身算一步，`stopWhen` 要多留一步 [V2]）；在回归集上与第一级对比，更好才开。
   - 写动作始终不作为模型工具。AI SDK 的 `toolApproval` 适合会话内即时批准 [V1]，不适合本项目 4 小时时限、多审批人、带处理锁的审批单。
   - 理由：实时聊天产品用工具循环，是因为要边问边查；本项目一封来信一次处理，数据需求按意图可知。工具循环的代价同类自己也承认：Fin「Structured search isn't free, multiple tool calls add latency compared to single-shot RAG」[I7]，没有要规划的内容时直接跳过 planner，把几秒的一步变成几毫秒的打分 [I3]；Salesforce「Every unnecessary LLM call adds latency, cost, and variability」[F2]。多步工具调用的一致性也仍差：τ-bench 中 gpt-4o 零售域 pass^1 为 61.2%、「pass^8 drops to < 25 %」[P5]，τ²-bench 中任务需要的动作超过 7 个时成功率接近 0 [P6]。但纯预取有一类覆盖不到——来信提到预取清单以外的对象——现在只能转人工或让草稿缺依据，补查一次就能覆盖大部分，且仍可审计。
2. **意图识别：保留显式分类，改进「怎么分」。**
   - 每个意图流程增加「适用 / 不适用条件 + 正反例」，由客服主管在 P19 处理说明里维护，`triage` 提示词由这些描述拼成。这就是 Fin 的 trigger description [I1]、Zendesk 的 use case 描述 [Z1]、Ada 的「When to use this Playbook」[AD2]、Agentforce 的 classification description [F1]、Decagon 的 entry conditions [D1]；改意图边界不用改代码，但要过该意图的回归样例。
   - 规则能定的先短路、不进模型（平台通知、致谢、已登记生产厂来信等）。Agentforce：「a short-circuit path can bypass the full LLM call when classification is unambiguous」[F2]。PRD 第 ① 步已有一部分，规格里写全。
   - 次意图：预取清单取主、次意图的并集（只读、成本低），允许的动作仍只取主意图，避免顺带回答次意图时没有依据。属于技术口径，可自定。
   - 意图一致率的测法照 Claude 工单路由指南：同一批标准输入定期重测，一致率 ≥ 95%；非主语言（西班牙语）的准确率比英语低不超过 5–10 个百分点 [A6]。
3. **评测与上线门槛：分层、可量化。**
   - 回归集分两层。**硬规则层**：亚马逊无链接与表情、安全事故与平台风险转人工、不越政策、语言一致与 usted、注入指令不执行、动作在允许集合内——每条跑 k 次全部通过（pass^k；ADR 0014 与 R-SD-06 的「连续 5 次全部通过」就是 pass^5，只用在这一层）。**质量层**（Q-08 的 500 封）：意图、审批项、发送方式由代码比对，回复质量由 `judge` 打分，门槛是「不低于基线、不低于上一版」，不要求全部通过；也可以照 Ada 的 delta evaluation，把同一批样本用新旧两版各跑一遍、由 `judge` 成对比较算胜率 [AD10]。依据：回归评测「should have a nearly 100% pass rate」、面向客户的智能体看 pass^k [A4]；Fin Evals「combines deterministic checks with an LLM judge, and if any single criterion fails, the Simulation fails」[I12]；Ada 新推理器要「clear a threshold against our defined baseline」才发布，每个用例至少跑 3 次 [AD4]。
   - 每条样本带期望字段：期望意图、期望审批项、期望发送方式、参考回复。对应 Agentforce Testing Center 的 Utterance / Expected Subagent / Expected Actions / Expected Response [F6] 与 Yuma「Write tests for each playbook using real tickets and the reply and action you expect」[Y3]。
   - `judge` 与人工对齐用 Cohen's κ：先让两名人工（客服主管与一名资深坐席）互评同一批样本得到人与人的一致度，`judge` 追到接近这个基线才用来做门槛。Shopify 的评审 κ 从 0.02 提到 0.61，人与人为 0.69 [H1]。评分细则会在人工打分中改写（「criteria drift」[P2]），50 条只够起步。同类产品在这一点上公开得很少：Fin Evals 目前「no dedicated way yet to record whether a reviewer agrees or disagrees with a result」[I15]，Ada 只说评审对齐客户的定义、未公开方法 [AD10]——这块要自己做扎实。
   - 多封往来的工单按时间逐封回放（Decagon「replay historical customer conversations against the latest agent logic」[D6]；Sierra 模拟测试可以挡发布 [S8]）。客户模拟器对邮件场景优先级低。
   - 合并交付后没有「第二期运行数据」：上线初期所有意图都是待审草稿（R-SD-02 要 30 天、≥ 50 封、采纳率 > 90% 才能放开），这段时间本身就是影子期，坐席的修改与拒绝就是对照样本。建议写成正式口径：样本来源、每周把被拒与大改的草稿回灌回归集。
4. **回复检查不通过时，先让模型按未通过项改写一次再检查，仍不通过再按 PRD 标出。** 对应 [A1] 的评估-优化模式、Gorgias「AI Agent reviews a draft of its response before replying」[G7]、Yuma「If the QC layer rejects the draft, the AI retries」[Y2]。要在 60 秒内完成。会改变坐席看到的结果，属界面行为，需用户确认。
5. **自动发送的放量与发送前护栏补细节（业务口径，需用户定）。**
   - 按比例放量：意图满足 R-SD-02、06 后，先只让一部分合格来信自动发送，其余仍是待审草稿。Yuma「Roll a new playbook out at 10% of matching conversations, with the rest handled as drafts」[Y1]；Ada 的 change set「try changes on a percentage of new conversations」并与基线对比 [AD8]；Fin Releases 支持逐步放量、A/B 与一键回滚 [I12]；Decagon 用 A/B 逐步加流量 [D7]；Shopify Flow 代理以 1% 流量上线 [H2]。
   - 意图流程（处理说明）的发布可回滚到上一版：Ada 的改动发布后 90 天内可撤回 [AD8]，Sierra 用不可变版本即时回滚 [S5]。属技术口径，可自定。
   - 抽检除随机抽样外，按风险定向挑选（例如 `judge` 低分、检查边缘通过）：Fin Monitors 的送检方式就是随机抽样或按风险信号定向 [I13]。R-SD-03 的抽检量不变，只改怎么挑，需用户确认。
   - 发送延迟窗口：自动发送排队几分钟，坐席可在发出前截下（eDesk [E5]），对 24 小时 SLA 无实质影响。
   - 额外的不自动发送条件：负面情绪、客户有多张未结工单（eDesk [E4]）。PRD 现定「情绪不决定是否转人工」，这里只影响能否自动发送，不转人工。
6. **亚马逊渠道规则补漏（业务口径，需用户定）。** 亚马逊沟通指南禁止「Emojis, including emoticons」，电话号码只允许与保修、承运商、生产厂相关的 [M1]。R-CK「渠道内容能力」现在列的是无链接、无图片、无营销、无站外联系方式，建议补「无表情符号」并明确电话号码口径。PRD 比亚马逊更严的地方（完全不放链接、发票不附件）保持不变。
7. **知识缺口与处理说明修改建议以「AI 草稿 vs 坐席最终发送」的差异为主信号，并把差异结构化。** eDesk 把被人工改掉或弃用的 AI 回复与人工实际发出的回复比较，差异记为知识缺口 [E9]；Decagon Suggestions 用人工坐席的实际解决方式生成内容 [D11]；Fin Recommendations 每周产出内容、客户数据、动作三类缺口建议，由人接受或拒绝 [I18]；Gorgias Opportunities 从没解决的对话里找缺口与冲突知识 [G11]。ADR 0014 已有「坐席修改按意图每周汇总」，建议在规格里把每次修改记成结构化类别（改事实 / 改承诺 / 改语气 / 改动作 / 改语言），便于 `knowledge` 聚类。

### 1.3 交给票 09 的待定项

- 业务口径（问用户）：1.2 第 3 条中 R-SD-06 的措辞（「回归样例连续 5 次全部通过」改为只对硬规则层要求全部通过，质量层改为不低于基线，属 PRD 上线门槛）、第 4 条（检查不通过先自动改写一次）、第 5 条（比例放量、抽检按风险定向挑选、发送延迟、负面情绪与多张未结工单不自动发送）、第 6 条（亚马逊表情符号与电话号码）。
- 技术口径（可自定，写回 ADR 0014 修订）：1.2 第 1 条第一级补查的契约、第 2 条意图描述的结构与次意图预取并集、第 3 条回归集分层与 κ 对齐、第 5 条处理说明可回滚、第 7 条修改差异的结构化类别。
- 维持不变但记一笔：默认 3 版草稿。本次查到的坐席辅助资料（Sierra、Decagon、eDesk、Agentforce）都只描述单条草稿，没有找到多版本做法的公开资料；维持 ADR 0014「上线后看 B、C 版采纳比例再议」。

## 2 逐项对照表

### 2.1 意图识别

| 做法 | 代表产品或资料 | 适用条件 | 对本项目的建议 |
|---|---|---|---|
| 显式分类到固定清单，按类走流程、按类开关 AI | Gorgias 24 个内置意图 + 每意图状态开关 [G1][G4]；eDesk 分类后按类型选 Procedure [E1][E2]；Agentforce 每句话选一个 subagent [F1]；OpenAI 客服示例的 Triage Agent [O2]；Anthropic 路由模式 [A1] | 类别边界清楚；权限、发送方式、统计要按类配置；需要按类放量 | **保留**。意图决定动作与发送方式，必须是枚举 |
| 按程序的「何时适用」描述选程序（检索或匹配），可判「无适用程序」 | Fin trigger description + 相关度阈值选择 [I1][I3]；Zendesk use case 名称与描述 [Z1]；Ada「When to use this Playbook」[AD2]；Decagon AOP 入口条件 [D1]；Sierra journeys [S1][S3]；Yuma 2.0 Handbook [Y1] | 多轮聊天、程序多（数十上百）且常变、业务人员直接写程序 | **吸收写法**：意图流程加「适用 / 不适用条件 + 正反例」，分类提示词由它拼成；12 个意图不需要检索式选择 |
| 显式分类只用于路由、转人工、报表 | Fin Attributes [I4]；Zendesk intelligent triage [Z4]；Ada Topic / Intent 随转人工传递 [AD3]；Decagon 意图标签 [D3]；Fin 话题聚类只做分析 [I20] | 前线代理按程序运行，分类另作运营用途 | 本项目意图同时承担路由与统计，已覆盖；话题聚类（未知话题发现）可作为知识缺口聚类的一部分 |
| 规则先短路、无歧义时不调模型 | Agentforce short-circuit [F2]；eDesk 用 Condition 步骤 [E2] | 有确定的结构化特征（发件域、已登记发件人） | **写全**：平台通知、致谢、生产厂来信等在第 ① 步就定 |
| 先写理由再给标签；按一致率与分语言准确率验收 | Claude 工单路由指南 [A6] | 用 LLM 分类、标注数据少 | **采用**：一致率 ≥ 95%，西语比英语低不超过 5–10 个百分点 |

### 2.2 草稿生成

| 做法 | 代表产品或资料 | 适用条件 | 对本项目的建议 |
|---|---|---|---|
| 固定工作流：代码取数，模型一次生成 | eDesk Procedure 流程图 + 生成 [E2][E3]；Agentforce「default position should be deterministic」[F2]；Anthropic「predictability and consistency for well-defined tasks」[A1] | 数据需求可预知、一次处理、要可审计、有时限 | **保留为默认** |
| 确定性骨架 + 局部交给模型（混合推理） | Agentforce Agent Script（`->` 确定执行、`\|` 交给模型，编译为状态机）[F2][F5]；Fin Procedure 的 IF/ELSE 与代码片段 [I2]；Ada Playbook 步骤分 fixed / AI-driven [AD5]；Zendesk 生成式 procedure 与确定性 dialogue 混用 [Z3]；Decagon 分步模块 [D5]；Sierra 按任务分级给「agency」[S2] | 流程有固定顺序，但某些步骤需要判断 | **已是这种形态**（五步 + 意图流程）；补查是骨架里的一个受控步骤 |
| 模型多轮调用工具（agent 循环） | Fin planner 与链式连接器 [I3]；Ada 快慢双推理器（2025-10 起取代「一串专用 LLM 调用」）[AD4]；Atlas ReAct 循环 [F4]；Gorgias 由模型按动作描述决定调用 [G5]；Shopify Sidekick [H1] | 实时对话、要边问边查、查询对象事先不可知 | **第二级、只读、按意图开关、默认关**；店铺与客户由代码绑定，限步数 |
| 预取 + 一次结构化补查 | 对应 Plan-Then-Execute [P1]、合并查询工具 [A3]（同类产品未公开这一具体做法） | 预取覆盖大部分，少数来信提到清单外对象 | **第一级，建议进合并期** |
| 写动作也作为模型工具，会话内即时批准 | AI SDK `toolApproval` [V1]；Gorgias 买家确认 [G5] | 实时会话、确认者就在会话里 | **不采用**：审批是异步、多人、带时限的业务流程 |

### 2.3 写动作与审批

| 做法 | 代表产品或资料 | 适用条件 | 对本项目的建议 |
|---|---|---|---|
| AI 直接执行，代码条件 + 买家确认兜底 | Gorgias（不可逆动作默认要买家确认，条件由平台判定）[G5][G6]；Agentforce 可要求用户确认（摘要）[F9]；Fin 在 Procedure 里写「Confirm once, clearly, immediately before the action」[I9]；Yuma 不可逆动作前强制停顿 [Y2]；Zendesk AI agent 可自主执行已授权系统的动作 [Z6] | 面向买家的实时聊天；动作金额小、可逆或平台允许 | **不采用**（业务已定审批）；以后若放开，按「动作 × 金额 × 意图」逐项放，沿用 R-SD 的放量与熔断逻辑 |
| 写操作不让模型自动触发，交给流程或人 | Fin 写操作连接器「Disabled (manual trigger)」、Procedure Checkpoint 暂停待批 [I8][I2]；Zendesk auto assist 写操作「agent-approved」，并警告预先批准的动作可能绕过前置条件 [Z7] | 写操作有风险或要内部授权 | **保留**：前置条件由代码判定，不靠提示词 |
| AI 只在自动发送时执行动作 | eDesk：动作挂在 Outcome 上，只有自动回复时才执行 [E1][E4] | 动作与回复强绑定 | 与本项目「绑定回复在动作成功后发出」（R-AP-06）方向一致，无需改 |
| AI 提出，人执行或批准 | Zendesk auto assist [Z7]；Sierra Live Assist、Decagon Assist 一键动作 [S10][D10]；Agentforce Service Assistant「doesn't take any direct actions」[F7]；Sidekick「never makes changes to your store without your approval」[H3]；OpenAI 高风险动作人工监督 [O1] | 高风险、涉及现金、不可逆、异步执行 | **保留**：审批项 + 代码前置条件 + 承诺对账 |
| 写接口的幂等由谁保证 | Ada：API 工具不支持幂等键，「must be handled through API design」[AD6] | 有重试 | 本项目已由统一动作接口带幂等键（ADR 0009），无需改 |

### 2.4 风险拦截、回复检查与自动发送

| 做法 | 代表产品或资料 | 适用条件 | 对本项目的建议 |
|---|---|---|---|
| 不可关闭的硬转人工信号 + 可配置的转人工话题 | Gorgias 内置信号不可关、自定义话题最多 10 条 [G7][G4]；Fin 内置升级始终生效，由专门分类模型判断 [I5][I11]；Zendesk「Instructions cannot trigger escalations」[Z5]；Agentforce 分类器触发转人工 [F3]；Ada 转人工记原因码 [AD7] | 所有场景 | **保留**（R-RS 关键词 + 模型取并集，转人工原因已逐项记录） |
| 输入侧注入 / 威胁检测 | Sierra supervisor [S6]；Agentforce Trust Layer prompt defense [F8]；OpenAI 安全分类 [O1]；设计模式论文 [P1] | 模型读取不可信内容 | **保留**「疑似提示注入」；补查与工具的参数由代码绑定 |
| 生成后、发送前检查，不过就重试或转人工 | Fin 生成后校验准确与安全 [I21]（营销页）；Ada 发送前查 Safe / Relevant / Accurate [AD1]；Gorgias 发送前草稿自审 [G7]；Yuma QC 关口重试 [Y2]；Decagon 发送前品牌与幻觉检查 [D6]；Agentforce `after_reasoning` 作护栏层 [F2] | 自动发送 | **保留** R-CK（规则 + 证据编号 + 模型只判越政策）；**新增**不过先改写一次（待用户定） |
| 按意图 / 程序 / 渠道开关自动回复 | Gorgias 意图状态、Skill、渠道 [G4][G8]；eDesk Procedure Disabled / Simulation / Auto [E2]；Zendesk 按渠道与客户分段 [Z1] | 所有场景 | **保留**（白名单 + R-SD-02） |
| 按比例或按量级逐步放量，版本可回滚 | Ada change set 按新对话比例、90 天内可撤回 [AD8]；Fin Releases 逐步放量、A/B、回滚 [I12]；Yuma 10% + 其余为草稿 [Y1]；Decagon A/B [D7]；Sierra 按周对话量 100→1,000→10,000、不可变版本 [S1][S5]；Shopify Flow 1% [H2] | 放开前后要对比 | **新增**比例放量（待用户定）；处理说明发布可回滚（技术口径） |
| 发送延迟窗口、额外的不自动发送条件 | eDesk 负面情绪不自动回复、多张未结工单不自动回复、发送延迟可截下 [E4][E5] | 自动发送 | **新增**（待用户定） |
| 上线后全量或抽样质检 | Fin Monitors 随机抽样或按风险信号定向送检 [I13]；Decagon Watchtower 审每一段对话 [D8]；Gorgias Auto QA [G9]；Zendesk QA 自动给机器人对话打分 [Z9]；Sierra 自然语言写的 monitor [S7] | 自动发送 | **保留** R-SD-03 抽检熔断；抽检按风险定向挑选（待用户定）；`judge` 可对自动发送全量打分辅助抽检（技术口径） |

### 2.5 评测

| 做法 | 代表产品或资料 | 适用条件 | 对本项目的建议 |
|---|---|---|---|
| 回归集挡发布，改提示词、知识、模型都重跑 | Fin 发布前「Run all」模拟、Evals 任一标准失败即失败 [I14][I12]；Ada 新版须超过基线、每例至少 3 次 [AD4]；Sierra「gate releases on specific simulations」[S8]；Agentforce 质量门 [F6]；Yuma 每个 playbook 带测试 [Y1][Y3]；Decagon 改 AOP 或知识前跑模拟 [D9] | 所有场景 | **保留**；按 1.2 第 3 条分硬规则层与质量层 |
| 生产对话用新版回放、成对比较 | Ada delta evaluation（LLM 评审算胜率）[AD10]；Fin 离线以全量提示词的生产决策为金标准、线上 A/B 看解决率 [I3] | 已有线上数据 | **可选**：质量层用新旧两版成对比较 |
| 样本带期望意图、动作、回复 | Agentforce Testing Center 用例列 [F6]；Yuma 用真实工单写期望 [Y3] | 有历史工单 | **采用**（Q-08 样本补期望字段） |
| pass^k 衡量一致性 | τ-bench 定义 [P5]；Anthropic 评测指南 [A4] | 面向客户、要每次都对 | **采用**：「连续 5 次全部通过」明确为硬规则层的 pass^5 |
| LLM 评审与人工对齐 | Shopify κ 0.02→0.61（人与人 0.69）[H1]；Anthropic「closely calibrated with human experts」[A4]；标准漂移 [P2] | 用 `judge` 做门槛 | **采用 κ**，先测人与人基线 |
| 回放历史对话 / 模拟用户 | Decagon 回放 [D6]；Sierra、Decagon、Siena 模拟 [S8][D9][N3]；τ-bench 用户模拟 [P5] | 多轮对话 | **回放采用**；客户模拟器对邮件优先级低 |
| 测试中不碰真实写操作 | Fin「Simulations never call external systems」[I14]；Yuma 测试时破坏性动作只模拟 [Y2]；反例：Gorgias 测试对话会改真实订单 [G10]、Ada 模拟里 API 工具默认发真实请求 [AD9]、Zendesk 测试窗口测不了 CRM 动作 [Z10] | 有写动作 | 本项目模型不调写动作，回归与开发用 Fake 适配器（ADR 0009），已满足；补查与只读工具在回归里也走 Fake |
| 从少量真实失败起步、读对话记录 | Anthropic「20-50 simple tasks drawn from real failures」[A4] | 起步阶段 | **采用**：硬规则层先从 Q-08 中挑 20–50 条 |

### 2.6 客服之外的环节

| 做法 | 代表产品或资料 | 适用条件 | 对本项目的建议 |
|---|---|---|---|
| 坐席辅助：起草、摘要、一键动作，人审后发 | Fin Copilot 带出处的答案、一键放进回复框 [I17]；Zendesk auto assist 按 procedure 建议回复与动作并给出理由与来源 [Z12]；eDesk AI Assist「A human Agent always reviews the suggested reply」[E7]；Sierra Live Assist [S10]；Decagon Assist [D10]；Agentforce Service Assistant [F7] | 未放开自动发送的意图 | **保留**（待审草稿就是这种形态；AI 分析里的「依据」对应理由与来源） |
| 知识缺口：AI 草稿与人工回复对比、未解决对话聚类 | eDesk Knowledge gaps [E9]；Fin Recommendations 每周三类缺口 [I18]；Zendesk Knowledge Copilot（早期访问）[Z11]；Decagon Suggestions [D11]；Gorgias Opportunities [G11]；Sierra knowledge gaps 与 Expert Answers [S11]；Yuma 记为待回答问题 [Y1]；Ada Coaching 把人工纠正存为示例记忆 [AD11] | 有坐席修改数据 | **保留** R-KB-04；**补**修改差异的结构化类别 |
| AI 起草程序 / 处理说明的修改，人审后生效 | eDesk Procedure gaps「won't run until you review it」[E8]；Decagon AOP Copilot [D12]；Ask Yuma 按影响排序建议 [Y4]；Gorgias Gaia 默认等批准 [G12] | 业务人员维护程序 | **保留**（ADR 0014 的 `knowledge` 起草处理说明修改建议） |
| 知识检索：按相关性检索 vs 过滤后全量 | Fin 检索 40 篇、重排留 5–10 篇 [I19]；Zendesk 最多 5 篇 [Z13]；Gorgias Guidance 按相关性、上限 100 条 [G3]；Agentforce Data 360 RAG [F4]；Anthropic 20 万词元以内可全量 [A5]；上下文变长退化 [P4] | 检索适合大而不受控的知识库；全量适合知识量小、维度清楚 | **保留**过滤后全量；记录每意图上下文词元数，超阈值再切检索 |
| 售后责任评估、协商依据起草 | 同类客服 AI 公开资料不足（这是本项目与生产厂之间的内部环节）；可借的只有通用原则：AI 建议 + 人工确认（R-AI-01）、高风险人工监督 [O1] | — | **保留** R-AS-02「规则先判、AI 建议、人工确认」；用 R-AS-03 的「改判 + 理由」作为 `assess` 的评测标签；协商依据只引用带证据编号的结构化事实，复用 R-CK「事实有来源」的检查 |

## 3 各来源要点

### 3.1 Intercom Fin

- **程序的选用**：Procedure 不靠预设意图表启动，「Fin evaluates every customer message to decide whether it matches a procedure's trigger description」[I1]；对话中途意图变了可以换 Procedure [I2]。运行时由基于 Gemma 4 E2B 微调的交叉编码器挑选 Guidance、Connector 与 Procedure，Procedure 用校准过的绝对阈值，「in production traffic, 84% of procedure relevance checks find nothing that applies」；「The system prompt has become a retrieval problem」[I3]。显式分类仍在：Fin Attributes（主题、紧急度等）用于工作流分支、自动转人工与报表 [I4]。
- **生成方式**：Procedure 以自然语言步骤为主，可叠加 IF/ELSE 与「Code snippets for when absolute accuracy is essential」，有 Checkpoint 暂停待批或转人工 [I2]；步骤串行，一次连接器调用完成才进下一步 [I5]；是否遵循某条 Guidance 由模型判断 [I6]；连接器由 planner 规划、可链式调用，没有要规划的内容时跳过 planner [I3]；官方承认「multiple tool calls add latency compared to single-shot RAG」[I7]。营销页描述的流水线是查询改写 → 检索 → 重排 → 生成 → 校验 [I21]。
- **写动作**：连接器支持写方法；写操作建议选「Disabled (manual trigger)」，只放进 Workflow、Procedure 或 Macro，「where you want human or workflow oversight before anything runs」[I8]；客户确认要在 Procedure 指令里自己写（「Confirm once, clearly, immediately before the action that can't be easily reversed」）[I9]；前置条件可用自然语言写，但建议在 API 服务端再校验权限 [I10]。
- **风险与发送**：内置升级始终生效（无进展、打转、要人工）[I5]；升级判断由多任务编码器分类模型做，「handles 90% of cases with >98% accuracy」，难例交给 LLM [I11]；Releases 支持逐步放量、A/B、暂停与一键回滚 [I12]；Monitors 按随机抽样或风险信号（低 CX Score、违反政策、法律威胁）送检，评分卡可由 AI、人工或两者评 [I13]。
- **评测**：Simulations 跑多轮对话，「Simulations never call external systems」，发布前要求 Run all [I14]；Evals「combines deterministic checks with an LLM judge, and if any single criterion fails, the Simulation fails」[I12]；评审与人工是否一致目前「no dedicated way yet to record」[I15]；研究侧离线以全量提示词生产模型的决策为金标准、线上 A/B 看解决率 [I3]。解决率口径含「assumed resolution」（客户没再求助即算解决）[I16]，营销页的 76% 未给口径。
- **前线之外**：Copilot 基于近 4 个月的对话、工单与文章给带出处的答案，可一键放入回复框 [I17]；Recommendations 每周产出内容、客户数据、动作三类缺口建议，人接受或拒绝 [I18]；知识检索是 RAG，取 40 篇、重排后留 5–10 篇 [I19]；话题用 HDBSCAN 聚类 + LLM 起名，只用于分析，归类准确率「exceeded 85%」[I20]。

### 3.2 Zendesk AI agents

- **意图与用例**：advanced AI agent 的 use case 只按名称与描述匹配，匹配后走 procedure 或 dialogue [Z1]；对话日志里的意图预测是「a prediction from a legacy process and might not match the use case the AI agent ultimately selected」[Z2]；上一代是「bot builder, answers, and intents」[Z3]。工单侧仍由 intelligent triage 给出主题（原 Intent，2026-06 改名 Topic）、情绪、语言并带置信度，供触发器、视图、路由与报表 [Z4]。
- **生成方式**：生成式 procedure 由自然语言描述生成流程，代理可跳到最合适的步骤；dialogue 是确定性分支；两者可混用 [Z3][Z8]；日志里有 Plan 字段展示推理 [Z2]；指令「interpreted as strong guidance rather than rigid commands」[Z5]。时延与成本的取舍：公开资料不足。OpenAI 的客户故事称 Zendesk 从「predict an intent, trigger a predefined dialogue」转向生成式推理（页面 403，引文来自检索摘要，待复核）[Z14]。
- **写动作**：AI agent 可「perform actions in authorized systems autonomously」，缺参数先向客户收集 [Z6]；AI agent 一侧的客户确认或审批：公开资料不足。Copilot 的 auto assist 区分坐席批准与预先批准，「Actions that write data, such as an action that refunds an order, should be marked as agent-approved」，并警告预先批准的动作「may execute the action without satisfying its prior conditions」[Z7]。
- **风险与发送**：procedure 里用 Escalate 块转人工，「Instructions cannot trigger escalations」[Z5][Z8]；可按渠道开、用客户分段限定用例 [Z1]；按比例放量与发送前回复检查：公开资料不足；Zendesk QA 可自动给机器人对话打分 [Z9]。
- **评测**：测试窗口能看每条消息预测的用例，但「isn't integrated with your CRM」[Z10]；回归集与批量模拟：公开资料不足；每次计费的解决由「a dedicated AI evaluation model」复核 [Z11]。
- **前线之外**：auto assist 按自然语言 procedure 给坐席建议回复与动作，测试时可看理由与来源 [Z12]；Knowledge Copilot（早期访问）从真实对话找缺口、过时与不一致内容 [Z11]；生成回复用 RAG，最多保留 5 篇作为来源 [Z13]。

### 3.3 Ada

- **意图与程序**：推理引擎用 LLM 判断意图，再在作答、追问、调用工具、运行 Playbook、转人工之间选择 [AD1]；选 Playbook 时「When to use this Playbook」是「the primary signal」[AD2]；Topic / Intent 分类用于分析并随转人工传给帮助台，文档未说影响运行时行为 [AD3]。
- **生成方式**：2025-10 起，原来每轮「a sequence of specialized LLM calls」的模块化推理器换成快、慢两个推理器 [AD4]；Playbook 每步可选 fixed 或 AI-driven，「where the Agent follows your instructions exactly and where it reasons on its own」，IF/ELSE 可按接口返回码分支，代码工具做确定性计算 [AD5]。
- **写动作**：API 工具支持写方法，何时调用由模型决定，可限定只在 Playbook / Process 内运行 [AD6]；内置的客户确认或人工审批：公开资料不足；「API tools do not support idempotency keys」，幂等要靠接口设计 [AD6]。
- **风险与发送**：发送前查 Safe、Relevant、Accurate [AD1]；转人工记原因码（含「政策不允许」、工具失败）[AD7]；change set 可「try changes on a percentage of new conversations」、与基线对比，发布后 90 天内可撤回 [AD8]。
- **评测**：Simulations 每个用例 1–10 条预期结果逐条二元判定，模拟与评判都由生成式 AI 完成；「Every API tool is Live by default and sends a real request in a simulation」[AD9]；新推理器「must clear a threshold against our defined baseline before it ships」，每个用例至少跑 3 次 [AD4]；delta evaluation 把生产对话用改过的提示词与模型回放，由 LLM 评审算胜率 [AD10]；解决率由 AI 判定是否同时满足 Relevant、Accurate、Safe、Contained [AD12]。
- **前线之外**：转人工附对话摘要；Coaching 把人工纠正存为示例对话记忆 [AD11]；实时起草与知识缺口自动发现：公开资料不足。

### 3.4 Sierra（含 τ-bench、τ²-bench）

- **组织方式**：体验按 journey 组织，journey 是「a goal that an end user might have in mind」[S1]；官方称「Journeys go beyond sequential workflows and lists of standard operating procedures」[S3]。未查到公开的显式意图路由说明；分类是可组合的能力之一（例子是识别可疑行为，不是路由）[S2]；对话会自动打标签，用于分析 [S1]。
- **自主度分级**：「Certain tasks get more "agency", greater room to reason, reflect, and use tools」，并由 supervisor 兜底 [S2]；需要一致性的地方用 SDK 绕开模型 [S4]；硬规则（如 30 天退货窗口）用「deterministic guardrails that the agent cannot cross」实现 [S5]。
- **风险**：每个生产代理配多个监督代理，其中一个专门检测输入里的威胁 [S6]；「At scale, a one-in-ten-thousand hallucination rate is a daily occurrence」[S6]；实时 supervisor 核事实、执行政策、必要时转人工，事后 monitor 用自然语言写 [S7]。
- **上线**：不可变版本、即时回滚、A/B [S5]；按每周对话量阶梯放量（100、1,000、10,000、100,000）[S1]。
- **评测**：模拟测试用例从 SOP、知识库、历史转录自动生成，评审代理判目标是否达成、是否守 SOP、是否合乎品牌，可接 CI 挡发布，客户每天跑 35,000+ 次 [S8]；人工标注过的对话可转为回归测试 [S5]。评审与人工对齐的数字：公开资料不足。
- **坐席侧**：Live Assist 起草有依据的回复、提供一键动作（「Live Assist can trigger it instantly」）[S10]；Agent Studio 标出知识缺口，Expert Answers 把联络中心经验变成新文章 [S11]。
- **τ-bench（arXiv 2406.12045，2024-06）**[P5]：用 LLM 模拟用户，按结束时数据库状态与目标是否一致评判；pass^k 是「the chance that all k i.i.d. task trials are successful」。gpt-4o 函数调用 pass^1 零售 61.2、航空 35.2，「pass^8 drops to < 25 %」。零售域失败中「错误决策（没遵守领域规则）」占 25%、复合请求只完成一部分占 19%。删掉政策文档后航空域从 33.2 跌到 10.8。政策要求写操作前「obtain explicit user confirmation (yes)」，但模型「might issue the return without explicit user confirmation」。论文自己的结论：「Domain-specific fine-tuning or agent code scaffolding might provide some remedy」。
- **τ²-bench（arXiv 2506.07982，2025-06）**[P6]：双控场景（用户也要动手），gpt-4.1 pass^1 零售 74%、航空 56%、电信 34%；任务所需动作超过 7 个时成功率接近 0。Sierra 自评「The pass^k curves remain far from ideal」[S9]。注：这两篇用的是 2024–2025 年的模型，新模型的绝对分数更高，但「多步越长越不稳、要靠代码脚手架」的结论仍是本次选型的依据。

### 3.5 Decagon

- **AOP**：「AOPs combine the power and flexibility of natural language with the precision and rigor of code」[D4]；有入口条件「the triggers that tell the agent when to use that workflow」、条件逻辑块与工具（营销页）[D1]；按模块拆步骤，每步有目标与边界 [D5]。
- **意图**：底层有专门理解意图的模型 [D2]；意图标签三级，配偏转率、CSAT、升级指标，用于分析与回改 AOP，未提用于路由 [D3]。
- **写动作**：「Built-in guardrails protect sensitive operations, such as refunds and identity verification」（营销向）；高风险账户操作列为转人工触发条件 [D6]。客户确认或人工审批流程：公开资料不足。
- **风险与上线**：发送前做品牌与幻觉检查，有识别操纵的模型，转人工附摘要 [D6]；A/B 实验逐步加流量 [D7]；Watchtower 按自定义标准审每一段对话（AI 与人工都审）[D8]。
- **评测**：模拟测试的人设与意图从真实失败自动生成，客户定义成功标准，上线前后、改 AOP 或知识前都跑，可重复跑测稳定性 [D9]；可回放历史对话 [D6]。大模型指令遵从更好但时延高，语音场景用微调小模型 [D2]。
- **前线之外**：Decagon Assist 给坐席摘要、起草、识别匹配的 workflow 并一键执行 [D10]；Suggestions 用人工坐席的实际解决方式补知识缺口、按影响排序（营销页）[D11]；AOP Copilot 从 SOP 生成 AOP [D12]。

### 3.6 Salesforce Agentforce

- **显式分类**：Topic 自 2026-04 改名 subagent；「The reasoning engine LLM can choose only one subagent at a time」，按分类描述与最后一句话的匹配度选择 [F1]；默认的转人工由分类器触发，「The classifier bypasses any instructions within the topic」[F3]。Testing Center 用例含「Expected Subagent」列，分类结果也进报表 [F6]。
- **从循环转向混合推理**：Atlas 是「a loop of reason, act, and observe」[F4]；架构指南承认旧模式「every decision was made in real time by the LLM, with no guaranteed path through the workflow」，并提出「The default position should be deterministic」「if you can express a decision as code, it should be written as logic」「Every unnecessary LLM call adds latency, cost, and variability」，以及无歧义时短路跳过模型 [F2]（Agent Script 自 2026-02 GA）；Agent Script 编译为 Agent Graph，用有限状态机管理状态 [F5]；只靠指令保证顺序「is not the preferred approach」[F1]。
- **写动作**：动作是预定义的 Apex / API / Flow，由模型选择调用 [F4]；可要求代理在执行前请用户确认（摘要）[F9]；有副作用的动作不要放在 `before_reasoning` [F2]；Service Assistant「doesn't take any direct actions」，由坐席执行 [F7]。写操作的人工审批：公开资料不足。
- **护栏与上线**：Trust Layer 有毒性评分、审计、prompt defense，但「Data masking for LLMs is currently disabled for agents」[F8]；`after_reasoning` 作为护栏层 [F2]；质量门「can block agent deployments until a test suite passes」，2026 年加入多轮人设测试、自然语言评测标准与阈值、LLM 评审理由 [F6]。
- **研究数据**：Salesforce AI Research 的 CRMArena-Pro（arXiv 2505.18878，2025-05）报告单轮约 58%、多轮约 35% 成功率，且保密意识「near-zero」[P7]。

### 3.7 Gorgias AI Agent（Shopify 生态）

- **意图与技能**：每条消息按预设清单打意图与情绪，可作规则条件与报表维度 [G1]；Skill =「one or more intents (the trigger) and instructions」[G2]，意图由平台内置、商家不用维护；每个意图有状态开关决定 AI 处理还是转人工 [G4]。Guidance 是商家写的参考知识，按相关性匹配，每店最多 100 条 [G3]。
- **动作**：取消、改地址、删换商品、免费补发、加备注 [G6]；「AI Agent uses the action's name and description to decide when to use it」，动作只有放进 Skill 或 Guidance 才能运行 [G5]；「Conditions set the criteria that must be met before an action runs」[G5]；取消前先查是否未履约 [G6]；「When turned on, AI Agent asks the shopper to approve before proceeding」，不可逆动作默认开启，关闭须显式声明 [G5]。坐席逐笔审批：公开资料不足。
- **转人工与发送**：内置信号（愤怒、要求真人、敏感话题）不可关，自定义话题最多 10 条，发送前「AI Agent reviews a draft of its response before replying」[G7][G4]；放量粒度为渠道、意图、Skill [G8]，未查到按比例放量或草稿待审模式。
- **评测与质检**：测试对话可测未发布内容，但「it can affect real customer and order data」[G10]；Auto QA 由 AI 打三项分、人工打四项 [G9]。
- **知识**：Opportunities 从未完全解决的对话里找缺口与冲突知识 [G11]；坐席反馈不会立即改变 AI 行为 [G13]；Gaia 起草配置改动、默认等批准 [G12]。

### 3.8 eDesk（亚马逊卖家客服）

- **先分类再走程序**：「eDesk's AI classifies it into a topic」，Procedure 只作用于「whose classification matches the Type of this Procedure」[E1][E2]；情绪识别用作护栏 [E3]。
- **流程图**：Condition / Gate / Guidance / Outcome；Gate「waits for a customer to provide something, e.g. a receipt」；回复由模型结合 Policies、Training content 与 Procedure 的决策逻辑生成 [E2][E3]。
- **动作**：动作挂在 Outcome 上（接受或拒绝退货、取消），「will only actually happen if your AI Agent auto-sends the reply」[E1][E4]。
- **放量与护栏**：Procedure 有 Disabled、Simulation、Auto 三种状态，新建默认 Disabled [E2]；「If the AI Agent is confident in its answer, the reply sends automatically」，否则转人工并附 AI Assist 建议 [E3]；负面情绪、客户有多张未结工单时不自动回复 [E4]；可设自动回复延迟，坐席可截下 [E5]；亚马逊渠道 SLA 默认 24 小时 [E6]。
- **亚马逊合规**：AI Agent 文档未提链接、附件、禁用内容的检查——公开资料不足。
- **前线之外**：AI Assist「A human Agent always reviews the suggested reply」[E7]；Knowledge gaps 比较被人改掉、弃用的 AI 回复与人工实际发出的回复（该页现已 404，引文来自检索索引）[E9]；Procedure gaps 由 AI 起草新程序，「A new Procedure won't run until you review it and switch it to Auto」[E8]。

### 3.9 Yuma AI、Siena AI（Shopify 电商）

- **Yuma**：2.0「replaces per-intent automation with one AI-managed Handbook」，每个话题一个 playbook；「Where the Handbook is silent, Yuma doesn't improvise」，转人工并记为待回答的问题 [Y1]；「Roll a new playbook out at 10% of matching conversations, with the rest handled as drafts your team reviews」[Y1]；政策改动后「reruns the whole suite as simulated conversations」[Y1]；不可逆动作前强制停顿确认，发送前过自动质检、驳回即重试、再失败转人工，测试时破坏性动作只模拟 [Y2]；用真实工单写期望回复与动作 [Y3]；Ask Yuma 分析转人工工单、按影响排序建议，改动需商家批准 [Y4]。资料均为官方博客，多数不标日期。
- **Siena**：多个专门代理协作 [N1]；所有自动化上线前过 Playground [N2]；Test Runs 生成客户场景并可打分 [N3]；转人工附内部说明写明原因 [N4]。写动作的确认与放量粒度：公开资料不足。

### 3.10 Shopify Sidekick（工程博客）

- 文章 [H1]（2025-08-26，基于 ICML 2025 演讲）：工具超过 50 个后「Multiple ways to accomplish the same task, system becomes difficult to reason about」；系统提示词变成「an unwieldy collection of special cases」；改为「Just-in-time instructions」——随工具结果返回相关指令，且不破坏提示缓存；「Avoid multi-agent architectures early」。
- 评测：用来自真实对话的 Ground Truth Sets 取代精挑的黄金集，每段对话至少三名产品专家多维标注；评审与人工的一致性用 Cohen's κ、Kendall τ、Pearson，κ 从 0.02 提到 0.61（人与人 0.69）；「Vibe testing … is not going to cut it」；模拟商家回放真实对话；出现过奖励投机（模型改为解释为什么帮不了）[H1]。
- Flow 代理：300 条手工基准 + LLM 评审离线评测，1% 流量上线后激活率比基于提示词的旧代理低 35%——离线评测通过不等于线上更好 [H2]。
- 写操作：「Sidekick never makes changes to your store without your approval」[H3]。

### 3.11 亚马逊买家消息规则

- 来源是亚马逊 CDN 上的公开 PDF（元数据 2020-10-20），与检索到的 Seller Central G1701 现行条文的链接条款一致，但不一定是最新版 [M1]；Seller Central 帮助页需登录。
- 允许的消息是「necessary to complete an order or to respond to a customer service inquiry」；禁止外链（除完成订单必需的 https 链接或亚马逊链接）、禁止附件（除解决问题必需的，如运单、发票、定制设计）、禁止邮箱地址、电话只允许保修 / 承运商 / 生产厂相关、禁止营销与优惠券、禁止表情符号；「Amazon has the authority to block any message at its discretion」[M1]。
- 24 小时回复（含周末节假日）只拿到帮助页 202152030 的检索摘要；「90% 在 24 小时内」的考核线只见于第三方，未找到一手出处 [M2]。
- 对本项目：PRD 比亚马逊更严（不放任何链接、发票不附件，D-22），保持；表情符号与电话号码口径见 1.2 第 6 条。

### 3.12 官方指南与论文

- **Anthropic《Building effective agents》**[A1]（2024-12-19，页面注明此后工具生态已有变化）：工作流是「LLMs and tools are orchestrated through predefined code paths」，智能体是「LLMs dynamically direct their own processes and tool usage」；建议「finding the simplest solution possible, and only increasing complexity when needed」；路由模式的例子就是把不同类型的客服问题分开处理；评估-优化模式「particularly effective when we have clear evaluation criteria」；附录把客服列为适合智能体的场景，同时要求「integrate meaningful human oversight」，代价是「Agentic systems often trade latency and cost for better task performance」与「the potential for compounding errors」。
- **Anthropic《Effective context engineering for AI agents》**[A2]（2025-09-29）：上下文是「a finite resource with diminishing marginal returns」；推理前检索与运行时按需取数各有取舍，「runtime exploration is slower than retrieving pre-computed data」；常见失败是「bloated tool sets」。
- **Anthropic《Writing effective tools for agents》**[A3]（2025-09-11）：把多步查询合成一个工具（例：`get_customer_context`），只返回「high signal information」，大结果分页、过滤或截断。
- **Anthropic《Demystifying evals for AI agents》**[A4]（2026-01-09）：代码、模型、人工三类评分器的取舍；模型评分器「Requires calibration with human graders」，要允许它答「Unknown」；回归评测「should have a nearly 100% pass rate」；「pass^k for agents where consistency is essential」；对话型智能体常需第二个模型模拟用户；「20-50 simple tasks drawn from real failures is a great start」；要读对话记录；上线后靠生产监控、用户反馈与 A/B 补足。
- **Anthropic《Introducing Contextual Retrieval》**[A5]（2024-09-19）：知识库小于 20 万词元（约 500 页）可整体放进提示词并配合缓存；需要检索时，上下文化嵌入 + BM25 + 重排把前 20 段检索失败率从 5.7% 降到 1.9%。
- **Claude 文档《Ticket routing》**[A6]（日期未标，页面已提到 Claude Haiku 5.5，为 2026 年版本）：标注数据少、类别会变、需要理由时适合用 LLM 分类；先写理由再给意图；「consistency rate of 95 percent or higher」；非主语言准确率下降不超过 5–10 个百分点；疑难样本准确率至少 80%。
- **OpenAI《A practical guide to building agents》**[O1]：先验证确实需要智能体，「Otherwise, a deterministic solution may suffice」；用现有操作规程、话术、政策文档写成「routines」；「maximize a single agent's capabilities first」；按「read-only vs. write access, reversibility, required account permissions, and financial impact」给工具定风险等级；高风险动作（取消订单、大额退款、付款）人工监督，直到可靠性建立；护栏分层（相关性、安全、PII、审核、工具防护、规则、输出校验）。
- **OpenAI 客服智能体示例**[O2]：入口是「Triage Agent … routes to specialists」，带相关性与越狱护栏。
- **Vercel AI SDK**：`toolApproval` 可让选定工具调用返回 `tool-approval-request` 等待批准，支持 `ToolLoopAgent`、`generateText`、`streamText` [V1]；结构化输出与工具同用时，结构化输出算一步，`stopWhen` 要多留一步 [V2]。
- **论文**：提示注入设计模式 [P1]（Action-Selector、Plan-Then-Execute、LLM Map-Reduce、Dual LLM、Code-Then-Execute、Context-Minimization；客服案例的主要风险是把模型限制在本业务话题内）；LLM 评审与人工对齐与「criteria drift」[P2]；口头置信度偏高 [P3]；上下文变长与干扰段落导致退化 [P4]；τ-bench、τ²-bench、CRMArena-Pro 见 3.4、3.6。

## 4 引用清单

日期为页面标注的发布或更新日期；「日期未标」的给出推断依据。

**Anthropic 与 Claude 文档**
- [A1] Building effective agents — https://www.anthropic.com/engineering/building-effective-agents — 2024-12-19
- [A2] Effective context engineering for AI agents — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents — 2025-09-29
- [A3] Writing effective tools for agents — with agents — https://www.anthropic.com/engineering/writing-tools-for-agents — 2025-09-11
- [A4] Demystifying evals for AI agents — https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents — 2026-01-09
- [A5] Introducing Contextual Retrieval — https://www.anthropic.com/news/contextual-retrieval — 2024-09-19
- [A6] Ticket routing（use case guide）— https://platform.claude.com/docs/en/about-claude/use-case-guides/ticket-routing — 日期未标（提到 Claude Haiku 5.5，推断 2026）

**OpenAI 与 Vercel AI SDK**
- [O1] A practical guide to building agents（PDF）— https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf — PDF 未标日期；2025 年发布，OpenAI 学习中心列为 2026-01-15
- [O2] openai/openai-cs-agents-demo — https://github.com/openai/openai-cs-agents-demo — 日期未标
- [V1] AI SDK: Tool Approvals — https://ai-sdk.dev/docs/agents/tool-approvals — 现行文档，日期未标
- [V2] AI SDK: Tool calling with structured outputs — https://ai-sdk.dev/docs/troubleshooting/tool-calling-with-structured-outputs — 现行文档，日期未标

**论文与技术报告**
- [P1] Beurer-Kellner 等，Design Patterns for Securing LLM Agents against Prompt Injections — https://arxiv.org/abs/2506.08837 — 2025-06-10（v3 2025-06-27）
- [P2] Shankar 等，Who Validates the Validators? Aligning LLM-Assisted Evaluation of LLM Outputs with Human Preferences — https://arxiv.org/abs/2404.12272 — 2024-04-18（UIST 2024）
- [P3] Xiong 等，Can LLMs Express Their Uncertainty? — https://arxiv.org/abs/2306.13063 — 2023-06-22（v2 2024-03-17，ICLR 2024）
- [P4] Chroma，Context Rot: How Increasing Input Tokens Impacts LLM Performance — https://www.trychroma.com/research/context-rot — 2025-07-14
- [P5] Yao 等，τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains — https://arxiv.org/abs/2406.12045 — 2024-06-17
- [P6] Barres 等，τ²-Bench: Evaluating Conversational Agents in a Dual-Control Environment — https://arxiv.org/abs/2506.07982 — 2025-06-09
- [P7] Huang 等，CRMArena-Pro — https://arxiv.org/abs/2505.18878 — 2025-05-24

**Intercom Fin（帮助中心只写「Updated …」的，按 2026-10-24 倒推）**
- [I1] Building Fin Procedures — https://www.intercom.com/help/en/articles/13449439-building-fin-procedures — 2026-08-28
- [I2] Procedures, Simulations and more（产品更新博客）— https://intercom.com/blog/procedures-simulations-updates — 2026-02-25
- [I3] How Fin scales customer-defined behaviour — https://fin.ai/research/how-fin-scales-customer-defined-behaviour — 2026-09-25
- [I4] Using Fin Attributes in workflows, reports and conversations — https://fin.ai/help/en/articles/13976158-using-fin-attributes-in-workflows-reports-and-conversations — 2026-05-18
- [I5] Fin Procedures explained — https://fin.ai/help/en/articles/13976187-fin-procedures-explained — 2026-07-17
- [I6] Fin Guidance best practices — https://www.intercom.com/help/en/articles/10560969-fin-guidance-best-practices — 2026-09-10
- [I7] Structured agentic RAG for e-commerce — https://fin.ai/research/structured-agentic-rag-for-e-commerce — 2026-05-07
- [I8] How to set up Data connectors — https://www.intercom.com/help/en/articles/9916497 — 约 2026-10（「Updated over a week ago」）
- [I9] How to write instructions in Fin Procedures — https://www.intercom.com/help/en/articles/13459811-how-to-write-instructions-in-fin-procedures — 约 2026-09
- [I10] Data and actions FAQs — https://www.intercom.com/help/en/articles/9916507-data-and-actions-faqs — 约 2026-10（「Updated this week」）
- [I11] To escalate or not to escalate, that is the question — https://fin.ai/research/to-escalate-or-not-to-escalate-that-is-the-question — 2025-09-11
- [I12] Announcing Evals and Releases — https://www.intercom.com/blog/announcing-evals-and-releases/ — 2026-08-13
- [I13] Monitors explained — https://fin.ai/help/en/articles/13976253-monitors-explained — 约 2026-09
- [I14] Run simulations for Fin Procedures — https://fin.ai/help/en/articles/13976191-run-simulations-for-fin-procedures — 约 2026-10
- [I15] Fin Evals (beta) — https://www.intercom.com/help/en/articles/15899411-fin-evals-beta — 约 2026-10
- [I16] Fin AI Agent resolutions — https://intercom.com/help/en/articles/8205718-fin-ai-agent-resolutions — 2026-09-23
- [I17] How to use Fin AI Copilot — https://www.intercom.com/help/en/articles/8587194-how-to-use-fin-ai-copilot — 约 2026-10
- [I18] Optimize Fin instantly with the help of AI（Recommendations）— https://fin.ai/help/en/articles/13975978-optimize-fin-instantly-with-the-help-of-ai — 2026-03-23
- [I19] Finetuning retrieval for Fin — https://fin.ai/research/finetuning-retrieval-for-fin — 2025-09-11
- [I20] Unsupervised learning meets generative AI: topic modelling for real-world dialogue — https://fin.ai/research/unsupervised-learning-meets-generative-ai-topic-modelling-for-real-world-dialogue — 2026-03-30
- [I21] Fin AI Engine（营销页）— https://fin.ai/ai-engine — 日期未标

**Zendesk（support.zendesk.com 帮助文章均不标日期，按文中提到的最新日期推断为 2025–2026）**
- [Z1] Creating use cases for advanced AI agents — https://support.zendesk.com/hc/en-us/articles/9041901679130-Creating-use-cases-for-advanced-AI-agents
- [Z2] Reviewing conversation logs for AI agents — https://support.zendesk.com/hc/en-us/articles/8357749580186-Reviewing-conversation-logs-for-AI-agents
- [Z3] AI agents glossary — https://support.zendesk.com/hc/en-us/articles/8357751626266-AI-agents-glossary（文中提到 2026-05-11）
- [Z4] Automatically detecting customer intent, sentiment, and language — https://support.zendesk.com/hc/en-us/articles/4550640560538-Automatically-detecting-customer-intent-sentiment-and-language（文中提到 2026-06-11 Intent 改名 Topic）
- [Z5] Best practices for using instructions and custom tone of voice — https://support.zendesk.com/hc/en-us/articles/8719119396506-Best-practices-for-using-instructions-and-custom-tone-of-voice-to-influence-AI-agent-responses
- [Z6] About AI agents — https://support.zendesk.com/hc/en-us/articles/6970583409690-About-AI-agents
- [Z7] About actions for auto assist and action flows — https://support.zendesk.com/hc/en-us/articles/9174548349978-About-actions-for-auto-assist-and-action-flows
- [Z8] About generative procedures for AI agents — https://support.zendesk.com/hc/en-us/articles/10473649691418-About-generative-procedures-for-AI-agents
- [Z9] Evaluating the performance of AI agents using Zendesk QA — https://support.zendesk.com/hc/en-us/articles/7418648293018-Evaluating-the-performance-of-AI-agents-using-Zendesk-QA
- [Z10] Testing conversation flows in AI agents — https://support.zendesk.com/hc/en-us/articles/8357758879130-Testing-conversation-flows-in-AI-agents
- [Z11] Relate 2026（新闻稿）— https://www.zendesk.com/newsroom/articles/relate-2026/ — 2026-05-19
- [Z12] Creating procedures for auto assist — https://support.zendesk.com/hc/en-us/articles/7924047699738-Creating-procedures-for-auto-assist
- [Z13] 生成式回复的知识来源说明 — https://support.zendesk.com/hc/en-us/articles/8357749315098
- [Z14] OpenAI 客户故事：Zendesk — https://openai.com/index/zendesk — 2025-03-27（页面 403，引文来自检索摘要）

**Ada（docs.ada.cx 页面多不标日期）**
- [AD1] Agent logic — https://docs.ada.cx/docs/welcome/agent-logic
- [AD2] Configure Playbooks — https://docs.ada.cx/docs/automation/playbooks/configure
- [AD3] Topic and intent classification at handoff — https://docs.ada.cx/docs/optimization/performance/intent-intelligence/topic-and-intent-classification-at-handoff
- [AD4] Unified reasoning engine and evaluation science（Ada Labs）— https://www.ada.cx/labs/research/unified-reasoning-engine-evaluation-science/ — 2025-10
- [AD5] Playbooks enhancements（更新日志）— https://docs.ada.cx/2026-06-22-playbooks-enhancements — 2026-06-22（据 URL）
- [AD6] API tool control — https://docs.ada.cx/docs/automation/tools/api-tools/api-tool-control ；External API design — https://docs.ada.cx/docs/automation/tools/api-tools/api-tool-control/external-api-design
- [AD7] Handoff reasons — https://docs.ada.cx/docs/handoffs/handoff-management/handoff-reasons（原因码自 2026-10-07 起记录）
- [AD8] Change sets — https://docs.ada.cx/docs/optimization/change-sets
- [AD9] Simulations — https://docs.ada.cx/docs/optimization/testing/simulations
- [AD10] Ada Labs（delta evaluation）— https://ada.cx/labs/
- [AD11] Coaching tools — https://docs.ada.cx/docs/optimization/coaching/coaching-tools
- [AD12] Resolution rate optimization — https://docs.ada.cx/docs/optimization/conversations/resolution-rate-optimization

**Sierra**
- [S1] Shipping and scaling AI agents — https://sierra.ai/blog/shipping-and-scaling-ai-agents — 2024-07-25
- [S2] Constellation of models — https://sierra.ai/blog/constellation-of-models — 2025-12-03
- [S3] Agent Studio 2.0 — https://sierra.ai/blog/agent-studio-2-0 — 2025-11-05
- [S4] Meet the AI agent engineer — https://sierra.ai/blog/meet-the-ai-agent-engineer — 2024-07-11
- [S5] Agent development life cycle — https://sierra.ai/blog/agent-development-life-cycle — 2024-06-03
- [S6] Enterprise-grade agents — https://sierra.ai/blog/enterprise-grade-agents — 2025-10-02
- [S7] Confidence in every conversation — https://sierra.ai/blog/confidence-in-every-conversation — 2025-10-29
- [S8] Simulations: the secret behind every great agent — https://sierra.ai/blog/simulations-the-secret-behind-every-great-agent — 2025-08-19
- [S9] τ-bench: shaping development and evaluation of agents — https://sierra.ai/blog/tau-bench-shaping-development-evaluation-agents — 2025-03-18
- [S10] Live Assist — https://sierra.ai/blog/live-assist — 2025-11-05
- [S11] Meet Agent Studio（2025-09-18）https://sierra.ai/blog/meet-agent-studio ；Agent OS 2.0（2025-11-05）https://sierra.ai/blog/agent-os-2-0

**Decagon**
- [D1] Agent Operating Procedures（产品页，营销页）— https://decagon.ai/modules/aops — 日期未标（页面有 Dialogues 2026 横幅，推断 2026）
- [D2] Fine-tuning AI agents — https://decagon.ai/blog/fine-tuning-ai-agents — 2025-11-20
- [D3] Intent tags — https://decagon.ai/blog/intent-tags — 2026-02-18
- [D4] AOP: the future of CX — https://decagon.ai/resources/aop-the-future-of-cx — 2025-04-08
- [D5] Decagon Trace View — https://decagon.ai/blog/decagon-trace-view — 2025-12-12
- [D6] Designing layered guardrails for reliable AI agents — https://decagon.ai/blog/designing-layered-guardrails-for-reliable-ai-agents — 2025-07-29
- [D7] Introducing Experiments（A/B testing）— https://decagon.ai/blog/introducing-experiments-ab-testing — 2025-06-24
- [D8] Decagon Watchtower — https://decagon.ai/blog/decagon-watchtower — 2025-06-25
- [D9] Decagon Simulations — https://decagon.ai/blog/decagon-simulations — 2025-09-23
- [D10] Decagon Assist — https://decagon.ai/blog/decagon-assist — 2026-08-19
- [D11] Suggestions（产品页，营销页）— https://decagon.ai/product/suggestions — 日期未标
- [D12] AOP Copilot — https://decagon.ai/blog/aop-copilot — 2025-09-23

**Salesforce Agentforce**
- [F1] Levels of determinism — https://www.salesforce.com/agentforce/levels-of-determinism/ — 日期未标（文内提 2026-04 改名 subagent）
- [F2] Hybrid reasoning with Agentforce Builder and Agent Script（Architect）— https://architect.salesforce.com/docs/architect/fundamentals/guide/hybrid-reasoning-agentforce-builder-agent-script — 日期未标（文内称 GA since February 2026）
- [F3] Agent handoff — https://www.salesforce.com/blog/agent-handoff/ — 2026-03-11
- [F4] What is a reasoning engine: Atlas — https://www.salesforce.com/agentforce/what-is-a-reasoning-engine/atlas/ — 日期未标
- [F5] Agentforce's Agent Graph: toward guided determinism with hybrid reasoning — https://engineering.salesforce.com/agentforces-agent-graph-toward-guided-determinism-with-hybrid-reasoning/ — 10-20（年份推断 2025）
- [F6] Agentforce Testing Center — https://www.salesforce.com/blog/agentforce-testing-center/ — 2026-04-15；Testing Center 发布新闻稿 https://www.salesforce.com/news/press-releases/2024/11/20/agentforce-testing-center-announcement/ — 2024-11-20
- [F7] Trailhead: Plan for Service Assistant — https://trailhead.salesforce.com/content/learn/modules/agentforce-service-assistant/plan-for-service-assistant — 日期未标
- [F8] Trailhead: Einstein Trust Layer — Follow the prompt journey — https://trailhead.salesforce.com/content/learn/modules/the-einstein-trust-layer/follow-the-prompt-journey — 日期未标
- [F9] Salesforce Help: custom agent actions（要求用户确认，检索摘要，正文未取到）— help.salesforce.com `ai.copilot_actions_custom` — 日期未标

**Gorgias（helpcenter.gorgias.com，日期为页面「Updated」）**
- [G1] Customer intents — https://helpcenter.gorgias.com/en-US/customer-intents-81924 — 2026-10-07
- [G2] AI Agent explained — https://helpcenter.gorgias.com/en-US/ai-agent-explained-497772 — 约 2026-09；Skills explained — https://helpcenter.gorgias.com/en-US/skills-explained-6556816 — 2026-07-13
- [G3] Create guidance — https://helpcenter.gorgias.com/en-US/create-guidance-to-give-ai-agent-custom-instructions-1362592 — 2026-07-13
- [G4] Optimize AI Agent based on insights — https://helpcenter.gorgias.com/en-US/optimize-ai-agent-based-on-insights-from-your-tickets-1024587 — 2026-10-22
- [G5] Allow AI Agent to perform actions — https://helpcenter.gorgias.com/en-US/allow-ai-agent-to-perform-actions-567325 — 2026-07-31
- [G6] AI Agent action: cancel an order in Shopify — https://helpcenter.gorgias.com/en-US/ai-agent-action-cancel-an-order-in-shopify-757792 — 2026-07-22
- [G7] Customize how AI Agent hands over — https://helpcenter.gorgias.com/en-US/customize-how-ai-agent-hands-over-to-your-team-6008591 — 2026-10-08
- [G8] Set up and go live with AI Agent — https://helpcenter.gorgias.com/en-US/set-up-and-go-live-with-ai-agent-500219 — 2026-09-09
- [G9] Automatically score the quality of your tickets (beta) — https://helpcenter.gorgias.com/en-US/automatically-score-the-quality-of-your-tickets-(beta)-861067 — 2026-08-21
- [G10] Preview AI Agent responses with test conversations — https://helpcenter.gorgias.com/en-US/preview-ai-agent-responses-with-test-conversations-828087 — 2026-10-08
- [G11] Continuously improve AI Agent with Opportunities (beta) — https://helpcenter.gorgias.com/en-US/continuously-improve-ai-agent-with-opportunities-beta-4858461 — 2026-07-13
- [G12] Gaia explained — https://helpcenter.gorgias.com/en-US/gaia-explained-6646561 — 2026-10-22
- [G13] Coach AI Agent and give feedback — https://helpcenter.gorgias.com/en-US/coach-ai-agent-and-give-feedback-500892 — 2026-10-22

**eDesk（support.edesk.com，页面均不标日期；按「按结果计费」等内容推断为 2025–2026）**
- [E1] Intro to Procedures — https://support.edesk.com/intro-procedures
- [E2] Building a new Procedure — https://support.edesk.com/building-a-new-procedure
- [E3] AI Agent — https://support.edesk.com/ai-agent ；Introducing eDesk AI — https://support.edesk.com/introducing-edesk-ai
- [E4] Agent profile — https://support.edesk.com/agent-profile
- [E5] AI Agent FAQ — https://support.edesk.com/ai-agent-faq
- [E6] Setting SLA targets — https://support.edesk.com/setting-sla-targets
- [E7] AI helpers — https://support.edesk.com/ai-helpers
- [E8] Procedure gaps report — https://support.edesk.com/procedure-gaps-report
- [E9] Knowledge gaps（页面现已 404，引文来自检索索引）— support.edesk.com

**Yuma AI、Siena AI**
- [Y1] Yuma 2.0 — https://yuma.ai/blogs/yuma-2-0 — 日期未标（Ask Yuma 相关稿件称 2026-09 发布）
- [Y2] AI hallucinations in customer service: why quality control architecture matters — https://yuma.ai/blogs/ai-hallucinations-in-customer-service-why-quality-control-architecture-matters — 日期未标（文中引用 2025–2026 事件）
- [Y3] Turn support SOPs into a tested AI agent — https://yuma.ai/blogs/turn-support-sops-into-a-tested-ai-agent — 日期未标
- [Y4] Yuma AI launches Ask Yuma — https://yuma.ai/blogs/yuma-ai-launches-ask-yuma-conversational-ai-support-operation — 2026-04-08
- [N1] Introducing Siena AI Reasoning — https://www.siena.cx/blog/introducing-siena-ai-reasoning-with-benefits-for-enterprise — 2024-11-25
- [N2] Testing AI agents: Playground — https://www.siena.cx/blog/testing-ai-agents-playground — 2025-07-31
- [N3] Validate Siena AI automations with Test Runs — https://www.siena.cx/blog/validate-siena-ai-automations-with-test-runs — 2025-01-22
- [N4] AI routing and human team collaboration — https://www.siena.cx/blog/ai-routing-human-team-collaborative-ai — 2024-03-13

**Shopify**
- [H1] Building production-ready agentic systems: Lessons from Shopify Sidekick — https://shopify.engineering/building-production-ready-agentic-systems — 2025-08-26
- [H2] Fine-tuning the Shopify Flow agent — https://shopify.engineering/fine-tuning-agent-shopify-flow — 更新于 2026-04-22
- [H3] Shopify Help Center: Sidekick Pulse — https://help.shopify.com/en/manual/ai-powered-tools/sidekick/pulse — 日期未标

**亚马逊**
- [M1] Amazon Seller Central Communication Guidelines（公开 PDF）— https://m.media-amazon.com/images/G/01/SellerCentral/CommunicationGuidelines/en_US_Communication_Guidelines.pdf — PDF 元数据 2020-10-20；Seller Central G1701 现行页需登录
- [M2] Seller Central：Respond to messages（202152030，需登录，只取到检索摘要）— 日期未标
