# 11: Shopify 订单镜像

Status: resolved
Blocked by: 07, 09, 31

规格：[第一期：报表与台账](../spec.md)

**What to build:** Shopify 店铺的订单准实时出现在本地镜像中，可被查询。`order` 模块的订单镜像表（平台订单号、订单名、店铺、状态、商品行、金额与币种、客户邮箱、收件国家与地址、履约单号、平台更新时间）；Shopify Admin GraphQL 客户端（真实 + Fake），每 1–2 分钟 `updated_at` 增量；令牌 24 小时过期、每 20 小时提前刷新，动态凭据用主密钥 AES-GCM 加密存库。对外接口：在某店铺内按订单名或订单号查订单（镜像没有则按订单名补拉）、按客户邮箱反查订单、最近同步成功时间。P18 的 Shopify 卡显示状态与最近同步时间、测试连接。同步失败按待办 09 的连接状态口径处理（按店铺计算；超过 10 分钟未成功同步为同步延迟）。

- [x] 集成测试（Fake）：增量拉取写入镜像，重复拉取不产生重复行
- [x] 集成测试：镜像中没有的订单名触发补拉并入库
- [x] 集成测试：邮箱反查只在指定店铺内匹配（R-ST-03）
- [x] 集成测试：令牌临近过期时自动刷新，凭据在库中为密文
- [x] 集成测试：超过 10 分钟未成功同步时 Shopify 卡与该店铺状态显示同步延迟
- [x] 集成测试：连续 3 次失败进入连接异常 → 全站横幅 → 管理员与客服主管收到站内通知与钉钉工作通知（E-01）；恢复后横幅消失并发「渠道连接恢复」站内通知
- [x] 订单同步的连接状态与最近同步时间可在 P18 看到

## Comments

- 2026-10-05（待办 07）：P18 的 Shopify 卡已有骨架（`channel-cards.tsx`），状态由 `channel/connections.ts` 的 `statusOf` 按数据来源给出、没有最近同步时间；本待办按订单同步记录替换（含 PRD 6.9「卡片列出异常的店铺」，`channelCardSchema` 要加字段），并加上「测试连接」与回补窗口行（例「订单回补 60 天 · 未开通 read_all_orders」，与 13 号待办分工）。（更正，待办 11：回补窗口行随待办 13 做，协调者 2026-10-06 决定。）店铺的数据来源在 `channel.store.adapter_mode`，`forStore(定义, { id, adapterMode })` 取客户端；店铺表「状态」列的订单一项写作「Admin API」。

- 2026-10-06（待办 31）：订单同步连接异常与恢复的站内通知同 09 的写法：`notifyMembers(tx, { type: 'channel_disconnected' | 'channel_recovered', …, object: { type: 'channel', id: 'shopify', label: 'P18 · Shopify' } })`（对象 id 用 `contracts` 的 `channelKinds`），不传 `storeId`，连接异常另发钉钉工作通知；标题与说明原型只画了 Gmail，写 Shopify 的文案时照 Gmail 的写法并按 CLAUDE.md 核对。

- 2026-10-06（待办 11 实现记录）

**业务口径（协调者 2026-10-06 决定 Q1–Q7，全部按建议；均为待办 09 用户确认的 Gmail 写法在 Shopify 上的套用，异常与延迟按店铺）**

- Q1 Shopify 卡同步延迟：每个延迟的店铺一行「forcome.mx 10:05 后未同步成功，超过 10 分钟」，排在「2 个店铺 · 订单经 Admin API 准实时同步」之前。
- Q2 连接异常：每个异常的店铺一行「forcome.mx 访问失败（10:05 起连续 3 次）：请检查 Admin API 应用凭据与授权范围」（次数写实际次数），再写一次「该店铺订单暂停同步，恢复后自动补拉；来信经 Gmail 照常收取」，延迟行在后，卡底「重新检测」；没有「重新授权」「查看错误日志」。
- Q3 全站横幅：「Shopify 订单同步中断」「09-11 10:05 起未同步。来信照常收取，恢复后自动补拉订单。管理员、客服主管已收到通知。」，不写店铺名，时刻取最早一串失败的第 1 次，「查看渠道状态」只对管理员；Gmail 与 Shopify 同时异常各一条、Gmail 在上。
- Q4 通知：「Shopify 连接异常」+「forcome.mx 连续 3 次失败，订单暂停同步」（另发钉钉工作通知）；「Shopify 已恢复」+「forcome.mx 已重新连接，补拉 N 笔订单」（0 照写）；对象「P18 · Shopify」，按角色发管理员与客服主管。
- Q5 P27：对象「Shopify · 店铺」，动作「连接异常」「恢复连接」，展开字段同 Gmail；摘要「状态：连接异常 → 已连接（补拉 N 笔订单）」，展开「补拉」写「N 笔订单（10:05–10:13 更新）」。
- Q6 测试连接：成功「连接正常 · Shopify：2 个店铺均可访问」，失败「测试连接失败：forcome.mx 无法访问 · 请检查 Admin API 应用凭据与授权范围」；不改状态，测完立即同步。
- Q7 回补窗口行「订单回补 60 天 · 未开通 read_all_orders」随待办 13（上面待办 07 的留言已更正，13 的 Comments 留了衔接）。
- 回写：原型 K20 补充小样（`design/spec/pages/build_settings.py` 的 `shopify_card_p1`、`build_states_admin.py` 的 `k20()`、`data.py` 的 `SHOPIFY_ISSUE`、`SHOPIFY_DELAYED`、`G4_BANNER_SHOPIFY`、`SHOPIFY_NOTICES`、`SHOPIFY_AUDIT`），重新生成 StatesAdmin 与截图、PRD 页面；第一期参照图无变化（`python shot_phase1.py` 9 张 OK）。PRD v2.26（6.9、P18「第一阶段」、G4、P27「第一阶段」、11.4、变更记录），WORKPLAN 记一条。文案收进文案模块并读原型生成物逐字核对：`p18-copy.ts`（`SHOPIFY_ISSUE_LINES`、`CONNECTION_TEST`）、`components/channel-alert-copy.ts`、`order/shopify-copy.ts`、`contracts/audit-describe.ts`。
- 示例数据：`data.py` 新增 `SHOPIFY_ORDERS_P1`（第一阶段工单与台账引用的 5 笔 Shopify 订单 #0991、#1049、#1052、#1057、#1063，#1063 的商品、金额、下单日同 `ORDERS`），夹具导出 `shopifyOrders`，Fake Shopify 回放它们。

**我定的技术口径**（写进 ADR 0005、0006、0008、0009、0010、0011、0013「待办 11 落地」修订）

- 访问令牌：Shopify 自建应用（Dev Dashboard，应用与店铺同一组织）的客户端凭据按店铺以 client credentials 换令牌（官方：`expires_in` 恒为 86399），令牌用主密钥 `CREDENTIAL_MASTER_KEY`（32 字节 base64）AES-256-GCM 加密存 `integration.credential`（随机 IV，附加数据「系统:店铺」），满 20 小时提前换新，401 立即换新重试一次；主密钥换了解不开时当作没有、重新换。Admin API 版本固定 `2026-07`。
- 增量：每分钟 `order.shopify_poll`（worker 启动时也一次）给每个 Shopify 店铺排 `order.shopify_sync`（stately、不重试，下一分钟的同步就是重试）；从水位（已写进镜像的最晚平台更新时间）前 2 分钟起按 `updated_at:>=` 分页（sortKey UPDATED_AT，每页 100），每页一个事务写镜像，全部写完才推进水位并记成功；第一次同步从此刻起（历史随 13）。新增或编辑 Shopify 店铺的事务里立即排一次；改了平台、平台标识或数据来源时清掉该店铺的同步记录从头算，同步期间配置变了的那一轮不记结果。
- 镜像 `order.platform_order`：「店铺 + 平台订单号（全局 ID）」唯一，只进不退（平台更新时间更新的版本才改）；订单名只建普通索引（平台保证店铺内唯一，库里不加唯一约束，撞名不卡同步，按名查取最新的一笔）；邮箱存小写。
- 对外接口（`order/index.ts`）：`findOrder`（先镜像，没有且是 Shopify 订单名时补拉入库；只写数字的补 #；范围外店铺不查不补拉；未配置时只查镜像）、`findOrdersByEmail`（只在该店铺、只查镜像，R-ST-03）、`orderSyncHealths`（最近同步成功时间，报表「更新于」随 24 用）。`order` 不依赖 `channel`，店铺由组装根注入（`channel.listOrderStores`）或调用方给出；`listOrderStores`、`orderSyncHealths` 是系统查询，在 ADR 0010 登记例外（横幅也用它）。
- 连接状态同 Gmail：按店铺的同步记录 `order.order_sync`，外部调用失败（`ClientNotConfiguredError` 除外）各记一次，正好第 3 次通知 + 审计（带 `storeId`，P27 按范围过滤），恢复时「补拉 N 笔订单」= 恢复那次写入或更新的订单数；按订单名补拉的失败不计（归并时的按需查询，由调用方重试）。P18 Shopify 卡取各店铺最差状态、列出延迟与异常的店铺（按店铺名）、最近同步取最旧的一次。
- 缺配置（用户 2026-10-04 口径）：`SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` 要么都填要么都不填；都不填时生产照常启动，真实接口店铺为「未连接」，不出横幅、不发通知、不记审计；填了凭据就要有主密钥（只填一部分拒绝启动、不回显取值）。店铺平台标识不是 `<名字>.myshopify.com` 时算连接失败（管理员在 P18 看得到）。
- 测试连接 `POST /api/channel/connection-tests/shopify`：逐个店铺 `shop` 查询，未配置也算「无法访问」（同 Gmail）；测完给每个 Shopify 店铺排一次同步。

**交付了什么**

- 后端：`order` 模块（`schema.ts`、`mirror.ts`、`shopify-sync.ts`、`sync-health.ts`、`shopify-copy.ts`、`index.ts`），迁移 0023（`order.platform_order`、`order.order_sync`、`integration.credential`）；`integration` 的 `shopify.ts`（接口、Fake：`put`、`faultsOf`、示例订单回放）、`shopify-real.ts`、`credential-vault.ts`、`fixture-customers.ts`（客户邮箱与 Fake 来信一致），`StoreClientSelection.platformId`、`RealClientContext` 加 `storePlatformId`、`shopify`、`credentialVault`、`clock`；`core/config.ts` 读 Shopify 凭据与主密钥；`channel` 的 Shopify 卡与横幅（`connections.ts`）、测试连接路由、保存店铺时立即同步与重置（`stores.ts`）；`jobs.ts` 登记两个任务；api、worker 入口传凭据保管与时钟。
- contracts：`channelAlertKinds`（gmail、shopify）、`connectionTestKinds` 加 shopify、渠道审计快照的 `channel`（补拉写「N 笔订单（…更新）」）。
- 前端：Shopify 卡的异常说明行（`channel-card-lines.ts`）、测试连接与「重新检测」、横幅文案；卡头右侧标签放不下时折行（卡名照原型完整显示）。
- 测试工具：`t.findOrder(店铺, { name } | { platformOrderId })`、`t.ordersByEmail(店铺, 邮箱)`；Fake Shopify 测试里 `t.clients.fake(shopifyClient).put(…)`、`.faultsOf(店铺).failNext(…)`。
- 部署与文档：`deploy/compose.yml`、`.env.example`（Shopify 凭据与主密钥）、`docs/部署说明.md` 第 5、13 节、ADR 七份修订、规格 order 段落地与「先例」、README「Shopify 订单」、CONTEXT（订单镜像、水位、动态凭据）、给 12、13、14 的衔接留言。

**关键取舍**

- 同步任务不重试、靠每分钟的定时：失败次数一分钟一次，约 3 分钟的故障满 3 次，与 Gmail「重试 60 秒起翻倍」的灵敏度相当，口径更简单。
- 水位取已写入订单的最晚平台更新时间、不取「此刻」，再往前重叠 2 分钟：平台搜索索引的延迟与时钟偏差都不会漏单；没有新订单时水位不动，查询仍只带回边界上的几笔。
- 订单名不加唯一约束：平台保证唯一，库里加约束反而会因一次撞名让整页写入失败、同步卡住（评审发现后改）。
- 测试连接遇到未配置也报「无法访问」：与 Gmail 一致，管理员在生产点它能看出还没接通；不改状态（仍为未连接）。
- 同步期间改了店铺数据源：这一轮结束时再取一次店铺配置，变了就不记结果（避免旧配置的成功盖掉重置）；这是竞态防护，没有专门的测试（Fake 无法在一次同步中间改配置），由逻辑审查保证。

**自己写而没用现成库的部分**

- 没用 `@shopify/shopify-api` / `@shopify/admin-api-client`：它们的请求不经我们的出站工厂（代理分流、限流、调用记录，ADR 0009），而我们只用一个换令牌接口与一个 GraphQL 端点、三个查询；自己写的只有查询文本、zod 校验与错误翻译。AES-GCM 用 `node:crypto`（内置）。
- 渠道卡说明行、横幅是业务拼装，没有可用的库。

**组件库带来的细微视觉差异**（由我定，汇总给用户过目）

- 开发测试环境的 Shopify 卡头比原型多一枚「模拟数据」标签，卡头一行放不下时右侧标签（模拟数据 · 状态 · 测试连接）折到第二行，卡名完整；真实环境没有这枚标签，与原型一样一行。卡名不收缩：比 1440 更窄的窗口里卡头可能挤（系统按 1440 设计，桌面使用）。
- Shopify 卡没有「订单回补 60 天 · 未开通 read_all_orders」一行（Q7，随 13），与第一期参照图不同。
- 卡上「最近同步」是实际同步时刻（截图里 10:19，原型示例 10:15）。

**截图与逐项核对**（1440 × 900，`.scratch/phase1-reporting/shots/`；本机开发服务 api 4516 + worker + 前端 4517，示例数据夹具，演示时刻 2026-09-11 10:20；异常状态用接口桩换成原型 K20 补充小样的示例值）

- `11-p18-settings.png` 对照 `design/spec/shots/phase1/P18_Settings.png`：Shopify 卡头「Shopify Admin API · 最近同步 10:19 · 已连接 · 测试连接」、店铺行「2 个店铺 · 订单经 Admin API 准实时同步」，店铺表两个 Shopify 店铺「已连接 / Gmail · Admin API」——一致；差异见上一节（模拟数据标签、回补窗口行随 13）。
- `11-p18-shopify-delayed.png` 对照 K20 补充小样「Shopify 同步延迟」：浅黄卡「同步延迟」「最近同步 10:05」，延迟行在前、店铺行照常，没有「重新检测」；店铺表 forcome.mx「Admin API 同步延迟」——一致。
- `11-p18-shopify-error.png` 对照 K20 补充小样「Shopify 连接异常」与 G4：顶部红色横幅「Shopify 订单同步中断」与说明逐字一致、管理员有「查看渠道状态」；卡浅红「连接异常」「最近同步 10:04」，原因行、暂停同步行、卡底主色「重新检测」带刷新图标；店铺表「Admin API 连接异常」——一致。
- `11-p18-shopify-test-ok.png`、`11-p18-shopify-test-failed.png` 对照 K20 补充小样的浮层：成功绿勾「连接正常 · Shopify：2 个店铺均可访问」；失败红叉「测试连接失败：forcome.mx 无法访问 · 请检查 Admin API 应用凭据与授权范围」——一致。
- `11-g4-two-banners-supervisor.png` 对照 K20 补充小样「Gmail 与 Shopify 同时连接异常」：客服主管周敏在 P04，两条横幅 Gmail 在上、Shopify 在下，文案逐字一致，没有「查看渠道状态」——一致。

**验收证据**

- [x] 增量拉取写入镜像，重复拉取不产生重复行：`apps/server/test/shopify-orders.int.test.ts`「增量拉取写入镜像（含分页）…」——两店铺各放订单（MX 一次 60 笔、Fake 每页 50 笔两页），同步后经 `t.findOrder` 核对字段（状态、付款、金额币种、邮箱小写、平台更新时间），经 `t.ordersByEmail` 核对每笔恰好一行；下一分钟重叠拉取仍各一行；订单发货后镜像更新为新版本仍一行；重叠窗口里拉到更旧的版本时镜像不回退。变异核对：去掉 upsert 的「只进不退」条件，该用例与两个恢复用例失败。
- [x] 镜像中没有的订单名触发补拉并入库：「镜像中没有的订单名触发补拉并入库…」——#1063 平台更新时间早于水位、增量拉不到；`findOrder({ name: '1063' })` 补拉入库（`order_by_name` 调用 1 次），再查不再调平台；别的店铺、平台也没有的为空；店铺范围外（只授权 forcome.mx）查不到也不补拉；亚马逊店铺不调 Shopify。
- [x] 邮箱反查只在指定店铺内匹配（R-ST-03）：「邮箱反查只在指定店铺内匹配，不分大小写」——同一邮箱在 forcome.com、forcome.mx 各一笔，各店铺只返回自己的；亚马逊店铺为空。
- [x] 令牌临近过期时自动刷新，凭据在库中为密文：`apps/server/src/modules/integration/shopify-real.int.test.ts`（真实现 + 测试库 + 手动时钟 + MockAgent）——第一次调用以 client credentials 换令牌，库里密文不含明文（utf8 与 hex 都查）、主密钥能解开、换个附加数据解不开、过期时间为 86399 秒后；19:59 沿用、满 20 小时换新且库里换成新令牌的密文（IV 不同）；401 换新重试一次、新令牌也被拒以 401 失败；主密钥不对读不出。变异核对：把换新阈值改成 24 小时，两个用例失败。另有 GraphQL 查询的参数（updated_at 过滤、sortKey、分页游标）与返回映射、THROTTLED 可重试与其他 errors 不可重试。
- [x] 超过 10 分钟未成功同步时 Shopify 卡与该店铺状态显示同步延迟：「超过 10 分钟没有同步成功为同步延迟…」——10 分钟整仍已连接，11 分钟同步延迟、卡片列出两个店铺、店铺表同步延迟、不出横幅；同步后回到已连接。
- [x] 连续 3 次失败进入连接异常 → 全站横幅 → 管理员与客服主管收到站内通知与钉钉工作通知（E-01）；恢复后横幅消失并发「渠道连接恢复」：「某店铺连续 3 次失败进入连接异常…」——forcome.mx 第 1、2 次仍已连接，第 3 次卡片 `issues` 只列它（失败起点、次数）、店铺表 error、另一店铺照常；坐席 / 客服主管 / 管理员的横幅接口都返回 `{ kind: 'shopify', targets: ['forcome.mx'] }`；管理员与客服主管收到「Shopify 连接异常」，坐席没有；审计带 `storeId`、P27 摘要「状态：已连接 → 连接异常（连续 3 次失败）」；第 4 次不重复；恢复后横幅为空、收到「Shopify 已恢复 · forcome.mx 已重新连接，补拉 1 笔订单」、P27 摘要「…（补拉 1 笔订单）」与展开四个字段；钉钉工作通知只发异常、接收人恰为示例数据里的管理员与客服主管。另：恢复时 0 笔照写；Gmail 与 Shopify 同时异常横幅各一条 Gmail 在前；e2e 覆盖横幅画面（客服主管两条、管理员 Shopify 横幅「查看渠道状态」进 P18）。
- [x] 订单同步的连接状态与最近同步时间可在 P18 看到：集成测试「还没同步过为未连接；第一次同步后…」「测试连接（K20）…」（200 / 502 与 message、不改状态、排同步、只有管理员）、「新登记的 Shopify 店铺立即同步一次…换了数据源从头算」；e2e `apps/web/e2e/channel-status.spec.ts` 新增 5 项（真实环境测试连接成功、Shopify 同步延迟、连接异常 + 重新检测失败浮层 + 店铺表、两条横幅、未连接「尚未授权」）；单元测试 `channel-card-lines.test.ts`（延迟、异常、异常加延迟）、文案核对 `p18-copy.test.ts`、`channel-alert-copy.test.ts`、`order/shopify-copy.test.ts`、`audit-describe.test.ts`；上面 6 张截图。
- 生产 + 未配置（用户 2026-10-04 口径）：`shopify-orders.int.test.ts`「生产环境没有配置 Shopify 凭据」——`startTestHarness({ appEnv: 'production' })` 建真实接口 Shopify 店铺，跑四轮同步不抛错，Shopify 卡与店铺为未连接、`issues` 为空、横幅为空、没有渠道通知与审计、按订单名查为空。变异核对：把「未配置不算失败」去掉，该用例失败。`config.test.ts`：生产都不填照常启动、填齐读出、只填一项 / 没主密钥 / 主密钥不是 32 字节拒绝启动且不回显。生产实测（构建产物 `apps/server/dist`，临时库，`APP_ENV=production`、钉钉三项占位、不给 Shopify 配置、代理指向不监听的 127.0.0.1:4515）：migrate「迁移完成」，api 启动、`/api/health` 200，worker 启动；SQL 灌一个真实接口的 Shopify 店铺后 80 秒内 `order.shopify_poll`、`order.shopify_sync` 各完成 3 次，`order.order_sync`、渠道通知、渠道审计、`integration.credential`、Shopify 调用记录都是 0 行；worker 的错误日志只有钉钉 Stream 连不上（占位凭据加故意不通的代理，属预期）。测完停进程、删临时库。

**测试结果**（代码 868ec42）：`pnpm typecheck` 0 错误；`pnpm lint`（ESLint 0 警告 + prettier，含模块边界）通过；`pnpm test:unit` 70 个文件 632 项全过；`pnpm test:integration`（本机 PostgreSQL 18）32 个文件 357 项全过；`pnpm test:e2e`（Playwright 单 worker 前台）97 项全过；`pnpm db:verify`、`pnpm fixtures:verify`、`pnpm build`、`pnpm deploy:verify` 通过。

**code-review**（固定点 33a5578；规范轴纳入 CLAUDE.md、AGENTS.md、README「约定」、ADR 0003 / 0005 / 0006 / 0008 / 0009 / 0010 / 0011 / 0013 与本次修订、原型 K20 补充小样与截图；规格轴纳入本待办与 Comments 的衔接、第一期规格 order / channel / integration 段、PRD 6.9 / P18 / G4 / 11.4 / P27 / E-01 与 Q1–Q7）

- 规范轴：① 横幅接口用了只给管理员接口的 `listAllStores` → 改用系统查询 `listOrderStores`，与 `orderSyncHealths` 一起在 ADR 0010 登记例外；② `findOrder` / `findOrdersByEmail` 缺范围外用例 → 补；③ 测试直接查表、引用内部文件 → 不重复改经 `t.ordersByEmail` 核对，令牌测试移到模块内 `integration/shopify-real.int.test.ts`；④ 订单名部分唯一索引撞名会卡住同步 → 改普通索引、按名取最新（迁移 0023 重新生成，尚未部署过）；⑤ 注释说补拉失败也计数 → 改注释；⑥ Shopify 审计没写 `storeId` → 加上并断言；⑦ `excluded('列名')` 字符串 → 按列对象取列名；⑧ 卡名被截断（固定文案）→ 改为右侧标签折行、卡名完整；⑨ 重置与正在跑的同步有竞态 → 复核建议后加「同步结束时配置变了就不记」。判断题保留：`sync-health.ts` 与 `channel/mailbox-health.ts` 结构相似（分属 order、channel 两个模块，等 12 亚马逊出现第三个使用者再抽到 core）、`orderSources` 只有一个值（12 加 `amazon_orders` 的扩展点）、按渠道的 switch。
- 规格轴：「只进不退」用例当时未提交 → 已提交；钉钉接收人只看文本 → 断言接收人；管理员 Shopify 横幅与未连接画面无 e2e → 补两项；补拉失败计数口径与注释不一致 → 同规范轴 ⑤；`normalizeShopifyOrderName` 判为提前做了 14 → 保留（按订单名补拉的健壮性），复核后只对 Shopify 店铺做；测试连接遇未配置显示「无法访问」→ 与 Gmail 一致，保留并写明（上面「关键取舍」）。
- 复核（3c2079a、f20a1e6 之后）：各条修复正确；三处小改（同步期间换数据源不记、只对 Shopify 补 #、断言 `storeId`）已在 868ec42 处理。没有遗留问题。

**Node 24**：照 README「开发」，把便携 Node 24.21.0 复制到本会话临时目录、只在会话命令里前置 PATH，pnpm 10.34.6 经 corepack；没有改系统配置。

**后续（给其他待办的衔接）**：12、13、14 的 Comments 已留言（同步记录与文案参数化、回补窗口行与回补复用写入、`findOrder` / `findOrdersByEmail` 的用法）。24（报表「更新于」）取 Shopify 订单的最近同步用 `order.orderSyncHealths`（取各店铺最旧的一次）。28（生产部署）：Shopify 凭据与主密钥不是启动条件，资质到位后按 `docs/部署说明.md` 第 13 节填入并重新部署；主密钥随备份单独离线保管。29（真实环境验收）：令牌、61–90 天历史订单、断线恢复、调用记录核对。

**提交**：611d3d5 认领；904e1af 原型与 PRD v2.26 回写；80a8f79 主体；59ec586 部署配置、文档与截图；3c2079a 评审修复；f20a1e6 文档跟上订单名索引；868ec42 复核小修；fc4fc6c 本条记录与收尾（勾选验收项、Status 改 resolved）；cc6daf3、3ce2aa4 部署冒烟发现的两处修复（见下）；以及补记部署结果的提交。

**部署到开发测试环境**（`pnpm deploy:staging`，前台等待，工作区干净）

- 第 1 次（fc4fc6c）：前七步全过，冒烟 96 通过 / 1 失败——`ledger-totals.spec.ts`「导出中…导出失败」第二次点「导出 Excel」超时。根因：第一次导出的成功浮层（右上）盖住按钮，Playwright 的鼠标停在浮层上，Sonner 悬停时暂停计时，浮层一直不消失、一直挡着点击；浮层与鼠标落点是否重叠随环境而定，所以是偶发。修复（cc6daf3）：第二次点击前把鼠标移开、等成功浮层消失（只改用例；产品行为是正常的悬停暂停）。
- 第 2 次（cc6daf3）：冒烟 96 通过 / 1 失败——`stores.spec.ts` 编辑测试店铺后 30 秒内状态列没变成「已连接」（「Admin API 未连接」）。根因：开发测试环境长期累积了 20 多个测试 Shopify 店铺（审计 e2e 每次部署建一个），worker 每个队列一次取一个任务、处理完等 2 秒再取，每分钟一轮的订单同步排成长队，编辑后新排的那次要二十多秒才轮到（查 `pgboss.job`：同一批任务每 2 秒开始一个）。修复（3ce2aa4）：`defineJob` 加每个 worker 的并发数（pg-boss `localConcurrency`），`order.shopify_sync` 设 5（同一店铺仍由 stately + singletonKey 保证同时只跑一个），`core/jobs.int.test.ts` 新增并发用例，ADR 0008 修订。
- 第 3 次（3ce2aa4）：八步全过——准备、构建镜像、启动数据库、执行迁移（含 0023）、灌示例数据、启动 api / worker / caddy、内网 HTTPS 核对、Playwright 冒烟 97 通过 / 0 失败 / 0 不稳定 / 0 跳过（报告 `deploy/.state/staging/report.md`，版本 `3ce2aa4f723a`）。跑完后 4516–4519 端口空闲。
- 修复后测试（3ce2aa4）：`pnpm typecheck` 0 错误，`pnpm lint` 通过，`pnpm test:unit` 70 个文件 632 项、`pnpm test:integration` 32 个文件 358 项全过；`ledger-totals.spec.ts` 本机单独 11 项全过，全量 e2e 由第 3 次部署的冒烟（97 项）覆盖。
