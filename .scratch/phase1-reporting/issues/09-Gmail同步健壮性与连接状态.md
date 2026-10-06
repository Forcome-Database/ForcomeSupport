# 09: Gmail 同步健壮性与连接状态

Status: ready-for-agent
Blocked by: 05, 08, 31

规格：[第一期：报表与台账](../spec.md)

**What to build:** 收信在真实环境下不丢、不重、可恢复，并让管理员看得见。每天续订 `watch`（不按标签过滤）；每 5 分钟 `history.list` 兜底；「已发送」同步入库（归属识别见待办 16）；游标过期（404）按 `internalDate` 区间全量补拉，补拉完成前「最近同步成功时间」不前移；水位只在持久化成功后推进；常驻 pull 用 advisory lock 选主。渠道连接状态（PRD 6.9）：已连接 / 同步延迟（Gmail 10 分钟、钉钉 2 小时）/ 连接异常（连续 3 次失败）/ 未连接；状态按店铺计算，渠道卡显示最差状态并列出异常的邮箱，店铺表「状态」列显示该店铺的 Gmail 状态（6.9）；连接异常时全站红色横幅（G4，不可关闭，恢复后自动消失，钉钉例外不出横幅），管理员与客服主管收到站内通知（待办 31）与钉钉工作通知（E-01、E-02）；恢复后自动补拉。P18 的 Gmail 卡显示状态、最近同步时间与恢复指引（K7），支持「测试连接」。每次外部调用写调用记录。服务账号 + 全域委派的真实客户端可切换。

- [ ] 集成测试（Fake 故障注入）：游标过期 → 区间补拉 → 补拉期间最近同步时间不前移 → 补拉后前移
- [ ] 集成测试：某个邮箱连续 3 次失败进入连接异常，横幅接口返回异常，Gmail 卡列出该邮箱，通知发出；恢复后状态回到已连接、横幅消失，管理员与客服主管收到「渠道连接恢复」站内通知
- [ ] 集成测试：超过 10 分钟未成功同步显示同步延迟
- [ ] 集成测试：「已发送」中的邮件入库并标记方向为我方
- [ ] 持久化失败时水位不前进（故障注入）
- [ ] P18 Gmail 卡与钉钉卡展示状态与最近同步时间；两张卡都有「测试连接」（K20）

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
