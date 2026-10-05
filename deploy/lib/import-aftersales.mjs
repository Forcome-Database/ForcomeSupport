// 「售后登记表导入」子命令（待办 27）：node deploy/deploy.mjs <环境> import-aftersales <登记表> [--mapping <映射表>] [--dry-run]
// 用当前部署的版本起一次性容器执行 dist/import-aftersales.mjs；表格与映射表以只读方式挂进容器的 /import/。
// 挂载用本机绝对路径：-v 的「D:\…:/import/…」在 Windows 的 Docker Desktop 上可用（本机已验证）；deploy.mjs 开头说的
// 「盘符被当成容器名」只发生在 docker compose cp 这类「容器:路径」的参数上。
import path from 'node:path';
import { parseArgs } from 'node:util';

export const IMPORT_AFTERSALES_USAGE =
  'import-aftersales <登记表.xlsx|.csv> [--mapping <映射表.json>] [--dry-run]';

/**
 * 子命令的参数 → 一次性容器的挂载（docker compose run 的 -v）与容器里的命令。
 * 容器里的文件名沿用原名（导入报告与导入记录写的来源就是它），映射表放在 /import/mapping/ 下以免与表格重名。
 * @param {string[]} args 子命令后的参数
 * @param {(file: string) => string} resolve 本机路径 → 绝对路径（Docker 挂载要绝对路径）
 * @returns {{ volumes: string[], command: string[] } | { error: string }}
 */
export function importAftersalesRun(args, resolve) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: { mapping: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
    });
  } catch (error) {
    return { error: `${error.message}\n用法：${IMPORT_AFTERSALES_USAGE}` };
  }
  const [sheet, ...rest] = parsed.positionals;
  if (!sheet || rest.length > 0) return { error: `用法：${IMPORT_AFTERSALES_USAGE}` };
  const inContainer = `/import/${path.basename(sheet)}`;
  const volumes = [`${resolve(sheet)}:${inContainer}:ro`];
  const command = ['node', 'dist/import-aftersales.mjs', inContainer];
  if (parsed.values.mapping) {
    const mapping = `/import/mapping/${path.basename(parsed.values.mapping)}`;
    volumes.push(`${resolve(parsed.values.mapping)}:${mapping}:ro`);
    command.push('--mapping', mapping);
  }
  if (parsed.values['dry-run']) command.push('--dry-run');
  return { volumes, command };
}
