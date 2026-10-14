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
//
// 只依赖 Node（≥ 22）、git 与 Docker（含 compose），不需要 pnpm install；Linux 服务器与 Windows 本机通用。
// 环境文件默认 deploy/.env.<环境>，可用 FORCOME_ENV_FILE 指到别处；部署产物（根证书、报告）在 deploy/.state/<环境>/。
import { randomBytes, X509Certificate } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { composeEnvironment } from './lib/compose.mjs';
import { createEnvFile, readDeployEnv } from './lib/env-file.mjs';
import { ENVIRONMENTS } from './lib/environments.mjs';
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
  | ${MAIL_REPLAY_SYNOPSIS}]
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

/** 第一次在本机部署时从模板生成环境文件（随机口令）；服务器上的环境文件由运维填写，缺了就报错 */
function ensureEnvFile() {
  if (existsSync(envFile)) return;
  if (process.env.FORCOME_ENV_FILE || environment.appEnv === 'production') {
    throw new Error(`找不到环境文件 ${envFile}：按 deploy/.env.example 填写（权限 600）`);
  }
  const text = createEnvFile(
    readFileSync('deploy/.env.example', 'utf8'),
    randomBytes(24).toString('hex'),
  );
  writeFileSync(envFile, text, { mode: 0o600 });
  console.log(`已从 deploy/.env.example 生成 ${envFile}（随机数据库口令；不进 git）`);
}

function loadDeployEnv() {
  ensureEnvFile();
  const deployEnv = readDeployEnv(readFileSync(envFile, 'utf8'), environment);
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

/** 核对 api、worker、caddy 都在运行，且用的是本次构建的镜像 */
function checkRunningRelease(compose, release) {
  const expected = {
    api: `forcome-server:${release}`,
    worker: `forcome-server:${release}`,
    caddy: `forcome-web:${release}`,
  };
  const lines = compose.capture('ps', '--format', 'json', 'api', 'worker', 'caddy').split('\n');
  const running = lines.filter(Boolean).map((line) => JSON.parse(line));
  for (const [service, image] of Object.entries(expected)) {
    const container = running.find((c) => c.Service === service);
    if (!container || container.State !== 'running' || container.Image !== image) {
      const actual = container ? `${container.State} ${container.Image}` : '没有容器';
      throw new Error(`${service} 没有以 ${image} 运行（${actual}）`);
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
  if (!smokeOnly) {
    await step('构建镜像', () =>
      compose.run('build', 'postgres', 'migrate', 'caddy', ...(environment.smoke ? ['smoke'] : [])),
    );
    await step('启动数据库', () => compose.run('up', '-d', '--wait', 'postgres'));
    await step('执行迁移（migrate）', () => compose.run('run', '--rm', '--no-deps', 'migrate'));
    if (environment.seed) {
      await step('灌示例数据（seed）', () => compose.run('run', '--rm', '--no-deps', 'seed'));
    }
    if (resetInboundData) {
      // 用本次构建的镜像清空；下一步起 worker 时按新口径重新回放
      await step('重放来信（清空收信与工单）', () => resetInbound(compose));
    }
    await step('启动 api、worker、caddy', () => {
      compose.run('up', '-d', '--wait', '--no-deps', 'api', 'worker', 'caddy');
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

async function main() {
  switch (command) {
    case 'deploy': {
      const unknown = commandArgs.filter((arg) => arg !== '--reset-inbound');
      if (unknown.length > 0) {
        console.error(`不认识的参数：${unknown.join(' ')}\n${USAGE}`);
        return false;
      }
      if (commandArgs.includes('--reset-inbound') && refuseResetInProduction()) return false;
      return deploy({
        smokeOnly: false,
        resetInboundData: commandArgs.includes('--reset-inbound'),
      });
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
      const compose = composeFor(loadDeployEnv(), deployedRelease());
      try {
        resetInbound(compose);
      } finally {
        // 不能用 compose start：worker 依赖一次性的 migrate（已 --rm 删掉），start 会报「缺少依赖」；
        // 与部署时一样用 up --no-deps 起它
        compose.run('up', '-d', '--wait', '--no-deps', 'worker');
      }
      console.log('已清空收信与工单，worker 已重启，示例来信几十秒内重新归并成工单');
      return true;
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
      const planned = mailReplayRun(commandArgs);
      if ('error' in planned) {
        console.error(planned.error);
        return false;
      }
      const compose = composeFor(loadDeployEnv(), deployedRelease());
      if (!planned.confirm) {
        return compose.status('run', '--rm', '--no-deps', 'migrate', ...planned.command) === 0;
      }
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
