# 09: Gmail 同步健壮性与连接状态

Status: resolved
Blocked by: 05, 08, 31

规格：[第一期：报表与台账](../spec.md)

**What to build:** 收信在真实环境下不丢、不重、可恢复，并让管理员看得见。每天续订 `watch`（不按标签过滤）；每 5 分钟 `history.list` 兜底；「已发送」同步入库（归属识别见待办 16）；游标过期（404）按 `internalDate` 区间全量补拉，补拉完成前「最近同步成功时间」不前移；水位只在持久化成功后推进；常驻 pull 用 advisory lock 选主。渠道连接状态（PRD 6.9）：已连接 / 同步延迟（Gmail 10 分钟、钉钉 2 小时）/ 连接异常（连续 3 次失败）/ 未连接；状态按店铺计算，渠道卡显示最差状态并列出异常的邮箱，店铺表「状态」列显示该店铺的 Gmail 状态（6.9）；连接异常时全站红色横幅（G4，不可关闭，恢复后自动消失，钉钉例外不出横幅），管理员与客服主管收到站内通知（待办 31）与钉钉工作通知（E-01、E-02）；恢复后自动补拉。P18 的 Gmail 卡显示状态、最近同步时间与恢复指引（K7），支持「测试连接」。每次外部调用写调用记录。服务账号 + 全域委派的真实客户端可切换。

- [x] 集成测试（Fake 故障注入）：游标过期 → 区间补拉 → 补拉期间最近同步时间不前移 → 补拉后前移
- [x] 集成测试：某个邮箱连续 3 次失败进入连接异常，横幅接口返回异常，Gmail 卡列出该邮箱，通知发出；恢复后状态回到已连接、横幅消失，管理员与客服主管收到「渠道连接恢复」站内通知
- [x] 集成测试：超过 10 分钟未成功同步显示同步延迟
- [x] 集成测试：「已发送」中的邮件入库并标记方向为我方
- [x] 持久化失败时水位不前进（故障注入）
- [x] P18 Gmail 卡与钉钉卡展示状态与最近同步时间；两张卡都有「测试连接」（K20）

## Comments

- 2026-10-05（待办 07）：P18 的 Gmail 卡与钉钉卡已有骨架（`apps/web/src/pages/settings/channel-cards.tsx`，后端 `GET /api/channel/settings` 的 `channels`）。状态目前只由数据来源决定（`apps/server/src/modules/channel/connections.ts` 的 `statusOf`：模拟数据为已连接、真实接口为未连接，`lastSyncAt` 恒为 null），本待办按同步记录替换它，补上同步延迟、连接异常、最近同步时间与「列出异常的邮箱」；「测试连接」在 07 先隐藏，由本待办加上（K20）；连接异常的卡片底色已按状态写好（`statusCard`）。店铺表「状态」列取 `Store.connections` 的 gmail 一项。
- 2026-10-05（待办 08）：收信的最小形态已就位，本待办在它上面补健壮性。
  - Gmail 客户端在 `apps/server/src/modules/integration/gmail.ts`：邮箱 `gmailClient`（店铺级：`watch`、`listHistory`、`getMessage`）与推送 `gmailPushClient`（全局，`CLIENT_MODE_GMAIL_PUSH`：`pull`、`acknowledge`）。两者的真实现现在是调用即「尚未接入」失败的占位（`realGmail`、`realGmailPush`），服务账号 + 全域委派、Pub/Sub 订阅、出站 HTTP 客户端工厂与调用记录由本待办接入。推送是环境级的，同一环境里店铺有真有假时只能二选一，另一类靠本待办的每 5 分钟兜底。
  - 收信流程在 `apps/server/src/modules/channel/gmail-sync.ts`：常驻拉取 `channel.gmail_push` 每轮先给没有游标的进线邮箱 watch（`channel.mailbox_sync`，失败按进程内退避重试），再拉通知、按邮箱排 `channel.gmail_sync`（stately + singletonKey）；同步任务 history.list → messages.get → postal-mime 解析 → 入库，全部入库后才推进游标（已是「水位只在持久化成功后推进」，本待办补故障注入测试）。要补的：每天续订 watch（`mailbox_sync.watch_expires_at` 已存）、每 5 分钟 history.list 兜底（排 `channel.gmail_sync` 即可）、`listHistory` 抛 `CursorExpiredError` 时按 internalDate 区间补拉（Fake 还没有区间查询，要在 `FakeGmail` 里加）、「已发送」入库（`directionOf` 已把 SENT 判为 outbound，`syncMailbox` 现在跳过）、最近同步成功时间与连接状态（替换 `connections.ts` 的 `statusOf`，也可替换 watch 失败的进程内退避）、常驻拉取的 advisory lock 选主（`core/feeds.ts`）。
  - Fake 的 watch 到期时间按最后一封信推算（Fake 没有时钟），做续订时按需改成可注入时间。
  - 测试写法见 `apps/server/test/inbound-to-ticket.int.test.ts`：灌店铺后先 `t.runJobs()` 一次（开始监听），再 `t.clients.fake(gmailClient).deliver(…)`；`t.runJobs()` 会先拉 Fake 推送。
- 2026-10-05（待办 20 留下的衔接）：出站 HTTP 客户端工厂已在 `apps/server/src/modules/integration/http.ts`（`createHttpClient(系统)`：进程共用 undici `EnvHttpProxyAgent`、调用时限、错误翻译成 `faults.ts` 的那一套，测试经参数换 undici `MockAgent`），第一个用它的是汇率客户端。按「系统 × 接口」的限流与每次外部调用的调用记录（系统、动作、店铺、耗时、状态码、请求与响应摘要）由本待办加在这个工厂里——汇率客户端（`integration/exchange-rate.ts`）也经它，加上后自然有记录。Gmail 的服务账号令牌与 googleapis 若不走 fetch，也要接到同一组代理变量与调用记录上（ADR 0009「待办 20 落地」修订）。

- 2026-10-06（待办 31）：渠道连接异常与恢复的站内通知：在连接状态变为「连接异常」/ 恢复为「已连接」的事务里调 `org` 的 `notifyMembers(tx, { type: 'channel_disconnected' | 'channel_recovered', title, body, object: { type: 'channel', id: 'gmail', label: 'P18 · Gmail' } })`，接收人是在职的管理员与客服主管（11.4）；照原型 G10 的写法：标题「Gmail 连接异常」「Gmail 已恢复」，说明「support@forcome.mx 连续 3 次失败，来信暂存」「support@forcome.mx 已重新连接，补拉 3 封来信」。这两种按角色发给全部，**不要传 `storeId`**（传了会按接收人的店铺范围在查询时隐藏）。连接异常另发钉钉工作通知（05 的能力）给 `notifyMembers` 返回的接收人。客服主管打不开 P18，点这类通知只标为已读（`apps/web/src/lib/notifications.ts` 的 `notificationTarget`）。产生通知后 e2e 可改用真实的故障注入，现在用的是示例通知接口。

- 2026-10-06（待办 05）：
  - 常驻拉取的选主已在 `core/feeds.ts`：`defineFeed(名, 拉取, { exclusive: true, release })`，多个 worker 时会话级咨询锁选主、持有者断线自动交还（ADR 0008「待办 05 落地」）。Gmail 推送要不要独占由本待办定，改一个选项即可（测试见 `core/feeds.int.test.ts`）。
  - 连接状态的规则在 `contracts` 的 `syncConnectionStatus` 与 `SYNC_DELAY_MS`（Gmail、订单 10 分钟，钉钉 2 小时；连续 3 次失败为连接异常；从没成功过为未连接），钉钉卡已按它出状态与最近同步时间（`org` 的 `dingtalkConnection`）。P18 钉钉卡在同步延迟、连接异常时的说明行（原型 K20 / `build_settings.py` 的钉钉卡：「通讯录 08:00 后未同步成功，超过 2 小时」「只提醒管理员，不出全站横幅；成员与部门保持上次结果，登录与权限不受影响」）由本待办随卡片展示一起做。
  - 全站横幅（G4）跟着「渠道连接异常」：钉钉同步失败是另一种通知（`dingtalk_sync_failed`），横幅接口不要算它（6.9 钉钉例外）。
  - `org` 的 `notifyMembers` 现在对 11.4 渠道里有钉钉的类型（`channel_disconnected`）自动排入钉钉工作通知，**不要另发**（取代待办 31 留言里「另发钉钉工作通知」的说法）；测试里推进 5 分钟后 `t.enqueue(sendWorkNotificationsJob, {})` 再 `t.runJobs()`，看 `t.clients.fake(dingtalkClient).sent`（`apps/server/test/work-notifications.int.test.ts`）。
  - 出站 HTTP 客户端工厂多了 `postJson`，进程共用的出站连接 `outboundDispatcher` 已导出（钉钉 Stream 的 WebSocket 用它）；限流与调用记录仍由本待办加，钉钉的调用也经这个工厂。钉钉卡的「测试连接」可在 `org` 加一个取根部门（`getDepartment('1')`）的检查。

- 2026-10-06（待办 09 实现记录）

**业务口径（2026-10-06 用户确认 Q1–Q6，全部按建议；E1–E4 协调者 2026-10-06 决定，均为已确认写法在边界上的套用）**

- Q1 全站横幅：K7 统一到 G4 写法——标题「Gmail 连接中断，来信暂存队列」，说明「09-11 10:05 起未收取。恢复后自动补收，按到达顺序处理，SLA 从原到达时间计算。管理员、客服主管已收到通知。」（时刻为连续失败的第 1 次），不写邮箱；「查看渠道状态」只对管理员显示。
- Q2 Gmail 卡连接异常（第一期）：每个异常的邮箱一行「<邮箱> 访问失败（10:05 起连续 3 次）：请检查全域委派范围与邮箱状态」，再写「该邮箱来信暂存，恢复后自动补拉」，卡底「重新检测」；不写「回复进入待发队列」、没有「查看错误日志」。
- Q3 Gmail 卡同步延迟：每个延迟的邮箱一行「<邮箱> 10:05 后未同步成功，超过 10 分钟」，其余说明行照常。
- Q4 测试连接：G5 浮层——成功「连接正常」+「Gmail：4 个邮箱均可访问」/「钉钉：通讯录可访问」；失败「测试连接失败：support@forcome.mx 无法访问」+「请检查全域委派范围与邮箱状态」（钉钉「测试连接失败：钉钉通讯录无法访问」+「请检查应用凭据与通讯录权限」）；测试中按钮置灰转圈；不改状态，Gmail 测完立即同步一次。
- Q5 渠道审计：记「连接异常」「恢复连接」，展开字段照 AUDIT_P27_EXPAND（状态、最近同步成功、补拉、触发）；测试连接不记审计。
- Q6 钉钉卡连接异常：「通讯录 08:00 后未同步成功，连续 3 次失败」+ 与同步延迟相同的后两行。
- E1 恢复时一封也没补拉到：照写「补拉 0 封来信」（通知与审计摘要）。E2 卡上写实际的连续失败次数，通知固定写转异常时的「连续 3 次」。E3 几个邮箱同时异常：每个一行、暂存说明只写一次、异常在前延迟在后，横幅不写邮箱、时刻取最早。E4 从没同步成功过：钉钉「通讯录尚未同步成功，连续 3 次失败」。
- 回写：原型 K7 横幅、K20 补充小样（`design/spec/pages/build_settings.py` 的 `gmail_card_p1`、`dingtalk_card(err=…)`，`build_states_admin.py` 的 `k20()`，`data.py` 的 `GMAIL_ISSUE` 等），重新生成 StatesAdmin 与截图、PRD 页面；第一期参照图无变化（`python shot_phase1.py` 9 张 OK）。PRD v2.25（6.9、P18「第一阶段」、K7、G4、P27「第一阶段」、11.4 渠道连接异常与恢复的写法、变更记录），WORKPLAN 记一条。文案收进文案模块并读原型生成物逐字核对：`p18-copy.ts`（`GMAIL_ISSUE_LINES`、`DINGTALK_ISSUE_LINES`、`CONNECTION_TEST`）、`components/channel-alert-copy.ts`、`channel/gmail-copy.ts`、`contracts/audit-describe.ts`。

**我定的技术口径**（写进 ADR 0003、0007、0008、0009「待办 09 落地」修订）

- 连接状态按每个进线邮箱的同步记录（`channel.mailbox_sync` 加最近同步成功、连续失败、失败起点、原因、补拉区间）：店铺取其邮箱中最差，Gmail 卡取全部邮箱中最差并列出延迟与异常的邮箱，卡上「最近同步」取各邮箱中最旧的一次（同报表「更新于」）。模拟数据的店铺同样按真实同步记录算。
- 「一次失败」：watch、续订、同步的外部调用失败各算一次，同步任务每次重试都算——重试 60 秒起翻倍，持续约 3 分钟的故障才满 3 次。我们自己的错误（入库、解析）不算连接失败但游标不前进，10 分钟后显示同步延迟。没配置 Google 凭据（`ClientNotConfiguredError`）不算失败，状态为未连接（6.9：还没接通）。
- 连续第 3 次失败（只在正好第 3 次）同一事务里通知管理员与客服主管（钉钉工作通知由 `notifyMembers` 按 11.4 自动排）并记审计；之前已是连接异常、再同步成功即恢复，发「Gmail 已恢复 · 补拉 N 封来信」（N 为新入库的来信，含归档的平台通知，不算别的邮箱已收过的副本）并记审计。
- 游标过期：先 `getProfile` 取新游标，再按 internalDate 从上次成功前 1 小时起 `messages.list` 补拉，全部入库后一个事务里换游标、记成功；中途失败下次接着补，补拉完成前最近同步时间不前移。
- 推送拉取改独占（咨询锁选主）；每 5 分钟兜底（worker 启动时也一次）；每天 03:00 续订 watch（不按标签过滤、不动游标）。「已发送」入库为方向 outbound、店铺为发件邮箱的店铺，不发事件（回复识别随 16）；Message-ID 判重按方向分开（迁移 0022 改唯一索引）。已被删除的邮件（messages.get 404）跳过。
- 「重新检测」与「测试连接」同一个接口：能访问但开始监听还在退避的邮箱当场 watch（写游标用 coalesce，与 worker 并发安全）。
- 出站工厂：按「系统 × 接口」限流（p-throttle，进程级共用；Gmail 每个接口每秒 20 次，汇率、钉钉暂不限——汇率每天一次、钉钉另有月度配额，积加与 17TRACK 随第二期配）；每次调用写 `integration.call_record`（请求摘要写方法与地址、查询参数里像凭证的值换成 ***；换令牌、扫码换用户凭证、钉钉 Stream 票据的响应体不记）。表没有清理策略，量大了随待办 28 的运维定。
- Google 凭据：`GOOGLE_SERVICE_ACCOUNT_KEY_FILE`、`GMAIL_PUBSUB_TOPIC`、`GMAIL_PUBSUB_SUBSCRIPTION` 三项要么都填要么都不填（只填一部分拒绝启动；都不填照常启动，生产也一样，Gmail 为「未连接」——验收返工改正，见文末「验收返工」）；Compose 把密钥目录 `GOOGLE_KEY_DIR` 只读挂到 `/run/forcome-keys`（`docs/部署说明.md` 第 12 节）。

**交付了什么**

- 后端：`channel/gmail-sync.ts`（独占推送拉取、`channel.gmail_poll`、`channel.gmail_renew_watch`、区间补拉、「已发送」、测试连接）、`mailbox-health.ts`（同步记录、异常与恢复的通知与审计）、`connections.ts`（店铺、卡片、横幅的状态）、`gmail-copy.ts`；接口 `GET /api/channel/alerts`、`POST /api/channel/connection-tests/{gmail|dingtalk}`；`org` 的 `checkDingtalkDirectory`；迁移 0022（同步记录列、调用记录表、Message-ID 唯一索引）。
- integration：`gmail-real.ts`（Gmail REST 与 Pub/Sub 一元 pull 的真实现）、`google-auth.ts`（服务账号 JWT 换令牌）、`http.ts`（限流、调用记录、表单 POST）、`call-records.ts`、`faults.ts` 的 `ClientNotConfiguredError`；Fake Gmail 加 `send`、`profile`、`listMessages`；`core/config.ts` 读 Google 凭据。
- contracts：`channelIssueSchema`、`channelAlertsSchema`、`connectionTestResultSchema` 与文案、渠道审计快照与写法。
- 前端：P18 Gmail / 钉钉卡的异常说明行（`channel-card-lines.ts`）、两张卡的「测试连接」、Gmail 卡「重新检测」；全站横幅 `components/channel-alert-banner.tsx`（`AppShell` 顶栏下方）；P18 与横幅每分钟重取。
- 部署与文档：Compose 与 `.env.example`、部署说明第 5、12 节、ADR 四份修订、规格「先例」、README「Gmail」、CONTEXT（同步记录、区间补拉、调用记录）。

**关键取舍**

- 卡上的「最近同步」取各邮箱中最旧的一次，而不是最新：与报表「更新于」同口径，不会因为一个邮箱刚同步就掩盖别的邮箱落后。
- 恢复判定用「之前连续失败 ≥ 3 次且这次同步成功」，通知与审计在记成功的同一事务里，重试不会重复发。
- 测试连接不改状态（Q4），但排同步、当场 watch 退避中的邮箱，管理员修好配置后不用等。
- 失败计数以同步任务的每次尝试为单位，不另做「一个时间窗算一次」：口径简单、和钉钉一致（每次对账算一次），靠重试间隔控制灵敏度。

**自己写而没用现成库的部分**

- Gmail / Pub/Sub 的调用没用 `googleapis`、`@google-cloud/pubsub`，令牌没用 `google-auth-library`：它们走自己的 gaxios / gRPC，不经出站工厂的代理分流（EnvHttpProxyAgent、NO_PROXY）与调用记录（ADR 0009「待办 20 落地」要求所有外部调用经工厂）；我们只用 6 个 REST 接口与一次 JWT 换令牌，自己写的只有 URL、zod 校验与错误翻译。JWT 签名用 `jose`，限流用 `p-throttle`（都是新加的依赖）。
- 渠道卡说明行、横幅都是业务拼装，没有可用的库。

**组件库带来的细微视觉差异**（由我定，汇总给用户过目）

- 开发测试环境的卡头比原型多一枚「模拟数据」标签（K20 小样里已有这种写法），卡头一行更挤；真实环境没有。
- 「测试连接」用 `Button` 的 `text-link` 变体，比原型 `btn('测试连接','link','sm')` 少一点水平内边距；转圈时文字前多一个 14px 的转圈图标。
- 全站横幅出现时页面内容整体下移，P18 在 1440 × 900 下要滚动才看到全部店铺（原型的 K7 是局部图，没画整页）；属真实数据比示例长的情况。
- 失败浮层标题较长时换成两行（「测试连接失败：support@forcome.mx 无法访问」），原型的浮层宽度相同、也是两行。
- 亚马逊、Shopify 卡没有「最近同步」与「测试连接」（订单同步随 11、12），与第一期参照图不同，07 号待办起就是这样。

**截图与逐项核对**（1440 × 900，`.scratch/phase1-reporting/shots/`；本机开发服务 api 4516 + worker + 前端 4517，示例数据夹具，演示时刻 2026-09-11 10:20；卡片的异常状态用接口桩换成原型示例值，截图脚本在本会话临时目录）

- `09-p18-settings.png` 对照 `design/spec/shots/phase1/P18_Settings.png`：页头、渠道连接区（3 × 2）、Gmail 卡「最近同步 10:18 · 已连接 · 测试连接」与两行说明、钉钉卡「最近同步 08:00 · 同步延迟 · 测试连接」浅黄卡与三行说明（逐字一致）、积加与易仓虚线卡、店铺表——一致；差异见上一节（模拟数据标签、订单卡）。环境里多一个之前 e2e 建的「E2E 冒烟店铺」。
- `09-p18-gmail-error.png` 对照 K7 与 K20 补充小样：顶部红色横幅（标题红字、说明、右侧「查看渠道状态」次按钮）与 G4/K7 一致；Gmail 卡浅红「连接异常」、「最近同步 10:04」、原因行与暂存行、卡底主色「重新检测」带刷新图标；钉钉卡连接异常三行；店铺表 forcome.mx「Gmail 连接异常」红色徽标——一致。
- `09-p18-gmail-delayed.png` 对照 K20 补充小样：Gmail 卡浅黄「同步延迟」「最近同步 10:05」，延迟行在前、两行说明照常；店铺表「Gmail 同步延迟」——一致。
- `09-p18-mixed.png` 对照 K20 补充小样（E3、E4）：两个邮箱的原因行（次数 3、5）、暂存行一次、延迟行在后；钉钉卡没有副标题、「通讯录尚未同步成功，连续 3 次失败」；店铺表三个店铺各自的状态——一致。
- `09-p18-test-ok.png`、`09-p18-test-failed.png` 对照 K20 补充小样的浮层：成功绿勾「连接正常 · Gmail：5 个邮箱均可访问」（环境里 5 个邮箱），失败红叉「测试连接失败：support@forcome.mx 无法访问 · 请检查全域委派范围与邮箱状态」，右上 ×——一致。
- `09-g4-banner-agent.png` 对照 GlobalStates G4：坐席李婷在 P04，顶栏下方红色横幅，标题与说明逐字一致，没有「查看渠道状态」、没有关闭按钮——一致。

**验收证据**

- [x] 游标过期 → 区间补拉 → 补拉期间最近同步时间不前移 → 补拉后前移：`gmail-sync-health.int.test.ts`「游标过期（Fake 故障注入）…」——注入 `cursor_expired` 与补拉中途 `messages.get` 失败，补拉中断时卡上时刻不动、信未入库；兜底同步其余邮箱前进而它仍不前移；恢复后两封各入库一次、时刻前移到此刻，之后照常增量。
- [x] 连续 3 次失败进入连接异常、横幅、卡片列出邮箱、通知；恢复后已连接、横幅消失、「渠道连接恢复」通知：同文件「某个邮箱连续 3 次失败…」——第 1、2 次仍已连接；第 3 次卡片 `issues` 只列 support@forcome.mx、店铺状态 error、坐席 / 客服主管 / 管理员的横幅接口都返回它；管理员与客服主管收到「Gmail 连接异常」，坐席没有；P27「状态：已连接 → 连接异常（连续 3 次失败）」；第 4 次不重复；恢复后横幅为空、收到「Gmail 已恢复 · 补拉 1 封来信」、P27 恢复连接的四个字段、钉钉工作通知有「Gmail 连接异常」没有「已恢复」。另：watch 失败 3 次同样进入异常；两个邮箱同时恢复「补拉 1 / 0 封」（E1）；没配置凭据为未连接、不出横幅不发通知；钉钉连接异常时横幅接口为空（`dingtalk-sync.int.test.ts`）。e2e `channel-status.spec.ts` 覆盖横幅的画面（各角色、管理员按钮、恢复后消失）。
- [x] 超过 10 分钟未成功同步显示同步延迟：「超过 10 分钟没有同步成功为同步延迟…」——10 分钟整仍已连接，11 分钟同步延迟、列出四个邮箱、不出横幅；兜底同步后回到已连接。
- [x] 「已发送」入库并标记方向为我方：「『已发送』里的我方回信入库…」——direction outbound、店铺为发件邮箱的店铺、不识别来源、不建工单。
- [x] 持久化失败时水位不前进：「持久化失败时水位不前进（故障注入）…」——数据库触发器拒绝主题为 POISON 的信，三轮都失败；之前那封已入库，它与之后的都没有，最近同步时间不前移、不算连接失败；去掉触发器后都补上、已入库的不重复。
- [x] P18 Gmail 卡与钉钉卡展示状态与最近同步时间，两张卡都有「测试连接」：集成测试「测试连接（K20…）」（200 / 502 与 message、不改状态、排同步、只有管理员）、「重新检测…当场 watch」；e2e 6 项（真实接口测试连接成功；Gmail 同步延迟 / 连接异常 + 重新检测失败浮层 / 几个邮箱同时异常；钉钉同步延迟 / 连接异常 / 从没同步成功 + 测试失败浮层；全站横幅）；上面 7 张截图；单元测试 `channel-card-lines.test.ts`、文案核对 `p18-copy.test.ts`、`channel-alert-copy.test.ts`、`gmail-copy.test.ts`、`audit-describe.test.ts`。
- 真实客户端可切换：`gmail-real.test.ts`（MockAgent 回放：令牌的 sub 与缓存、401 换令牌重试、全域委派未授权不可重试、watch 不写 labelIds、history 分页与 404、按 internalDate 列消息、raw 解码、Pub/Sub pull / ack、调用记录、未配置）、`http.test.ts`（调用记录与脱敏、网络错误、按接口限流）、`config.test.ts`（Google 凭据的必填与校验、不回显密钥）。

**测试结果**（代码 4da09d1）：`pnpm typecheck` 0 错误；`pnpm lint`（ESLint 0 警告 + prettier，含模块边界）通过；`pnpm test:unit` 69 个文件 618 项全过；`pnpm test:integration`（本机 PostgreSQL 18）30 个文件 339 项全过；`pnpm test:e2e`（Playwright 单 worker）92 项全过；`pnpm db:verify`、`pnpm fixtures:verify`、`pnpm build`、`pnpm deploy:verify` 通过。

- 偶发失败定位：一次全量并行运行里 `module-boundaries.test.ts` 第一个用例超过 30 秒——第一次 `lintText` 要建起带类型的 ESLint 程序，全量并行时 CPU 紧张，冷启动算进了第一个用例。改为在 `beforeAll`（单独 180 秒时限）先热身一次，之后全量运行通过。
- e2e 两处等待首轮同步：新部署 / 新店铺的邮箱在 worker 开始监听并同步一次之前为「未连接」（新口径的正确行为），`channel-status.spec.ts` 与 `stores.spec.ts` 用 `toPass` 重新载入等到「已连接」（最多 30 秒，实际几秒）。

**code-review**（固定点 cecfb3f；规范轴纳入 CLAUDE.md、AGENTS.md、README「约定」、ADR 0003 / 0005 / 0006 / 0007 / 0008 / 0009 / 0010 与本次修订；规格轴纳入本待办与 Comments 的衔接要求、第一期规格、PRD 6.9 / P18 / K7 / K20 / G4 / P27 / E-02 / 11.4 与 Q1–Q6、E1–E4、原型与截图）

- 规范轴：① 钉钉 `gettoken`、扫码换用户凭证、Stream 连接票据的响应会进调用记录（凭证泄露）→ 标 `secretResponse`；② 「补拉 N 封」把别的邮箱的副本算进去 → 入库结果区分 created / copy / duplicate，只算新的来信；③ 每次重试都算一次失败，故障 1.5 分钟就满 3 次 → 重试 60 秒起翻倍；④ 记失败本身出错会盖掉原错误 → try/catch；⑤–⑦ 重复 JSDoc、logger 类型、进线邮箱查询四处重复（合成 `mailboxTargets`）、渠道审计摘要另写 if（并入摘要表）、横幅 kind 预留订单（收窄为 gmail）——都已修。
- 规格轴：没有严重问题。钉钉不出横幅缺测试 → 补；「重新检测」对正在退避的未 watch 邮箱无效 → 测试连接当场 watch；请求摘要丢查询参数 → 写查询参数并脱敏；未配置凭据会算失败出横幅 → `ClientNotConfiguredError` 不计失败、状态未连接；限流只配了 Gmail → 保留并写明理由；Comments 未写 → 本条。
- 复核（58febeb 之后）：各条修复正确、没有引入新问题；两处加固建议（请求摘要解码失败照原样写、凭证参数名补 signature / sig；ADR 0008 写明测试连接当场 watch 与 worker 并发的安全性）已在 4da09d1 处理。没有遗留问题。

**Node 24**：照 README「开发」，把便携 Node 24.21.0 复制到本会话临时目录、只在会话命令里前置 PATH，pnpm 10.34.6 经 corepack；没有改系统配置。

**后续（给其他待办的衔接）**

- 11、12（订单）：在 `connections.ts` 用同步记录替换订单的 `statusOf`，横幅的 `channelAlertSchema.kind` 加 amazon / shopify，`CHANNEL_ALERT_COPY` 类型上会要求补文案；SP-API 预签名地址的 signature 参数已在调用记录的脱敏名单里；订单的「测试连接」在 `connectionTestKinds` 加。
- 16（回复识别）：「已发送」已入库（direction outbound、店铺为发件邮箱的店铺），在 `gmail-sync.ts` 的 `ingestMessage` outbound 分支发「我方发信已同步」；Fake 用 `send(…)` 放我方回信。示例数据回放目前只回放来信。
- 26（历史回放）：`notifyMembers` 在回放运行时不发通知，渠道异常 / 恢复同样不会在回放中产生。
- 28（生产部署）：Google 三项配置与密钥目录不是启动条件（资质到位前生产照常启动，Gmail 为「未连接」），到位后按 `docs/部署说明.md` 第 12 节填入并重新部署；调用记录表需要定清理周期。
- 29（真实环境验收）：服务账号授权、推送到达、游标过期补拉与断线恢复、调用记录核对，步骤见 `docs/部署说明.md` 第 12 节。

**部署到开发测试环境**（`pnpm deploy:staging`，代码 7c611a0，工作区干净）：八步全过——准备、构建镜像、启动数据库、执行迁移（含 0022）、灌示例数据、启动 api / worker / caddy、内网 HTTPS 核对、Playwright 冒烟 92 通过 / 0 失败（报告 `deploy/.state/staging/report.md`，版本 `7c611a099026`）。冒烟里的 `channel-status.spec.ts` 6 项在开发测试环境照常通过（worker 启动时兜底同步一次，邮箱几秒内为已连接）。本机内存紧张，Claude Code 在部署接近结束时回收了后台 shell 的外壳，部署进程本身跑完并写出报告，冒烟容器退出码 0；没有重跑。跑完后 4516–4519 端口空闲。

**提交**：90859a4 主体（后端、契约、前端、原型与 PRD v2.25）；c00bb93 e2e、截图、部署配置与文档；58febeb 评审修复；4da09d1 复核小修；7c611a0 本条记录与收尾（勾选验收项、Status 改 resolved）；以及补记部署结果的提交。

## 验收返工（2026-10-06，协调者核查不通过的三项）

**问题与修复**（6cdb761）

1. **生产缺 Google 配置拒绝启动，违背用户 2026-10-04 口径**（外部资质只有钉钉已有；缺某个外部系统的配置时系统照常可用，该渠道「未连接」，只有配置了却连不上才算异常）。原来 `loadConfig` 在推送用真实接口（生产默认）时要求三项必填，api、worker、migrate 都以 ConfigError 退出，`CLIENT_MODE_GMAIL_PUSH=fake` 又被「生产不允许 Fake」拒绝，无法绕过。
   - 改：三项都不填时 `google = null` 照常启动（生产也一样），只填一部分仍拒绝；推送与邮箱的真实现以 `ClientNotConfiguredError` 失败、不计失败；推送常驻拉取遇到它安静跳过（第一次记一条 info 日志，返回 0、不进出错退避），开始监听失败只记调试日志；Gmail 与各店铺为「未连接」，不出横幅、不报连接异常、不发通知。
   - 其他已实现的外部客户端：只有钉钉在生产必填凭据（钉钉资质已有，按口径保留）；汇率是公开源、不要凭据；SP-API、SQS、Shopify 还没实现（11、12 接入时照同样口径）。
   - 测试：`config.test.ts` 改为「生产三项都不填照常启动、google 为 null」「只填一部分拒绝启动、只列缺的」；`gmail-sync-health.int.test.ts` 新增「生产环境没有配置 Google 凭据」——`startTestHarness({ appEnv: 'production' })`（只挂收信的常驻拉取），建真实接口店铺后跑六轮开始监听、兜底同步、续订都不抛错，Gmail 卡与店铺为未连接、`issues` 为空、横幅接口为空、没有渠道通知与渠道审计。变异核对：把推送拉取改回遇到未配置就抛错，该用例失败（`ClientNotConfiguredError: gmail_push pull…`）；还原后通过。
   - 生产实测（构建产物 `apps/server/dist`，临时库 `forcome_prodcheck`，`APP_ENV=production`、钉钉三项占位、不给 Google 配置；`HTTPS_PROXY` 指向不监听的 127.0.0.1:4515，保证不连真实外部服务）：`node dist/migrate.mjs` 退出 0（「迁移完成」）；`node dist/api.mjs` 启动（「api 已启动」，appEnv production），`/api/health` 200；`node dist/worker.mjs` 启动（「worker 已启动」），日志「没有配置 Google 凭据，Gmail 推送不拉取（Gmail 为未连接）」只一条；SQL 灌一个真实接口店铺后，`channel.mailbox_sync` 没有失败记录、通知 0 条、渠道审计 0 条。worker 另有钉钉 Stream 连不上与钉钉对账、欧洲央行失败的日志——是占位凭据加故意不通的代理所致，属预期。测完停进程、删临时库，4515–4519 端口空闲。
   - 文档：ADR 0009「待办 09 落地」配置条、`docs/部署说明.md` 第 12 节第 2 步、`deploy/.env.example` 与 `deploy/compose.yml` 注释、`config.ts` 头注释（「P18 显示连接异常」改为「未连接」）；本待办上文「技术口径」的配置说明与给 28 的衔接已改正（28 部署时 Google 三项不是启动条件，资质到位后填入重新部署即可）。
2. **P27 渠道对象不能点**：`apps/web/src/pages/audit/audit-table.tsx` 的 `objectLink` 加渠道分支——能打开 P18 的人（管理员）点「Gmail · 邮箱」进 `/settings/channels`，打不开的（客服主管）只显示文字。e2e `audit-log.spec.ts` 新增一项（真实响应按 contracts 解析后在最前面加一条渠道记录）：管理员点进 P18，客服主管没有链接。
3. **原型截图工具缺陷**：`design/spec/check.py` 的元素截图受 Chrome 单次截图 16384 像素上限所限，StatesAdmin（1920 × 20071）的 K20 补充小样与 K21–K24 没截进去。改为超过 8000 像素的画板按段 `clip + full_page` 截再用 PIL 竖着拼成一张（其余画板照旧按元素截，生成逻辑不变）；重新生成 `design/spec/shots/StatesAdmin.png`，核对 K20 补充小样（Gmail 同步延迟、连接异常、几个邮箱同时异常、钉钉连接异常与从没同步成功、测试连接浮层）与 K21–K24 完整可见。其余画板都不超过 16384 像素（最高 StatesAfterSales 12268），原来就是完整的，没有重拍。

**测试**（6cdb761）：`pnpm typecheck` 0 错误；`pnpm lint` 通过；`pnpm test:unit` 69 个文件 619 项全过；`pnpm test:integration` 30 个文件 340 项全过；`pnpm test:e2e`（单 worker 前台）93 项全过。

**部署**：`pnpm deploy:staging`（0f03d5d，工作区干净，前台等待）八步全过，冒烟 93 通过 / 0 失败 / 0 不稳定 / 0 跳过（报告 `deploy/.state/staging/report.md`，版本 `0f03d5d`）；跑完后 4516–4519 端口空闲。

**返工提交**：6cdb761 代码、测试、截图工具与文档；0f03d5d 本节记录；以及本条部署结果。
