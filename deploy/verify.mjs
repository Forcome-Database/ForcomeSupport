// 部署配置的静态检查（CI 的镜像作业与 pnpm ci:local 执行，ADR 0013 修订）：
// Compose 文件按两份模板（开发测试 deploy/.env.example、生产 deploy/.env.production.example）都能完整插值；
// 前端镜像（caddy + 静态文件）能构建；Caddyfile 能通过 caddy validate；PostgreSQL 镜像（WAL-G、restic、supercronic 与
// 备份恢复脚本，待办 28）能构建。不起任何服务，不需要环境文件。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { composeEnvironment } from './lib/compose.mjs';
import { mustRun } from './lib/process.mjs';

process.chdir(path.resolve(import.meta.dirname, '..'));

for (const example of ['deploy/.env.example', 'deploy/.env.production.example']) {
  const env = composeEnvironment({
    processEnv: process.env,
    envFileVars: parseEnv(readFileSync(example, 'utf8')),
    release: 'ci',
    lockText: readFileSync('pnpm-lock.yaml', 'utf8'),
  });
  mustRun(
    'docker',
    ['compose', '-f', 'deploy/compose.yml', '--env-file', example, 'config', '-q'],
    { env },
  );
}
mustRun('docker', [
  'build',
  '-f',
  'deploy/web/Dockerfile',
  '--target',
  'web',
  '-t',
  'forcome-web:ci',
  '.',
]);
mustRun('docker', [
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
// 镜像里构建时就执行 wal-g --version 与 restic version（下载的二进制核对过校验和）
mustRun('docker', ['build', '-f', 'deploy/postgres/Dockerfile', '-t', 'forcome-postgres:ci', '.']);
console.log(
  '部署配置检查通过：Compose 文件（开发测试与生产）、前端镜像、Caddyfile、PostgreSQL 镜像',
);
