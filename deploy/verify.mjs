// 部署配置的静态检查（CI 的镜像作业与 pnpm ci:local 执行，ADR 0013 修订）：
// Compose 文件按模板 deploy/.env.example 能完整插值；前端镜像（caddy + 静态文件）能构建；Caddyfile 能通过 caddy validate。
// 不起任何服务，不需要环境文件。
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { playwrightVersion } from './lib/report.mjs';

process.chdir(path.resolve(import.meta.dirname, '..'));

function run(args, env = process.env) {
  const { status, error } = spawnSync('docker', args, { stdio: 'inherit', env });
  if (error) throw error;
  if (status !== 0) {
    console.error(`docker ${args.join(' ')} 退出码 ${status}`);
    process.exit(1);
  }
}

const env = {
  ...process.env,
  RELEASE: 'ci',
  PLAYWRIGHT_VERSION: playwrightVersion(readFileSync('pnpm-lock.yaml', 'utf8')),
};
run(
  ['compose', '-f', 'deploy/compose.yml', '--env-file', 'deploy/.env.example', 'config', '-q'],
  env,
);
run(['build', '-f', 'deploy/web/Dockerfile', '-t', 'forcome-web:ci', '.']);
run([
  'run',
  '--rm',
  '-e',
  'SITE_HOST=ci.forcome.internal',
  'forcome-web:ci',
  'caddy',
  'validate',
  '--config',
  '/etc/caddy/Caddyfile',
]);
console.log('部署配置检查通过：Compose 文件、前端镜像、Caddyfile');
