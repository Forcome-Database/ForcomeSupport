// 部署脚本（ADR 0013 修订，待办 03）。仓库上 GitHub 之前在本机执行；之后由部署工作流在运行器上执行同一个脚本。
//
//   node deploy/deploy.mjs staging [deploy]     部署：构建镜像 → 起数据库 → 先跑 migrate → 灌示例数据
//                                               → 起 api、worker、caddy → 用根证书核对 HTTPS → Playwright 冒烟 → 报告
//   node deploy/deploy.mjs staging deploy --reset-inbound
//                                               同上，灌示例数据之后、起服务之前「重放来信」（识别或归并口径变了的
//                                               版本用它部署，冒烟在按新口径重新回放的数据上跑；只用于非生产环境）
//   node deploy/deploy.mjs staging smoke        对当前运行的版本重跑「用根证书核对 HTTPS」与冒烟
//   node deploy/deploy.mjs staging cert         导出 caddy 根证书（发给员工浏览器安装）并显示指纹
//   node deploy/deploy.mjs staging compose …    带上项目名、Compose 文件、环境文件与当前版本执行 docker compose
//   node deploy/deploy.mjs staging down         停止并删除容器（保留数据卷）
//   node deploy/deploy.mjs staging reset-inbound 对当前部署的版本重放来信：停 worker → 清空收信与工单 → 起 worker
//                                               （按当前口径重新回放示例来信；只用于非生产环境，docs/部署说明.md）
//   node deploy/deploy.mjs staging import-aftersales <登记表.xlsx|.csv> [--mapping <映射表.json>] [--dry-run]
//                                               用当前部署的版本导入售后登记表（待办 27；--dry-run 只报告不写库，
//                                               docs/部署说明.md「售后登记表导入」）
//   node deploy/deploy.mjs staging sp-api-token --seller <卖家 ID> < <放刷新令牌的文件>
//                                               用当前部署的版本录入某卖家的 SP-API 授权（待办 12；令牌从标准输入读、
//                                               加密存库，docs/部署说明.md 第 14 节）
//   node deploy/deploy.mjs staging order-backfill [--store <店铺名>]… [--again]
//                                               用当前部署的版本开始订单回补（待办 13；近 90 天，worker 在后台逐页做，
//                                               上线前、选定 T0 之前执行，docs/部署说明.md 第 15 节）
//   node deploy/deploy.mjs staging mail-replay [--t0 <时刻>] [--confirm]
//                                               用当前部署的版本回放近 90 天邮件并切换到实时处理（待办 26；不加 --confirm
//                                               只看计划；加了先停 worker、回放完成后再起，docs/部署说明.md 第 16 节）
//   以下随待办 28（生产部署、备份与监控，docs/运维手册.md）：
//   node deploy/deploy.mjs production [deploy]  生产部署：同上但不灌示例数据、不跑冒烟，执行迁移前先做一次完整备份（pre_migrate）
//   node deploy/deploy.mjs <环境> backup [list | verify-retention]
//                                               立即备份一次 / 列出基础备份与快照 / 核对保留策略
//   node deploy/deploy.mjs <环境> restore (--target-time <时刻> | --latest) [--backup <名>] [--confirm]
//                                               把数据库恢复到某个时点（覆盖现有数据；不加 --confirm 只看用哪份基础备份）
//   node deploy/deploy.mjs <环境> restore-drill [--target-time <时刻>]
//                                               恢复演练：在临时卷里恢复到指定时点并核对、报告用时，不碰正在运行的库
//   node deploy/deploy.mjs <环境> host-check [--webhook <地址>]
//                                               宿主机检查一次 worker 存活与心跳，异常发钉钉群机器人（systemd 定时器每分钟执行）
//   node deploy/deploy.mjs <环境> alert-test [--webhook <地址>]
//                                               经 worker 与宿主机两路各发一条「告警通道已连通」
//   node deploy/deploy.mjs <环境> maintenance [--hours <小时>] [--reason <原因>] | maintenance --clear
//                                               手动写或清维护标记（期间宿主机检查不告警）；部署、回放、恢复等命令自动写、
//                                               退出时清（--maintenance-hours 调时长，默认 2 小时）
//
// 只依赖 Node（≥ 22）、git 与 Docker（含 compose），不需要 pnpm install；Linux 服务器与 Windows 本机通用。
// 环境文件默认 deploy/.env.<环境>，可用 FORCOME_ENV_FILE 指到别处；部署产物（根证书、报告）在 deploy/.state/<环境>/。
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  BACKUP_SYNOPSIS,
  backupRun,
  durationWords,
  RESTORE_DRILL_SYNOPSIS,
  RESTORE_SYNOPSIS,
  restoreDrillRun,
  restoreResults,
  restoreRun,
} from './lib/backup.mjs';
import { composeEnvironment } from './lib/compose.mjs';
import { sendRobotMessage } from './lib/dingtalk-robot.mjs';
import {
  createEnvFile,
  envFilePermissionProblem,
  GENERATED_SECRETS,
  readDeployEnv,
} from './lib/env-file.mjs';
import { ENVIRONMENTS } from './lib/environments.mjs';
import {
  formatHostAlert,
  HEARTBEAT_SQL,
  hostAlertBrand,
  hostFindings,
  hostTime,
  parseHeartbeatRow,
  planHostAlerts,
} from './lib/host-check.mjs';
import { staleImages } from './lib/images.mjs';
import {
  maintenanceMarker,
  maintenanceState,
  parseMaintenance,
  takeMaintenanceHours,
} from './lib/maintenance.mjs';
import { httpsGet, verifyCertificate } from './lib/https-check.mjs';
import { IMPORT_AFTERSALES_SYNOPSIS, importAftersalesRun } from './lib/import-aftersales.mjs';
import { MAIL_REPLAY_SYNOPSIS, mailReplayRun } from './lib/mail-replay.mjs';
import { ORDER_BACKFILL_SYNOPSIS, orderBackfillRun } from './lib/order-backfill.mjs';
import { capture, mustRun, run } from './lib/process.mjs';
import { SP_API_TOKEN_SYNOPSIS, spApiTokenRun } from './lib/sp-api-token.mjs';
import { formatReport, summarizePlaywright } from './lib/report.mjs';

const ROOT_CERT_IN_CADDY = '/data/caddy/pki/authorities/local/root.crt';
const USAGE = `用法：node deploy/deploy.mjs <环境> [deploy [--reset-inbound] | smoke | cert | compose <参数…> | down | reset-inbound
  | ${IMPORT_AFTERSALES_SYNOPSIS} | ${SP_API_TOKEN_SYNOPSIS} | ${ORDER_BACKFILL_SYNOPSIS}
  | ${MAIL_REPLAY_SYNOPSIS}
  | ${BACKUP_SYNOPSIS} | ${RESTORE_SYNOPSIS} | ${RESTORE_DRILL_SYNOPSIS}
  | host-check [--webhook <地址>] | alert-test [--webhook <地址>]
  | maintenance [--hours <小时>] [--reason <原因>] | maintenance --clear]
部署、回放（--confirm）、恢复、重放来信另可加 --maintenance-hours <小时>（维护标记的时长，默认 2）
环境：${Object.keys(ENVIRONMENTS).join('、')}`;

// 命令行里给的文件（售后登记表导入）按调用者所在的目录解析：pnpm 运行脚本时把它放在 INIT_CWD
const invokedFrom = process.env.INIT_CWD ?? process.cwd();
// 所有路径相对仓库根目录（Docker 在 Windows 上把「盘符:」当成容器名，所以不用绝对路径）
process.chdir(path.resolve(import.meta.dirname, '..'));

const [environmentName, command = 'deploy', ...commandArgs] = process.argv.slice(2);
const environment = ENVIRONMENTS[environmentName ?? ''];
if (!environment) {
  console.error(USAGE);
  process.exit(2);
}

const envFile = process.env.FORCOME_ENV_FILE ?? `deploy/.env.${environment.name}`;
const stateDir = `deploy/.state/${environment.name}`;
const releaseFile = `${stateDir}/release`;
const rootCertFile = `${stateDir}/caddy-root.crt`;
const smokeReportDir = `${stateDir}/smoke-report`;
// 维护标记与宿主机检查的状态（待办 28）：运行器与宿主机检查不在同一个工作区时，两边都用环境变量指到同一个文件
const maintenanceFile = process.env.FORCOME_MAINTENANCE_FILE ?? `${stateDir}/maintenance.json`;
const hostCheckStateFile = process.env.FORCOME_HOST_CHECK_STATE ?? `${stateDir}/host-check.json`;

/** 第一次在本机部署时从模板生成环境文件（随机口令）；服务器上的环境文件由运维填写，缺了就报错 */
function ensureEnvFile() {
  if (existsSync(envFile)) return;
  if (process.env.FORCOME_ENV_FILE || environment.appEnv === 'production') {
    const example =
      environment.appEnv === 'production'
        ? 'deploy/.env.production.example'
        : 'deploy/.env.example';
    throw new Error(`找不到环境文件 ${envFile}：按 ${example} 填写（权限 600）`);
  }
  const secrets = Object.fromEntries(
    GENERATED_SECRETS.map((name) => [
      name,
      randomBytes(name === 'WALG_LIBSODIUM_KEY' ? 32 : 24).toString('hex'),
    ]),
  );
  const text = createEnvFile(readFileSync('deploy/.env.example', 'utf8'), secrets);
  writeFileSync(envFile, text, { mode: 0o600 });
  console.log(`已从 deploy/.env.example 生成 ${envFile}（随机数据库口令与备份密钥；不进 git）`);
}

function loadDeployEnv() {
  ensureEnvFile();
  const deployEnv = readDeployEnv(readFileSync(envFile, 'utf8'), environment);
  const permission = envFilePermissionProblem(
    statSync(envFile).mode,
    process.platform,
    environment,
  );
  if (permission) deployEnv.problems.push(permission);
  if (deployEnv.problems.length > 0) {
    throw new Error(`环境文件 ${envFile} 有误：\n${deployEnv.problems.join('\n')}`);
  }
  return deployEnv;
}

/** 镜像版本：当前提交号；工作区有未提交的改动时加 -dirty（只会出现在本机部署） */
function currentRelease() {
  const commit = capture('git', ['rev-parse', '--short=12', 'HEAD']);
  const dirty = capture('git', ['status', '--porcelain']) !== '';
  return dirty ? `${commit}-dirty` : commit;
}

function deployedRelease() {
  if (!existsSync(releaseFile)) {
    throw new Error(`${releaseFile} 不存在：先运行 node deploy/deploy.mjs ${environment.name}`);
  }
  return readFileSync(releaseFile, 'utf8').trim();
}

/** 本环境的 docker compose：固定项目名、Compose 文件与环境文件，环境文件是变量的唯一来源 */
function composeFor(deployEnv, release) {
  const env = composeEnvironment({
    processEnv: process.env,
    envFileVars: deployEnv.vars,
    release,
    lockText: readFileSync('pnpm-lock.yaml', 'utf8'),
  });
  const base = ['compose', '-p', environment.project, '-f', 'deploy/compose.yml'];
  const args = (rest) => [...base, '--env-file', envFile, ...rest];
  return {
    /** 执行，退出码不为 0 时抛错 */
    run: (...rest) => mustRun('docker', args(rest), { env }),
    /** 执行，返回退出码 */
    status: (...rest) => run('docker', args(rest), { env }),
    capture: (...rest) => capture('docker', args(rest), { env }),
    /** 执行并取回全部输出与退出码（失败时也要输出里的内容，如恢复脚本的 RESTORE_* 行） */
    output: (...rest) => {
      const result = spawnSync('docker', args(rest), { env, encoding: 'utf8' });
      if (result.error) throw result.error;
      return { status: result.status, text: `${result.stdout}${result.stderr}` };
    },
  };
}

/** 等 caddy 签好根证书后导出到本机，返回 PEM 与 SHA-256 指纹 */
async function exportRootCert(compose) {
  mkdirSync(stateDir, { recursive: true });
  for (let attempt = 1; ; attempt += 1) {
    rmSync(rootCertFile, { force: true });
    if (compose.status('cp', `caddy:${ROOT_CERT_IN_CADDY}`, rootCertFile) === 0) break;
    if (attempt === 15) throw new Error('caddy 没有生成内部 CA 的根证书');
    await sleep(2_000);
  }
  const pem = readFileSync(rootCertFile, 'utf8');
  return { pem, fingerprint: new X509Certificate(pem).fingerprint256 };
}

/** 用根证书核对证书链与域名，再经 HTTPS 取健康检查与首页；caddy 刚起来时签证书要几秒，失败先重试 */
async function checkHttps(deployEnv, ca) {
  const target = {
    host: deployEnv.connectHost,
    port: deployEnv.httpsPort,
    servername: deployEnv.siteHost,
    ca,
  };
  let lastError;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    try {
      const certificate = await verifyCertificate(target);
      console.log(
        `证书受信：${certificate.names}，签发者 ${certificate.issuer}，到期 ${certificate.validTo}`,
      );
      const health = await httpsGet(target, '/api/health');
      if (health.status !== 200 || JSON.parse(health.body).status !== 'ok') {
        throw new Error(`/api/health 返回 ${health.status}：${health.body}`);
      }
      const home = await httpsGet(target, '/');
      if (home.status !== 200 || !home.body.includes('<div id="root">')) {
        throw new Error(`首页返回 ${home.status}`);
      }
      console.log('HTTPS 正常：/api/health 为 ok，首页可以打开');
      return;
    } catch (error) {
      lastError = error;
      await sleep(2_000);
    }
  }
  throw new Error(`HTTPS 核对失败：${lastError.code ?? ''} ${lastError.message}`.trim());
}

/**
 * 核对 api、worker、caddy 都在运行，且用的是本次构建的镜像；备份服务也在运行。备份服务是数据库镜像（固定标签 forcome-postgres:18）：
 * 内容没变时重新构建也会换一个镜像 ID（构建证明的时刻不同），标签移走、Compose 不重建容器（内容相同），ps 里就只剩 ID，所以只核对在运行
 */
function checkRunningRelease(compose, release) {
  const expected = {
    api: `forcome-server:${release}`,
    worker: `forcome-server:${release}`,
    caddy: `forcome-web:${release}`,
    backup: null,
  };
  const lines = compose
    .capture('ps', '--format', 'json', 'api', 'worker', 'caddy', 'backup')
    .split('\n');
  const running = lines.filter(Boolean).map((line) => JSON.parse(line));
  for (const [service, image] of Object.entries(expected)) {
    const container = running.find((c) => c.Service === service);
    if (!container || container.State !== 'running' || (image && container.Image !== image)) {
      const actual = container ? `${container.State} ${container.Image}` : '没有容器';
      throw new Error(`${service} 没有${image ? `以 ${image} ` : ''}运行（${actual}）`);
    }
  }
}

/** 在一次性容器里跑 Playwright，取回报告，返回汇总；失败时抛出的错误带着汇总 */
function runSmoke(compose) {
  const name = `${environment.project}-smoke`;
  run('docker', ['rm', '-f', name], { stdio: 'ignore' });
  const status = compose.status('run', '--no-deps', '--name', name, 'smoke');
  rmSync(smokeReportDir, { recursive: true, force: true });
  const copied = run('docker', ['cp', `${name}:/report`, smokeReportDir]);
  run('docker', ['rm', '-f', name], { stdio: 'ignore' });
  const resultsFile = `${smokeReportDir}/results.json`;
  const summary =
    copied === 0 && existsSync(resultsFile)
      ? summarizePlaywright(JSON.parse(readFileSync(resultsFile, 'utf8')))
      : null;
  if (status !== 0) {
    throw Object.assign(new Error(`Playwright 冒烟失败（报告在 ${smokeReportDir}/html）`), {
      summary,
    });
  }
  return summary;
}

/** 依次执行步骤；某步失败后其余标为未执行，最后统一出报告 */
function stepRunner() {
  const results = [];
  async function step(name, action) {
    if (results.some((s) => s.status === 'failed')) {
      results.push({ name, status: 'skipped' });
      return undefined;
    }
    console.log(`\n▶ ${name}`);
    const started = performance.now();
    const seconds = () => (performance.now() - started) / 1000;
    try {
      const value = await action();
      results.push({ name, status: 'passed', seconds: seconds() });
      return value;
    } catch (error) {
      const detail = String(error.message).split('\n')[0];
      results.push({ name, status: 'failed', seconds: seconds(), detail });
      console.error(`✗ ${name}：${error.message}`);
      // 冒烟失败时也要把已取回的汇总写进报告
      return error.summary;
    }
  }
  return { step, results };
}

function publishReport(report) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(`${stateDir}/report.md`, report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }
  console.log(`\n${report}\n报告：${stateDir}/report.md`);
}

// ---------------------------------------------------------------- 维护标记（待办 28，协调者决定 Q4）

/** 写维护标记（期间宿主机检查不告警），返回清掉它的函数：只清自己写的那一份（按 token） */
function beginMaintenance(reason, hours) {
  const token = randomUUID();
  mkdirSync(path.dirname(maintenanceFile), { recursive: true });
  const marker = maintenanceMarker({ reason, hours, now: new Date(), token });
  writeFileSync(maintenanceFile, `${JSON.stringify(marker, null, 2)}\n`);
  console.log(
    `已写维护标记（${reason}，到 ${hostTime(new Date(marker.until))} 为止宿主机检查不告警）：${maintenanceFile}`,
  );
  return () => {
    const current = parseMaintenance(
      existsSync(maintenanceFile) ? readFileSync(maintenanceFile, 'utf8') : null,
    );
    if (current?.token === token) {
      rmSync(maintenanceFile, { force: true });
      console.log('已清掉维护标记');
    }
  };
}

/** 在维护标记下执行：成功、失败、抛错都清掉自己写的标记 */
async function withMaintenance(reason, hours, action) {
  const end = beginMaintenance(reason, hours);
  try {
    return await action();
  } finally {
    end();
  }
}

/** 部署成功后删掉旧版本的镜像，只留本次与上一次的（回退用）；删不掉的（还有容器在用）跳过 */
function removeStaleImages(keep) {
  const listed = capture('docker', [
    'image',
    'ls',
    '--filter',
    `label=com.docker.compose.project=${environment.project}`,
    '--format',
    '{{.Repository}}:{{.Tag}}',
  ]).split('\n');
  const stale = staleImages(listed, keep);
  for (const ref of stale) {
    run('docker', ['image', 'rm', ref], { stdio: 'ignore' });
  }
  console.log(
    stale.length > 0
      ? `删掉旧版本的镜像 ${stale.length} 个（只留 ${keep.filter(Boolean).join('、')}）`
      : '没有要删的旧镜像',
  );
}

/** 在数据库容器里执行一条 SQL，取回文本（-At，列以 | 分隔） */
function psqlIn(compose, deployEnv, statement) {
  return compose.capture(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-X',
    '-At',
    '-F',
    '|',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    deployEnv.vars.POSTGRES_USER,
    '-d',
    deployEnv.vars.POSTGRES_DB,
    '-c',
    statement,
  );
}

/** 重放来信只用于非生产环境：deploy --reset-inbound 与 reset-inbound 两个入口在动手之前都先问它 */
function refuseResetInProduction() {
  if (environment.appEnv !== 'production') return false;
  console.error('生产环境不能清空收信与工单');
  return true;
}

/**
 * 重放来信（待办 10，ADR 0013 修订）：先停 worker，再用 compose 当前指向的镜像执行 dist/reset-inbound.mjs，
 * 清掉收取的邮件、邮箱游标、工单与客户；worker 再起来时重新 watch，Fake Gmail 按当前口径重新回放示例来信。
 * 调用方先用 refuseResetInProduction 挡住生产环境（镜像里的入口与清理函数也各拒绝一次）。
 */
function resetInbound(compose) {
  compose.run('stop', 'worker');
  compose.run('run', '--rm', '--no-deps', 'migrate', 'node', 'dist/reset-inbound.mjs');
}

async function deploy({ smokeOnly, resetInboundData = false }) {
  const { step, results } = stepRunner();
  let deployEnv;
  let release;
  let compose;
  let rootCert = null;
  let smoke = null;

  await step('准备（环境文件、版本）', () => {
    deployEnv = loadDeployEnv();
    release = smokeOnly ? deployedRelease() : currentRelease();
    compose = composeFor(deployEnv, release);
    mkdirSync(stateDir, { recursive: true });
    console.log(`环境 ${environment.name} · Compose 项目 ${environment.project} · 版本 ${release}`);
  });
  // 上一次部署的版本：部署成功后它的镜像留着（回退用），更早的删掉
  const previousRelease = existsSync(releaseFile) ? deployedRelease() : null;
  if (!smokeOnly) {
    await step('构建镜像', () =>
      compose.run('build', 'postgres', 'migrate', 'caddy', ...(environment.smoke ? ['smoke'] : [])),
    );
    await step('启动数据库', () => compose.run('up', '-d', '--wait', 'postgres'));
    if (environment.backupBeforeMigrate) {
      // 生产迁移前自动备份（ADR 0013）：WAL-G 基础备份 + pg_dump，失败即停、不迁移
      await step('迁移前备份（pre_migrate）', () =>
        compose.run('run', '--rm', '--no-deps', 'backup', 'forcome-backup', 'run', 'pre_migrate'),
      );
    }
    await step('执行迁移（migrate）', () => compose.run('run', '--rm', '--no-deps', 'migrate'));
    if (environment.seed) {
      await step('灌示例数据（seed）', () => compose.run('run', '--rm', '--no-deps', 'seed'));
    }
    if (resetInboundData) {
      // 用本次构建的镜像清空；下一步起 worker 时按新口径重新回放
      await step('重放来信（清空收信与工单）', () => resetInbound(compose));
    }
    await step('启动 api、worker、caddy 与备份服务', () => {
      // 同一个版本再部署一次时，重新构建的镜像换了 ID（构建证明的时刻不同）、标签移到新 ID，Compose 却不重建容器，
      // 容器还跑着上一次构建、ps 里只剩 ID：带版本的三个服务一律重建，确保跑的是本次构建
      compose.run('up', '-d', '--wait', '--no-deps', '--force-recreate', 'api', 'worker', 'caddy');
      compose.run('up', '-d', '--wait', '--no-deps', 'backup');
      checkRunningRelease(compose, release);
      writeFileSync(releaseFile, `${release}\n`);
    });
  }
  await step('内网 HTTPS（用导出的根证书核对）', async () => {
    rootCert = await exportRootCert(compose);
    await checkHttps(deployEnv, rootCert.pem);
  });
  if (environment.smoke) {
    smoke = await step('Playwright 冒烟（apps/web/e2e）', () => runSmoke(compose));
  }
  if (!smokeOnly && results.every((s) => s.status === 'passed')) {
    // 清理失败不算部署失败
    try {
      removeStaleImages([release, previousRelease]);
    } catch (error) {
      console.warn(`清理旧镜像时出错（不影响部署）：${error.message}`);
    }
  }

  publishReport(
    formatReport({
      environment,
      release: release ?? '（未知）',
      url: deployEnv?.siteUrl ?? '（未知）',
      rootCertFingerprint: rootCert?.fingerprint ?? null,
      steps: results,
      smoke: smoke ?? null,
    }),
  );
  return results.every((s) => s.status === 'passed');
}

// ---------------------------------------------------------------- 宿主机检查与告警（待办 28）

/** 命令行的 --webhook <地址>（演练时让宿主机这一路发到接收替身）；没给为环境文件的 DINGTALK_ROBOT_WEBHOOK */
function robotOf(deployEnv, args) {
  const index = args.indexOf('--webhook');
  const webhook = index === -1 ? deployEnv.vars.DINGTALK_ROBOT_WEBHOOK : args[index + 1];
  return webhook ? { webhook, secret: deployEnv.vars.DINGTALK_ROBOT_SECRET || null } : null;
}

/** 本项目某个服务的容器（不含 compose run 的一次性容器）：ID 与状态；没有为 null */
function serviceContainer(service) {
  const line = capture('docker', [
    'ps',
    '-a',
    '--filter',
    `label=com.docker.compose.project=${environment.project}`,
    '--filter',
    `label=com.docker.compose.service=${service}`,
    '--filter',
    'label=com.docker.compose.oneoff=False',
    '--format',
    '{{.ID}} {{.State}}',
  ]).split('\n')[0];
  if (!line) return null;
  const [id, state] = line.split(' ');
  return { id, state };
}

/** 宿主机看到的情况：worker 容器、数据库里的心跳与上线切换状态。不依赖部署的版本文件，宿主机上的定时器直接用 */
function observeHost(deployEnv) {
  const worker = serviceContainer('worker');
  const startedAt =
    worker && worker.state === 'running'
      ? new Date(capture('docker', ['inspect', '-f', '{{.State.StartedAt}}', worker.id]))
      : null;
  const postgres = serviceContainer('postgres');
  let row = null;
  let databaseError = null;
  if (postgres?.state === 'running') {
    try {
      row = parseHeartbeatRow(
        capture('docker', [
          'exec',
          postgres.id,
          'psql',
          '-X',
          '-At',
          '-F',
          '|',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          deployEnv.vars.POSTGRES_USER,
          '-d',
          deployEnv.vars.POSTGRES_DB,
          '-c',
          HEARTBEAT_SQL,
        ]),
      );
    } catch (error) {
      databaseError = String(error.message).split('\n')[0].slice(0, 200);
    }
  } else {
    databaseError = postgres ? `数据库容器 ${postgres.state}` : '没有数据库容器';
  }
  return {
    workerState: worker?.state ?? null,
    workerStartedAt: startedAt,
    databaseReachable: row !== null,
    databaseError,
    heartbeatAt: row?.heartbeatAt ?? null,
    now: row?.now ?? new Date(),
    cutover: row?.cutover ?? null,
  };
}

/** 宿主机检查一次：有要发的就发钉钉群机器人，发出去（或没配置机器人）才记状态 */
async function hostCheck(args) {
  const deployEnv = loadDeployEnv();
  const vars = deployEnv.vars;
  const observed = observeHost(deployEnv);
  const findings = hostFindings(observed, {
    heartbeatMinutes: Number(vars.HOST_CHECK_HEARTBEAT_MINUTES || 3),
  });
  const heartbeat = observed.heartbeatAt ? hostTime(observed.heartbeatAt) : '—';
  console.log(
    `worker ${observed.workerState ?? '没有容器'} · 心跳 ${heartbeat} · 上线切换 ${observed.cutover ?? '—'} · ` +
      `${findings.length > 0 ? `异常 ${findings.length} 项：${findings.map((f) => f.key).join('、')}` : '正常'}`,
  );
  const now = new Date();
  const maintenance = maintenanceState(
    parseMaintenance(existsSync(maintenanceFile) ? readFileSync(maintenanceFile, 'utf8') : null),
    now,
  );
  if (maintenance.state === 'active') {
    console.log(
      `维护中（${maintenance.marker.reason}，到 ${hostTime(new Date(maintenance.marker.until))}）：不发告警`,
    );
    return true;
  }
  let state = {};
  try {
    if (existsSync(hostCheckStateFile))
      state = JSON.parse(readFileSync(hostCheckStateFile, 'utf8'));
  } catch {
    console.warn(`状态文件 ${hostCheckStateFile} 读不懂，当作没有正在告警的项`);
  }
  // 连不上数据库时看不到心跳：原来在告警的「心跳停止」照旧算在告警，不误报「已恢复」
  if (!observed.databaseReachable && state['worker:heartbeat']) {
    findings.push({ key: 'worker:heartbeat', ...state['worker:heartbeat'] });
  }
  const repeatMs = Number(vars.ALERT_REPEAT_HOURS || 2) * 3_600_000;
  const plan = planHostAlerts(findings, state, now, repeatMs);
  if (!plan.send) return true;
  const message = formatHostAlert(plan, {
    appEnv: vars.APP_ENV,
    now,
    expiredMaintenance: maintenance.state === 'expired' ? maintenance.marker : null,
  });
  console.log(`\n${message.markdown}\n`);
  const robot = robotOf(deployEnv, args);
  if (robot) {
    try {
      await sendRobotMessage(robot, message);
      console.log('已发到钉钉群机器人');
    } catch (error) {
      console.error(`告警发送失败（下一次检查再发）：${error.message}`);
      return false;
    }
  } else {
    console.warn('没有配置 DINGTALK_ROBOT_WEBHOOK：告警只打在这里');
  }
  mkdirSync(path.dirname(hostCheckStateFile), { recursive: true });
  writeFileSync(hostCheckStateFile, `${JSON.stringify(plan.nextState, null, 2)}\n`);
  return true;
}

/** 两路各发一条「告警通道已连通」：worker 的群机器人客户端（一次性容器）与宿主机检查 */
async function alertTest(args) {
  const deployEnv = loadDeployEnv();
  const release = deployedRelease();
  const compose = composeFor(deployEnv, release);
  console.log('▶ 经 worker 的群机器人客户端发（一次性容器 dist/alert-test.mjs）');
  const viaWorker =
    compose.status(
      'run',
      '--rm',
      '--no-deps',
      'migrate',
      'node',
      'dist/alert-test.mjs',
      '--release',
      release,
    ) === 0;
  console.log('▶ 经宿主机检查发');
  const robot = robotOf(deployEnv, args);
  let viaHost = false;
  if (!robot) {
    console.error('没有配置 DINGTALK_ROBOT_WEBHOOK');
  } else {
    const brand = hostAlertBrand(deployEnv.vars.APP_ENV);
    const title = `${brand}告警通道已连通`;
    try {
      await sendRobotMessage(robot, {
        title,
        markdown: [
          `#### ${title}`,
          '',
          '这是一条测试消息：宿主机检查（worker 存活与心跳）发现的异常会发到这个群。',
          '',
          `版本 ${release}`,
          '',
          `发送时刻 ${hostTime(new Date())}`,
        ].join('\n'),
      });
      console.log('已发出');
      viaHost = true;
    } catch (error) {
      console.error(`发送失败：${error.message}`);
    }
  }
  return viaWorker && viaHost;
}

// ---------------------------------------------------------------- 备份与恢复（待办 28）

/** 等数据库恢复完成（promote）：重放 WAL 期间连不上或还在恢复中，每 2 秒看一次，最多 4 小时（RTO） */
async function waitForPromotion(compose, deployEnv) {
  const deadline = Date.now() + 4 * 3_600_000;
  for (;;) {
    try {
      if (psqlIn(compose, deployEnv, 'SELECT pg_is_in_recovery()') === 'f') return;
    } catch {
      // 还在启动（the database system is starting up）
    }
    if (Date.now() > deadline) throw new Error('4 小时内没有恢复完成');
    await sleep(2_000);
  }
}

/** 把本环境的数据库恢复到目标时点（覆盖现有数据）。每一步计时，最后报告合计（RTO 4 小时） */
async function restore(planned) {
  const deployEnv = loadDeployEnv();
  const compose = composeFor(deployEnv, deployedRelease());
  if (!planned.confirm) {
    compose.run('run', '--rm', '--no-deps', 'restore', 'forcome-restore', 'list');
    console.log(
      `\n要把 ${environment.title} 的数据库恢复到 ${planned.targetTime ?? '最新'}` +
        `${planned.backup ? `（用基础备份 ${planned.backup}）` : '（用结束时刻不晚于目标时点的最近一份基础备份）'}：` +
        '加 --confirm 执行。会停 api、worker 与数据库，现有数据目录改名留在卷里（docs/运维手册.md 第 3 节）',
    );
    return true;
  }
  const { step, results } = stepRunner();
  const started = performance.now();
  let base = null;
  await step('停 api、worker、备份服务与数据库', () => {
    compose.run('stop', 'api', 'worker', 'backup');
    compose.run('stop', 'postgres');
  });
  await step('取回基础备份（forcome-restore prepare）', () => {
    const { status, text } = compose.output(
      'run',
      '--rm',
      '--no-deps',
      'restore',
      ...planned.prepare,
    );
    console.log(text);
    base = restoreResults(text);
    if (status !== 0) throw new Error(`forcome-restore prepare 退出码 ${status}`);
  });
  await step(`起数据库，重放 WAL 到 ${planned.targetTime ?? '最新'}（promote）`, async () => {
    compose.run('up', '-d', '--wait', '--no-deps', 'postgres');
    await waitForPromotion(compose, deployEnv);
  });
  await step('清恢复参数（forcome-restore finish）', () =>
    compose.run('exec', '-T', 'postgres', 'forcome-restore', 'finish'),
  );
  await step('新时间线的第一份基础备份（after_restore）', () =>
    compose.run('run', '--rm', '--no-deps', 'backup', 'forcome-backup', 'run', 'after_restore'),
  );
  await step('起 api、worker、caddy 与备份服务', () =>
    compose.run('up', '-d', '--wait', '--no-deps', 'api', 'worker', 'caddy', 'backup'),
  );
  const total = (performance.now() - started) / 1000;
  const succeeded = results.every((s) => s.status === 'passed');
  const report = [
    `## 恢复${environment.title}（${environment.name}）：${succeeded ? '成功' : '失败'}`,
    '',
    `- 目标时点：${planned.targetTime ?? '最新（重放全部已归档的 WAL）'}`,
    `- 基础备份：${base?.BASE_BACKUP ?? '—'}（结束于 ${base?.BASE_FINISHED ?? '—'}）`,
    `- 合计用时：${durationWords(total)}（目标 RTO 4 小时）`,
    '',
    '| 步骤 | 结果 | 用时 |',
    '|---|---|---|',
    ...results.map(
      (s) =>
        `| ${s.name} | ${s.status === 'passed' ? '✅ 通过' : s.status === 'skipped' ? '⏭ 未执行' : `❌ 失败：${s.detail ?? ''}`} | ${s.seconds === undefined ? '—' : durationWords(s.seconds)} |`,
    ),
  ].join('\n');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(`${stateDir}/restore-report.md`, `${report}\n`);
  console.log(`\n${report}\n报告：${stateDir}/restore-report.md`);
  if (succeeded) {
    console.log(
      '核对数据无误后，删掉卷里改名留着的原数据目录（docs/运维手册.md 第 3 节）；恢复后先对账外部动作的结果（第一期只有钉钉工作通知）',
    );
  }
  return succeeded;
}

/** WAL 切段并等它归档（演练的目标时点之后的写入要进归档，恢复时才能重放到目标时点） */
async function switchAndWaitArchived(compose, deployEnv) {
  const segment = psqlIn(compose, deployEnv, 'SELECT pg_walfile_name(pg_switch_wal())');
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const archived = psqlIn(
      compose,
      deployEnv,
      "SELECT coalesce(last_archived_wal, '') FROM pg_stat_archiver",
    );
    if (archived >= segment) return segment;
    if (Date.now() > deadline)
      throw new Error(`WAL 段 ${segment} 10 分钟内没有归档（最近归档 ${archived || '—'}）`);
    await sleep(2_000);
  }
}

/**
 * 恢复演练：不给目标时点时，在库里写「目标时点之前」「之后」两行标记，以两者之间的时刻为目标；在临时卷里从基础备份恢复到目标时点、
 * 核对（标记只剩前一行）、报告用时；最后删掉临时卷与标记表。正在运行的库照常服务
 */
async function restoreDrill(planned) {
  const deployEnv = loadDeployEnv();
  const compose = composeFor(deployEnv, deployedRelease());
  const marker = planned.targetTime === null;
  let target = planned.targetTime;
  const started = performance.now();
  let output = '';
  let ok = false;
  try {
    if (marker) {
      psqlIn(
        compose,
        deployEnv,
        'CREATE TABLE IF NOT EXISTS public.forcome_restore_drill (label text NOT NULL, at timestamptz NOT NULL DEFAULT clock_timestamp()); ' +
          "TRUNCATE public.forcome_restore_drill; INSERT INTO public.forcome_restore_drill (label) VALUES ('before')",
      );
      await sleep(2_000);
      target = psqlIn(
        compose,
        deployEnv,
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      );
      await sleep(2_000);
      psqlIn(
        compose,
        deployEnv,
        "INSERT INTO public.forcome_restore_drill (label) VALUES ('after')",
      );
      console.log(
        `演练标记：目标时点 ${target} 之前写 before、之后写 after；恢复出来应当只有 before`,
      );
    }
    console.log(`WAL 切段并等它归档：${await switchAndWaitArchived(compose, deployEnv)}`);
    const drill = compose.output(
      'run',
      '--rm',
      '--no-deps',
      'restore-drill',
      'forcome-restore-drill',
      '--target-time',
      target,
      ...(marker ? ['--expect-marker', 'before'] : []),
    );
    output = drill.text;
    console.log(output);
    if (drill.status !== 0) throw new Error(`forcome-restore-drill 退出码 ${drill.status}`);
    ok = true;
  } catch (error) {
    console.error(`恢复演练失败：${error.message}`);
  } finally {
    run('docker', ['volume', 'rm', '-f', `${environment.project}_restore_drill`], {
      stdio: 'ignore',
    });
    if (marker) {
      try {
        psqlIn(compose, deployEnv, 'DROP TABLE IF EXISTS public.forcome_restore_drill');
      } catch (error) {
        console.error(`删演练标记表时出错：${error.message}`);
      }
    }
  }
  const result = restoreResults(output);
  const report = [
    `## 恢复演练（${environment.title}，${environment.name}）：${ok && result.RESULT === 'ok' ? '通过' : '失败'}`,
    '',
    `- 时刻：${new Date().toISOString()}`,
    `- 目标时点：${target}${marker ? '（演练标记 before 之后、after 之前）' : ''}`,
    `- 基础备份：${result.BASE_BACKUP ?? '—'}（结束于 ${result.BASE_FINISHED ?? '—'}）`,
    `- 取回基础备份：${result.FETCH_SECONDS ? durationWords(Number(result.FETCH_SECONDS)) : '—'}`,
    `- 重放 WAL 到目标时点并 promote：${result.REPLAY_SECONDS ? durationWords(Number(result.REPLAY_SECONDS)) : '—'}`,
    `- 恢复合计（容器内）：${result.TOTAL_SECONDS ? durationWords(Number(result.TOTAL_SECONDS)) : '—'}；演练全程：${durationWords((performance.now() - started) / 1000)}（目标 RTO 4 小时）`,
    `- 核对：${result.RESULT ?? '没有完成'}`,
  ].join('\n');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(`${stateDir}/restore-drill-report.md`, `${report}\n`);
  console.log(`\n${report}\n报告：${stateDir}/restore-drill-report.md`);
  return ok && result.RESULT === 'ok';
}

async function main() {
  switch (command) {
    case 'deploy': {
      const options = takeMaintenanceHours(commandArgs);
      if ('error' in options) {
        console.error(options.error);
        return false;
      }
      const unknown = options.rest.filter((arg) => arg !== '--reset-inbound');
      if (unknown.length > 0) {
        console.error(`不认识的参数：${unknown.join(' ')}\n${USAGE}`);
        return false;
      }
      if (options.rest.includes('--reset-inbound') && refuseResetInProduction()) return false;
      return withMaintenance(`部署 ${currentRelease()}`, options.hours, () =>
        deploy({
          smokeOnly: false,
          resetInboundData: options.rest.includes('--reset-inbound'),
        }),
      );
    }
    case 'smoke':
      return deploy({ smokeOnly: true });
    case 'cert': {
      const compose = composeFor(loadDeployEnv(), deployedRelease());
      const { fingerprint } = await exportRootCert(compose);
      console.log(`根证书已导出到 ${rootCertFile}\nSHA-256 指纹：${fingerprint}`);
      return true;
    }
    case 'compose':
      return composeFor(loadDeployEnv(), deployedRelease()).status(...commandArgs) === 0;
    case 'down': {
      const release = existsSync(releaseFile) ? deployedRelease() : 'none';
      composeFor(loadDeployEnv(), release).run('down');
      return true;
    }
    case 'reset-inbound': {
      // 对当前部署的版本重放来信：清空后把 worker 起回来
      if (refuseResetInProduction()) return false;
      const options = takeMaintenanceHours(commandArgs);
      if ('error' in options) {
        console.error(options.error);
        return false;
      }
      const compose = composeFor(loadDeployEnv(), deployedRelease());
      return withMaintenance('重放来信', options.hours, () => {
        try {
          resetInbound(compose);
        } finally {
          // 不能用 compose start：worker 依赖一次性的 migrate（已 --rm 删掉），start 会报「缺少依赖」；
          // 与部署时一样用 up --no-deps 起它
          compose.run('up', '-d', '--wait', '--no-deps', 'worker');
        }
        console.log('已清空收信与工单，worker 已重启，示例来信几十秒内重新归并成工单');
        return true;
      });
    }
    case 'import-aftersales': {
      // 售后登记表导入（待办 27）：用当前部署的镜像起一次性容器，表格与映射表只读挂进 /import/，报告直接打到终端
      const planned = importAftersalesRun(commandArgs, (file) => path.resolve(invokedFrom, file));
      if ('error' in planned) {
        console.error(planned.error);
        return false;
      }
      const compose = composeFor(loadDeployEnv(), deployedRelease());
      const volumes = planned.volumes.flatMap((volume) => ['-v', volume]);
      return (
        compose.status('run', '--rm', '--no-deps', ...volumes, 'migrate', ...planned.command) === 0
      );
    }
    case 'sp-api-token': {
      // 录入卖家授权（待办 12）：一次性容器，-T 不分配终端，本命令的标准输入（刷新令牌）原样交给容器
      const planned = spApiTokenRun(commandArgs);
      if ('error' in planned) {
        console.error(planned.error);
        return false;
      }
      const compose = composeFor(loadDeployEnv(), deployedRelease());
      return compose.status('run', '--rm', '--no-deps', '-T', 'migrate', ...planned.command) === 0;
    }
    case 'order-backfill': {
      // 开始订单回补（待办 13）：一次性容器只登记并排上第一页，worker 在后台逐页做
      const planned = orderBackfillRun(commandArgs);
      if ('error' in planned) {
        console.error(planned.error);
        return false;
      }
      const compose = composeFor(loadDeployEnv(), deployedRelease());
      return compose.status('run', '--rm', '--no-deps', 'migrate', ...planned.command) === 0;
    }
    case 'mail-replay': {
      // 历史邮件回放与 T0 切换（待办 26）：不加 --confirm 只看计划；加了先停 worker，完成后再起
      const options = takeMaintenanceHours(commandArgs);
      if ('error' in options) {
        console.error(options.error);
        return false;
      }
      const planned = mailReplayRun(options.rest);
      if ('error' in planned) {
        console.error(planned.error);
        return false;
      }
      const compose = composeFor(loadDeployEnv(), deployedRelease());
      if (!planned.confirm) {
        return compose.status('run', '--rm', '--no-deps', 'migrate', ...planned.command) === 0;
      }
      // 回放期间 worker 是有意停掉的：写维护标记（宿主机检查另按「回放中」不判断 worker，标记过期后也不误报）
      return withMaintenance('上线切换：历史邮件回放', options.hours, () => {
        compose.run('stop', 'worker');
        if (compose.status('run', '--rm', '--no-deps', 'migrate', ...planned.command) !== 0) {
          console.error(
            '回放没有完成，worker 保持停止（回放排的任务只能由回放自己跑完）：按上面的提示处理后再执行同一命令接着回放（docs/部署说明.md 第 16 节）',
          );
          return false;
        }
        // 与部署时一样用 up --no-deps 起 worker（start 会因一次性的 migrate 已删除报缺依赖）
        compose.run('up', '-d', '--wait', '--no-deps', 'worker');
        console.log('worker 已启动：实时处理开启，T0 之后的邮件几分钟内同步进来');
        return true;
      });
    }
    case 'backup': {
      // 立即备份一次（种类 manual，同每日备份但不执行保留策略）/ 列出 / 核对保留策略：在备份服务的镜像里起一次性容器
      const planned = backupRun(commandArgs);
      if ('error' in planned) {
        console.error(planned.error);
        return false;
      }
      const compose = composeFor(loadDeployEnv(), deployedRelease());
      return compose.status('run', '--rm', '--no-deps', 'backup', ...planned.command) === 0;
    }
    case 'restore': {
      const options = takeMaintenanceHours(commandArgs);
      if ('error' in options) {
        console.error(options.error);
        return false;
      }
      const planned = restoreRun(options.rest);
      if ('error' in planned) {
        console.error(planned.error);
        return false;
      }
      if (!planned.confirm) return restore(planned);
      return withMaintenance(`恢复数据库到 ${planned.targetTime ?? '最新'}`, options.hours, () =>
        restore(planned),
      );
    }
    case 'restore-drill': {
      const planned = restoreDrillRun(commandArgs);
      if ('error' in planned) {
        console.error(planned.error);
        return false;
      }
      return restoreDrill(planned);
    }
    case 'host-check':
      return hostCheck(commandArgs);
    case 'alert-test':
      return alertTest(commandArgs);
    case 'maintenance': {
      // 手动写或清维护标记（计划内的停机：换服务器、改 NAS 等；部署脚本自己的命令会自动写）
      if (commandArgs.includes('--clear')) {
        rmSync(maintenanceFile, { force: true });
        console.log(`已清掉维护标记：${maintenanceFile}`);
        return true;
      }
      const hoursAt = commandArgs.indexOf('--hours');
      const reasonAt = commandArgs.indexOf('--reason');
      const hours = hoursAt === -1 ? 2 : Number(commandArgs[hoursAt + 1]);
      const reason = reasonAt === -1 ? '手动维护' : (commandArgs[reasonAt + 1] ?? '手动维护');
      const marker = maintenanceMarker({ reason, hours, now: new Date(), token: randomUUID() });
      mkdirSync(path.dirname(maintenanceFile), { recursive: true });
      writeFileSync(maintenanceFile, `${JSON.stringify(marker, null, 2)}\n`);
      console.log(
        `已写维护标记：${reason}，到 ${hostTime(new Date(marker.until))} 为止宿主机检查不告警（${maintenanceFile}；提前结束用 maintenance --clear）`,
      );
      return true;
    }
    default:
      console.error(USAGE);
      return false;
  }
}

try {
  process.exitCode = (await main()) ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
