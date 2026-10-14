---
status: accepted
---

# 代码托管在 GitHub，经内网自托管运行器部署；动态凭据加密存库

工程与运维的做法（2026-09-24 用户同意）：

- **托管与 CI/CD**：GitHub 私有仓库。静态检查、测试、构建在 GitHub Actions 云端运行；部署由公司服务器上的自托管运行器执行（主动连出、经代理，无入站端口，符合 ADR 0003）。合并到 main 后自动部署到开发测试环境；打版本标签并人工批准后部署到生产。
- **质量门槛**：每个 PR 须通过类型检查、lint（含 ADR 0005 边界规则）、单元测试、集成测试（真实 PostgreSQL 18 服务容器 + Fake 适配器），并有至少 1 名人工评审批准；Playwright 端到端测试在合并后对开发测试环境运行。
- **迁移**：只向前，不写回滚脚本；生产迁移前自动备份；出问题时发修复迁移或从备份恢复；破坏性变更分两次发版（先兼容、再清理）。
- **监控告警**：先确认运维现有的监控系统。有则接入（api、worker 提供健康检查与指标接口）；没有则由 worker 每分钟自检（队列积压、失败任务、各数据源最近一次同步成功的时间、外部调用错误率、模型熔断状态、钉钉、17TRACK、SP-API 配额），异常发钉钉群机器人，管理员设置里加「系统状态」页；不搭 Prometheus 与 Grafana。
- **日志**：pino JSON 输出到标准输出，Docker json-file 驱动轮转，保留 30 天；业务追溯依赖审计表、外部调用记录与模型调用记录；运维如有 ELK 或 Loki 就转发。
- **密钥**：静态密钥（数据库口令、NewAPI 密钥、Google 服务账号、主加密密钥）放在服务器 `.env`（权限 600，运维保管，不进 git）；动态凭据（各店铺 Shopify 令牌、SP-API 刷新令牌）用主密钥 AES-GCM 加密后存数据库，只有 `integration` 能解密；轮换流程写入运维手册；不引入 Vault。
- **备份**（落实 ADR 0003）：每天凌晨 `pg_dump` 全量 + 附件卷，用 restic 加密、去重后同步到 NAS，保留 30 份日备份与 12 份月备份；恢复演练写成脚本，每季度执行一次。
- **环境**：开发测试环境与生产同机，但为独立的 Compose 项目和数据库，默认用 Fake 适配器，外部接口开通后接各平台沙箱与开发店铺；开发者（含 AI 代理）在本机用 `docker-compose.dev.yml` 起 PostgreSQL，全部用 Fake。

## Considered Options

- 公司自建 Gitea 或 GitLab：全内网、网络最稳，但 AI 编程代理（Claude Code、`gh`）对 GitHub 的支持最好，开 PR、看 CI 结果都最顺手。
- 云端 CI 直接推送部署到服务器：需要开入站端口，违反 ADR 0003。
- Vault 等密钥服务：多一个有状态组件，按现在的规模不划算。

## Consequences

- GitHub 与 Actions 的可用性依赖境外代理；代理中断时无法合并和部署，但不影响生产运行。
- 主加密密钥丢失会导致全部店铺凭据不可解密，必须随备份单独、离线保管。
- 运维现有监控系统的情况待确认。

## 修订（2026-09-24，交叉审查复核，见 `.scratch/tech-plan/reviews/复核结论.md`）

- **备份**：PostgreSQL 镜像内置 WAL-G：每日物理基础备份（`wal-g backup-push`）+ `archive_command` 连续归档 WAL，二者都存到 NAS，RPO 降到分钟级并支持按时间点恢复；每日 `pg_dump` 保留为附加的逻辑备份；恢复演练必须包含「从基础备份恢复到其后指定时点」；恢复后先对账外部动作结果，防止旧任务重复执行。（第二轮复审更正：原写法缺物理基础备份，`pg_dump` 不能作为 WAL 重放的基线。）
- **worker 存活检查**：由宿主机独立执行（不依赖 worker 自身），检查进程存活与心跳更新时间，异常时发钉钉群机器人；验收「进程退出」与「进程在但心跳停」两种情况。
- **运行器与环境隔离**：部署分两类任务。开发测试部署由合并到 main 触发，只调度到一个仅能操作开发测试 Compose 项目的独立运行器标签（独立系统用户）；生产部署由打标签触发，带环境保护与人工批准，调度到生产运行器标签。PR 与 main 的 CI（构建、测试）一律在云端运行器。开发测试环境使用独立的 Pub/Sub 订阅、SQS 队列与 Gmail 测试邮箱，默认禁止向白名单外地址发信。
- **上线验收**：最后一个实施切片附真实环境验收矩阵：各店铺收信与「已发送」关联、订单增量与 61–90 天历史订单、断线恢复、未归属店铺指定、台账导出一致性、带源时间戳的报表可见延迟、近 90 天数据下的页面性能。Fake 仍是日常回归主体。
- **可用性**：单机部署对应 PRD 工作时间可用性目标 ≥ 99%（计划内维护不计入，D-22）。

## 修订（2026-10-04，待办 01 落地）

- **CI 工作流**（`.github/workflows/ci.yml`）：static（类型检查、lint 含模块边界与格式、迁移一致性、构建）、unit、integration（`postgres:18` 服务容器）、image（后端镜像可构建）四个作业，外加汇总作业「CI 通过」。分支保护只需把「CI 通过」设为 main 的必需检查，再要求至少 1 个批准（设置步骤见 README「开发」）。
- **暂不上 GitHub 期间**（2026-10-04 用户口径）：工作流照写；同样的检查用 `pnpm ci:local` 在本机执行，其中 `pnpm lint:workflows` 用 actionlint（Docker 镜像 `rhysd/actionlint:1.7.12`）校验工作流语法。仓库推到 GitHub 时补设分支保护。
- **迁移只向前**：migrate 执行 drizzle-kit 生成的迁移，并安装或升级 pg-boss 的表（ADR 0008 修订）；迁移目录不放回滚脚本，测试核对迁移目录只有 drizzle-kit 日志登记过的 SQL。
- **本机开发**：`docker-compose.dev.yml` 只起 PostgreSQL 18，端口 4520（本期本机可用 4510–4520，其余留给开发测试与生产两套 Compose）；集成测试每次运行先建模板库并迁移，各测试文件复制出独立的库。

## 修订（2026-10-04，待办 02 落地）

- **本机端口**（本期本机可用 4510–4520）：开发库 4520；本机开发的 api 4516、前端开发服务器 4517；Playwright 用的 e2e api 4518、前端预览 4519；4510–4515 留给 03 号待办的开发测试与生产两套 Compose。本机开发的环境变量默认值在 `apps/server/dev.env`（`pnpm dev:api`、`dev:worker`、`db:migrate`、`db:seed` 读取，命令行里已设的变量优先），e2e 的在 `apps/server/e2e.env`；两者只含本机开发库的口令，不含任何外部凭据。
- **示例数据**：镜像多一个只用于非生产环境的入口 `node dist/seed.mjs`（灌示例数据夹具，生产环境拒绝，ADR 0009 修订）。CI 的 static 作业加 `pnpm fixtures:verify`（运行器自带 python3），`pnpm ci:local` 同样执行。
- **Playwright**：`pnpm test:e2e` 在本机运行（需要 `pnpm db:up`）。按本 ADR，端到端在合并后对开发测试环境运行，随 03 号待办接入，不放进 PR 的 CI。

## 修订（2026-10-04，待办 03 落地；按用户 2026-10-04 口径）

用户口径：服务器与 GitHub 暂未就绪，先在本机用 Docker 部署与测试；暂不上 GitHub，「合并到 main 触发部署」「在 Actions 上报告结果」「内网自托管运行器」本期改为本机部署脚本，上 GitHub 后启用；外部资质只有钉钉企业内部应用，开发测试环境默认全部 Fake。

- **部署脚本**：`deploy/deploy.mjs`（`pnpm deploy:staging`）只依赖 Node、git 与 Docker，Windows 本机与 Linux 服务器通用。步骤：校验环境文件 → 构建镜像 → 起数据库 → 单独运行 `migrate`（失败即停，api 与 worker 仍是上一版本）→ 非生产环境运行 `seed`（加载步骤幂等，每次部署都跑）→ 起 api、worker、caddy 并核对三者运行的是本次构建的镜像 → 导出 caddy 根证书核对 HTTPS → Playwright 冒烟 → 报告。任一步失败，之后的步骤不执行、退出码 1，不回滚。报告写到终端、`deploy/.state/<环境>/report.md`，有 `GITHUB_STEP_SUMMARY` 时同时写入作业摘要。另有 `smoke`（只重跑核对与冒烟）、`cert`、`compose …`、`down` 子命令。
- **上 GitHub 后**：`.github/workflows/deploy-staging.yml` 由 main 上 CI 成功的 `workflow_run` 触发（PR 的 CI 不触发），`runs-on: [self-hosted, linux, forcome-staging]`，调用同一个脚本，环境文件 `/etc/forcome/staging.env`（工作区以外，600），`deploy/.state/staging/` 作为产物上传。运行器隔离：独立系统用户 + 该用户自己的 rootless Docker，只看得到自己的 Compose 项目；生产运行器另设用户与标签（28 号待办）。actionlint 的配置 `.github/actionlint.yaml` 登记自定义标签，`pnpm lint:workflows` 校验全部工作流。CI 的 image 作业另跑 `deploy/verify.mjs`（Compose 文件插值、前端镜像构建、`caddy validate`），`pnpm ci:local` 同样执行。
- **Compose**：`deploy/compose.yml` 两套环境共用，项目名由脚本按环境固定（开发测试 `forcome-staging`，生产 `forcome-production`）。镜像：`forcome-server`（由 migrate 服务构建一次，seed、api、worker 共用）、`forcome-web`（caddy + 前端静态文件）、`forcome-postgres:18`（自建，固定标签，镜像不变时数据库容器不重建；WAL-G 随 28 号待办）、`forcome-smoke`（`forcome-web` 与 `forcome-smoke` 是 `deploy/web/Dockerfile` 的 web、smoke 两个目标，共用依赖安装层）；版本标签是 git 提交号（工作区不干净时加 `-dirty`）。自建镜像一律 `pull_policy: never`，不会去镜像仓库拉同名镜像。
- **环境文件**：变量只写在环境文件（默认 `deploy/.env.<环境>`，可用 `FORCOME_ENV_FILE` 指到别处；模板 `deploy/.env.example`）。本机第一次部署开发测试环境时由脚本生成并填随机口令；生产的由运维填写，缺了就报错。脚本调用 Compose 时把环境文件里有的变量从子进程环境去掉（Compose 让 shell 变量优先于 `--env-file`）。口令只用 URL 里不需要转义的字符（直接拼进连接串）。环境变量的空值在 `loadConfig` 里视同未设置（Compose 把留空的变量传成空字符串）。
- **端口**（本期本机 4510–4520）：开发测试 4510（HTTPS，`HTTPS_BIND` 本机默认 127.0.0.1）与 4511（PostgreSQL，只开在 127.0.0.1）；4512–4513 预留给生产（28 号待办）；4514–4515 机动。
- **冒烟**：在一次性容器里运行（底是与 `pnpm-lock.yaml` 中 `@playwright/test` 同版本的官方镜像，加装 certutil），只把本环境 caddy 的根证书加进容器内 Chromium 的证书库，经 Compose 网络按内网域名访问 caddy（模拟内网 DNS），不忽略证书错误、不改宿主机证书库；不装根证书时同样的用例以 `ERR_CERT_AUTHORITY_INVALID` 失败。报告用 `docker cp` 取出，不挂宿主机目录。e2e 用例的断言不依赖端口与协议，HTTPS 下另核对会话 Cookie 带 `Secure`。部署后跑 `apps/web/e2e` 全部用例：以后加入的端到端用例要能在长期运行、已灌示例数据的开发测试环境上重复执行。
- **发信白名单**：`MAIL_SEND_ALLOWLIST_ONLY`（不设时取 `core` 的 `defaultMailSendPolicy`：非生产 `true`、生产 `false`；模板里留空，免得照抄到生产）与 `MAIL_SEND_ALLOWLIST`（逗号分隔的完整地址或 `@域名`，`@域名` 不含子域名，空白名单即一封也不发）。`integration` 的 `MailRecipientGuard` 经 `RealClientContext.mailRecipientGuard` 交给真实现：会发信的真实现（第二期的 Gmail 发信）发出前必须对全部收件人调用 `assertAllowed`，有一个不在白名单就整封不发（`MailRecipientNotAllowedError`）。Fake 不真的发信，不检查。
- **部署说明**：组成、命令、根证书安装、切换 DNS-01、放行域名与 `NO_PROXY` 清单、内网 DNS、迁移到 Linux 服务器与上 GitHub 后的启用步骤写在 `docs/部署说明.md`。

## 修订（2026-10-05，待办 10 落地）

- **重放来信**（协调者 10-05 要求做成可重复的步骤）：识别或归并的口径变了，已入库的示例来信不会回头重新识别。非生产环境清掉收取的邮件、邮箱游标、工单与客户，并把工单编号从 0001 重新发号；worker 重启后重新 watch，Fake Gmail 按新口径重新回放。成员、店铺、来源规则、会话、审计与根证书不动。三个入口：
  - 口径变更的版本用 `pnpm deploy:staging --reset-inbound` 部署：在「灌示例数据」之后、「启动 api、worker、caddy」之前多一步「重放来信」（停 worker → 用本次构建的镜像执行 `node dist/reset-inbound.mjs`），起服务后按新口径回放，冒烟在新数据上跑；
  - 对已部署的版本重放：`pnpm staging reset-inbound`（停 worker → 清空 → 起 worker），再 `pnpm staging smoke`；
  - 本机开发库：先停 `dev:worker`，`pnpm db:reset-inbound`，再启动 `dev:worker`。
  生产环境三处拒绝：部署脚本（两个入口都查 `APP_ENV`）、镜像入口 `reset-inbound.mjs`（连数据库之前）、组合函数 `resetInboundData` 本身。

## 修订（2026-10-06，待办 27 落地）

- **售后登记表导入是镜像里的一次性命令**：`node dist/import-aftersales.mjs <登记表.xlsx|.csv> [--mapping <映射表.json>] [--dry-run]`，开发测试与生产都用（不像 `seed`、`reset-inbound` 只限非生产）。部署脚本子命令 `node deploy/deploy.mjs <环境> import-aftersales …`（本机 `pnpm staging import-aftersales …`）用当前部署的版本起一次性 `migrate` 容器，表格与映射表只读挂进容器的 `/import/`（本机路径按调用者所在目录解析），报告直接打到终端，有未导入的行时退出码为 1。落地口径（待办 32 上线前事项）：客户的真实登记表到位后只改映射表 → 开发测试环境试运行、正式导入一次并核对台账 → 生产环境同样执行；生产环境随待办 28 加入部署脚本，在那之前在生产机上用 `docker compose run --rm --no-deps -v …:/import/…:ro migrate node dist/import-aftersales.mjs …` 执行同一条命令（`docs/部署说明.md`「售后登记表导入」）。

## 修订（2026-10-06，待办 06 落地）

- **冒烟容器的 Node 一侧同样信任本环境根证书**：e2e 用例可以用 `route.fetch()` 取真实响应再改写（P20 的接口桩按 contracts 严格解析），也可以用 `APIRequestContext`；这些请求由 Playwright 在 Node 里发出，不读 Chromium 的 NSS 证书库，原来在开发测试环境以 `unable to get local issuer certificate` 失败（本机 e2e 走 http，暴露不出来）。冒烟入口 `deploy/smoke/run-smoke.sh` 在加 NSS 证书之后另设 `NODE_EXTRA_CA_CERTS` 为同一张 caddy 根证书：只在这个一次性容器里生效，仍按正常规则校验证书链与域名，不忽略证书错误（`ignoreHTTPSErrors` 不用）。

## 修订（2026-10-06，待办 11 落地）

- **主密钥与动态凭据**：主密钥是环境变量 `CREDENTIAL_MASTER_KEY`（32 字节的 base64，`openssl rand -base64 32`），只读进 `integration`（`databaseCredentialVault`）。动态凭据按「外部系统 × 店铺」存进 `integration.credential`：AES-256-GCM（`node:crypto`），每次写入随机 12 字节 IV、16 字节认证标签，附加数据为「系统:店铺」（密文搬到别的行就解不开）；库里只有密文与签发、过期时间。主密钥换了或密文被改，解密失败当作没有凭据，真实现重新换一个，不让旧数据挡住同步。第一个使用者是 Shopify 的访问令牌（待办 11），SP-API 刷新令牌随 12。
- **缺配置照常启动**（用户 2026-10-04 口径）：`SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` 要么都填要么都不填，都不填时生产照常启动，Shopify 店铺为「未连接」（不出横幅、不发通知）；填了 Shopify 凭据就要有主密钥（只填一部分拒绝启动，只列变量名、不回显取值）。主密钥单独填可以。部署配置见 `docs/部署说明.md` 第 13 节。

## 修订（2026-10-06，待办 12 落地）

- **SP-API 刷新令牌是第二个动态凭据**：按店铺加密存 `integration.credential`（系统名 `sp_api`，附加数据「sp_api:店铺」）；平台不给过期时间，库里的过期时间按录入后一年记，只作提醒、不据此拒用（被撤销时换访问令牌失败，记连接失败）。主密钥换了时刷新令牌解不开、该店铺为「未连接」，要用子命令重新录入（Shopify 的访问令牌则会自动重新换）。
- **部署子命令 `sp-api-token`**：`node deploy/deploy.mjs <环境> sp-api-token --seller <卖家 ID> < <放刷新令牌的文件>`（不用 echo：echo 的参数会进 shell 历史），用当前部署的镜像起一次性容器（`docker compose run --rm --no-deps -T migrate node dist/sp-api-token.mjs --seller …`），令牌经标准输入传入，不出现在参数、shell 历史与输出里；卖家 ID 对不上亚马逊店铺时退出码为 1。环境变量 `SP_API_CLIENT_ID` / `_SECRET`、`AMAZON_SQS_QUEUE_URL` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY`、`CLIENT_MODE_AMAZON_SQS` 进 `deploy/compose.yml` 与 `.env.example`（`docs/部署说明.md` 第 14 节）；填了 SP-API 凭据就要有主密钥。

## 修订（2026-10-07，待办 13 落地）

- **部署子命令 `order-backfill`**：`node deploy/deploy.mjs <环境> order-backfill [--store <店铺名>]… [--again]`，用当前部署的镜像起一次性容器执行 `dist/order-backfill.mjs`：给选中的店铺（不给为全部订单店铺）开始近 90 天的订单回补，只登记并排上第一页，worker 在后台逐页做，进度见 P18；已完成的跳过（`--again` 从头重来），没做完的接着做。上线前、选定 T0 与回放邮件之前执行（待办 26 的顺序），上线后新加的店铺再执行一次（`docs/部署说明.md` 第 15 节）。没配置平台凭据的店铺照常登记、先不取，配好后由每 10 分钟的续跑接着做。
- **示例环境模拟「上线前已回补」**：`seedDemoData`（`pnpm db:seed`、开发测试环境的 seed 步骤、Playwright 的 e2e api）灌完示例数据后调同一个函数开始回补，P18 两张卡的回补行与原型一致（亚马逊 90 天已完成、Shopify 没开通 read_all_orders 只回补 60 天）。不放进示例数据的加载步骤：集成测试灌示例数据后自己决定回补与否。

## 修订（2026-10-14，待办 26 落地）

- **部署子命令 `mail-replay`**：`node deploy/deploy.mjs <环境> mail-replay [--t0 <带时区的时刻>] [--confirm]`，用当前部署的镜像起一次性容器执行 `dist/mail-replay.mjs`（历史邮件回放与 T0 切换，ADR 0008「待办 26 落地」）。不加 `--confirm` 只看计划（T0、回放区间、各邮箱开始监听的时刻、worker 是否在运行），不停 worker、不写库——生产环境的明确确认就是这一步；加了先 `stop worker`，命令成功（退出码 0）后 `up -d --wait --no-deps worker`，失败时 worker 保持停止并提示再执行同一命令接着回放（回放排的任务只能由回放跑完）。不挂载本机文件，远端 Docker 上下文（本机部署到远端主机）也能用。参数在 `deploy/lib/mail-replay.mjs` 里转成容器里的命令（有单测）。生产环境随 28 号待办加入部署脚本后同样可用；在那之前的等价 `docker compose` 写法见 `docs/部署说明.md` 第 16 节。
- **重放来信也清切换记录**：非生产环境的「重放来信」清掉 `channel.mail_cutover` 与 `channel.mail_replay_item`，回到「已切换」，回放命令可以重新演练。

## 修订（2026-10-14，待办 28 落地；告警口径为协调者 2026-10-14 决定 Q1–Q4）

- **生产部署**：部署脚本加 `production` 环境（Compose 项目 `forcome-production`，本期端口 4512 HTTPS、4513 PostgreSQL）：不灌示例数据、不跑冒烟（冒烟要开发登录），执行迁移前先做一次完整备份（`pre_migrate`，失败即停、不迁移）。守卫：环境文件 `APP_ENV` 必须是 production、`BACKUP_DIR` 必填（NAS 的绝对路径）、不能开开发登录、Linux 上权限必须是 600；没有环境文件时报错（不自动生成）；`reset-inbound` 照旧拒绝生产。生产模板 `deploy/.env.production.example` 与开发测试模板的变量一一对应（单测核对）。工作流 `.github/workflows/deploy-production.yml`：`v*` 标签触发 → 云端核对标签在 main 上、该提交的「CI 通过」为 success → 部署作业带 environment `production`（保护规则要求审批人批准，只允许 `v*` 标签；在 GitHub 设置，`docs/部署说明.md` 第 17 节）→ `runs-on: [self-hosted, linux, forcome-production]` 执行同一个部署脚本，报告上传 90 天。真实环境的「打标签 → 人工批准 → 部署；未批准不部署」核对在待办 29。
- **备份**：PostgreSQL 镜像内置 WAL-G（v3.0.9，Ubuntu 22.04 构建）、restic（Debian 包）与 supercronic，下载的二进制核对校验和。数据库容器开着连续归档：`archive_command` 经 WAL-G 推到备份目录，`archive_timeout` 5 分钟（协调者修改 Q2 g：业务清闲时也最多 5 分钟一段，「没归档」的阈值取它的 2 倍）。备份服务 `backup`（同一镜像，root 运行，WAL-G 一步以 postgres 身份）每天 02:30（北京时间）做一次：WAL-G 物理基础备份（共用数据卷只读）→ `pg_dump -Fc` 经 `restic backup --stdin-from-command`（pg_dump 失败时不留残缺快照）→ 各卷（`/backup-src/*`，第一期是 caddy 的根证书；第二期的附件卷挂到这里）→ 保留策略；启动时最近 24 小时没有成功的备份先补一次。保留：restic 近 30 天每天 1 份 + 近 12 个月每月 1 份（ADR 原文的口径）；WAL-G 至少 7 份基础备份与近 7 天的全部（按时间点恢复的窗口，原文没写，技术决定）。WAL-G 用 libsodium、restic 用自己的口令加密（`WALG_LIBSODIUM_KEY`、`RESTIC_PASSWORD`，环境文件必填）。每次备份写 `core.backup_run`。NAS 要让 uid 999 与 root 都能写。
- **恢复与演练**：`forcome-restore prepare` 取「结束时刻不晚于目标时点」的最近一份基础备份、写 `recovery.signal` 与恢复参数（`restore_command` 经 WAL-G、`recovery_target_time`、到点 promote）；部署脚本 `restore` 停服务 → 原数据目录改名留在卷里 → 取回 → 起库重放到目标时点 → 清恢复参数 → 新时间线的第一份基础备份（`after_restore`）→ 起服务，每步计时出报告。`restore-drill` 在独立的临时卷与一次性容器里做（临时库不归档、只听本地套接字，不污染 WAL 归档），不给目标时点时在库里写 before / after 两行演练标记、以两者之间为目标，核对恢复出来只有 before——即 ADR 要求的「从基础备份恢复到其后指定时点」，每季度一次。恢复后对账外部动作：第一期对外的写动作只有钉钉工作通知（`docs/运维手册.md` 第 3 节）。
- **监控告警**：没有现成的监控系统（本期按「没有则」的做法），第一期的同类告警只发钉钉群机器人（PRD P26 第二期才有「系统状态」页）。
  - worker 每分钟自检（定时任务 `core.self_check`，ADR 0008「待办 28 落地」）：任务队列积压与失败、各数据源最近同步（PRD 6.9 的阈值）、外部调用错误率、钉钉配额、SQS、回补与对账、备份与 WAL 归档；阈值是环境变量 `ALERT_*`（默认值见协调者 Q2）。按异常项的键去重，持续每 2 小时再提醒，恢复发「已恢复」，一次最多一条 markdown 消息（Q3）；某个自检项出错时，原来在告警的项照旧算在告警（不误报「已恢复」）；没配置机器人照常启动、只写日志（Q1）。汇率从没同步成功过时有失败就告警，不等 1 天。
  - 群机器人是全局外部客户端 `dingtalk_robot`（`CLIENT_MODE_DINGTALK_ROBOT`，生产默认真实接口；加签按钉钉自定义机器人文档，系统时间签名，errcode 不为 0 算失败），生产的 Webhook 只能是 `oapi.dingtalk.com`；一次性入口 `dist/alert-test.mjs` 与部署脚本 `alert-test` 发「告警通道已连通」（第一次部署后，Q1）。
  - 宿主机检查（修订 2026-09-24 的「worker 存活检查」）：部署脚本 `host-check`，由宿主机的 systemd 定时器（模板 `deploy/host/`，本期不安装）每分钟执行；只用 Docker CLI（按 Compose 标签找容器）与数据库容器里的 psql，不依赖部署的版本文件。判断「进程退出」（容器不在运行）与「进程在但心跳停」（`core.worker_heartbeat` 超过 `HOST_CHECK_HEARTBEAT_MINUTES` 没更新；心跳由排程的自检任务写，任务队列停了也算）；上线切换回放中 worker 是有意停掉的，靠回放命令写的维护标记暂停，标记过期后照常告警并注明「回放还没完成」（只看切换状态就不告警的话，回放失败后 worker 永远停着也没人知道）；数据库连不上时原来在告警的「心跳停止」照旧算在告警。部署脚本不引用应用代码，加签与去重在 `deploy/lib/` 另写一份（加签由单测与应用的实现对照）。
  - 维护标记（Q4）：部署、回放（`--confirm`）、恢复、重放来信时写带到期时间的标记（默认 2 小时，`--maintenance-hours` 调），退出时清掉自己写的；宿主机检查见到没到期的不告警，过期的照常告警并注明「维护标记已过期」。运行器与宿主机检查经 `FORCOME_MAINTENANCE_FILE` 共用一个文件。
  - 开发测试环境演练用钉钉群机器人的接收替身 `deploy/robot-sink/`（Compose profile `robot-sink`，按加签核对、返回钉钉的 errcode）；现成的回显服务不返回 errcode、不核对加签，所以自己写了几十行。
- **日志**：json-file 只能按大小轮转、不能按天数：每个容器 30 × 20 MB（`LOG_MAX_FILE`、`LOG_MAX_SIZE`），按第一期的日志量能留 30 天以上，每月核对一次最旧的日志（运维手册第 7 节）。原文「保留 30 天」以此落实。
- **旧版本镜像**：部署全部成功后删掉本项目（按 Compose 给镜像打的项目标签）更早的 `forcome-server`、`forcome-web`、`forcome-smoke`、`forcome-robot-sink`，只留本次与上一次的版本；数据库镜像不动，还有容器在用的跳过。
- **密钥**：离线保管的清单与轮换写在运维手册第 5 节：数据库口令、主密钥、WAL-G 密钥、restic 口令四项随备份单独、离线保管（丢了后两项备份就解不开）。
- **工作流与脚本的静态检查**：`pnpm lint:workflows` 把文件打成 tar 经标准输入送进 actionlint 容器（不挂载本机目录：Docker 上下文指向远端主机时也能用），并用同一镜像里的 shellcheck 检查部署用的 shell 脚本；`deploy/verify.mjs` 另核对生产模板的 Compose 插值与 PostgreSQL 镜像能构建。
