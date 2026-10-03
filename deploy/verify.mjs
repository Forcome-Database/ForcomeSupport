// 部署配置的静态检查（CI 的镜像作业与 pnpm ci:local 执行，ADR 0013 修订）：
// Compose 文件按模板 deploy/.env.example 能完整插值；前端镜像（caddy + 静态文件）能构建；Caddyfile 能通过 caddy validate。
// 不起任何服务，不需要环境文件。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { composeEnvironment } from './lib/compose.mjs';
import { mustRun } from './lib/process.mjs';

process.chdir(path.resolve(import.meta.dirname, '..'));

const example = 'deploy/.env.example';
const env = composeEnvironment({
  processEnv: process.env,
  envFileVars: parseEnv(readFileSync(example, 'utf8')),
  release: 'ci',
  lockText: readFileSync('pnpm-lock.yaml', 'utf8'),
});
mustRun('docker', ['compose', '-f', 'deploy/compose.yml', '--env-file', example, 'config', '-q'], {
  env,
});
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
console.log('部署配置检查通过：Compose 文件、前端镜像、Caddyfile');
