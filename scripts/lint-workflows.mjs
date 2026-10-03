// 用 actionlint（Docker 镜像，含 shellcheck）校验 .github/workflows 下全部 GitHub Actions 工作流的语法
// （ADR 0013 修订）。仓库暂不上 GitHub，工作流不会真正运行，靠它在本机发现写错的地方。
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const IMAGE = 'rhysd/actionlint:1.7.12';
const github = path.resolve('.github');
// 容器里没有 git 仓库，actionlint 找不到项目根目录：逐个传入文件，并显式指定配置（自托管运行器的标签）
const workflows = readdirSync(path.join(github, 'workflows'))
  .filter((file) => /\.ya?ml$/.test(file))
  .map((file) => `.github/workflows/${file}`);

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
    '-config-file',
    '.github/actionlint.yaml',
    ...workflows,
  ],
  { stdio: 'inherit' },
);
console.log(`工作流语法检查通过：${workflows.join('、')}`);
