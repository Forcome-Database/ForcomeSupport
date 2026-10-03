// 部署脚本（ADR 0013 修订，待办 03）。仓库上 GitHub 之前在本机执行；之后由部署工作流在运行器上执行同一个脚本。
//
//   node deploy/deploy.mjs staging              部署：构建镜像 → 起数据库 → 先跑 migrate → 灌示例数据
//                                               → 起 api、worker、caddy → 用根证书核对 HTTPS → Playwright 冒烟 → 报告
//   node deploy/deploy.mjs staging smoke        只对当前运行的版本重跑冒烟
//   node deploy/deploy.mjs staging cert         导出 caddy 根证书（发给员工浏览器安装）并显示指纹
//   node deploy/deploy.mjs staging compose …    带上项目名、Compose 文件、环境文件与当前版本执行 docker compose
//   node deploy/deploy.mjs staging down         停止并删除容器（保留数据卷）
//
// 只依赖 Node（≥ 22）、git 与 Docker（含 compose），不需要 pnpm install；Linux 服务器与 Windows 本机通用。
// 环境文件默认 deploy/.env.<环境>，可用 FORCOME_ENV_FILE 指到别处；部署产物（根证书、报告）在 deploy/.state/<环境>/。
import { spawnSync } from 'node:child_process';
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
import { createEnvFile, readDeployEnv } from './lib/env-file.mjs';
import { ENVIRONMENTS } from './lib/environments.mjs';
import { httpsGet, verifyCertificate } from './lib/https-check.mjs';
import { formatReport, playwrightVersion, summarizePlaywright } from './lib/report.mjs';

const ROOT_CERT_IN_CADDY = '/data/caddy/pki/authorities/local/root.crt';
const USAGE = `用法：node deploy/deploy.mjs <环境> [deploy | smoke | cert | compose <参数…> | down]
环境：${Object.keys(ENVIRONMENTS).join('、')}`;

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

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  return result;
}

function capture(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${program} ${args.join(' ')} 失败：${result.stderr.trim()}`);
  }
  return result.stdout.trim();
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

/**
 * 调用 docker compose。环境文件里写了的变量从子进程环境里去掉：Compose 让 shell 环境变量优先于 --env-file，
 * 不去掉的话本机或运行器上设的 HTTPS_PROXY 之类会悄悄盖过环境文件。
 */
function composeRunner(deployEnv, release) {
  const fromFile = new Set(Object.keys(deployEnv.vars).map((key) => key.toLowerCase()));
  const overridden = new Set(['compose_project_name', 'compose_file', 'compose_profiles']);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !fromFile.has(key.toLowerCase()) && !overridden.has(key.toLowerCase()),
    ),
  );
  env.RELEASE = release;
  env.PLAYWRIGHT_VERSION = playwrightVersion(readFileSync('pnpm-lock.yaml', 'utf8'));
  const base = [
    'compose',
    '-p',
    environment.project,
    '-f',
    'deploy/compose.yml',
    '--env-file',
    envFile,
  ];

  /** 执行并要求成功 */
  function compose(...args) {
    const { status } = run('docker', [...base, ...args], { env });
    if (status !== 0) {
      throw new Error(`docker compose ${args.join(' ')} 退出码 ${status}`);
    }
  }
  compose.status = (...args) => run('docker', [...base, ...args], { env }).status;
  compose.capture = (...args) => capture('docker', [...base, ...args], { env });
  return compose;
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
    host: deployEnv.httpsBind === '0.0.0.0' ? '127.0.0.1' : deployEnv.httpsBind,
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
      throw new Error(
        `${service} 没有以 ${image} 运行（${container ? `${container.State} ${container.Image}` : '没有容器'}）`,
      );
    }
  }
}

/** 在一次性容器里跑 Playwright，取回报告，返回汇总 */
function runSmoke(compose) {
  const name = `${environment.project}-smoke`;
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  const status = compose.status('run', '--no-deps', '--name', name, 'smoke');
  rmSync(smokeReportDir, { recursive: true, force: true });
  const copied = spawnSync('docker', ['cp', `${name}:/report`, smokeReportDir], {
    stdio: 'inherit',
  });
  spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  const resultsFile = `${smokeReportDir}/results.json`;
  const summary =
    copied.status === 0 && existsSync(resultsFile)
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
  const steps = [];
  async function step(name, action) {
    if (steps.some((s) => s.status === 'failed')) {
      steps.push({ name, status: 'skipped' });
      return undefined;
    }
    console.log(`\n▶ ${name}`);
    const started = performance.now();
    const seconds = () => (performance.now() - started) / 1000;
    try {
      const value = await action();
      steps.push({ name, status: 'passed', seconds: seconds() });
      return value;
    } catch (error) {
      const detail = String(error.message).split('\n')[0];
      steps.push({ name, status: 'failed', seconds: seconds(), detail });
      console.error(`✗ ${name}：${error.message}`);
      return error.summary;
    }
  }
  step.results = steps;
  return step;
}

function publishReport(report) {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(`${stateDir}/report.md`, report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }
  console.log(`\n${report}\n报告：${stateDir}/report.md`);
}

async function deploy({ smokeOnly }) {
  const step = stepRunner();
  let deployEnv;
  let release;
  let compose;
  let rootCert = null;
  let smoke = null;

  await step('准备（环境文件、版本）', () => {
    deployEnv = loadDeployEnv();
    release = smokeOnly ? deployedRelease() : currentRelease();
    compose = composeRunner(deployEnv, release);
    mkdirSync(stateDir, { recursive: true });
    console.log(`环境 ${environment.name} · Compose 项目 ${environment.project} · 版本 ${release}`);
  });
  if (!smokeOnly) {
    await step('构建镜像', () =>
      compose('build', 'postgres', 'migrate', 'caddy', ...(environment.smoke ? ['smoke'] : [])),
    );
    await step('启动数据库', () => compose('up', '-d', '--wait', 'postgres'));
    await step('执行迁移（migrate）', () => compose('run', '--rm', '--no-deps', 'migrate'));
    if (environment.seed) {
      await step('灌示例数据（seed）', () => compose('run', '--rm', '--no-deps', 'seed'));
    }
    await step('启动 api、worker、caddy', () => {
      compose('up', '-d', '--wait', '--no-deps', 'api', 'worker', 'caddy');
      checkRunningRelease(compose, release);
      writeFileSync(releaseFile, `${release}\n`);
    });
  }
  await step('内网 HTTPS（用导出的根证书核对）', async () => {
    rootCert = await exportRootCert(compose);
    await checkHttps(deployEnv, rootCert.pem);
  });
  if (environment.smoke) {
    smoke = await step('冒烟（Playwright：开发登录 → 顶栏）', () => runSmoke(compose));
  }

  const port = deployEnv?.httpsPort;
  publishReport(
    formatReport({
      environment: environment.name,
      project: environment.project,
      release: release ?? '（未知）',
      url: deployEnv
        ? `https://${deployEnv.siteHost}${port === 443 ? '' : `:${port}`}/`
        : '（未知）',
      rootCertFingerprint: rootCert?.fingerprint ?? null,
      steps: step.results,
      smoke: smoke ?? null,
    }),
  );
  return step.results.every((s) => s.status === 'passed');
}

async function main() {
  switch (command) {
    case 'deploy':
      return deploy({ smokeOnly: false });
    case 'smoke':
      return deploy({ smokeOnly: true });
    case 'cert': {
      const compose = composeRunner(loadDeployEnv(), deployedRelease());
      const { fingerprint } = await exportRootCert(compose);
      console.log(`根证书已导出到 ${rootCertFile}\nSHA-256 指纹：${fingerprint}`);
      return true;
    }
    case 'compose': {
      const compose = composeRunner(loadDeployEnv(), deployedRelease());
      return compose.status(...commandArgs) === 0;
    }
    case 'down': {
      const deployEnv = loadDeployEnv();
      const release = existsSync(releaseFile) ? deployedRelease() : 'none';
      composeRunner(deployEnv, release)('down');
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
