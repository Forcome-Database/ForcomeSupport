# 34: 163 企业邮箱通道的 PRD、原型与 ADR

Status: resolved
Blocked by: None (can start immediately)

规格：[第一期：报表与台账](../spec.md)

**What to build:** 用户 2026-10-15 决定新增「163 企业邮箱」（网易企业邮箱）通道。现在 PRD、原型、ADR、规格只认 Gmail（Google Workspace 服务账号 + 全域委派 + Pub/Sub），本票先把文档与原型改到位（CLAUDE.md：先改原型与 PRD，再改代码），给 35（后端收信）、36（P18 界面）当依据。本票不改应用代码。

用户口径（2026-10-15，三问三答，记为新决策，例如 D-28）：

- **与 Gmail 并存**：每个进线邮箱各自选服务商（Gmail / 163 企业邮箱）；已做好的 Gmail 保留，收信层与服务商无关。渠道（亚马逊 / Shopify / 邮件）的含义不变，只是「经 Gmail 收发」改为「经店铺进线邮箱（Gmail 或 163 企业邮箱）收发」。
- **第一期只做收信**：163 邮箱的收件箱与「已发送」、连接状态与告警、上线时近 90 天的历史回放与 T0 切换，与 Gmail 同口径；SMTP 发信随第二期与 Gmail 发信一起做（写进第二期规格）。
- **授权码在 P18 界面里填**：管理员在「设置 · 渠道与店铺」给 163 邮箱填客户端授权码（加密存库、只写不显，已保存时只显示「已保存」并可重新填写），可点「测试连接」。

协调者给的技术方向（写进新 ADR，35 实现时可按技术判断调整并写回）：

- 163 企业邮箱只有 IMAP / SMTP（没有公开的收信 REST API 与推送）。收信用 IMAP：IDLE 长连接 + 每 5 分钟轮询兜底，全部主动连出，符合 ADR 0003（零入站）；网易是境内服务，按分流规则直连，`NO_PROXY` 加网易企业邮箱的域名。
- 服务器因企业所在机房不同（`imap.qiye.163.com`、`imaphz.qiye.163.com`、海外 `hwimap.qiye.163.com` 等），所以 IMAP 服务器与端口可填，默认 `imap.qiye.163.com:993`（SSL）；登录名是完整邮箱地址，口令是客户端授权码（不是登录密码）。网易后台要由管理员开启 IMAP 并允许客户端登录，可能有 IP 登录限制（`ERR.LOGIN.IPDENY`）——这些是 32 号的先决条件。
- 增量：收件箱与「已发送」各一组 UIDVALIDITY + UID 游标（文件夹按 SPECIAL-USE `\Sent` 识别，兜底中文名「已发送」）；UIDVALIDITY 变了等同 Gmail 游标过期，按到达时间区间补拉（IMAP `SEARCH SINCE/BEFORE` 只到日期，取回后按 INTERNALDATE 再筛）。
- 到达时间用 IMAP INTERNALDATE（对应 Gmail `internalDate`）；去重按「邮箱 + 服务商消息标识」；回复识别对 163 只用 In-Reply-To / References（没有 Gmail 线程那一顺位）；方向按文件夹（「已发送」为发出）。
- 凭据按邮箱加密保管（现有保管箱的键是「系统 × 店铺」，不够），只写不读回界面；审计记「改了授权码」不记内容。

要改的地方（调研结论，行号以当前文件为准，逐处核对）：

- **PRD**（`design/spec/prd_*.md`，`build_prd.py` 重新生成）：1.4 渠道术语与 1.5 系统边界（`prd_a.md:139-140`、`:171-172`）、D-14 的写法、F-CH-01/02（`prd_a.md:211-212`）、SC-08（`:203`）；6.9 连接状态（`prd_b.md:397`）、R-TK-07 去重、R-SL-08 计时与回复匹配（`prd_b.md:415`、`:429`）；E-02 恢复方式（`prd_d.md:6`）；11.1 Store / Message 对象（`prd_d.md:107`、`:112`）、11.3 集成表加一行「163 企业邮箱 · IMAP（第一期收信）/ SMTP（第二期发信）」、11.4 通知文案按服务商（`prd_d.md:189`）；P18 页头与渠道卡、K7、K8、K20、G4（`prd_c.md:372-388`、`:637-663`）；第 14 节历史回放；新增决策与必要的待确认项（例如网易是否写 Delivered-To、别名如何落箱）；版本号 +1。
- **原型**（`design/spec/pages/build_settings.py`、`build_states_admin.py`、`design/spec/data.py`，再跑 `shot_phase1.py` 刷新 `design/spec/shots/phase1/` 的 P18 相关参照图）：
  - P18 渠道卡：保留 Gmail 卡，另加「163 企业邮箱」卡（同一种卡片结构：连接状态、邮箱数、最近同步、测试连接），K20 第一阶段形态同步改。
  - K8 店铺抽屉：「进线邮箱」从标签输入改为逐行登记——地址、服务商（Gmail / 163 企业邮箱）；163 的行另有授权码（密码框；已保存显示「已保存 · 重新填写」）、IMAP 服务器（默认 `imap.qiye.163.com`）、端口（默认 993）、「测试连接」。具体布局用设计规范板与现有组件拼，不自创样式。校验：地址不能同时登记在两个店铺（原规则不变）、163 新增时授权码必填。
  - K7 渠道断开、G4 横幅、测试连接浮层的文案按服务商区分（Gmail 的「检查全域委派」与 163 的「检查授权码 / 客户端登录是否开启」）。
  - 示例数据：至少一个示例店铺的进线邮箱用 163 企业邮箱（例如某个 Shopify 店铺），原型、示例数据夹具（35 落地）与截图一致。
  - `EmailFlow`、`Architecture` 画板的「客服邮箱 Gmail」改为 Gmail / 163 企业邮箱。
  - `build_canvas.py --seed` 需要 design 技能的环境，本机跑不了的话在 Comments 写明，留给用户。
- **ADR**：新开 ADR 0015「邮箱服务商抽象与 163 企业邮箱 IMAP 收信」（上面的技术方向）；修订 0002（来信收发的记账方）、0003（网易直连、`NO_PROXY`）、0008（同步记录、游标、区间补拉、回放与服务商无关的说法）、0009（邮箱客户端按邮箱选服务商、凭据按邮箱保管）。
- **规格**：第一期规格补「163 企业邮箱收信」的实现契约（模块职责与接口、数据约定、测试接缝：Fake IMAP 与 Fake Gmail 同一套示例回放）；第二期规格（`.scratch/phase2-aftersales/spec.md`）补 163 发信走 SMTP、「已发送」是否自动留存（不留存时 IMAP APPEND）、结果不明时按 Message-ID 在「已发送」搜索确认。`CONTEXT.md` 的同步记录、区间补拉、水位、游标等术语改成与服务商无关。`docs/agents/prototype.md` 若对照有变一并改。
- **衔接待办**：32 号补「163 企业邮箱：管理员开启 IMAP/SMTP 与客户端登录、各进线邮箱生成客户端授权码、确认服务器机房地址、IP 登录限制放行服务器出口 IP」；29 号补真实环境核对点（IDLE 是否可用与掉线重连、「已发送」文件夹识别、Delivered-To 与别名落箱、授权码失效时的连接异常与恢复、近 90 天历史回放）。

- [x] PRD 按上面各处改完，新增决策记下用户口径，版本号 +1，`build_prd.py` 生成无误
- [x] 原型 P18、K7、K8、K20、G4、测试连接浮层与示例数据改完，`design/spec/check.py`（若有）通过，P18 相关第一期参照图刷新
- [x] 新开 ADR 0015，修订 0002、0003、0008、0009
- [x] 第一期规格补实现契约，第二期规格补 163 发信，`CONTEXT.md` 术语改为与服务商无关
- [x] 32、29 号补上 163 的先决条件与真实环境核对点
- [x] PRD、原型、规格、待办四方对照一遍，没有遗留「只经 Gmail」的说法（历史记录与已结算待办的 Comments 不改）

## Comments

- 2026-10-15（实现记录）

  **环境**：原型脚本用 `uv run --python 3.11 --with playwright --with pillow --with markdown` 跑（本机没有全局 Python）；跑 lint、单测时把 `C:\Users\User\tools\pgsql\bin` 加进 PATH；e2e 用本机 PostgreSQL 18（4520）。本票不跑集成测试与部署（协调者给的第 5 步替代）。

  **产出**（`git diff b8192cf..HEAD`）：PRD v2.37（新增 D-28 记下用户三项口径；1.4 补「进线邮箱」「邮箱服务商」「客户端授权码」；1.5、SC-08、F-CH-01/02、5.1、6.9、R-TK-07、R-SL-08、E-01、E-02、E-04、11.1、11.3、11.4、14、Q-01、P05、P17、P22、P26、P27 改为与服务商无关；P18 页头、渠道卡、店铺表、抽屉、操作、校验、第一阶段；K7、K8、K19、K20、G4；新增 AC-P1-23–25、Q-27）；原型（`data.py`、`build_settings.py`、`build_states_admin.py`、`build_ds.py`、`build_prd.py` 系统边界图、`build_canvas.py` 画布说明、手写的 `EmailFlow`、`Architecture` 画板）；ADR 0015（新开）与 0002、0003、0008、0009、0013 的修订；第一期规格「163 企业邮箱收信」实现契约与其余写法；第二期规格 SMTP 发信；`CONTEXT.md`；`docs/agents/prototype.md`；`design/spec/WORKPLAN.md`；29、32 号追加；35、36 号 Comments 衔接。

  **设计取舍**（「已确认方向下的原型设计」，请协调者验收后交用户过目）：
  1. **示例 163 企业邮箱用 Forcome Auto 的 `amz-auto@forcome.com`**（亚马逊店铺），不用 Shopify 店铺：示例数据夹具导出的字段与 Gmail 的示例（异常、延迟、横幅、通知、P27 都是 support@forcome.mx）一个都不用动，`fixtures:verify` 照样通过；而且它正好覆盖「亚马逊买家消息经中转到 163 企业邮箱」与只按 `In-Reply-To` / `References` 识别回复。代价：K20「几个邮箱同时异常」原来用 amz-auto@forcome.com 作 Gmail 邮箱，换成 amz-direct@forcome.com。
  2. **P18 第一阶段渠道卡仍是 3 × 2**：加了「163 企业邮箱」卡后共 7 张，第三行会把店铺表挤出 900 高，所以把两张「第二阶段接入」虚线卡（积加、易仓）合成一张「积加 ERP · 易仓海外仓」，说明沿用原来两张卡的两句。完整版 P18 是 8 张，第三行原来就有空位，不合卡。
  3. **163 企业邮箱卡**与 Gmail 卡同一种结构（卡名、最近同步、连接状态、测试连接、说明行「1 个邮箱：1 个亚马逊买家消息」「收件与「已发送」：识别到我方回复即转等客户」），图标用现有的 `inbox`（Gmail 是 `message`），便于区分；异常写法套用 Gmail 卡，恢复指引按服务商：「请检查客户端授权码，以及网易企业邮箱是否开启 IMAP 与客户端登录」。
  4. **店铺表**进线邮箱下一行写「用途 · 服务商」（例「亚马逊买家消息 · 163 企业邮箱」），状态列的连接名写服务商（「163 企业邮箱 · SP-API」）。
  5. **K8 进线邮箱改为逐行登记**：每行「地址输入框 + 服务商下拉（132px）+ 移除」，末尾「添加进线邮箱」，新加的行默认 Gmail；163 企业邮箱的行下方展开一块浅底面板（`T['subtle']` 底、`T['line']` 边、8px 圆角，同 StatesInbox 已有的面板写法）：客户端授权码（新填时密码点、提示「不是登录密码：…保存后不再显示」；已保存时只读框「🔒 已保存」+「重新填写」；为空报「请填写客户端授权码」）、IMAP 服务器与端口（预填默认值、可改）、第二阶段起另有 SMTP 服务器与端口、「测试连接」（次要按钮）与行内结果。重复与格式错误从原来的「标签变红 + 字段下方多行错误」改为写在出错的那一行下方。只用 `ui.py` 现有组件（`input_box`、`select_box`、`icon_btn`、`btn`、`link`、`field`）与令牌，没有新组件。
  6. **按行「测试连接」不保存也能测**（用这一行当前填的内容，授权码没重填时用已保存的），结果五种：连接正常 / 登录失败（授权码或客户端登录）/ 登录被拒（IP 限制）/ 连不上服务器与端口 / 找不到「已发送」（`data.QIYE_ROW_TESTS`）；测试不改连接状态。渠道卡的「测试连接」测该服务商全部邮箱，浮层写法同 Gmail。
  7. **审计**：改授权码只写「进线邮箱 amz-auto@forcome.com：客户端授权码已重新填写」（K18 补充小样加了这一行，所以 K18 小样的计数由 5 条变 6 条）。
  8. **找不到「已发送」不算连接失败**：收件箱照常入库、记同步成功，只记警告日志（不出「来信暂存」的横幅），见 ADR 0015。
  9. **随口径一起改的其他页面文字**（不改业务含义）：P17 数据来源「工单（Gmail）」→「工单（店铺邮箱）」、「更新于」取各进线邮箱；P22「回复客户」的适配器写「店铺邮箱 · 中转 / 店铺邮箱」；P26 数据源 Gmail 3 个、163 企业邮箱 1 个；Shopify / 亚马逊卡的「来信经 Gmail 照常收取」→「来信照常收取」；G4 规格文字与 K7 改为 Gmail 与 163 企业邮箱各一条横幅、各一张异常卡。

  **协调者决定 Q1（2026-10-15，选 B）**：原型改动让 apps/web 的「原型守卫」测试（`p18-copy.test.ts`、`p17-copy.test.ts`）红 7 项。按协调者决定，本票同时把纯文案常量与测试跟上原型，不改接口、行为、数据与组件结构：`apps/web/src/pages/settings/p18-copy.ts`（页头说明、「卡片状态按店铺计算」全文、Shopify 与亚马逊卡的 `held`、注释）、`apps/web/src/pages/reports/p17-copy.ts`（`SOURCES`）；测试里配合原型示例的输入：`p18-copy.test.ts`（Gmail 卡 1 + 2 个邮箱、多邮箱异常示例 amz-direct@forcome.com、测试连接 3 个邮箱）、`p27-copy.test.ts`（K18 小样 6 条）、`channel-card-lines.test.ts` 与 e2e `stores.spec.ts`、`reports.spec.ts`、`channel-status.spec.ts` 里写死的同一句文案。合卡、163 企业邮箱卡、K8 逐行登记等结构仍归 36。协调者另定：以后改原型的票同时把守卫测试与对应的纯文案常量对齐。

  **自写与现成的**：本票只有文档与原型。ADR 0015 定的实现用现成的：`imapflow`（IMAP，Nodemailer 作者维护）、已装的 `postal-mime`（解析）、第二期 `nodemailer`（SMTP）；凭据加密沿用 `sealSecret`。

  **截图与核对**：`shot_phase1.py` 刷新的参照图逐张看过——`design/spec/shots/phase1/P18_Settings.png`（163 企业邮箱卡、合并的第二阶段卡、店铺表服务商）、`design/spec/shots/phase1/P17_Reports.png`（数据来源「工单（店铺邮箱）」），与同次生成的 `design/spec/phase1/P18_Settings.dc.html`、`P17_Reports.dc.html` 一致；其余第一期参照页的 `.dc.html` 不变，重拍的 PNG 只有字体抗锯齿差异，没提交。`check.py` 对 Settings、StatesAdmin、GlobalStates、SettingsActions、SettingsHealth、EmailFlow、Architecture 全部 OK，变了的画板截图（`design/spec/shots/` 下同名 PNG）已更新；K7、K8、K20 的新小样另渲染核对过。`build_canvas.py --seed` 需要 design 技能的环境，本机跑不了，留给用户重新打包画布（`canvas.json` 本来就与几张状态板的高度不一致，一并由 `--seed` 重写，本票没动）。

  **检查**：`build_prd.py` 生成无误；`check.py` 全部 OK；`fixtures:verify` 一致（data.py 只加了不导出的字段）；`pnpm typecheck`、`pnpm lint` 通过；e2e 受影响的三个文件（stores、reports、channel-status）26 项通过；`pnpm test:unit` 99 个文件 898 项中 897 项通过，唯一失败的 `deploy/lib/env-file.test.mjs`「两份模板的变量一一对应」是既有问题（8a54841 只给开发测试环境模板加了可选的 `SITE_IP`，生产模板没有；本票没动 `deploy/`），已报告协调者，不在本票修。

  **code-review（基线 b8192cf，四方对照；规范一轴纳入 ADR 0002、0003、0008、0009、0015）** 发现与处理：
  - 修了：K20「测试连接」浮层仍写「Gmail：4 个邮箱均可访问」（改为按示例数据算，3 个）；ADR 0008 修订的小标题「同步与水位」与新写法「增量位置」偏离术语表（统一为「增量游标」，CONTEXT.md 同步）；ADR 0013 没有指向按邮箱保管授权码的反向指引（加修订）；ADR 0015 改名列没写怎么分步（写明同 ADR 0006 三步）；第一期规格 Problem Statement 与用户故事 25 仍写「4 个店铺邮箱」与只有 Gmail 的收法、切片表第 12 片排在第 11 片前；审计写法在 PRD、规格、ADR 三处措辞不一（统一为「进线邮箱 <地址>：客户端授权码已重新填写」，其余字段照常记前后值）；ADR 0015「找不到「已发送」记一次失败」与 6.9 冲突（改为不计失败、记警告）；`data.HEALTH` 与 `QIYE_ROW_TESTS` 写死邮箱数与服务器（改为按数据与默认值算）；前端守卫测试变红（按协调者决定 B 对齐）。
  - 不改：`qiye_card*` 与 `gmail_card*` 结构相似——与 Shopify、亚马逊卡同一种并列写法，便于逐张对照 PRD；`provider` 存显示文字——原型的示例数据都存显示写法，`contracts` 的取值 `gmail` / `qiye163` 由 35 定；第一期规格「待办 26 落地」一段仍写 `internalDate` 与 Gmail 消息 ID——那是 26 号的落地记录，口径已由上一行的「顺序」与 ADR 0008 修订覆盖；ADR 0015 用 CRLF——仓库约定新建文档用 CRLF（集成验证的换行符修复，7176c0d）；`docs/部署说明.md` 第 12 节「4 个店铺邮箱都在 Google Workspace」不在本票范围，留给 35（它要改部署说明的 `NO_PROXY` 与网易直连）。

  **衔接**：35、36 号的 Comments 写了要用的口径与已在本票对齐的文案；32 号补「163 企业邮箱」先决条件，29 号补真实环境核对项与七条核对点（都只追加）。
