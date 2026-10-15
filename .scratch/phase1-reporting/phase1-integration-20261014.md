# 第一期整体集成验证

日期：2026-10-14。对象：分支 `phase1-dev`（第一期开发待办 01–28、30、31 全部 resolved；29、32 为 ready-for-human，本次不改它们的 Status）。审查基线 `07023f9`，本次提交 `07023f9..HEAD`。

依据：`.scratch/phase1-reporting/spec.md`（「第一期适用的验收子集」「上线前必须验证」）、PRD 13.6（`design/spec/prd_d.md`）、`docs/agents/prototype.md`、`design/spec/WORKPLAN.md`、README。

环境：同 18、23–28 号——本机原生 PostgreSQL 18.6（127.0.0.1:4520）跑开发库、集成测试与 e2e；`pnpm deploy:staging` 部署到远端 Docker（context remote），本机 4510 / 4511 经 SSH 隧道；本机 8 GB，测试、构建、部署严格串行。本机没有全局 Python：`pnpm fixtures:verify`（`ci:local` 的一步）与原型脚本用 uv 装的 Python 3.11（`fixtures:verify` 需要它在 PATH 上，第一次跑 `ci:local` 就是停在这一步，补上后重跑通过）。

## 1 全量检查

严格串行，同一时间只跑一个重任务。

| 检查 | 版本 | 结果 |
|---|---|---|
| `pnpm ci:local`（依次 typecheck、lint、lint:workflows、db:verify、fixtures:verify、build、test:unit、test:integration、`docker build` 后端镜像、deploy:verify） | `b919499`（本票最后一次改应用与测试代码之后） | ✅ 全过，9 分 25 秒：typecheck 通过；lint（ESLint 含模块边界 + Prettier）通过；工作流语法（actionlint）与 6 个部署 shell 脚本（shellcheck）通过；迁移一致性「迁移与表结构一致」（drizzle-kit check + 38 张表 generate 无变化 + check-migrations）；示例数据夹具「与 data.py 一致」；build 通过；**test:unit 99 个文件 898 项全过**；**test:integration 49 个文件 579 项全过**；镜像构建通过；deploy:verify「部署配置检查通过」 |
| `pnpm test:e2e` | `b919499` | ✅ **140 项全过**（11.1 分钟） |
| `pnpm lint`、`pnpm test:unit`、`pnpm deploy:verify` | `6811e77`（只多了 `deploy/deploy.mjs` 的部署修复） | ✅ lint 通过；test:unit 99 个文件 898 项全过；部署配置检查通过（这处修复本身由第三次部署验证，见第 2 节） |

经过（如实记录）：

- 第一次 `ci:local`（`07023f9`）前四步通过，停在 `fixtures:verify`「找不到 Python 3」（本机没有全局 Python）；把 uv 的 Python 3.11 放进 PATH 后在同一版本重跑全过（数字同上：898 / 579）。
- 第一次 `test:e2e`（`95e7f94`）133 项通过、2 项失败、5 项未运行，都在 `unassigned-mail.spec.ts` 末尾，原因是 `browserContext.newPage: Target crashed` 与 worker 退出码 3221225794（内存不足），随后 Claude Code 以系统内存过低停掉了命令。协调者查到是两个父进程已退出的孤儿 `grep` 占着约 1.5 GB（很可能是本会话早先一条被停掉的递归 grep 的子进程，停掉父命令时没有一并结束），结束后空闲约 3.2 GB；经协调者同意先单独重跑 `unassigned-mail.spec.ts` 11 项全过，再在最终版本整套重跑 140 项全过（上表）。

## 2 部署到开发测试环境

从头部署：`pnpm deploy:staging --reset-inbound`（清空收信与工单，worker 起来后按示例数据重新回放）。环境同 18、23–28 号：远端 Docker（context remote），只动 forcome-staging 项目的容器、卷与镜像；冒烟在远端的 smoke 容器里经 caddy 运行。三次部署时工作区都干净。

经过：

- 第一次（`b919499f4b46`）：前八步都通过，冒烟 139 项通过、1 项失败——`ticket-detail.spec.ts`「坐席打开 Oliver Grant 的工单：全程记录、工单信息、订单、SLA 结果与状态流转（I18 ①）」状态流转期望 7 步、实际 8 步。查证：worker 逐封回放示例来信时，每分钟的时限扫描落在 Oliver 的第一、二封之间，按 7 天关闭后又被第二封重开。这是按时关闭不看同步进度的缺陷，见第 6 节「已知问题」与待办 33；经协调者决定（选 A）同样再部署一次确认。
- 第二次（`b919499f4b46`，同一版本重跑）：「启动 api、worker、caddy 与备份服务」失败「api 没有以 forcome-server:b919499f4b46 运行（running sha256:f44dde87…）」。原因同 28 号备份服务那次：内容没变时重新构建也换镜像 ID（构建证明的时刻不同），标签移到新 ID，Compose 不重建容器，容器还跑着上一次的构建。修复 `6811e77`：带版本的 api、worker、caddy 加 `--force-recreate`（核对照旧严格），备份服务单独 up。
- 第三次（`6811e77599d0`）：八步全过，冒烟 140 项全过（Oliver Grant 这一项这次通过，扫描没有落在两封之间）。

第三次部署的报告（`deploy/.state/staging/report.md`）：

**部署到开发测试环境（staging）：成功**

- 版本：`6811e77599d0`
- 地址：https://support-dev.forcome.internal:4510/
- Compose 项目：forcome-staging
- 根证书 SHA-256：D5:9C:51:89:44:EC:9A:BF:9F:37:DA:0D:10:35:9C:E4:55:6E:6E:78:5B:08:DB:EB:31:F6:CD:93:BC:13:AD:D1

| 步骤 | 结果 | 用时 |
|---|---|---|
| 准备（环境文件、版本） | ✅ 通过 | 0.2 秒 |
| 构建镜像 | ✅ 通过 | 12.9 秒 |
| 启动数据库 | ✅ 通过 | 2.4 秒 |
| 执行迁移（migrate） | ✅ 通过 | 5.5 秒 |
| 灌示例数据（seed） | ✅ 通过 | 5.7 秒 |
| 重放来信（清空收信与工单） | ✅ 通过 | 7.3 秒 |
| 启动 api、worker、caddy 与备份服务 | ✅ 通过 | 16.3 秒 |
| 内网 HTTPS（用导出的根证书核对） | ✅ 通过 | 1.7 秒 |
| Playwright 冒烟（apps/web/e2e） | ✅ 通过 | 695.6 秒 |

冒烟：140 项通过，0 项失败，0 项不稳定，0 项跳过

部署前写了维护标记（到 10-15 07:45 为止宿主机检查不告警），部署后清掉；删掉旧版本的镜像 6 个（只留 `6811e77599d0`、`b919499f4b46`）。

## 3 验收矩阵（PRD 13.6）

13.6 第一阶段适用 42 条：13.1 的 AC-TK-01、02、03、04、07、09、11、13、14；13.4 的 AC-AS-16、22；13.5 全部（AC-RP-01–03、AC-ST-01–06）；AC-P1-01–22。13.7 是第二阶段的验收，没有标第一阶段的条目；其中 AC-P2-05、06、08 的前提是第一期的数据（待回复工单、手工登记的进行中售后单、历史导入的单），第一期已按规格「第二期衔接」保留了简化状态与创建路径，验收随第二期。

归类：**自动化**＝集成测试（主接缝，`apps/server/test/*.int.test.ts`）、单元测试或 Playwright（`apps/web/e2e/*.spec.ts`，每次部署后在开发测试环境作为冒烟再跑一遍）覆盖；**演练**＝开发测试环境的演练记录；**转 29**＝期望里有 Fake 测不到、要真实外部系统核对的部分（待办 29 已有对应条目）。42 条都有自动化覆盖，没有缺口；矩阵对照时发现 1 处测试不完整，已在本次补上（AC-TK-14，见表注）。

| 编号 | 期望（摘要） | 覆盖的测试（文件 · 用例） | 归类 |
|---|---|---|---|
| AC-TK-01 | 同一订单有未关闭工单，再来信追加、不新建，第一期不计重复联系 | `order-merge.int.test.ts` ·「AC-TK-01：同一订单已有未关闭工单，客户再来一封信 → 追加到原工单，不新建（第一期不计重复联系）」 | 自动化 |
| AC-TK-02 | 同一客户两笔订单 → 两张工单 | `order-merge.int.test.ts` ·「AC-TK-02：…生成两张工单」 | 自动化 |
| AC-TK-03 | 关闭 20 天同一订单来信 → 重开为待回复 | `order-merge.int.test.ts` ·「AC-TK-03（第一期改写）：…原工单重开为待回复…」 | 自动化 |
| AC-TK-04 | 关闭 40 天 → 新建 | `order-merge.int.test.ts` ·「AC-TK-04：工单关闭 40 天，同一订单来信 → 新建工单…」 | 自动化 |
| AC-TK-07 | 等客户 7 天无来信 → 关闭「客户未回复」 | `reply-sla.int.test.ts` ·「AC-TK-07：等客户 7 天无来信 → 已关闭，原因「客户未回复」…」；`mail-replay.int.test.ts`（回放中按邮件时间关闭） | 自动化 |
| AC-TK-09 | 收件邮箱未登记 → 进未归属队列、不建工单，SLA 照常计时 | `unassigned-mail.int.test.ts` ·「进队列（AC-TK-09、E-13）」下「买家消息的收件地址没登记：进队列、不建工单，SLA 按原到达时间照常计时…」等 8 项 | 自动化；真实来信转 29 |
| AC-TK-11 | 指定店铺 → 按 R-ST-02 归并成工单，SLA 按原到达时间 | `unassigned-mail.int.test.ts` ·「指定后按 R-ST-02 重新识别站点、关联订单并归并成工单，SLA 仍按原到达时间…」；`unassigned-mail.spec.ts` ·「不撤销：窗口结束才提交…（AC-P1-15、AC-TK-11）」 | 自动化；真实来信转 29 |
| AC-TK-13 | 关闭时仍有未回复来信 → 计未达标 | `reply-sla.int.test.ts` ·「AC-TK-13 与 14 天规则：…未回复的应回复来信计未达标…」 | 自动化 |
| AC-TK-14 | amz-direct 收到 marketplace.amazon.com.mx 的买家来信 → Forcome Direct、MX，建工单并开始 SLA 计时 | `source-recognition.int.test.ts` ·「amz-direct@forcome.com 收到买家消息中转域 marketplace.amazon.com.mx 的来信 → …建工单并开始 SLA 计时（AC-TK-14）」；`recognition.test.ts` ·「站点识别（R-ST-02，AC-TK-14）」 | 自动化（注 1）；真实中转域转 29 |
| AC-AS-16 | 台账取消：原因必填，已产生费用照常计入 | `aftersales-ledger-states.int.test.ts` ·「AC-AS-16：不填原因报错、不取消；填写后已取消，勾选保留的已产生费用仍登记，记审计」；`aftersales-ledger-totals.int.test.ts` ·「已取消的单只计确认保留的费用」；`ledger-states.spec.ts` ·「取消售后单：二次确认，原因必填…」 | 自动化 |
| AC-AS-22 | 进行中未寄出：快递单号「—」，不标待回填，无补登 | `aftersales-ledger-states.int.test.ts` ·「AC-AS-22：进行中、尚未寄出的单不标缺、不计完整率；没有补登…」；`ledger-states.spec.ts` ·「设为已完成：…（S15 ①、AC-AS-22）」 | 自动化 |
| AC-RP-01 | P13 合计与 P17 成本卡头一致（$188.79） | `report-cost.int.test.ts` ·「AC-RP-01：示例夹具下 P17 卡头总额与 P13 合计行「费用合计」都为 $188.79…」；`reports-cost.spec.ts` ·「AC-RP-01（界面）…」；`packages/fixtures/src/demo.test.ts` | 自动化；真实数据转 29（台账导出与报表一致） |
| AC-RP-02 | 只选 Forcome Direct 只统计该店铺 | `report-tickets.int.test.ts` ·「AC-RP-02：只选 Forcome Direct 时只统计该店铺；下钻带店铺，条数一致」；成本卡见 `report-cost.int.test.ts` ·「随店铺筛选（下钻带店铺），不随时间与站点」 | 自动化 |
| AC-RP-03 | 无数据 → 无数据状态与调整筛选 | `report-tickets.int.test.ts` ·「AC-RP-03 的数据：…为无数据…」；`reports.spec.ts` ·「AC-RP-03 与 K4：…「调整筛选」…「清除筛选」」 | 自动化 |
| AC-ST-01 | 平台标识为空 → 报错不保存 | `stores.int.test.ts` ·「三类校验错误各自返回字段级错误，不保存（AC-ST-01、K8）」下「平台标识为空…」「以上请求都没有保存…」；`channel.test.ts`；`stores.spec.ts` ·「新增店铺：字段下方逐项报错…（K8、AC-ST-01）」 | 自动化 |
| AC-ST-02 | 停用有进行中售后单的成员 → 弹窗选接手人、改派后停用、记审计 | `member-handover.int.test.ts` ·「AC-ST-02：负责 2 张进行中售后单 → 弹窗要求选接手人；选好后停用、会话失效，负责人变更记审计、状态不变」；`member-handover.spec.ts` ·「P20 停用：选好接手人后「改派并停用」，成员表随之更新…」「P20 停用：王磊是唯一的售后负责人，「改派并停用」置灰并写原因…」 | 自动化 |
| AC-ST-03 | 坐席访问设置 → 无权限 | `navigation.spec.ts` ·「坐席从链接打开设置页显示无权限，只能返回首页（AC-ST-03、G2）」；接口一侧 `team.int.test.ts` ·「非管理员访问 P20 的接口一律 403…」 | 自动化 |
| AC-ST-04 | 密度切紧凑，刷新、重新登录保持 | `session.int.test.ts` ·「密度偏好存服务端（AC-ST-04、G9）」；`navigation.spec.ts` ·「密度切到紧凑后，刷新与重新登录都保持（AC-ST-04、G9）」 | 自动化 |
| AC-ST-05 | 钉钉离职 → 自动停用、会话失效，售后单进改派队列，客服主管收通知 | `dingtalk-sync.int.test.ts` ·「离职（AC-ST-05）：立即停用，现有会话立即失效…」；`member-handover.int.test.ts` ·「AC-ST-05：离职 → 自动停用、会话失效；进行中售后单进入改派队列…」；`member-handover.spec.ts` ·「钉钉离职 → 售后单进改派队列（AC-ST-05）…」 | 自动化；真实钉钉转 29 |
| AC-ST-06 | 从钉钉添加并分配角色、店铺 → 扫码进入默认首页、只见授权店铺 | `dingtalk-login.int.test.ts` ·「已分配角色与店铺的成员扫码后进入默认首页，只见授权店铺的数据（AC-ST-06）…」；`team.int.test.ts` ·「新成员登录后进入该角色的默认首页，只看到授权店铺（AC-ST-06）」；`team.spec.ts` ·「从钉钉添加（AC-ST-06）…」 | 自动化；真实钉钉扫码转 29 |
| AC-P1-01 | 两封都标记无需回复 → 已解决、不计 SLA；5 秒内撤销第二封 → 待回复 | `ticket-detail.int.test.ts` ·「两封都标记 → 已解决、两封都不计 SLA；5 秒内撤销第二封 → 回到待回复…」；`ticket-detail.spec.ts` ·「坐席标记无需回复 → 工单转已解决 → 5 秒内撤销，回到待回复（AC-P1-01）」 | 自动化 |
| AC-P1-02 | 「已发送」里 In-Reply-To 指向来信的回信 → 等客户，首次回复 = internalDate | `reply-sla.int.test.ts` ·「AC-P1-02：…首次回复时间 = 回信 internalDate」 | 自动化；Q-26（海帆回信在「已发送」且带回复头）转 29 |
| AC-P1-03 | 带 Auto-Submitted 的我方邮件不算回复 | `reply-sla.int.test.ts` ·「AC-P1-03：…不算回复，工单保持待回复…」；`auto-reply.test.ts` | 自动化 |
| AC-P1-04 | 生产厂来信建工单、标「生产厂」、待回复，不计工单量与 SLA | `source-recognition.int.test.ts` ·「已登记生产厂邮箱的来信建工单，来源标「生产厂」，状态待回复…」；`reply-sla.int.test.ts` ·「AC-P1-04：生产厂来信建工单（待回复）但不计 SLA…」；`report-tickets.int.test.ts` ·「工单量：客户来信触发的新建与重开计入，生产厂来信触发的新建与重开不计…」 | 自动化；真实生产厂邮箱名单见 32 |
| AC-P1-05 | 亚马逊平台通知归档、不建工单 | `source-recognition.int.test.ts` ·「亚马逊平台通知邮件归档，不建工单（AC-P1-05）…」 | 自动化；真实发件域转 29 |
| AC-P1-06 | 10 张已完成、1 张寄配件缺单号 → 90%，调整安装方式不计缺 | `aftersales-ledger-states.int.test.ts` ·「AC-P1-06：当月 10 张已完成…」下「设为已完成后计入当月完整率…」；`aftersales-missing.test.ts` | 自动化 |
| AC-P1-07 | 历史导入的已完成单缺字段不计完整率 | `aftersales-ledger-states.int.test.ts` ·「AC-P1-07：历史导入的已完成单缺字段，不计入完整率的分子与分母…」；`aftersales-history-import.int.test.ts` ·「导入的已完成单不影响当月登记完整率…」 | 自动化；真实登记表样本见 32 |
| AC-P1-08 | MX$889.00、当天无汇率 → 取此前最近日期并标注，冻结美元值到分 | `exchange-rates.int.test.ts` ·「AC-P1-08：…」；`exchange-rate.test.ts` ·「冻结美元值：原币 ÷ 汇率，四舍五入到分」；`exchange-rates.spec.ts` | 自动化；经公司代理取欧洲央行汇率转 29 |
| AC-P1-09 | 知识库负责人看不到成本卡，接口不返回成本 | `report-cost.int.test.ts` ·「AC-P1-09：知识库负责人的成本接口不返回成本字段…」；`reports-cost.spec.ts` ·「AC-P1-09（界面）…」 | 自动化 |
| AC-P1-10 | 管理员的每日工单量柱不可点、无「查看明细」 | `report-tickets.int.test.ts` ·「AC-P1-10：管理员能看报表但没有「查看工单」…」；`reports.spec.ts` ·「AC-P1-10：管理员没有工单页权限…」 | 自动化 |
| AC-P1-11 | 三个同步时刻取最旧 → 「更新于 10:12」 | `report-tickets.int.test.ts` ·「AC-P1-11：Gmail 最近同步 10:18、亚马逊订单 10:12、Shopify 订单 10:15 → 更新于 10:12…」；写法见 `p17-copy.test.ts` ·「对比的前缀、持平、「更新于 —」、全部店铺」 | 自动化；带源时间戳的延迟转 29 |
| AC-P1-12 | 3 封亚马逊来信 → 分母 2、达标率 50% | `report-tickets.int.test.ts` ·「AC-P1-12：…分母 2，达标率 50%…」；`report.test.ts` | 自动化 |
| AC-P1-13 | 近 90 天回放：编号日期取首封来信，按邮件时间归并关闭重开，无提醒通知 | `mail-replay.int.test.ts` ·「AC-P1-13：近 90 天邮件回放…」下 7 项（编号日期、按邮件时间、SLA、无通知、14 天规则、幂等）及「T0 交界」「切换的状态与命令的保护」 | 自动化；演练见 26 号部署记录；生产回放转 29 |
| AC-P1-14 | 09-10 的柱 73，下钻 P04 计数行与列表都 73 | `report-tickets.int.test.ts` ·「AC-P1-14 的数据：09-10 的柱为 73…」「worker 重启过…验收日的柱为 73」；`reports.spec.ts` ·「AC-P1-14：验收日「每日工单量」的柱为 73…列表逐页合计 73 张」 | 自动化 |
| AC-P1-15 | 指定后 5 秒内撤销 → 回到队列；不撤销 → 归并成工单 | `unassigned-mail.int.test.ts` ·「撤销窗口内撤销（前端不提交）…（AC-P1-15）」；`unassigned-mail.spec.ts` ·「指定后 5 秒内撤销…」「不撤销：窗口结束才提交…」 | 自动化 |
| AC-P1-16 | 新增进线邮箱为 amz-ca2 的店铺 → 来信自动归位、客服主管收通知 | `unassigned-mail.int.test.ts` ·「登记新店铺后自动归位（AC-P1-16）」下「管理员新增进线邮箱为该地址的店铺：来信自动归位成工单…收到站内通知…」「兜底扫描…」 | 自动化；真实别名投递转 29 |
| AC-P1-17 | 退款或部分补偿额外赔偿为 0 → 字段下报错，不保存 | `aftersales-registration.int.test.ts` ·「AC-P1-17：…」；`aftersales.test.ts`；`ledger.spec.ts` ·「保存时校验全部：额外赔偿为 0…（S14、AC-P1-17）」 | 自动化 |
| AC-P1-18 | forcome.mx 只有王磊有范围 → 默认王磊、下拉只列有范围的人 | `aftersales-registration.int.test.ts` ·「AC-P1-18：…」；`aftersales.test.ts` ·「负责人（D-24、AC-P1-18）…」；`ledger.spec.ts` | 自动化 |
| AC-P1-19 | 客服主管不能补登已完成单，售后负责人可以并记审计 | `aftersales-ledger-states.int.test.ts` ·「AC-P1-19：客服主管补登已完成单的快递单号被拒绝；售后负责人可以…记审计」；`ledger-states.spec.ts` ·「行内补登…」「客服主管：已完成的单没有补登入口…」 | 自动化 |
| AC-P1-20 | 坐席只看自己的记录；管理员看全部，成本与比例「已隐藏」 | `audit-log.int.test.ts` ·「查看范围（10.2、AC-P1-20）」；`audit-log.spec.ts` ·「坐席只看到自己的操作记录…」「管理员没有财务权限：成本与比例的前后值「已隐藏」…」；`audit-describe.test.ts` | 自动化 |
| AC-P1-21 | 只有生产厂对接人角色 → 无权限、不进入 | `dingtalk-login.int.test.ts` ·「只有生产厂对接人角色（第一期，AC-P1-21）…」；`navigation.int.test.ts`；`login.test.ts`；`dingtalk-login.spec.ts`、`navigation.spec.ts` | 自动化 |
| AC-P1-22 | 钉钉连续 3 次失败 → P18 连接异常、提醒管理员，无横幅，登录不受影响 | `dingtalk-sync.int.test.ts` ·「同步失败（E-32、AC-P1-22）」下「每个整点对账一次、失败不重试：…连续 3 次为连接异常…」（断言不出横幅、开发登录与扫码登录照常） | 自动化；真实钉钉转 29 |

注 1：原用例只断言店铺、站点、渠道与状态，没有断言期望里的「开始 SLA 计时」；本次补断言（平台目标、到达起 24 小时、演示时刻未到期），用例名的「发件域 amazon.com.mx」改为 PRD v2.15 的「买家消息中转域」（`95e7f94`）。

规格「上线前必须验证」三项都不能在本机或开发测试环境完成，已在 29、32 号：Q-26（29 第 3 项）；SP-API 的 MFN 单号、`ORDER_CHANGE` 延迟与 `searchOrders` 配额（29 第 4、5 项）；历史售后登记表样本、SKU 与生产厂归属表（32 的第一期阻塞项）。

## 4 四方对照（PRD、原型、规格、待办）

做法：逐张读 18–28 号待办 Comments 里的协调者决定，按业务 / 界面（应在 PRD 与原型）与技术 / 运维（应在 ADR、部署说明、运维手册、规格）归类，逐条找落点；重新生成全部画板与第一期参照页，对照生成物与源；核对 `prototype.md`、WORKPLAN、README「开发」与换行符。只修漂移，不改业务口径。

**已回写、无漂移的**：18 号 Q1–Q5（PRD v2.32，Q5 另见 ADR 0008「待办 18 落地」）；19–22 号（v2.16–v2.19，S13–S15 补充小样；技术部分在规格与 ADR 0006、0008）；23 号 Q1–Q9、R1–R2（v2.33，K10 第一阶段补充小样、S15 补充小样 · 改派负责人与待分配；R2 的并发另见 ADR 0005）；24 号 Q1–Q7（v2.34，K19 补充小样①–⑤）；25 号 Q1–Q5（v2.35，K19 补充小样⑥–⑧）；26 号 Q1–Q4 与 28 号 Q1–Q4 是技术 / 运维口径（明确不改 PRD），在规格、ADR 0008、0013、`docs/部署说明.md` 第 16、17 节与 `docs/运维手册.md`；27 号的映射、报错与警告口径在规格「历史导入与切换」与部署说明第 10 节。

**发现的漂移与处理**（提交 `7176c0d`、`afa5c74`、`b919499`）：

| # | 漂移 | 处理 |
|---|---|---|
| 1 | 换行符：待办 25 的提交把 README.md、WORKPLAN.md、prd_a.md、prd_c.md、`pages/build_states_admin.py`、ADR 0005 从 CRLF 改成了 LF（`core.autocrlf=true` 下索引一旦成了 LF 就一直是 LF）；待办 26、28 往 `docs/部署说明.md` 加的 125 行是 LF（索引里成了混合）；新建的 `docs/运维手册.md` 与 18、23–26、28 号部署存档是 LF（README「约定」：新建文档用 CRLF） | 一律改回 CRLF（`core.autocrlf=false` 暂存），`git diff --ignore-cr-at-eol` 为空；之后 `git ls-files --eol` 没有 `i/mixed`，代码与配置目录全是 LF（3 个空文件为 none） |
| 2 | 18 号 Q6（P04 清除筛选后仍为空的写法）只在代码里（`apps/web/src/pages/tickets/p04-copy.ts`、`tickets-page.tsx`），原型与 PRD 都没有 | PRD P04「第一阶段」补列表为空的写法，I16 说明跟上（说明写法同 P13；与 P13 不同的是清除后也为空时不给「清除筛选」）；PRD v2.36 |
| 3 | 27 号协调者 2026-10-06 决定的审计动作「历史导入」只在规格里，PRD P27「第一阶段」逐一列了其余系统动作、唯独没有它 | P27「第一阶段」补「历史导入」（每张导入的单一条，操作人「系统」，写法同新建登记）；v2.36 |
| 4 | PRD I16 一行仍写「表头写「共 73 条」」，没跟上 v2.32 的计数行 | 改为「下方计数行写「共 73 条」与出处」；v2.36 |
| 5 | PRD 变更记录 v2.25 一行夹在 v2.15 与 v2.35 之间 | 挪回 v2.26 与 v2.24 之间 |
| 6 | WORKPLAN 写「当前 PRD v2.15」；18 号一条只写 Q1–Q4、没写 Q5 | 改为 v2.36；18 号一条补 Q5 的内容；新增本次一条 |
| 7 | `prototype.md` 的当期列没指向 18–28 号新加的补充小样（P13 只写 S14、S15，P17 只写 K19，P20 写「K10 与 K17 的第一阶段小图」等） | P04、P13、P17、P18、P20、P27 的当期列指向各自的补充小样 |
| 8 | 规格开头的依据停在 PRD v2.30，状态清单缺 K10 | 依据改到 v2.36（补 v2.31–v2.36 各条），状态清单补 K10（第一阶段补充小样） |
| 9 | README「开发」没有 19–22 号（汇率、台账导出）的开发与测试写法 | 补「汇率与台账导出（待办 19–22）」一段：定时任务 `schedule`、测试里 `t.enqueue(syncExchangeRatesJob, {})`、`FakeExchangeRates` 的 `publish` 与 `faults`、导出用 `exceljs` 读回。18 号（实时推送 `liveHeartbeatMs`）、23 号（「模拟回到通讯录」）、24–28 号已有说明 |

生成物：`pages/build_*.py`、`build_ds.py`、`build_map.py` 全部重跑，**只有 `StatesInbox.dc.html` 有变化**（即上面第 2、4 条的 I16 说明），其余画板生成物与源一致；`check.py --shots` 全部画板 OK（没有溢出与裁切）；只提交 StatesInbox 的新截图——其余截图重拍后与仓库里的只差字体抗锯齿（强差异像素 ≤ 0.01%），不提交；`build_prd.py` 重新合成（`forcome-blueprint-guide.html` 的变化只有 v2.36 的内容）；`shot_phase1.py` 重跑，第一期 14 张参照页 `.dc.html` 全部不变（PNG 同样只有抗锯齿差异，不提交）。

不改的（记录在此）：
- PRD 11.4 表行「成员停用后…进入改派队列」是完整版的笼统写法，第一阶段由同节 v2.33 写准（只在钉钉离职自动停用时产生），不矛盾，不改。
- 27 号「导入不按配件 SKU 预填生产厂」只写在规格里、R-AS-08 未改：待办 27 已写明是导入命令的取舍、不改业务规则，不回写 PRD。
- 画布 `design/forcome-support-blueprint.html` 与 `canvas.json` 自 v2.12 起没有重新打包（状态板高度已过时，例如 StatesInbox 记 9487、实际 12722）：`build_canvas.py --seed` 依赖另一台机器上 Claude Code design 技能的 `seed-canvas.mjs`（脚本里 `SKILL` 写死的路径在本机不存在），本次不能重跑，列入第 5 节。

## 5 仍需真实环境或人工的事项

**待办 29（真实环境验收矩阵，ready-for-human）**——要真实外部系统，开发测试环境的 Fake 测不到。逐条见 29 号复选框与各票留下的 Comments，归纳：

1. 真实钉钉：扫码登录（含 AC-ST-06、AC-P1-21）、通讯录同步与离职停用（AC-ST-05，含改派队列）、连续失败（AC-P1-22）、工作通知送达与 5 分钟合并、配额余量。
2. 各店铺收信与「已发送」关联；**Q-26**（海帆回信在「已发送」且带回复邮件头，AC-P1-02 与首响 / SLA 指标的前提）；真实别名投递与未归属店铺（AC-TK-09、11、AC-P1-15、16）；买家消息中转域与平台通知发件域（AC-TK-14、AC-P1-05）；Shopify 联系表单。
3. 订单：`ORDER_CHANGE` 与 Shopify 增量延迟、61–90 天历史订单、MFN 单号（O-2）、`searchOrders` 配额、断线恢复。
4. 报表：台账导出与页面、报表数字一致（AC-RP-01 在真实数据上）、带源时间戳的可见延迟 ≤ 15 分钟（AC-P1-11）、近 90 天数据下列表首屏 P95 ≤ 1.5 秒；汇率经公司代理可取（AC-P1-08）。
5. 上线切换：历史回放与 T0 切换在生产完成（AC-P1-13，手册 `docs/部署说明.md` 第 16 节）。
6. 生产部署：打标签 → 人工批准 → 部署、未批准不部署；迁移前备份、每日备份与保留、告警通道、宿主机检查、按时间点恢复演练、日志与密钥（`docs/部署说明.md` 第 17 节、`docs/运维手册.md`）。
7. 实时推送经员工电脑、代理与 VPN 到内网 caddy 的实际表现（18 号留下的衔接）。
8. 验收结论：报表可替代人工导出；登记完整率口径可计算。

**待办 32（外部资质与先决条件，ready-for-human）**——第一期生产上线前必须到位的：SP-API 资质与 SQS、Shopify 自建应用与 `read_all_orders`、Google 全域委派与 Pub/Sub、钉钉开放平台配置、内网 HTTPS 与 NAS、GitHub 私有仓库；以及三项阻塞生产上线的数据：SKU 与生产厂归属表（缺了「寄配件」选不了配件）、生产厂来信邮箱与其他供应商名单（来源规则）、历史售后登记表样本（拿到后只改 `history-mapping.json` → 开发测试环境试运行 → 生产导入）。

**上 GitHub 启用前要定的事项**（不改工作流，如实列出）：`.github/workflows/ci.yml` 与 `deploy-staging.yml` 写的触发分支是 `main`（`branches: [main]`），生产部署 `deploy-production.yml` 按 `v*` 标签、核对标签在 main 上；而远端仓库的默认分支现在是 `claude02`。推到 GitHub 之前要定：改默认分支为 `main`，或把三个工作流与 `docs/部署说明.md` 里的 `main` 改成实际的主分支。

**其他人工事项**：
- 画布重新打包：在装有 Claude Code design 技能的环境改 `design/spec/build_canvas.py` 的 `SKILL` 路径后运行 `build_canvas.py --seed`（自 v2.12 未重新打包）；已发布页面的链接与版本按 WORKPLAN 更新。
- 待办 33（见第 6 节）由协调者另派。

## 6 已知问题

- **按时关闭不看同步进度（待办 33，ready-for-agent，不在本票修）**：时限扫描按时关闭只看 `ticket.last_inbound_at`。Gmail 同步滞后（断线、补拉）时，客户在到期前已来信但还没入库，扫描照样关闭，入库后又按 30 天内重开，多出一对关闭 / 重开（影响工单量的重开计数）；P05 状态流转里按时关闭的业务时刻是读取时重算的（`apps/server/src/modules/ticket/detail.ts:44` `businessTimeOf`），会显示成晚于关闭时刻的时间。开发测试环境的示例回放（`apps/server/src/modules/integration/gmail.ts:106`，逐封、整天平移）与每分钟扫描交错时会触发它，第一次部署的冒烟失败就是这样（第 2 节；开发测试库 T-20261007-0001 的状态变更：05:27:08 等客户 → 05:27:10 `idle_7_days` 关闭 → 05:27:12 重开）。协调者 2026-10-14 决定在第一期修，方向与验收写在 `.scratch/phase1-reporting/issues/33-按时关闭与同步滞后.md`。

## 7 本次提交与 code-review

提交（`07023f9..HEAD`）：`7176c0d` 换行符漂移修复；`afa5c74` 四方对照收口（PRD v2.36、原型、prototype.md、WORKPLAN、规格依据、README）；`95e7f94` AC-TK-14 测试补 SLA 断言；`b919499` 评审修复；`6811e77` 部署修复（同一版本再部署时重建容器）；以及本文件、待办 33 与 29 号 Comments 的提交。

`/code-review`（基线 `07023f9`，覆盖到 `95e7f94`，规范一轴纳入 README「约定」、CLAUDE.md「实现依据」、ADR 0005，界面一轴核对 StatesInbox 的 I16、I10 与 `p04-copy.ts`、`tickets-page.tsx`）：

- 规范一轴：没有违反成文规范。判断项①AC-TK-14 的期望值用被测的 `slaDueAt` 算，「24 小时」没有被独立钉住——**修**：改断言字面值 `2026-09-11T03:15:00.000Z`；②同一条决定写进 PRD、原型说明、WORKPLAN、prototype.md 多处——是回写流程本身的要求，不改。顺带：P04 列表为空时「清除后的张数」还在加载时会短暂显示「换个条件试试。」——既有代码、不在本次改动里，影响是一瞬间的文案，记录不改。
- 规格一轴：①PRD 等处写「同 P13」不准——P13 清除后为 0 时仍给「清除筛选」，P04 不给——**修**：五处一律改为「说明写法同 P13；清除后也为空时不给「清除筛选」」；②WORKPLAN 18 号一条只改了编号、没写 Q5 的内容——**修**；③「条件就是默认且为空时只有标题与「当前筛选：…。」」不在 Q6 原话里——是代码现有行为，也与 P13「条件就是默认时没有按钮」同一写法（默认条件下没有可清除的），保留并写明；④README 没有 18、23、27 号的段落——核对后 18 号（实时推送 `liveHeartbeatMs`）、23 号（「模拟回到通讯录」）、27 号（`t.importAftersales`）都已在「测试」「钉钉」段与命令表里，不改；⑤工作区里 29 号待办、ADR 0008、0013 是 `w/mixed`——索引都是 LF，属于 `core.autocrlf` 下的工作区表现，不改。
- `6811e77` 的部署修复在评审之后：一处 Compose 参数、两行注释，由第三次部署（八步全过）与 lint、deploy:verify 验证。

## 8 待办 33 之后的复核

待办 33（按时关闭与同步滞后，第 6 节的已知问题）提交 `53e1f8b..`（审查基线 `b30ec5b`）。代码的最后一个提交是 `f9f47ba`，之后只有文档（部署记录、待办、本节）；下面的全量检查与两次部署都在 `f9f47ba` 上。

**全量检查**（`f9f47ba`）：

- `pnpm ci:local` 全过：typecheck、lint、工作流语法、迁移与表结构一致（新迁移 0034–0036）、示例数据夹具与 data.py 一致、build、单元测试 99 个文件 898 项、集成测试 50 个文件 589 项（比第 1 节多 1 个文件 10 项：新增 `idle-close-sync.int.test.ts` 9 项、`mail-replay.int.test.ts` 补 1 项）、镜像构建、部署配置检查。
- `pnpm test:e2e`：140 项全过。

**从头部署**：连续两次 `pnpm deploy:staging --reset-inbound`（同一版本 `f9f47bac4afd`），两次都八步全过、冒烟 140 / 140（第二次同一版本重跑，按 `6811e77` 重建容器，没有再出现容器不重建）。第 2 节第一次部署偶发失败的 `ticket-detail.spec.ts:73`（I18 ①）两次都首次通过；部署后开发测试库里 Oliver Grant 的工单没有按时关闭与重开，全库重开 0 次。报告存档 `.scratch/phase1-reporting/33-deployment-20261014.md`。

**第 6 节已知问题的处理**：已修（ADR 0008「待办 33 落地」）。按时关闭前要店铺已开始监听的进线邮箱都已同步到到期时刻（新加的 `channel.mailbox_sync.synced_through`，同步取清单的时刻；上线切换前一律不算，回放不看），且店铺在最近来信与到期之间到达的来信都已归并（入库超过 1 小时仍没归并的不等），否则本轮不关；关闭时把到期时刻存进 `ticket.status_change.due_at`，P05 状态流转直接用它，已有的关闭由迁移 0035 回填。示例回放的交错由同一条规则消除（同步完成前、逐封归并期间都挡住），没有另改 worker 的启动顺序。

**仍需真实环境的**（转 29）：真实 Gmail 下别名能否 watch——不能 watch 的别名不挡按时关闭（它开始监听后只收之后的信），能 watch 但同步一直失败的会挡住该店铺的按时关闭直到恢复（P18 同时显示连接异常）；真实环境里按时关闭比到期晚几分钟（等每 5 分钟的轮询）是预期的。

## 9 163 企业邮箱通道（34–36）复核

用户 2026-10-15 新增「163 企业邮箱通道」（PRD v2.37 D-28：与 Gmail 并存、第一期只收信、授权码在 P18 填）：待办 34 改 PRD、原型与 ADR 0015（`b8192cf..6aefa7a`），35 做后端 IMAP 收信（`181d1fd..4acbdc8`），36 做 P18 界面并做这次复核（`4acbdc8..`）。36 的代码最后一个提交是 `98ea154`，之后只有文档（部署记录、待办、本节）；下面的全量检查在 `89f1cdf`（之后的 `99eee9d` 只加截图，`cea78d7`、`98ea154` 只改 e2e 的用例时限：`98ea154` 撤回 `cea78d7` 的逐条放宽，改为在 Playwright 配置里只对冒烟放宽），两次部署都在 `98ea154` 上。

**全量检查**：

- `pnpm ci:local` 全过：typecheck、lint、工作流语法、迁移与表结构一致（34–36 新迁移只有 35 的 0037–0039）、示例数据夹具与 data.py 一致、build、单元测试 100 个文件 940 项、集成测试 51 个文件 610 项、镜像构建、部署配置检查。第一次跑在最后一步「部署配置检查」失败：`8a54841`（开发测试环境可按 IP 访问）给 Caddyfile 加了 `default_sni {$SITE_DEFAULT_SNI}`，`deploy/verify.mjs` 校验时没传这个变量；协调者授权在 `89f1cdf` 修（另加按 IP 访问的一次校验）后全过。
- `pnpm test:e2e`：146 项全过（比第 8 节多 6 项：新增 `qiye163.spec.ts`）。

**从头部署**：连续两次 `pnpm deploy:staging --reset-inbound`（同一版本 `98ea154`），两次都八步全过、冒烟 146 / 146。在这之前共部署 5 次（经过见部署存档）：冒烟两次 146 / 146，两次各有 1 条用例超过 Playwright 默认的 30 秒用例时限（`exchange-rates.spec.ts:64` 33.7 秒、`ledger-states.spec.ts:560` 33.1 秒），一次因本机 docker 当前上下文被 Docker Desktop 切到 `desktop-linux` 构建失败（切回 `remote`）。冒烟偶发查明是测试写法与环境：没有哪一步卡住，是远端 2 GB 主机里跑浏览器时快时慢，台账与汇率这类整条流程在那里要 18–34 秒、登录后等顶栏近 5 秒，压着默认的 30 秒用例时限与 5 秒断言等待（35 号存档里的 `ledger.spec.ts:31` 同一原因，那里 29 秒多）；另有两条台账用例在 5 秒撤销浮层里做了多余的远端往返。改法：撤销窗口里不做多余往返（`95e1201`），Playwright 配置只对冒烟（`E2E_BASE_URL`）把用例时限放宽到 60 秒、断言等待到 10 秒（`98ea154`），本机照默认；产品的 5 秒撤销窗口与 PRD 口径不变。报告存档 `.scratch/phase1-reporting/36-deployment-20261015.md`。部署前核对过开发测试库：店铺的数据来源都是「模拟数据」，没被改动。

**PRD 13.6 受影响的验收条目**（D-28 后口径对 Gmail 与 163 企业邮箱都成立的，与新增的 AC-P1-23–25）：

| 编号 | 内容（简） | 结果 | 依据 |
|---|---|---|---|
| AC-P1-23 | 管理员把 Forcome Auto 的 amz-auto@forcome.com 设为 163 企业邮箱、填授权码，按行测试连接，保存 | ✅（Fake IMAP） | e2e `qiye163.spec.ts`「K8 …」「登记 163 企业邮箱 …」（行内「连接正常：收件箱与「已发送」均可访问」、保存后只写「已保存」、页面无密码框）；集成 `qiye163-mail.int.test.ts`「示例的授权码已加密存库：店铺接口只写「已保存」…」「重新填写授权码：审计「编辑店铺」只写「已重新填写」…」；`p27-copy.test.ts` 摘要与 K18 一致；截图 `36-k8-qiye-saved.png`。寄到该邮箱的买家消息建工单：集成「收件箱来信：IDLE 收到新信即同步，…归并成工单」与示例回放（P04 有 Forcome Auto 的工单） |
| AC-P1-24 | 163 企业邮箱的「已发送」同步到 `In-Reply-To` 指向来信的回信 | ✅ | 集成「「已发送」里的回复（In-Reply-To 指向来信）每 5 分钟检查时收到，识别为首次回复，工单转等客户，首次回复时间 = INTERNALDATE」 |
| AC-P1-25 | 授权码失效，同步连续 3 次登录失败；重新填写后恢复 | ✅（Fake IMAP） | 集成「授权码失效：登录连续失败到 3 次为连接异常——卡片、全站横幅、管理员与客服主管的通知、审计」「管理员在 P18 重新填写授权码：立即重连并补拉…收到「163 企业邮箱已恢复」」；e2e 卡片连接异常与恢复指引、全站横幅（接口桩）；截图 `36-p18-qiye-error.png` |
| AC-P1-02 | 工单待回复，「已发送」同步到回信 → 等客户 | ✅ | Gmail 照旧（第 3 节）；163 企业邮箱同 AC-P1-24 |
| AC-P1-11 | P17「更新于」取最旧的同步（含 163 企业邮箱 10:17） | ✅ | `report/tickets.ts` 的 `updatedAtOf` 读全部进线邮箱的同步记录（`mailboxHealths` 不分服务商）与两种订单，取最旧；没有专门的 163 企业邮箱集成用例（函数注释仍写「Gmail 邮箱」，口径以代码为准，留作文字小修）；截图 `36-p17-reports-admin.png`「数据来源：工单（店铺邮箱）、平台订单、登记台账 · 更新于 …」与参照图逐字一致 |
| AC-P1-13 | 近 90 天邮件回放 | ✅ | 集成「回放命令：163 企业邮箱的收件箱与「已发送」按邮件时间回放…回放期间不发通知」「切换完成前只监听不入库」；`mail-replay.int.test.ts` |
| AC-P1-16 | 新增进线邮箱后未归属来信自动归位 | ✅ | 不分服务商（入库之后与服务商无关，ADR 0015）；e2e `unassigned-mail.spec.ts` 与第 3 节同 |
| AC-P1-20 | P27 的可见范围与「已隐藏」 | ✅ | 不变；163 企业邮箱的审计对象与摘要见 AC-P1-23、25 |
| AC-ST-01 | 新增店铺校验（K8） | ✅ | 改为逐行登记后照常一次列全、定位到第一个错误；e2e `stores.spec.ts` 3 项、`qiye163.spec.ts`（授权码、端口的错误写在该行的输入框下） |

**仍需真实环境的**（转 29，36 号在 29 的 Comments 补了 ⑬–⑯）：真实网易企业邮箱的按行测试与五种行内结果、保存后不回显、改服务器要重填、授权码失效到恢复的整条链路（AC-P1-23、25 的真实环境部分）。

**留意**：开发测试环境此时公网可访问（`HTTPS_BIND=0.0.0.0`），店铺的数据来源曾被人在 P18 改成「真实接口」（35 号存档）；本机 docker 当前上下文会被 Docker Desktop 改回 `desktop-linux`，部署前看一眼 `docker context show`（本机这台的情况，不写进 README）。
