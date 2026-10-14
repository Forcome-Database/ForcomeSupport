// 用 actionlint（Docker 镜像，含 shellcheck）校验 .github/workflows 下全部 GitHub Actions 工作流的语法（ADR 0013 修订），
// 并用同一个镜像里的 shellcheck 检查部署用的 shell 脚本（PostgreSQL 镜像里的备份与恢复脚本、冒烟入口；待办 28）。
// 仓库暂不上 GitHub，工作流不会真正运行，靠它在本机发现写错的地方。
// 文件打成 tar 经标准输入送进容器（不挂载本机目录）：Docker 上下文指向远端主机时也能用（待办 28）。
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const IMAGE = 'rhysd/actionlint:1.7.12';
process.chdir(path.resolve(import.meta.dirname, '..'));

const workflows = readdirSync('.github/workflows')
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => `.github/workflows/${file}`);
const scripts = [
  ...readdirSync('deploy/postgres/bin').map((file) => `deploy/postgres/bin/${file}`),
  'deploy/smoke/run-smoke.sh',
];

const archive = execFileSync('tar', ['-cf', '-', '.github', ...scripts], {
  maxBuffer: 64 * 1024 * 1024,
});
// 容器里没有 git 仓库，actionlint 找不到项目根目录：逐个传入文件，并显式指定配置（自托管运行器的标签）
const quote = (files) => files.map((file) => `'${file}'`).join(' ');
execFileSync(
  'docker',
  [
    'run',
    '--rm',
    '-i',
    '--entrypoint',
    'sh',
    IMAGE,
    '-c',
    [
      'set -e',
      // 镜像以普通用户运行，解到 /tmp 下
      'mkdir /tmp/repo',
      'cd /tmp/repo',
      'tar -xf -',
      `actionlint -color -config-file .github/actionlint.yaml ${quote(workflows)}`,
      `shellcheck ${quote(scripts)}`,
    ].join('\n'),
  ],
  { input: archive, stdio: ['pipe', 'inherit', 'inherit'] },
);
console.log(`工作流语法检查通过：${workflows.join('、')}`);
console.log(`shell 脚本检查通过：${scripts.join('、')}`);
