// 检查迁移与各模块 schema.ts 一致（ADR 0006）：重新运行 drizzle-kit generate，
// 迁移目录有任何变化（新文件或改动）就失败——说明改了表结构却没有生成并提交迁移。
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS = 'apps/server/drizzle';

function snapshot(dir) {
  const files = new Map();
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files.set(file, createHash('sha256').update(readFileSync(file)).digest('hex'));
  }
  return files;
}

const before = snapshot(MIGRATIONS);
execSync('pnpm --filter @forcome/server db:generate', { stdio: 'inherit' });
const after = snapshot(MIGRATIONS);

const changed = [...after].filter(([file, hash]) => before.get(file) !== hash).map(([f]) => f);
const removed = [...before.keys()].filter((file) => !after.has(file));
if (changed.length > 0 || removed.length > 0) {
  console.error(
    `迁移与表结构不一致：重新生成后变化的文件\n${[...changed, ...removed].join('\n')}\n` +
      '请运行 pnpm db:generate，检查生成的迁移并提交。',
  );
  process.exit(1);
}
console.log('迁移与表结构一致');
