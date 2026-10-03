// 用 actionlint（Docker 镜像，含 shellcheck）校验 GitHub Actions 工作流语法（ADR 0013 修订）。
// 仓库暂不上 GitHub，工作流不会真正运行，靠它在本机发现写错的地方。
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const IMAGE = 'rhysd/actionlint:1.7.12';
const github = path.resolve('.github');

execFileSync(
  'docker',
  [
    'run',
    '--rm',
    '-v',
    `${github}:/repo/.github:ro`,
    '-w',
    '/repo',
    IMAGE,
    '-color',
    '.github/workflows/ci.yml',
  ],
  { stdio: 'inherit' },
);
console.log('工作流语法检查通过');
