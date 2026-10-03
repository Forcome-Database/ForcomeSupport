// 示例数据夹具（待办 02）：从 design/spec/data.py 生成 packages/fixtures/data/demo.json，或核对产物是否最新。
//   node scripts/fixtures.mjs generate   重新生成并覆盖产物
//   node scripts/fixtures.mjs verify     生成到临时文件，与仓库里的产物逐字节比较（CI 与 pnpm ci:local 执行）
// 生成脚本是 Python（示例数据就是 Python），这里只负责找解释器：Windows 上是 python，Linux 上通常只有 python3。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const GENERATOR = 'scripts/fixtures/export_demo_fixture.py';
const OUTPUT = 'packages/fixtures/data/demo.json';

function python() {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // 换下一个
    }
  }
  throw new Error('找不到 Python 3（python3 或 python），生成夹具需要它');
}

function generate(out) {
  execFileSync(python(), [GENERATOR, out], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
}

const command = process.argv[2];
if (command === 'generate') {
  generate(OUTPUT);
  console.log(`已生成 ${OUTPUT}`);
} else if (command === 'verify') {
  const dir = mkdtempSync(path.join(tmpdir(), 'forcome-fixtures-'));
  try {
    const fresh = path.join(dir, 'demo.json');
    generate(fresh);
    if (!readFileSync(fresh).equals(readFileSync(OUTPUT))) {
      console.error(
        `${OUTPUT} 与 design/spec/data.py 不一致：请运行 pnpm fixtures:generate，检查差异后提交。`,
      );
      process.exit(1);
    }
    console.log('示例数据夹具与 data.py 一致');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.error('用法：node scripts/fixtures.mjs generate | verify');
  process.exit(2);
}
